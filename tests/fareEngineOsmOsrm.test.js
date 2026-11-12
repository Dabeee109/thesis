const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const testDbPath = path.join(__dirname, 'test_fare_engine_osm.sqlite');
try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (_) {}

process.env.DB_FORCE_SQLITE = '1';
process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const axios = require('axios');
const { initDatabase } = require('../database/db');
const fareEngine = require('../src/services/fareEngine');
const deliveryController = require('../src/controllers/deliveryController');
const messengerService = require('../src/services/messengerService');
const {
  getSession,
  saveSession,
  resolveDeliveryAddressAndFare,
  handleTextInput
} = require('../src/services/nlpEngine');

const sentMessages = [];
const origCallSendAPI = messengerService.callSendAPI;
messengerService.callSendAPI = async (psid, messagePayload) => {
  sentMessages.push({ psid, messagePayload });
  return { recipient_id: psid, message_id: `mid.fare.${Date.now()}` };
};

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      return this;
    }
  };
}

test('Open-Source Delivery Distance & Fare Engine (Nominatim + OSRM)', async (t) => {
  await initDatabase();
  await new Promise(r => setTimeout(r, 300));

  await t.test('1. computeBreakdown computes exact 2-decimal fare without ₱5 rounding', () => {
    const res = fareEngine.computeBreakdown(1.45, 3.0);
    assert.strictEqual(res.distanceKm, 1.45);
    assert.strictEqual(res.isOutOfBounds, false);
    assert.deepStrictEqual(res.breakdown, {
      baseFare: 49.00,
      distanceCharge: 12.00,
      fuelCost: 4.10,
      maintenanceAllowance: 7.50,
      finalFare: 72.60
    });

    const oob = fareEngine.computeBreakdown(3.45, 3.0);
    assert.strictEqual(oob.isOutOfBounds, true);
  });

  await t.test('2. geocodeAddressWithLandmark enforces User-Agent and multi-tier landmark fallback', async () => {
    const seenQueries = [];
    const seenHeaders = [];
    const mockHttp = {
      async get(url, cfg) {
        seenQueries.push(cfg.params.q);
        seenHeaders.push(cfg.headers['User-Agent']);
        assert.strictEqual(url, 'https://nominatim.openstreetmap.org/search');
        assert.strictEqual(cfg.params.format, 'json');
        assert.strictEqual(cfg.params.limit, 1);
        assert.strictEqual(cfg.params.addressdetails, 1);

        // Fail tier 1 and tier 2, succeed on tier 3 (landmark standalone)
        if (seenQueries.length < 3) {
          return { data: [] };
        }
        return {
          data: [{
            lat: '14.6225',
            lon: '120.9705',
            display_name: 'SM City San Lazaro, Manila, Philippines'
          }]
        };
      }
    };

    const coords = await fareEngine.geocodeAddressWithLandmark(
      '123 Felix Huertas St',
      'SM City San Lazaro',
      { httpClient: mockHttp }
    );

    assert.strictEqual(seenQueries[0], '123 Felix Huertas St, near SM City San Lazaro, Philippines');
    assert.strictEqual(seenQueries[1], '123 Felix Huertas St, Philippines');
    assert.strictEqual(seenQueries[2], 'SM City San Lazaro, Philippines');
    assert.ok(seenHeaders.every(h => h.includes('DinersCafeApp/1.0')));
    assert.strictEqual(coords.latitude, 14.6225);
    assert.strictEqual(coords.longitude, 120.9705);
  });

  await t.test('3. geocodeAddressWithLandmark throws descriptive GEOCODE_NOT_FOUND when all tiers fail', async () => {
    const mockHttp = {
      async get() {
        return { data: [] };
      }
    };

    await assert.rejects(
      () => fareEngine.geocodeAddressWithLandmark('Unknown Street', 'Unknown Landmark', { httpClient: mockHttp }),
      err => err.code === 'GEOCODE_NOT_FOUND'
    );
  });

  await t.test('4. getOsrmDrivingDistanceKm formats {lng},{lat} and converts meters to km', async () => {
    let capturedUrl = null;
    const mockHttp = {
      async get(url) {
        capturedUrl = url;
        return {
          data: {
            code: 'Ok',
            routes: [{ distance: 1450 }]
          }
        };
      }
    };

    const route = await fareEngine.getOsrmDrivingDistanceKm(
      { latitude: 14.6143686, longitude: 120.9642334 },
      { latitude: 14.6225, longitude: 120.9705 },
      { httpClient: mockHttp }
    );

    assert.strictEqual(
      capturedUrl,
      'https://router.project-osrm.org/route/v1/driving/120.9642334,14.6143686;120.9705,14.6225?overview=false'
    );
    assert.strictEqual(route.distanceKm, 1.45);
    assert.strictEqual(route.provider, 'osrm');
  });

  await t.test('5. POST /api/delivery/calculate-fare returns exact JSON breakdown and 422 on unresolvable', async () => {
    const origAxiosGet = axios.get;
    axios.get = async (url) => {
      if (url.includes('nominatim.openstreetmap.org')) {
        return {
          data: [{
            lat: '14.6225',
            lon: '120.9705',
            display_name: 'Tayuman St, Tondo, Manila, Philippines'
          }]
        };
      }
      return {
        data: {
          code: 'Ok',
          routes: [{ distance: 1450 }]
        }
      };
    };

    try {
      const req = { body: { address: 'Tayuman St, Tondo', landmark: 'LRT Tayuman' } };
      const res = mockRes();
      await deliveryController.calculateFareFromAddress(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.distanceKm, 1.45);
      assert.strictEqual(res.body.isOutOfBounds, false);
      assert.deepStrictEqual(res.body.breakdown, {
        baseFare: 49.00,
        distanceCharge: 12.00,
        fuelCost: 4.10,
        maintenanceAllowance: 7.50,
        finalFare: 72.60
      });

      // Unresolvable returns 422
      axios.get = async () => ({ data: [] });
      const resFail = mockRes();
      await deliveryController.calculateFareFromAddress({ body: { address: 'Nowhere XYZ' } }, resFail);
      assert.strictEqual(resFail.statusCode, 422);
      assert.strictEqual(resFail.body.success, false);
    } finally {
      axios.get = origAxiosGet;
    }
  });

  await t.test('6. Chatbot workflow checks boundary (>3km -> Pick-up prompt) and populates exact fare when within coverage', async () => {
    const origAxiosGet = axios.get;
    const psid = `TEST_BOT_FARE_${Date.now()}`;
    sentMessages.length = 0;

    try {
      // A. Out of bounds (4.2 km) -> prompts switch to Store Pick-up
      axios.get = async (url) => {
        if (url.includes('nominatim.openstreetmap.org')) {
          return { data: [{ lat: '14.65', lon: '121.02', display_name: 'Quezon Ave, QC' }] };
        }
        return { data: { code: 'Ok', routes: [{ distance: 4200 }] } };
      };

      const session = await getSession(psid);
      const oobRes = await resolveDeliveryAddressAndFare(psid, session, 'Quezon Ave', 'Circle');
      assert.strictEqual(oobRes.intent, 'AWAITING_BOUNDARY_PICKUP_SWITCH');
      assert.ok(
        oobRes.replyLog.includes('lampas sa aming 3 km store delivery limit. Nais niyo po ba itong i-switch sa Store Pick-up?')
      );

      // Customer confirms switching to Store Pick-up
      const switchRes = await handleTextInput(psid, session, 'Oo, switch to pick up');
      assert.strictEqual(switchRes.intent, 'AWAITING_DISCOUNT_CONFIRMATION');
      assert.strictEqual(session.dining_mode, 'Pick-up');
      assert.strictEqual(session.delivery_fee, 0);

      // B. Within coverage (1.45 km) -> sets exact deliveryFee 72.60
      axios.get = async (url) => {
        if (url.includes('nominatim.openstreetmap.org')) {
          return { data: [{ lat: '14.6225', lon: '120.9705', display_name: 'Gagalangin, Tondo, Manila' }] };
        }
        return { data: { code: 'Ok', routes: [{ distance: 1450 }] } };
      };

      const session2 = await getSession(`${psid}_IN`);
      const inRes = await resolveDeliveryAddressAndFare(`${psid}_IN`, session2, 'Gagalangin', 'Deca Mall');
      assert.strictEqual(inRes.intent, 'AWAITING_ADDRESS_CONFIRMATION');
      assert.strictEqual(session2.delivery_fee, 72.60);
      assert.strictEqual(session2.deliveryFee, 72.60);
      assert.ok(inRes.replyLog.includes('Delivery Fee: ₱72.60'));
    } finally {
      axios.get = origAxiosGet;
    }
  });

  t.after(() => {
    messengerService.callSendAPI = origCallSendAPI;
    try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath); } catch (_) {}
  });
});

