const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCheckoutForm, isCheckoutForm, parsePhoneNumber, parseOrderItems, parseGoogleMapsLink } = require('../src/services/orderCheckoutParser');

test('Order Checkout Form Parser Suite', async (t) => {
  await t.test('1. Valid Full Template with coordinates and GCash', () => {
    const rawMessage = `
🛒 Diner's Cafe — Order Checkout Form
Full Name: Maria Santos
Contact Number: 0917-888-9999
Delivery Address: Unit 302, Gagalangin, Tondo, Manila (near Deca Mall)
Google Maps / Pin Location Link: https://maps.google.com/?q=14.6225,120.9705
Order Summary / Items: Signature Spanish Latte x 2, Classic Beef Tapa Rice Bowl x 1
Special Instructions / Notes: Less ice on latte, extra garlic on tapa please
Payment Method: GCash
    `;

    const res = parseCheckoutForm(rawMessage);
    assert.equal(res.isForm, true);
    assert.equal(res.isValid, true);
    assert.equal(res.errors.length, 0);
    assert.equal(res.data.customer.fullName, 'Maria Santos');
    assert.equal(res.data.customer.phone, '+639178889999');
    assert.equal(res.data.customer.phoneNational, '09178889999');
    assert.equal(res.data.delivery.address, 'Unit 302, Gagalangin, Tondo, Manila (near Deca Mall)');
    assert.ok(res.data.delivery.extractedCoords);
    assert.equal(res.data.delivery.extractedCoords.lat, 14.6225);
    assert.equal(res.data.delivery.extractedCoords.lng, 120.9705);
    assert.ok(res.data.delivery.distanceFromStoreKm > 0);
    assert.equal(res.data.items.length, 2);
    assert.equal(res.data.items[0].name, 'Signature Spanish Latte');
    assert.equal(res.data.items[0].quantity, 2);
    assert.equal(res.data.items[1].name, 'Classic Beef Tapa Rice Bowl');
    assert.equal(res.data.items[1].quantity, 1);
    assert.equal(res.data.paymentMethod, 'GCash');
    assert.equal(res.data.specialInstructions, 'Less ice on latte, extra garlic on tapa please');
  });

  await t.test('2. Template with brackets retained by customer', () => {
    const rawMessage = `
🛒 Diner's Cafe — Order Checkout Form
Full Name: [Juan Dela Cruz]
Contact Number: [09181234567]
Delivery Address: [123 Juan Luna St., Tondo, Manila]
Google Maps / Pin Location Link: [Empty]
Order Summary / Items: [Caramel Macchiato x 1, Almond Croissant x 2]
Special Instructions / Notes: []
Payment Method: [GCash]
    `;

    const res = parseCheckoutForm(rawMessage);
    assert.equal(res.isForm, true);
    assert.equal(res.isValid, true);
    assert.equal(res.data.customer.fullName, 'Juan Dela Cruz');
    assert.equal(res.data.customer.phone, '+639181234567');
    assert.equal(res.data.delivery.mapsUrl, null);
    assert.equal(res.data.items.length, 2);
    assert.equal(res.data.specialInstructions, 'None');
  });

  await t.test('3. Invalid Phone Number Validation', () => {
    const rawMessage = `
🛒 Diner's Cafe — Order Checkout Form
Full Name: Carlos Tan
Contact Number: 12345
Delivery Address: Herbosa St, Tondo
Google Maps / Pin Location Link: Empty
Order Summary / Items: Iced Americano x 1
Special Instructions / Notes: None
Payment Method: GCash
    `;

    const res = parseCheckoutForm(rawMessage);
    assert.equal(res.isForm, true);
    assert.equal(res.isValid, false);
    assert.ok(res.errors.some(e => e.includes('Philippine mobile number')));
  });

  await t.test('4. Missing required fields validation', () => {
    const rawMessage = `
🛒 Diner's Cafe — Order Checkout Form
Full Name: 
Contact Number: 
Delivery Address: 
Google Maps / Pin Location Link: 
Order Summary / Items: 
Special Instructions / Notes: 
Payment Method: 
    `;

    const res = parseCheckoutForm(rawMessage);
    assert.equal(res.isForm, true);
    assert.equal(res.isValid, false);
    assert.ok(res.errors.length >= 3);
  });
});
