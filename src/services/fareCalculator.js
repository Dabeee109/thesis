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
 *  - Subtotal * (1 + weatherSurchargeRate), rounded to the nearest 5.00 PHP.
 */

const MAX_DELIVERY_DISTANCE_KM = 3.0;
const MOTORCYCLE_KM_PER_LITER = 45.0;
const FUEL_PRICE_PER_LITER = 85.0;

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
function calculateDeliveryFare(distanceKm, vehicleType = 'motorcycle', weatherCondition = 'sunny', currentTime = null) {
  const dist = parseFloat(distanceKm);
  if (isNaN(dist) || dist < 0) {
    throw new Error('Invalid distance: Distance must be a positive number.');
  }

  if (dist > MAX_DELIVERY_DISTANCE_KM) {
    throw new Error(`Delivery distance (${dist.toFixed(2)} km) exceeds the maximum internal cafe delivery radius of ${MAX_DELIVERY_DISTANCE_KM} km.`);
  }

  const vType = (vehicleType || 'motorcycle').toLowerCase().trim();
  if (vType !== 'motorcycle' && vType !== 'bicycle') {
    throw new Error("Invalid vehicle type: Must be 'motorcycle' or 'bicycle'.");
  }

  let baseFare = 0;
  let distanceCharge = 0;
  let fuelCost = 0;
  let maintenanceCost = 0;

  // Step charge calculation for distance beyond the first 1.0 km
  const excessDistance = Math.max(0, dist - 1.0);
  const additionalHalfKmSteps = excessDistance > 0 ? Math.ceil(excessDistance / 0.5) : 0;

  if (vType === 'motorcycle') {
    baseFare = 49.00;
    distanceCharge = additionalHalfKmSteps * 12.00;
    fuelCost = (dist / MOTORCYCLE_KM_PER_LITER) * FUEL_PRICE_PER_LITER;
    maintenanceCost = 5.00 * dist;
  } else {
    // Bicycle
    baseFare = 35.00;
    distanceCharge = additionalHalfKmSteps * 10.00;
    fuelCost = 0.00;
    maintenanceCost = 3.00 * dist;
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

  // Round to the nearest 5.00 PHP
  const finalFare = Math.round(rawFinalFare / 5) * 5;

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
    maxRadiusKm: MAX_DELIVERY_DISTANCE_KM
  };
}

module.exports = {
  calculateDeliveryFare,
  isExtremeHeatWindow,
  MAX_DELIVERY_DISTANCE_KM
};
