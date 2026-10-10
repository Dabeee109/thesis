const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const config = require('../src/config/config');
const {
  quoteDelivery,
  verifyQuote,
  chooseVehicle,
  haversineKm,
  validateCoords,
  GeoError
} = require('../src/services/geoService');
const { calculateDeliveryFare } = require('../src/services/fareCalculator');
const { getQuote, getServiceArea } = require('../src/controllers/deliveryQuoteController');

test('GeoService - haversineKm calculation', () => {
  // Two points 0.009 degrees of latitude apart are about 1.0 km
  const lat1 = 14.6042;
  const lng1 = 120.9822;
  const lat2 = 14.6042 + 0.009;
  const lng2 = 120.9822;

  const dist = haversineKm(lat1, lng1, lat2, lng2);
  assert.ok(Math.abs(dist - 1.0) <= 0.02, `Expected distance ~1.0 km, got ${dist.toFixed(4)} km`);
});

test('GeoService - validateCoords validation', () => {
  // 0,0 fails
  assert.throws(() => validateCoords(0, 0), (err) => err.code === 'GEO_INVALID_COORDS');

  // NaN fails
  assert.throws(() => validateCoords(NaN, 120.9822), (err) => err.code === 'GEO_INVALID_COORDS');

  // Lat > 90 fails
  assert.throws(() => validateCoords(91, 120.9822), (err) => err.code === 'GEO_INVALID_COORDS');

  // Outside Philippines (e.g. Paris, Europe)
  assert.throws(() => validateCoords(48.8566, 2.3522), (err) => err.code === 'GEO_OUT_OF_COUNTRY');

  // Valid Philippines coordinates pass
  assert.doesNotThrow(() => validateCoords(14.6042, 120.9822));
});

test('GeoService - Pin 1.5 km away and clock injection proof', async (t) => {
  const storeLat = config.store.lat || 14.6042;
  const storeLng = config.store.lng || 120.9822;

  const fakeMaps = {
    async geocode() { throw new Error('Should not be called'); },
    async routeDistance() { return { km: 1.5, etaMin: 9 }; }
  };
  const fakeWeather = {
    async getCurrentWeather() { return 'sunny'; }
  };

  await t.test('Outside extreme heat window (09:00 AM)', async () => {
    const fixedNow = new Date('2026-10-10T09:00:00+08:00');
    const originalBicycleMax = config.delivery.bicycleMaxKm;
    config.delivery.bicycleMaxKm = 1.0; // Set to 1.0 so 1.5 km evaluates to motorcycle

    try {
      const res = await quoteDelivery(
        { lat: storeLat + 0.012, lng: storeLng },
        { maps: fakeMaps, weather: fakeWeather, now: () => fixedNow }
      );

      assert.ok(res.quoteToken);
      assert.equal(res.distanceKm, 1.5);
      assert.equal(res.vehicleType, 'motorcycle');
      assert.equal(res.weatherCondition, 'sunny');

      const expectedFare = calculateDeliveryFare(1.5, 'motorcycle', 'sunny', fixedNow);
      assert.equal(res.fare.finalFare, expectedFare.finalFare);

      const claims = verifyQuote(res.quoteToken, { now: () => fixedNow });
      assert.equal(claims.distanceKm, 1.5);
      assert.equal(claims.deliveryFee, expectedFare.finalFare);
    } finally {
      config.delivery.bicycleMaxKm = originalBicycleMax;
    }
  });

  await t.test('Inside extreme heat window (13:00 PM) proves clock is injected', async () => {
    const fixedNow = new Date('2026-10-10T13:00:00+08:00');
    const originalBicycleMax = config.delivery.bicycleMaxKm;
    config.delivery.bicycleMaxKm = 1.0;

    try {
      const res = await quoteDelivery(
        { lat: storeLat + 0.012, lng: storeLng },
        { maps: fakeMaps, weather: fakeWeather, now: () => fixedNow }
      );

      assert.ok(res.quoteToken);
      const expectedFare = calculateDeliveryFare(1.5, 'motorcycle', 'sunny', fixedNow);
      assert.equal(res.weatherCondition, 'extreme_heat');
      assert.equal(res.fare.finalFare, expectedFare.finalFare);
    } finally {
      config.delivery.bicycleMaxKm = originalBicycleMax;
    }
  });
});

test('GeoService - Pin 5 km away throws GEO_TOO_FAR without calling routeDistance', async () => {
  const storeLat = config.store.lat || 14.6042;
  const storeLng = config.store.lng || 120.9822;

  let routeDistanceCalled = false;
  const fakeMaps = {
    async geocode() { throw new Error('Should not be called'); },
    async routeDistance() {
      routeDistanceCalled = true;
      return { km: 5.0, etaMin: 25 };
    }
  };

  // 0.045 degrees lat ≈ 5.0 km
  await assert.rejects(
    async () => {
      await quoteDelivery(
        { lat: storeLat + 0.045, lng: storeLng },
        { maps: fakeMaps, weather: { async getCurrentWeather() { return 'sunny'; } } }
      );
    },
    (err) => {
      assert.equal(err.code, 'GEO_TOO_FAR');
      assert.equal(err.status, 422);
      return true;
    }
  );

  assert.equal(routeDistanceCalled, false, 'Routing API must not be called when haversine exceeds service radius');
});

