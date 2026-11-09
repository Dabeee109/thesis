/**
 * Diner's Cafe Smart Delivery Fare Calculation Engine (FR6)
 * Internal delivery only: 0.0 km to 3.0 km range.
 * 
 * Vehicles:
 *  - Motorcycle:
 *      Fuel Cost = (distance / 45 km/L) * 85.00 PHP/L
 *      Base Fare = 49.00 PHP (first 1.0 km) + 12.00 PHP per additional 0.5 km
 *      Maintenance/Rider Allowance = 5.00 PHP * distance
 *      Subtotal = Base Fare + Distance Charge + Fuel Cost + Maintenance Cost
 * 
 *  - Bicycle:
 *      Fuel Cost = 0.00 PHP
 *      Base Fare = 35.00 PHP (first 1.0 km) + 10.00 PHP per additional 0.5 km
 *      Maintenance Cost = 3.00 PHP * distance
 *      Subtotal = Base Fare + Distance Charge + Maintenance Cost
 * 
 * Weather Surcharges:
 *  - 0%   (0.00) : sunny / normal
 *  - 15%  (0.15) : light_rain / drizzle
 *  - 35%  (0.35) : heavy_rain / storm
 *  - 15%  (0.15) : extreme_heat (or automatic if currentTime is between 11:00 AM and 3:00 PM)
 * 
 * Final Fare:
 *  - Subtotal * (1 + weatherSurchargeRate), formatted to exact 2-decimal currency (no ₱5 rounding).
 */

const MAX_DELIVERY_DISTANCE_KM = 3.0;
const MOTORCYCLE_KM_PER_LITER = 45.0;
const FUEL_PRICE_PER_LITER = 85.0;

let systemSettingsService = null;
try {
  systemSettingsService = require('./systemSettingsService');
} catch (e) {
  systemSettingsService = null;
}

/**
 * Checks whether a given Date or time string falls in extreme heat window (11:00 AM - 3:00 PM).
 * @param {Date|string|null} time 
 * @returns {boolean}
 */
function isExtremeHeatWindow(time) {
  if (!time) return false;
  let dateObj;
  if (time instanceof Date) {
    dateObj = time;
  } else if (typeof time === 'string') {
    // If format is HH:MM or HH:MM:SS
    if (/^\d{1,2}:\d{2}/.test(time)) {
      const parts = time.split(':');
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const totalMinutes = hours * 60 + minutes;
      return totalMinutes >= 11 * 60 && totalMinutes <= 15 * 60;
    }
    dateObj = new Date(time);
  } else {
    return false;
  }

  if (isNaN(dateObj.getTime())) return false;
  const hours = dateObj.getHours();
  const minutes = dateObj.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  // 11:00 AM (660 min) to 3:00 PM (900 min)
  return totalMinutes >= 660 && totalMinutes <= 900;
}

/**
 * Calculates delivery fare with complete mathematical breakdown
 * 
 * @param {number} distanceKm - Distance in kilometers (0.0 to 3.0 km)
 * @param {string} vehicleType - 'motorcycle' or 'bicycle'
 * @param {string} weatherCondition - 'sunny', 'light_rain', 'heavy_rain', or 'extreme_heat'
 * @param {Date|string|null} currentTime - Optional timestamp to evaluate extreme heat window
 * @returns {Object} Complete fare computation details
 */
