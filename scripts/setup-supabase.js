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

const ENV_PATH = path.resolve(__dirname, '../.env');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

function log(msg) { console.log(`\x1b[36m[setup]\x1b[0m ${msg}`); }
function success(msg) { console.log(`\x1b[32m  ✓\x1b[0m ${msg}`); }
function error(msg) { console.log(`\x1b[31m  ✗\x1b[0m ${msg}`); }
function warn(msg) { console.log(`\x1b[33m  !\x1b[0m ${msg}`); }

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

  if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    error('DATABASE_URL must start with postgresql:// or postgres://');
    process.exit(1);
  }
  if (!directUrl.startsWith('postgresql://') && !directUrl.startsWith('postgres://')) {
    error('DIRECT_URL must start with postgresql:// or postgres://');
    process.exit(1);
  }

  // Ensure pgbouncer param on pooled URL
  let finalDbUrl = dbUrl;
  if (!finalDbUrl.includes('pgbouncer=true')) {
    finalDbUrl += (finalDbUrl.includes('?') ? '&' : '?') + 'pgbouncer=true';
  }

  success('Connection strings received');

  // Step 2: Update .env
  log('Step 2: Updating .env file');

  let envContent = fs.readFileSync(ENV_PATH, 'utf-8');

  // Replace or add DATABASE_URL
  if (envContent.includes('DATABASE_URL=')) {
    envContent = envContent.replace(
      /^DATABASE_URL=.*$/m,
      `DATABASE_URL="${finalDbUrl}"`
    );
  } else {
    envContent = `DATABASE_URL="${finalDbUrl}"\n` + envContent;
  }

  // Remove old commented DATABASE_URL lines
  envContent = envContent.replace(/^#\s*DATABASE_URL=.*$/gm, '');

  // Add or replace DIRECT_URL
  if (envContent.includes('DIRECT_URL=')) {
    envContent = envContent.replace(
      /^DIRECT_URL=.*$/m,
      `DIRECT_URL="${directUrl}"`
    );
  } else {
    // Add after DATABASE_URL
    envContent = envContent.replace(
      /^(DATABASE_URL=.*)$/m,
      `$1\nDIRECT_URL="${directUrl}"`
    );
  }

  fs.writeFileSync(ENV_PATH, envContent);
  success('.env updated with Supabase URLs');

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
      env: { ...process.env, DATABASE_URL: finalDbUrl, DIRECT_URL: directUrl },
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