test('GeoService - Straight-line close but road distance 3.4 km throws GEO_TOO_FAR with details.roadKm', async () => {
  const storeLat = config.store.lat || 14.6042;
  const storeLng = config.store.lng || 120.9822;

  const fakeMaps = {
    async geocode() { throw new Error('Should not be called'); },
    async routeDistance() {
      return { km: 3.4, etaMin: 18 };
    }
  };

  await assert.rejects(
    async () => {
      await quoteDelivery(
        { lat: storeLat + 0.008, lng: storeLng }, // straight line ~0.9 km
        { maps: fakeMaps, weather: { async getCurrentWeather() { return 'sunny'; } } }
      );
    },
    (err) => {
      assert.equal(err.code, 'GEO_TOO_FAR');
      assert.equal(err.status, 422);
      assert.equal(err.details?.roadKm, 3.4);
      return true;
    }
  );
});

test('GeoService - Geocoding precision and not found errors', async () => {
  const fakeMapsVague = {
    async geocode() {
      return { lat: 14.6042, lng: 120.9822, formattedAddress: 'Manila', precision: 'APPROXIMATE' };
    },
    async routeDistance() { return { km: 1.0, etaMin: 5 }; }
  };

  await assert.rejects(
    async () => {
      await quoteDelivery({ address: 'Somewhere in Manila' }, { maps: fakeMapsVague });
    },
    (err) => {
      assert.equal(err.code, 'GEO_LOW_PRECISION');
      assert.equal(err.status, 422);
      return true;
    }
  );

  const fakeMapsNotFound = {
    async geocode() {
      throw new GeoError('GEO_NOT_FOUND', 'Address not found', 422);
    },
    async routeDistance() { return { km: 1.0, etaMin: 5 }; }
  };

  await assert.rejects(
    async () => {
      await quoteDelivery({ address: 'Nowhere St.' }, { maps: fakeMapsNotFound });
    },
    (err) => {
      assert.equal(err.code, 'GEO_NOT_FOUND');
      assert.equal(err.status, 422);
      return true;
    }
  );
});

test('GeoService - Provider failure throws GEO_PROVIDER_ERROR and produces no token', async () => {
  const storeLat = config.store.lat || 14.6042;
  const storeLng = config.store.lng || 120.9822;

  const fakeMapsThrow = {
    async geocode() { throw new Error('Unused'); },
    async routeDistance() {
      throw new GeoError('GEO_PROVIDER_ERROR', 'Provider network outage', 502);
    }
  };

  await assert.rejects(
    async () => {
      await quoteDelivery({ lat: storeLat + 0.005, lng: storeLng }, { maps: fakeMapsThrow });
    },
    (err) => {
      assert.equal(err.code, 'GEO_PROVIDER_ERROR');
      assert.equal(err.status, 502);
      return true;
    }
  );
});

test('GeoService - Server owns all pricing inputs (ignores client vehicleType, weather, fee)', async () => {
  const storeLat = config.store.lat || 14.6042;
  const storeLng = config.store.lng || 120.9822;

  const fakeMaps = {
    async geocode() { throw new Error('Unused'); },
    async routeDistance() { return { km: 2.5, etaMin: 14 }; }
  };
  const fakeWeather = {
    async getCurrentWeather() { return 'light_rain'; }
  };

  // Client attempts to cheat by submitting bicycle, sunny, and 1.00 PHP fee
  const res = await quoteDelivery(
    {
      lat: storeLat + 0.015,
      lng: storeLng,
      vehicleType: 'bicycle',
      weatherCondition: 'sunny',
      deliveryFee: 1.00
    },
    { maps: fakeMaps, weather: fakeWeather, now: () => new Date('2026-10-10T09:00:00+08:00') }
  );

  // 2.5 km exceeds BICYCLE_MAX_KM (1.5), so server must choose motorcycle
  assert.equal(res.vehicleType, 'motorcycle');
  assert.equal(res.weatherCondition, 'light_rain');
  assert.notEqual(res.fare.finalFare, 1.00);
});

test('GeoService - Both pin and address sent: pin is used and geocoder is not called', async () => {
  const storeLat = config.store.lat || 14.6042;
  const storeLng = config.store.lng || 120.9822;

  let geocodeCalled = false;
  const fakeMaps = {
    async geocode() {
      geocodeCalled = true;
      return { lat: 14.61, lng: 120.98, formattedAddress: 'Ignored', precision: 'ROOFTOP' };
    },
    async routeDistance() { return { km: 1.2, etaMin: 6 }; }
  };

  const res = await quoteDelivery(
    { lat: storeLat + 0.008, lng: storeLng, address: 'Custom Address Note' },
    { maps: fakeMaps, weather: { async getCurrentWeather() { return 'sunny'; } } }
  );

  assert.equal(geocodeCalled, false, 'Geocoder must not be called when pin coordinates are supplied');
  assert.equal(res.destination.lat, storeLat + 0.008);
});

