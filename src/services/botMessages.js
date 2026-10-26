/**
 * Bot Message Catalog (Task 4)
 * Single source of truth for conversational bot messages, button labels, and quick replies.
 * Adheres strictly to Section 8 specifications.
 */

const { peso } = require('./textMatch');

const LABELS = {
  deliveryFee: 'Delivery fee',
  deliveryFeeEstimate: 'Delivery fee (estimate)'
};

const botMessages = {
  welcome: () => ({
    text: "Welcome to Diner's Cafe! What would you like?",
    quickReplies: [
      { title: '☕ Menu', payload: 'MENU_HOME' },
      { title: '🛒 Cart', payload: 'VIEW_CART' },
      { title: 'Track order', payload: 'TRACK_LATEST_ORDER' },
      { title: 'Info', payload: 'STORE_INFO' }
    ]
  }),

  menuIntro: () => ({
    text: "Here's our menu. Tap ➕ to add, or type an order.",
    quickReplies: []
  }),

  menuOutro: (hasCart = false) => {
    const qrs = [{ title: '🛒 Cart', payload: 'VIEW_CART' }];
    if (hasCart) {
      qrs.push({ title: 'Checkout', payload: 'CONFIRM_CHECKOUT' });
    }
    return {
      text: 'Type your order, e.g. “2 spanish latte”.',
      quickReplies: qrs
    };
  },

  added: (qty, name, totalFormatted) => ({
    text: `Added ${qty}x ${name}. Cart: ${totalFormatted}. Check out?`,
    quickReplies: [
      { title: 'Yes, checkout', payload: 'CONFIRM_CHECKOUT' },
      { title: 'Add more', payload: 'KEEP_SHOPPING' },
      { title: 'View cart', payload: 'VIEW_CART' }
    ]
  }),

  askQty: (name) => ({
    text: `How many ${name}?`,
    quickReplies: [
      { title: '1', payload: 'QTY_1' },
      { title: '2', payload: 'QTY_2' },
      { title: '3', payload: 'QTY_3' },
      { title: '4', payload: 'QTY_4' },
      { title: 'Cancel', payload: 'KEEP_SHOPPING' }
    ]
  }),

  cart: (lines, totalFormatted) => {
    // lines: [{ qty, name, lineTotal }]
    const lineTexts = lines.map(l => `${l.qty}x ${l.name} ${l.lineTotal}`).join('\n');
    return {
      text: `Your cart:\n${lineTexts}\nTotal ${totalFormatted}`,
      quickReplies: [
        { title: 'Checkout', payload: 'CONFIRM_CHECKOUT' },
        { title: 'Remove item', payload: 'REMOVE_ITEM' },
        { title: 'Add more', payload: 'KEEP_SHOPPING' },
        { title: 'Clear cart', payload: 'CLEAR_CART' }
      ]
    };
  },

  cartEmpty: () => ({
    text: 'Your cart is empty.',
    quickReplies: [
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]
  }),

  removeWhich: (cartLines) => {
    // cartLines: [{ menuItemId, name, quantity }]
    const qrs = cartLines.slice(0, 12).map(c => {
      const title = `${c.name} x${c.quantity}`.substring(0, 20);
      return { title, payload: `REMOVE_ITEM_${c.menuItemId}` };
    });
    qrs.push({ title: 'Cancel', payload: 'VIEW_CART' });
    return {
      text: 'Which item would you like to remove?',
      quickReplies: qrs
    };
  },

  removed: (qty, name, totalFormatted) => ({
    text: `Removed ${qty}x ${name}. Cart: ${totalFormatted}. Check out?`,
    quickReplies: [
      { title: 'Yes, checkout', payload: 'CONFIRM_CHECKOUT' },
      { title: 'Add more', payload: 'KEEP_SHOPPING' }
    ]
  }),

  removedEmpty: (qty, name) => ({
    text: `Removed ${qty}x ${name}. Cart is empty.`,
    quickReplies: [
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]
  }),

  notInCart: (text, cartLines = []) => {
    const qrs = cartLines.slice(0, 12).map(c => {
      const title = `${c.name} x${c.quantity}`.substring(0, 20);
      return { title, payload: `REMOVE_ITEM_${c.menuItemId}` };
    });
    qrs.push({ title: 'Cancel', payload: 'VIEW_CART' });
    return {
      text: `${text} isn't in your cart. Which one?`,
      quickReplies: qrs
    };
  },

  clearAsk: () => ({
    text: 'Clear your whole cart?',
    quickReplies: [
      { title: 'Yes, clear', payload: 'CLEAR_CART_YES' },
      { title: 'Keep cart', payload: 'KEEP_SHOPPING' }
    ]
  }),

  cleared: () => ({
    text: 'Cart cleared.',
    quickReplies: [
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]
  }),

  keptCart: () => ({
    text: 'No problem. Cart kept.',
    quickReplies: [
      { title: 'Add more', payload: 'KEEP_SHOPPING' },
      { title: 'View cart', payload: 'VIEW_CART' }
    ]
  }),

  didYouMean: (suggestion) => ({
    text: `Did you mean: ${suggestion}?`,
    quickReplies: [
      { title: 'Yes', payload: 'CONFIRM_YES' },
      { title: 'No', payload: 'CONFIRM_NO' }
    ]
  }),

  yesToWhat: () => ({
    text: 'Yes to what? Ready to check out?',
    quickReplies: [
      { title: 'Yes, checkout', payload: 'CONFIRM_CHECKOUT' },
      { title: 'Add more', payload: 'KEEP_SHOPPING' }
    ]
  }),

  orderType: () => ({
    text: 'Delivery or pickup?',
    quickReplies: [
      { title: '🛵 Delivery', payload: 'CHECKOUT_DELIVERY' },
      { title: '🛍️ Pickup', payload: 'CHECKOUT_PICKUP' },
      { title: 'Back', payload: 'VIEW_CART' }
    ]
  }),

  savedDetails: (name, phone, address) => ({
    text: `Use your saved details?\n${name} · ${phone}\n${address}`,
    quickReplies: [
      { title: '✅ Use these', payload: 'USE_SAVED_DETAILS' },
      { title: '✏️ Change', payload: 'CHANGE_DETAILS' }
    ]
  }),

  askName: () => ({
    text: "What's your name?",
    quickReplies: [
      { title: 'Back', payload: 'BACK_TO_CART' }
    ]
  }),

  askAddress: () => ({
    text: 'Delivery address? Add a landmark.',
    quickReplies: [
      { title: 'Back', payload: 'BACK_TO_CART' }
    ]
  }),

  askPhone: () => ({
    text: 'Contact number?',
    quickReplies: [
      { title: 'Back', payload: 'BACK_TO_CART' }
    ]
  }),

  badName: () => ({
    text: 'Please send your full name.',
    quickReplies: []
  }),

  badPhone: () => ({
    text: 'Please send a valid mobile number, e.g. 0917 123 4567.',
    quickReplies: []
  }),

  badAddress: () => ({
    text: 'Please send your full address with a landmark.',
    quickReplies: []
  }),

  tooFar: (km, max = 3) => ({
    text: `That's ${km} km away. We deliver within ${max} km.`,
    quickReplies: [
      { title: '🛍️ Pickup', payload: 'CHECKOUT_PICKUP' },
      { title: 'Change address', payload: 'EDIT_ADDRESS' }
    ]
  }),

  addressRetry: () => ({
    text: "I couldn't find that address. Send a more exact one.",
    quickReplies: []
  }),

  orderSummary: ({ lines, subtotal, km, fee, total, name, phone, address, isEstimate }) => {
    const itemLines = lines.map(l => `${l.qty}x ${l.name} ${l.lineTotal}`).join('\n');
    const feeLabel = isEstimate ? LABELS.deliveryFeeEstimate : LABELS.deliveryFee;
    const feeLine = `${feeLabel} (${km} km) ${fee}`;
    const text = `Order summary\n${itemLines}\nSubtotal ${subtotal}\n${feeLine}\nTotal ${total}\n\n${name} · ${phone}\n${address}`;
    return {
      text,
      quickReplies: [
        { title: '✅ Confirm', payload: 'CONFIRM_DETAILS' },
        { title: '✏️ Edit details', payload: 'EDIT_DETAILS' },
        { title: '🛒 Back to cart', payload: 'BACK_TO_CART' }
      ]
    };
  },

  orderSummaryPickup: ({ lines, subtotal, total, name, phone }) => {
    const itemLines = lines.map(l => `${l.qty}x ${l.name} ${l.lineTotal}`).join('\n');
    const text = `Order summary\n${itemLines}\nSubtotal ${subtotal}\nTotal ${total}\n\n${name} · ${phone}\nStore pickup`;
    return {
      text,
      quickReplies: [
        { title: '✅ Confirm', payload: 'CONFIRM_DETAILS' },
        { title: '✏️ Edit details', payload: 'EDIT_DETAILS' },
        { title: '🛒 Back to cart', payload: 'BACK_TO_CART' }
      ]
    };
  },

  editWhat: (isDelivery = true) => {
    const qrs = [
      { title: 'Name', payload: 'EDIT_NAME' }
    ];
    if (isDelivery) {
      qrs.push({ title: 'Address', payload: 'EDIT_ADDRESS' });
    }
    qrs.push({ title: 'Number', payload: 'EDIT_PHONE' });
    qrs.push({ title: 'Back', payload: 'BACK_TO_SUMMARY' });
    return {
      text: 'What do you want to change?',
      quickReplies: qrs
    };
  },

  pricesChanged: () => ({
    text: 'Prices changed. Please review.',
    quickReplies: []
  }),

  payWith: () => ({
    text: 'Pay with?',
    quickReplies: [
      { title: '💵 Cash', payload: 'PAY_CASH' },
      { title: '📱 GCash', payload: 'PAY_GCASH' },
      { title: 'Back', payload: 'BACK_TO_SUMMARY' }
    ]
  }),

  placedCash: (orderNumber, totalFormatted) => ({
    text: `Order #${orderNumber} placed. Pay ${totalFormatted} in cash on receipt.`,
    quickReplies: [
      { title: 'Track order', payload: 'TRACK_LATEST_ORDER' },
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]
  }),

  placedCashPickup: (orderNumber, totalFormatted) => ({
    text: `Order #${orderNumber} placed. Pay ${totalFormatted} at the counter.`,
    quickReplies: [
      { title: 'Track order', payload: 'TRACK_LATEST_ORDER' },
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]
  }),

  gcashPay: (totalFormatted, number, name) => ({
    text: `Send ${totalFormatted} to ${number} (${name}), then reply with the amount you sent.`,
    quickReplies: []
  }),

  gcashOk: (orderNumber) => ({
    text: `Payment verified. Order #${orderNumber} is in the kitchen.`,
    quickReplies: [
      { title: 'Track order', payload: 'TRACK_LATEST_ORDER' },
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]
  }),

  gcashMismatch: (paidFormatted, totalFormatted) => ({
    text: `Amount mismatch (sent ${paidFormatted}, total ${totalFormatted}). Staff will verify.`,
    quickReplies: [
      { title: 'Track order', payload: 'TRACK_LATEST_ORDER' }
    ]
  }),

  outOfStock: (itemNames) => ({
    text: `Sorry, ${itemNames} just sold out.`,
    quickReplies: [
      { title: 'View cart', payload: 'VIEW_CART' },
      { title: 'Remove item', payload: 'REMOVE_ITEM' }
    ]
  }),

  fallback: () => ({
    text: "Sorry, I didn't get that.",
    quickReplies: [
      { title: '☕ Menu', payload: 'MENU_HOME' },
      { title: '🛒 Cart', payload: 'VIEW_CART' },
      { title: 'Talk to staff', payload: 'REQUEST_AGENT' }
    ]
  }),

  outOfScope: () => ({
    text: "I can only help with orders at Diner's Cafe.",
    quickReplies: [
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]
  }),

  agent: (phone = '+63 917 111 2222', hours = '7:00 AM - 10:00 PM') => ({
    text: `Call us at ${phone}. We're open ${hours}.`,
    quickReplies: [
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]
  }),

  feedbackAsk: () => ({
    text: 'Your order has been delivered! How was your experience today?',
    quickReplies: [
      { title: '5 ⭐', payload: 'FEEDBACK_RATE_5' },
      { title: '4 ⭐', payload: 'FEEDBACK_RATE_4' },
      { title: '3 ⭐', payload: 'FEEDBACK_RATE_3' },
      { title: '2 ⭐', payload: 'FEEDBACK_RATE_2' },
      { title: '1 ⭐', payload: 'FEEDBACK_RATE_1' }
    ]
  }),

  feedbackAskPickup: () => ({
    text: 'Thanks for picking up! How was your experience today?',
    quickReplies: [
      { title: '5 ⭐', payload: 'FEEDBACK_RATE_5' },
      { title: '4 ⭐', payload: 'FEEDBACK_RATE_4' },
      { title: '3 ⭐', payload: 'FEEDBACK_RATE_3' },
      { title: '2 ⭐', payload: 'FEEDBACK_RATE_2' },
      { title: '1 ⭐', payload: 'FEEDBACK_RATE_1' }
    ]
  }),

  feedbackWhy: (orderNumber) => ({
    text: 'Sorry about that. What went wrong? (optional)',
    quickReplies: [
      { title: 'Skip', payload: orderNumber ? `FEEDBACK_SKIP_${orderNumber}` : 'FEEDBACK_SKIP' }
    ]
  }),

  feedbackDone: () => ({
    text: "Thanks for your feedback! Type 'Menu' or 'Order' whenever you're ready for your next order.",
    quickReplies: [
      { title: '☕ Menu', payload: 'MENU_HOME' }
    ]
  }),

  feedbackAlready: () => ({
    text: "You've already rated this order. Thanks!",
    quickReplies: []
  }),

  staleButton: () => ({
    text: 'That option has expired.',
    quickReplies: [
      { title: '☕ Menu', payload: 'MENU_HOME' },
      { title: '🛒 Cart', payload: 'VIEW_CART' }
    ]
  })
};

module.exports = {
  botMessages,
  LABELS
};