function calculateDeliveryFare(distanceKm, vehicleType = 'motorcycle', weatherCondition = 'sunny', currentTime = null, maxRadius = null, customRates = null) {
  const dist = parseFloat(distanceKm);
  if (isNaN(dist) || dist < 0) {
    throw new Error('Invalid distance: Distance must be a positive number.');
  }

  const effectiveMaxRadius = Number.isFinite(maxRadius) && maxRadius > 0 ? maxRadius : MAX_DELIVERY_DISTANCE_KM;

  if (dist > effectiveMaxRadius) {
    throw new Error(`Delivery distance (${dist.toFixed(2)} km) exceeds the maximum internal cafe delivery radius of ${effectiveMaxRadius} km.`);
  }

  const vType = (vehicleType || 'motorcycle').toLowerCase().trim();
  if (vType !== 'motorcycle' && vType !== 'bicycle') {
    throw new Error("Invalid vehicle type: Must be 'motorcycle' or 'bicycle'.");
  }

  // Resolve dynamic fare matrix variables (Requirement 1 & 2)
  const cachedSettings = systemSettingsService?.getCachedSystemSettings?.() || {};
  const activeBaseFare = Number.isFinite(parseFloat(customRates?.fare_base))
    ? parseFloat(customRates.fare_base)
    : (Number.isFinite(parseFloat(cachedSettings.fare_base)) ? parseFloat(cachedSettings.fare_base) : 49.00);

  const activePer05km = Number.isFinite(parseFloat(customRates?.fare_per_05km))
    ? parseFloat(customRates.fare_per_05km)
    : (Number.isFinite(parseFloat(cachedSettings.fare_per_05km)) ? parseFloat(cachedSettings.fare_per_05km) : 12.00);

  const activeFuelCost = Number.isFinite(parseFloat(customRates?.fare_fuel_cost))
    ? parseFloat(customRates.fare_fuel_cost)
    : (Number.isFinite(parseFloat(cachedSettings.fare_fuel_cost)) ? parseFloat(cachedSettings.fare_fuel_cost) : 2.83);

  const activeMaintenance = Number.isFinite(parseFloat(customRates?.fare_maintenance))
    ? parseFloat(customRates.fare_maintenance)
    : (Number.isFinite(parseFloat(cachedSettings.fare_maintenance)) ? parseFloat(cachedSettings.fare_maintenance) : 7.50);

  let baseFare = 0;
  let distanceCharge = 0;
  let fuelCost = 0;
  let maintenanceCost = 0;

  // Step charge calculation for distance beyond the first 1.0 km
  const excessDistance = Math.max(0, dist - 1.0);
  const additionalHalfKmSteps = excessDistance > 0 ? Math.ceil(excessDistance / 0.5) : 0;

  if (vType === 'motorcycle') {
    baseFare = activeBaseFare;
    distanceCharge = additionalHalfKmSteps * activePer05km;
    fuelCost = dist > 0 ? parseFloat(((dist / 1.5) * activeFuelCost).toFixed(2)) : 0.00;
    maintenanceCost = dist > 0 ? parseFloat(((dist / 1.5) * activeMaintenance).toFixed(2)) : 0.00;
  } else {
    // Bicycle
    baseFare = Math.max(0, activeBaseFare - 14.00);
    distanceCharge = additionalHalfKmSteps * Math.max(0, activePer05km - 2.00);
    fuelCost = 0.00;
    maintenanceCost = dist > 0 ? parseFloat(((dist / 1.5) * (activeMaintenance * 0.4)).toFixed(2)) : 0.00;
  }

  const subtotal = baseFare + distanceCharge + fuelCost + maintenanceCost;

  // Weather surcharge resolution
  let normalizedWeather = (weatherCondition || 'sunny').toLowerCase().trim();
  let surchargeRate = 0.0;

  const inHeatWindow = isExtremeHeatWindow(currentTime);
  if (normalizedWeather === 'extreme_heat' || inHeatWindow) {
    surchargeRate = 0.15;
    normalizedWeather = 'extreme_heat';
  } else if (normalizedWeather === 'light_rain' || normalizedWeather === 'drizzle') {
    surchargeRate = 0.15;
  } else if (normalizedWeather === 'heavy_rain' || normalizedWeather === 'storm') {
    surchargeRate = 0.35;
  } else {
    surchargeRate = 0.0;
    normalizedWeather = 'sunny';
  }

  const surchargeAmount = subtotal * surchargeRate;
  const rawFinalFare = subtotal * (1 + surchargeRate);

  // Exact 2-decimal currency formatting (no ₱5 rounding)
  const finalFare = Number(rawFinalFare.toFixed(2));

  return {
    distanceKm: parseFloat(dist.toFixed(2)),
    vehicleType: vType,
    weatherCondition: normalizedWeather,
    isExtremeHeatTime: inHeatWindow,
    baseFare: parseFloat(baseFare.toFixed(2)),
    distanceCharge: parseFloat(distanceCharge.toFixed(2)),
    additionalHalfKmSteps,
    fuelCost: parseFloat(fuelCost.toFixed(2)),
    maintenanceCost: parseFloat(maintenanceCost.toFixed(2)),
    subtotal: parseFloat(subtotal.toFixed(2)),
    surchargeRate: parseFloat(surchargeRate.toFixed(2)),
    surchargeAmount: parseFloat(surchargeAmount.toFixed(2)),
    rawFinalFare: parseFloat(rawFinalFare.toFixed(2)),
    finalFare: Math.max(0, finalFare),
    currency: 'PHP',
    maxRadiusKm: effectiveMaxRadius
  };
}

const { calculateDeliveryFee, computeDeliveryFee } = require('./deliveryFeeCalculator');

module.exports = {
  calculateDeliveryFare,
  calculateDeliveryFee,
  computeDeliveryFee,
  isExtremeHeatWindow,
  MAX_DELIVERY_DISTANCE_KM
};
