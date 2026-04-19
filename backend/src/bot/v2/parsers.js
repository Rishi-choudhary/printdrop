'use strict';

/**
 * Parsers for the lean WhatsApp flow.
 *
 * Accepted choice inputs (text):
 *   - `1`, `2`, `3` …           → B&W × N copies (default)
 *   - `c 2`, `color 2`, `c2`     → Color × N copies
 *   - `2 copies`, `x3`           → same, tolerant of noise
 *
 * Accepted choice inputs (quick_reply callbacks): `bw_1`, `bw_2`, `color_1`.
 */

const COLOR_RE  = /^\s*(?:c|col|color|colour)\s*[x×*-]?\s*(\d{1,2})\s*(?:copies?|cop|c)?\s*$/i;
const COPIES_RE = /^\s*x?\s*(\d{1,2})\s*(?:copies?|cop)?\s*$/i;
const CALLBACK_RE = /^(bw|color)_(\d{1,2})$/i;

function parseChoice(input) {
  if (!input) return null;

  // Quick-reply callback id
  const cb = String(input).match(CALLBACK_RE);
  if (cb) {
    const copies = parseInt(cb[2], 10);
    if (copies >= 1 && copies <= 50) {
      return { color: cb[1].toLowerCase() === 'color', copies };
    }
    return null;
  }

  const text = String(input).trim();

  const c = text.match(COLOR_RE);
  if (c) {
    const copies = parseInt(c[1], 10);
    if (copies >= 1 && copies <= 50) return { color: true, copies };
    return null;
  }

  const n = text.match(COPIES_RE);
  if (n) {
    const copies = parseInt(n[1], 10);
    if (copies >= 1 && copies <= 50) return { color: false, copies };
  }

  return null;
}

function isCancelCommand(text) {
  return /^\s*(cancel|\/cancel|stop|\/stop)\s*$/i.test(text || '');
}

function isHelpCommand(text) {
  return /^\s*(help|\/help|\?)\s*$/i.test(text || '');
}

function isStartCommand(text) {
  return /^\s*(start|\/start|hi|hello|hey)\s*$/i.test(text || '');
}

module.exports = { parseChoice, isCancelCommand, isHelpCommand, isStartCommand };
