#!/usr/bin/env node
require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin: input, stdout: output, stderr } = require('node:process');

(async () => {
  const rl = readline.createInterface({ input, output });
  process.stdout.write('NetClaw super admin bootstrap\n');
  process.stdout.write('==============================\n\n');

  const username = (await rl.question('Username (3-32 chars): ')).trim();
  const password = (await rl.question('Password (>= 8 chars): ')).trim();
  const display_name = (await rl.question('Display name (optional, press Enter to skip): ')).trim();
  rl.close();

  if (!username || !password) {
    stderr.write('username and password required\n');
    process.exit(1);
  }

  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  const admins = require('../src/repos/admins');

  try {
    const a = await admins.createAdmin({
      tenant_id: null,
      username,
      password,
      role: 'super',
      display_name: display_name || null
    });
    process.stdout.write(`\n✓ super admin created: ${a.username} (id ${a.id})\n`);
  } catch (err) {
    stderr.write(`\nfailed: ${err.code || err.name}: ${err.message}\n`);
    process.exit(1);
  }
})();
