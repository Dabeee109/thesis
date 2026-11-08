/**
 * Senior Citizen (RA 9994) & PWD (RA 10754) Portion Discount Calculator
 * Calculates statutory 20% discount (+ 12% VAT exemption) strictly on the cardholder's
 * individual personal food + beverage portion (1 drink + 1 food item only), NOT the bulk bill.
 */

/**
 * Determine if an item is a drink/beverage
 * @param {Object} item
 * @returns {boolean}
 */
function isBeverage(item) {
  const name = String(item.name || item.itemName || '').toLowerCase();
  const category = String(item.category || '').toLowerCase();
  if (category.includes('drink') || category.includes('beverage') || category.includes('coffee') || category.includes('tea')) {
    return true;
  }
  return /\b(latte|cappuccino|americano|espresso|coffee|kape|macchiato|mocha|cold brew|flat white|tea|frappe|horchata|matcha|water|juice|soda)\b/i.test(name);
}

/**
 * Compute statutory Senior/PWD discount strictly for 1 individual meal and 1 individual beverage
 * @param {Array} items - Array of { name, price, quantity, category? }
 * @param {Object} options - { cardholderCount: 1, applyVatExemption: true }
 * @returns {{
 *   eligibleItems: Array,
 *   portionSubtotal: number,
 *   discountAmount: number,
 *   totalSubtotal: number,
 *   finalSubtotal: number,
 *   breakdownText: string
 * }}
 */
function calculatePortionDiscount(items = [], options = {}) {
  const cardholders = Math.max(1, parseInt(options.cardholderCount, 10) || 1);
  const applyVat = options.applyVatExemption !== false;

  let totalSubtotal = 0;
  const flatLines = [];

  for (const it of items) {
    const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
    const price = parseFloat(it.price || it.unitPrice) || 0.0;
    totalSubtotal += price * qty;

    for (let q = 0; q < qty; q++) {
      flatLines.push({
        name: it.name || it.itemName || 'Item',
        price,
        isDrink: isBeverage(it)
      });
    }
  }

  // Sort descending by price to maximize allowable discount for the cardholder's single portion
  const drinks = flatLines.filter(it => it.isDrink).sort((a, b) => b.price - a.price);
  const foods = flatLines.filter(it => !it.isDrink).sort((a, b) => b.price - a.price);

  const eligibleDrinks = drinks.slice(0, cardholders);
  const eligibleFoods = foods.slice(0, cardholders);
  const eligibleItems = [...eligibleDrinks, ...eligibleFoods];

  const portionSubtotal = eligibleItems.reduce((sum, it) => sum + it.price, 0);

  let discountAmount = 0;
  if (portionSubtotal > 0) {
    if (applyVat) {
      // In the Philippines (RA 9994/RA 10754):
      // Gross includes 12% VAT.
      // Net of VAT = Gross / 1.12
      // 20% discount is applied to Net of VAT: (Net of VAT * 0.20)
      // Total deduction from gross = VAT component + 20% discount = Gross - (Net of VAT * 0.80)
      const vatableNet = portionSubtotal / 1.12;
      const vatExemption = portionSubtotal - vatableNet;
      const twentyPercentDiscount = vatableNet * 0.20;
      discountAmount = Math.round((vatExemption + twentyPercentDiscount) * 100) / 100;
    } else {
      // Straight 20% discount
      discountAmount = Math.round(portionSubtotal * 0.20 * 100) / 100;
    }
  }

  // Discount can never exceed total bill or portion subtotal
  discountAmount = Math.min(discountAmount, portionSubtotal, totalSubtotal);
  const finalSubtotal = Math.max(0, totalSubtotal - discountAmount);

  const breakdownText = eligibleItems.length > 0
    ? `Portion: ${eligibleItems.map(i => i.name).join(' + ')} (₱${portionSubtotal.toFixed(2)}) -> Less ₱${discountAmount.toFixed(2)} (20% + VAT Exemption)`
    : 'No eligible food or beverage items for Senior/PWD discount.';

  return {
    eligibleItems,
    portionSubtotal: Math.round(portionSubtotal * 100) / 100,
    discountAmount,
    totalSubtotal: Math.round(totalSubtotal * 100) / 100,
    finalSubtotal: Math.round(finalSubtotal * 100) / 100,
    breakdownText
  };
}

module.exports = {
  isBeverage,
  calculatePortionDiscount
};

