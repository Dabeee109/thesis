const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDeliveryFare, isExtremeHeatWindow } = require('../src/services/fareCalculator');

test('Delivery Fare Engine - Motorcycle Calculations', async (t) => {
  await t.test('Case M1: 0.8 km distance, sunny weather (under 1.0 km)', () => {
    const result = calculateDeliveryFare(0.8, 'motorcycle', 'sunny');
    assert.equal(result.distanceKm, 0.8);
    assert.equal(result.vehicleType, 'motorcycle');
    assert.equal(result.baseFare, 49.00);
    assert.equal(result.distanceCharge, 0.00);
    assert.equal(result.additionalHalfKmSteps, 0);
    assert.equal(result.fuelCost, 1.51); // (0.8 / 45) * 85 = 1.511
    assert.equal(result.maintenanceCost, 4.00); // 5 * 0.8
    assert.equal(result.subtotal, 54.51);
    assert.equal(result.surchargeRate, 0.00);
    assert.equal(result.finalFare, 55.00); // 54.51 rounded to nearest 5
  });

  await t.test('Case M2: 1.5 km distance, sunny weather (1 additional 0.5km step)', () => {
    const result = calculateDeliveryFare(1.5, 'motorcycle', 'sunny');
    assert.equal(result.distanceKm, 1.5);
    assert.equal(result.baseFare, 49.00);
    assert.equal(result.additionalHalfKmSteps, 1);
    assert.equal(result.distanceCharge, 12.00);
    assert.equal(result.fuelCost, 2.83); // (1.5 / 45) * 85 = 2.833
    assert.equal(result.maintenanceCost, 7.50); // 5 * 1.5
    assert.equal(result.subtotal, 71.33);
    assert.equal(result.finalFare, 70.00); // 71.33 rounded to nearest 5
  });

  await t.test('Case M3: 2.2 km distance, light rain (15% surcharge, 3 steps)', () => {
    const result = calculateDeliveryFare(2.2, 'motorcycle', 'light_rain');
    assert.equal(result.distanceKm, 2.2);
    assert.equal(result.additionalHalfKmSteps, 3); // (2.2 - 1.0) / 0.5 = 2.4 -> ceil = 3
    assert.equal(result.distanceCharge, 36.00);
    assert.equal(result.surchargeRate, 0.15);
    assert.equal(result.finalFare, 115.00); // Subtotal 100.16 * 1.15 = 115.18 -> 115
  });

  await t.test('Case M4: 3.0 km maximum radius, heavy rain (35% surcharge, 4 steps)', () => {
    const result = calculateDeliveryFare(3.0, 'motorcycle', 'heavy_rain');
    assert.equal(result.distanceKm, 3.0);
    assert.equal(result.additionalHalfKmSteps, 4); // (3.0 - 1.0) / 0.5 = 4
    assert.equal(result.distanceCharge, 48.00);
    assert.equal(result.surchargeRate, 0.35);
    assert.equal(result.finalFare, 160.00); // Subtotal 117.67 * 1.35 = 158.85 -> 160
  });
});

test('Delivery Fare Engine - Bicycle Calculations', async (t) => {
  await t.test('Case B1: 0.5 km distance, sunny weather (under 1.0 km)', () => {
    const result = calculateDeliveryFare(0.5, 'bicycle', 'sunny');
    assert.equal(result.distanceKm, 0.5);
    assert.equal(result.vehicleType, 'bicycle');
    assert.equal(result.baseFare, 35.00);
    assert.equal(result.distanceCharge, 0.00);
    assert.equal(result.fuelCost, 0.00); // Bicycle has zero fuel cost
    assert.equal(result.maintenanceCost, 1.50); // 3 * 0.5
    assert.equal(result.subtotal, 36.50);
    assert.equal(result.finalFare, 35.00); // 36.50 rounded to nearest 5
  });

  await t.test('Case B2: 1.8 km distance, sunny weather (2 additional steps)', () => {
    const result = calculateDeliveryFare(1.8, 'bicycle', 'sunny');
    assert.equal(result.distanceKm, 1.8);
    assert.equal(result.baseFare, 35.00);
    assert.equal(result.additionalHalfKmSteps, 2); // (1.8 - 1.0) / 0.5 = 1.6 -> ceil = 2
    assert.equal(result.distanceCharge, 20.00); // 2 * 10.00
    assert.equal(result.fuelCost, 0.00);
    assert.equal(result.maintenanceCost, 5.40); // 3 * 1.8
    assert.equal(result.subtotal, 60.40);
    assert.equal(result.finalFare, 60.00); // 60.40 rounded to nearest 5
  });

  await t.test('Case B3: 2.5 km distance, extreme heat 15% surcharge at 1:30 PM', () => {
    const result = calculateDeliveryFare(2.5, 'bicycle', 'sunny', '13:30');
    assert.equal(result.distanceKm, 2.5);
    assert.equal(result.additionalHalfKmSteps, 3);
    assert.equal(result.distanceCharge, 30.00);
    assert.equal(result.isExtremeHeatTime, true);
    assert.equal(result.surchargeRate, 0.15);
    assert.equal(result.subtotal, 72.50); // 35 + 30 + 0 + 7.50
    assert.equal(result.finalFare, 85.00); // 72.50 * 1.15 = 83.375 -> 85
  });
});

test('Delivery Fare Engine - Extreme Heat Window Detection', () => {
  assert.equal(isExtremeHeatWindow('11:00'), true);
  assert.equal(isExtremeHeatWindow('13:15'), true);
  assert.equal(isExtremeHeatWindow('15:00'), true);
  assert.equal(isExtremeHeatWindow('09:30'), false);
  assert.equal(isExtremeHeatWindow('16:00'), false);
  assert.equal(isExtremeHeatWindow(null), false);
});

test('Delivery Fare Engine - Boundary & Error Validation', () => {
  // Boundary distances
  assert.doesNotThrow(() => calculateDeliveryFare(0.0, 'motorcycle'));
  assert.doesNotThrow(() => calculateDeliveryFare(3.0, 'motorcycle'));

  // Exceeds 3.0 km max radius
  assert.throws(() => {
    calculateDeliveryFare(3.1, 'motorcycle');
  }, /exceeds the maximum internal cafe delivery radius/i);

  // Negative distance
  assert.throws(() => {
    calculateDeliveryFare(-0.5, 'motorcycle');
  }, /Distance must be a positive number/i);

  // Invalid vehicle type
  assert.throws(() => {
    calculateDeliveryFare(1.5, 'helicopter');
  }, /Must be 'motorcycle' or 'bicycle'/i);
});
