const test = require('node:test');
const assert = require('node:assert/strict');
const { botMessages, LABELS } = require('../src/services/botMessages');
const { peso } = require('../src/services/textMatch');

// Helper to count emojis in a string
function countEmojis(str) {
  // Matches typical pictographs / emoji symbols
  const matches = str.match(/[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu);
  return matches ? matches.length : 0;
}

test('botMessages renders every message catalog key adhering to constraints', () => {
  const sampleLines = [
    { qty: 2, name: 'Signature Spanish Latte', lineTotal: '₱290.00' },
    { qty: 1, name: 'Almond Butter Croissant', lineTotal: '₱95.00' }
  ];
  const sampleCartLines = [
    { menuItemId: 1, name: 'Signature Spanish Latte', quantity: 2 },
    { menuItemId: 8, name: 'Almond Butter Croissant', quantity: 1 }
  ];

  const renderedList = [
    botMessages.welcome(),
    botMessages.menuIntro(),
    botMessages.menuOutro(true),
    botMessages.menuOutro(false),
    botMessages.added(2, 'Signature Spanish Latte', '₱290.00'),
    botMessages.askQty('Signature Spanish Latte'),
    botMessages.cart(sampleLines, '₱385.00'),
    botMessages.cartEmpty(),
    botMessages.removeWhich(sampleCartLines),
    botMessages.removed(2, 'Signature Spanish Latte', '₱95.00'),
    botMessages.removedEmpty(1, 'Almond Butter Croissant'),
    botMessages.notInCart('pizza', sampleCartLines),
    botMessages.clearAsk(),
    botMessages.cleared(),
    botMessages.keptCart(),
    botMessages.didYouMean('Iced Americano'),
    botMessages.yesToWhat(),
    botMessages.orderType(),
    botMessages.savedDetails('Juan Dela Cruz', '+639171234567', 'Unit 402 Acacia Heights'),
    botMessages.askName(),
    botMessages.askAddress(),
    botMessages.askPhone(),
    botMessages.badName(),
    botMessages.badPhone(),
    botMessages.badAddress(),
    botMessages.tooFar(4.5, 3),
    botMessages.addressRetry(),
    botMessages.orderSummary({
      lines: sampleLines,
      subtotal: '₱385.00',
      km: 1.5,
      fee: '₱70.00',
      total: '₱455.00',
      name: 'Juan Dela Cruz',
      phone: '+639171234567',
      address: 'Unit 402 Acacia Heights',
      isEstimate: false
    }),
    botMessages.orderSummaryPickup({
      lines: sampleLines,
      subtotal: '₱385.00',
      total: '₱385.00',
      name: 'Juan Dela Cruz',
      phone: '+639171234567'
    }),
    botMessages.editWhat(true),
    botMessages.editWhat(false),
    botMessages.pricesChanged(),
    botMessages.payWith(),
    botMessages.placedCash('DNR-20261010-001', '₱455.00'),
    botMessages.placedCashPickup('DNR-20261010-001', '₱385.00'),
    botMessages.gcashPay('₱455.00', '0917 111 2222', 'Diner Cafe'),
    botMessages.gcashOk('DNR-20261010-001'),
    botMessages.gcashMismatch('₱400.00', '₱455.00'),
    botMessages.outOfStock('Signature Spanish Latte'),
    botMessages.fallback(),
    botMessages.outOfScope(),
    botMessages.agent('+63 917 111 2222', '7:00 AM - 10:00 PM'),
    botMessages.feedbackAsk(),
    botMessages.feedbackAskPickup(),
    botMessages.feedbackWhy('DNR-20261010-001'),
    botMessages.feedbackDone(),
    botMessages.feedbackAlready(),
    botMessages.staleButton()
  ];

  for (const msg of renderedList) {
    assert.ok(msg.text, 'Message must have non-empty text');
    assert.ok(msg.text.length <= 2000, `Text exceeds 2000 chars: "${msg.text.slice(0, 50)}..."`);
    assert.ok(!msg.text.includes('$'), `Text contains $ symbol: "${msg.text}"`);

    // Check emojis in message text: at most one emoji
    const emojiCount = countEmojis(msg.text);
    assert.ok(emojiCount <= 1, `Message text has more than 1 emoji (${emojiCount}): "${msg.text}"`);

    // Check quick replies
    if (msg.quickReplies) {
      assert.ok(msg.quickReplies.length <= 13, `Quick replies exceed 13: ${msg.quickReplies.length}`);
      for (const qr of msg.quickReplies) {
        assert.ok(qr.title.length <= 20, `Quick reply title exceeds 20 chars: "${qr.title}"`);
        assert.ok(!qr.title.includes('$'), `Quick reply title contains $: "${qr.title}"`);
      }
    }
  }
});
