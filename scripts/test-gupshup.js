#!/usr/bin/env node
/**
 * Usage: node scripts/test-gupshup.js <phone>
 * Example: node scripts/test-gupshup.js 919876543210
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const phone = process.argv[2];
if (!phone) {
  console.error('Usage: node scripts/test-gupshup.js <phone>');
  process.exit(1);
}

const apiUrl = process.env.WHATSAPP_API_URL || 'https://api.gupshup.io/wa/api/v1/msg';
const apiKey = process.env.WHATSAPP_API_KEY;
const sourceNumber = process.env.GUPSHUP_SOURCE_NUMBER;
const appName = process.env.GUPSHUP_APP_NAME || 'printdrop';

if (!apiKey || !sourceNumber) {
  console.error('Missing WHATSAPP_API_KEY or GUPSHUP_SOURCE_NUMBER in .env');
  process.exit(1);
}

const dest = String(phone).replace(/^\+/, '');
const message = { type: 'text', text: 'Hello from PrintDrop! This is a test message.' };

const params = new URLSearchParams({
  channel: 'whatsapp',
  source: sourceNumber,
  destination: dest,
  'src.name': appName,
  message: JSON.stringify(message),
});

console.log(`Sending to ${dest} via ${sourceNumber} (app: ${appName})...`);

fetch(apiUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    apikey: apiKey,
  },
  body: params.toString(),
})
  .then(async (res) => {
    const body = await res.text();
    if (res.ok) {
      console.log('Success:', res.status, body);
    } else {
      console.error('Error:', res.status, body);
    }
  })
  .catch((err) => console.error('Network error:', err.message));
