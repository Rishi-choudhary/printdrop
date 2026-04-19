'use strict';

/**
 * Copy strings for bot v2. Keep each message short — we pay Gupshup per
 * session message. Pricing lines use the shop's actual rate × pages × copies
 * for the print cost, plus a flat platform fee of ₹0.5 per page (not per
 * copy), matching the MVP pricing rule.
 */

const pad3 = (n) => String(n).padStart(3, '0');

const CHOICE_BUTTONS = [
  { text: 'B&W · 1 copy',  callback_data: 'bw_1' },
  { text: 'B&W · 2 copies', callback_data: 'bw_2' },
  { text: 'Color · 1 copy', callback_data: 'color_1' },
];

module.exports = {
  CHOICE_BUTTONS,

  welcome:
`*PrintDrop*

Send me a PDF to print.
I'll ask B&W or color + copies, you pay online and pick up with a token. 🖨️`,

  sendPdfPlease:
`Send a PDF (or image) and I'll get it printed. 📄`,

  firstTimeGreeting: (fileName, pages) =>
`👋 Welcome to *PrintDrop*!

📄 *${fileName}* · ${pages} page${pages === 1 ? '' : 's'}

Tap a button below, or reply with:
• *1* · *2* · *3* for B&W copies
• *color 1* for color`,

  askChoice: (fileName, pages) =>
`📄 *${fileName}* · ${pages} page${pages === 1 ? '' : 's'}

Tap below, or reply:
• *1* · *2* · *3* for B&W copies
• *color 1* for color`,

  choiceInvalid:
`Please reply with a number (e.g. *2* for 2 B&W copies), or *color 1* for color. Reply *CANCEL* to abort.`,

  askPay: (job, link) => {
    const printCost = +(job.pricePerPage * job.pageCount * job.copies).toFixed(2);
    const fee = +(job.platformFee || 0).toFixed(2);
    const total = +(job.totalPrice || 0).toFixed(2);
    const mode = job.color ? 'Color' : 'B&W';
    return (
`🧾 *${job.fileName}*
${job.pageCount} pages × ${job.copies} ${job.copies === 1 ? 'copy' : 'copies'} · ${mode}

Print cost: ₹${printCost} (${job.pageCount}×${job.copies}×₹${job.pricePerPage})
Service fee: ₹${fee}
*Total: ₹${total}*

Pay here 👉 ${link}

Reply *CANCEL* to abort.`
    );
  },

  alreadyPending:
`You have a payment pending. Tap the link above to pay, or reply *CANCEL* to abort.`,

  paidConfirm: (job, shopName) =>
`✅ *Paid* · Token *#${pad3(job.token)}*
${shopName ? `Pickup: *${shopName}*\n` : ''}We'll ping you when it's ready.`,

  readyForPickup: (job, shopName) =>
`🔔 Ready for pickup · Token *#${pad3(job.token)}*${shopName ? `\n📍 ${shopName}` : ''}`,

  cancelled:
`Order cancelled. Send a new PDF whenever you're ready.`,

  noActiveOrder:
`Nothing to cancel — you don't have an active order.`,

  fileTooLargeOrInvalid:
`I couldn't read that file. Please send a PDF or image (max 50 MB).`,

  shopUnavailable:
`All our shops are closed right now. Try again during open hours.`,

  serverError:
`Something went wrong on our side. Please try again in a moment.`,
};
