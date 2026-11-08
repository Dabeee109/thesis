const db = require('../database/db');
(async () => {
  const [rows] = await db.query("SELECT psid, first_name, cart_json FROM customers WHERE cart_json IS NOT NULL AND length(cart_json) > 2");
  console.log("Non-empty carts in DB:", rows);
})();

