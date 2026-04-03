const PLATFORM_FEE_PERCENT = 10;

function parsePageRange(rangeStr, totalPages) {
  if (!rangeStr || rangeStr === 'all') {
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    return { pages, count: totalPages };
  }

  const pages = new Set();
  const parts = rangeStr.split(',').map((s) => s.trim());

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
        throw new Error('invalid_range');
      }
      for (let i = start; i <= end; i++) pages.add(i);
    } else {
      const page = parseInt(part, 10);
      if (isNaN(page) || page < 1 || page > totalPages) {
        throw new Error('invalid_range');
      }
      pages.add(page);
    }
  }

  const sorted = Array.from(pages).sort((a, b) => a - b);
  return { pages: sorted, count: sorted.length };
}

function calculatePrice({ shop, pageCount, pageRange, color, doubleSided, copies, binding }) {
  let effectivePages = pageCount;
  if (pageRange && pageRange !== 'all') {
    try {
      const parsed = parsePageRange(pageRange, pageCount);
      effectivePages = parsed.count;
    } catch {
      // Fall back to full page count
    }
  }

  let pricePerPage;
  if (color && doubleSided) {
    pricePerPage = shop.ratesColorDouble;
  } else if (color) {
    pricePerPage = shop.ratesColorSingle;
  } else if (doubleSided) {
    pricePerPage = shop.ratesBwDouble;
  } else {
    pricePerPage = shop.ratesBwSingle;
  }

  let subtotal = pricePerPage * effectivePages * (copies || 1);

  // Binding charges
  if (binding === 'staple') {
    subtotal += shop.bindingCharge * (copies || 1);
  } else if (binding === 'spiral') {
    subtotal += shop.spiralCharge * (copies || 1);
  }

  const platformFee = Math.round(subtotal * PLATFORM_FEE_PERCENT / 100 * 100) / 100;
  const total = Math.round((subtotal + platformFee) * 100) / 100;
  const shopEarning = subtotal;

  return {
    pricePerPage,
    effectivePages,
    subtotal: Math.round(subtotal * 100) / 100,
    platformFee,
    total,
    shopEarning: Math.round(shopEarning * 100) / 100,
  };
}

module.exports = { calculatePrice, parsePageRange };