test('GeoService - verifyQuote validation and expiration', () => {
  const fixedNow = new Date('2026-10-10T10:00:00+08:00');
  const claims = {
    lat: 14.6042,
    lng: 120.9822,
    address: '123 Test St',
    distanceKm: 1.5,
    vehicleType: 'motorcycle',
    weatherCondition: 'sunny',
    deliveryFee: 70
  };

  const iat = Math.floor(fixedNow.getTime() / 1000);
  const token = jwt.sign(
    { ...claims, iat },
    config.jwtSecret,
    { audience: 'delivery-quote', expiresIn: 600 }
  );

  // 1. Valid token
  const decoded = verifyQuote(token, { now: () => fixedNow });
  assert.equal(decoded.distanceKm, 1.5);
  assert.equal(decoded.deliveryFee, 70);

  // 2. Tampered token
  const tampered = token.slice(0, -6) + 'abcdef';
  assert.throws(
    () => verifyQuote(tampered, { now: () => fixedNow }),
    (err) => err.code === 'QUOTE_INVALID' && err.status === 400
  );

  // 3. Different audience token
  const wrongAudToken = jwt.sign({ ...claims, iat }, config.jwtSecret, { audience: 'staff-auth' });
  assert.throws(
    () => verifyQuote(wrongAudToken, { now: () => fixedNow }),
    (err) => err.code === 'QUOTE_INVALID' && err.status === 400
  );

  // 4. Expired token (advance time by 601 seconds)
  const expiredNow = new Date(fixedNow.getTime() + 601 * 1000);
  assert.throws(
    () => verifyQuote(token, { now: () => expiredNow }),
    (err) => err.code === 'QUOTE_EXPIRED' && err.status === 410
  );
});

test('GeoService - chooseVehicle boundaries', () => {
  const bicycleMax = config.delivery.bicycleMaxKm || 1.5;
  assert.equal(chooseVehicle(bicycleMax - 0.1), 'bicycle');
  assert.equal(chooseVehicle(bicycleMax), 'bicycle');
  assert.equal(chooseVehicle(bicycleMax + 0.01), 'motorcycle');
  assert.equal(chooseVehicle(3.0), 'motorcycle');
});

test('DeliveryQuoteController - Handler response codes and error shape', async (t) => {
  await t.test('Validation error returns 400 with VALIDATION_ERROR', async () => {
    let responseStatus = 0;
    let responseBody = null;

    const req = { body: {} }; // Missing pin and address
    const res = {
      status(s) { responseStatus = s; return this; },
      json(b) { responseBody = b; return this; }
    };

    await getQuote(req, res);
    assert.equal(responseStatus, 400);
    assert.equal(responseBody.success, false);
    assert.equal(responseBody.code, 'VALIDATION_ERROR');
    assert.ok(responseBody.message);
  });

  await t.test('Out of bounds location returns 422 with GEO_OUT_OF_COUNTRY', async () => {
    let responseStatus = 0;
    let responseBody = null;

    const req = { body: { lat: 48.8566, lng: 2.3522 } }; // Paris
    const res = {
      status(s) { responseStatus = s; return this; },
      json(b) { responseBody = b; return this; }
    };

    await getQuote(req, res);
    assert.equal(responseStatus, 422);
    assert.equal(responseBody.success, false);
    assert.equal(responseBody.code, 'GEO_OUT_OF_COUNTRY');
  });

  await t.test('Valid nearby pin returns 200 with quoteToken and fee', async () => {
    let responseStatus = 0;
    let responseBody = null;

    const storeLat = config.store.lat || 14.6042;
    const storeLng = config.store.lng || 120.9822;

    const req = { body: { lat: storeLat + 0.01, lng: storeLng } };
    const res = {
      status(s) { responseStatus = s; return this; },
      json(b) { responseBody = b; return this; }
    };

    await getQuote(req, res);
    assert.equal(responseStatus, 200);
    assert.equal(responseBody.success, true);
    assert.ok(responseBody.quoteToken);
    assert.ok(typeof responseBody.fare?.finalFare === 'number');
  });

  await t.test('GET /api/delivery/service-area returns public store metadata', async () => {
    let responseStatus = 0;
    let responseBody = null;

    const req = {};
    const res = {
      status(s) { responseStatus = s; return this; },
      json(b) { responseBody = b; return this; }
    };

    getServiceArea(req, res);
    assert.equal(responseStatus, 200);
    assert.equal(responseBody.success, true);
    assert.ok(Number.isFinite(responseBody.storeLat));
    assert.ok(Number.isFinite(responseBody.storeLng));
    assert.ok(Number.isFinite(responseBody.maxDeliveryKm));
  });
});
