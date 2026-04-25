#!/usr/bin/env node
/**
 * PrintDrop — Supabase Setup Script
 *
 * Run: node scripts/setup-supabase.js
 *
 * This script:
 * 1. Validates your Supabase connection strings
 * 2. Pushes the Prisma schema to create all tables
 * 3. Seeds the database with an admin user and demo shop
 * 4. Verifies everything works
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { randomPin, validatePin } = require('./lib/demo-seed');

const ENV_PATH = path.resolve(__dirname, '../.env');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

function log(msg) { console.log(`\x1b[36m[setup]\x1b[0m ${msg}`); }
function success(msg) { console.log(`\x1b[32m  ✓\x1b[0m ${msg}`); }
function error(msg) { console.log(`\x1b[31m  ✗\x1b[0m ${msg}`); }
function warn(msg) { console.log(`\x1b[33m  !\x1b[0m ${msg}`); }

function parsePostgresUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }

  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error(`${label} must start with postgresql:// or postgres://`);
  }
  if (!parsed.hostname || !parsed.username || !parsed.pathname || parsed.pathname === '/') {
    throw new Error(`${label} must include username, host, and database name`);
  }
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error(`${label} cannot contain newlines`);
  }
  return parsed;
}

function addPgbouncerParam(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!parsed.searchParams.has('pgbouncer')) {
    parsed.searchParams.set('pgbouncer', 'true');
  }
  return parsed.toString();
}

function envLine(key, value) {
  if (String(value).includes('\n') || String(value).includes('\r')) {
    throw new Error(`${key} cannot contain newlines`);
  }
  return `${key}=${JSON.stringify(String(value))}`;
}

function setEnvValue(content, key, value) {
  const uncommentedKey = new RegExp(`^${key}=.*$`, 'm');
  const commentedKey = new RegExp(`^#\\s*${key}=.*$`, 'gm');
  const clean = content.replace(commentedKey, '').replace(/\n{3,}/g, '\n\n');
  const line = envLine(key, value);

  if (uncommentedKey.test(clean)) {
    return clean.replace(uncommentedKey, line);
  }

  return clean.trimEnd() ? `${clean.trimEnd()}\n${line}\n` : `${line}\n`;
}

function getEnvValue(content, key) {
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) return undefined;
  const raw = match[1].trim();
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, raw.endsWith('"') ? -1 : undefined);
    }
  }
  return raw.replace(/^'|'$/g, '');
}

async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   PrintDrop — Supabase Database Setup    ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  // Step 1: Get connection strings
  log('Step 1: Supabase connection strings');
  console.log('');
  console.log('  Go to: https://supabase.com/dashboard');
  console.log('  → Your Project → Project Settings → Database');
  console.log('  → Connection string → URI tab');
  console.log('');
  console.log('  You need TWO connection strings:');
  console.log('  1. Transaction pooler (port 6543) — for app connections');
  console.log('  2. Session pooler or Direct (port 5432) — for migrations');
  console.log('');

  const dbUrl = await ask('  Paste DATABASE_URL (port 6543, transaction pooler):\n  > ');
  const directUrl = await ask('  Paste DIRECT_URL (port 5432, session/direct):\n  > ');

  try {
    parsePostgresUrl(dbUrl, 'DATABASE_URL');
    parsePostgresUrl(directUrl, 'DIRECT_URL');
  } catch (err) {
    error(err.message);
    process.exit(1);
  }

  // Ensure pgbouncer param on pooled URL
  const finalDbUrl = addPgbouncerParam(dbUrl);

  success('Connection strings received');

  // Step 2: Update .env
  log('Step 2: Updating .env file');

  let envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';

  const demoShopkeeperPin =
    process.env.PRINTDROP_DEMO_SHOPKEEPER_PIN ||
    getEnvValue(envContent, 'PRINTDROP_DEMO_SHOPKEEPER_PIN') ||
    randomPin();
  const adminPin =
    process.env.PRINTDROP_ADMIN_PIN ||
    getEnvValue(envContent, 'PRINTDROP_ADMIN_PIN') ||
    randomPin();
  validatePin('PRINTDROP_DEMO_SHOPKEEPER_PIN', demoShopkeeperPin);
  validatePin('PRINTDROP_ADMIN_PIN', adminPin);

  envContent = setEnvValue(envContent, 'DATABASE_URL', finalDbUrl);
  envContent = setEnvValue(envContent, 'DIRECT_URL', directUrl);
  envContent = setEnvValue(envContent, 'PRINTDROP_DEMO_SHOPKEEPER_PIN', demoShopkeeperPin);
  envContent = setEnvValue(envContent, 'PRINTDROP_ADMIN_PIN', adminPin);

  fs.writeFileSync(ENV_PATH, envContent);
  success('.env updated with Supabase URLs and demo login PINs');

  // Step 3: Generate Prisma client
  log('Step 3: Generating Prisma client');
  try {
    execSync('npx prisma generate', { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });
    success('Prisma client generated');
  } catch (e) {
    error('Prisma generate failed: ' + e.message);
    process.exit(1);
  }

  // Step 4: Push schema to Supabase
  log('Step 4: Pushing schema to Supabase (creating tables)');
  try {
    execSync('npx prisma db push', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: finalDbUrl, DIRECT_URL: directUrl },
    });
    success('All 7 tables created in Supabase');
  } catch (e) {
    error('Schema push failed. Check your connection strings.');
    error(e.message);
    process.exit(1);
  }

  // Step 5: Seed database
  log('Step 5: Seeding database with admin + demo shop');
  try {
    execSync('node scripts/seed-supabase.js', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: finalDbUrl,
        DIRECT_URL: directUrl,
        PRINTDROP_DEMO_SHOPKEEPER_PIN: demoShopkeeperPin,
        PRINTDROP_ADMIN_PIN: adminPin,
      },
    });
    success('Database seeded');
  } catch (e) {
    warn('Seed may have partially failed (duplicate data is OK): ' + e.message);
  }

  // Step 6: Verify
  log('Step 6: Verifying connection');
  try {
    const output = execSync('npx prisma db execute --stdin', {
      cwd: path.resolve(__dirname, '..'),
      input: 'SELECT count(*) as user_count FROM "User"; SELECT count(*) as shop_count FROM "Shop";',
      env: { ...process.env, DATABASE_URL: finalDbUrl, DIRECT_URL: directUrl },
      encoding: 'utf-8',
    });
    success('Database connection verified');
    console.log(output);
  } catch {
    warn('Verification query failed, but tables were created. This is usually OK.');
  }

  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║          Setup Complete!                 ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  Your Supabase database is ready.');
  console.log('  Tables created: User, Shop, Job, Payment, Conversation, Referral, OTP');
  console.log('');
  console.log('  Next steps:');
  console.log('    1. npm run dev:backend     → Start API server');
  console.log('    2. npm run dev:dashboard   → Start dashboard');
  console.log('    3. Open Supabase Dashboard → Table Editor to view data');
  console.log('');

  rl.close();
}

main().catch((e) => {
  error(e.message);
  rl.close();
  process.exit(1);
});
