#!/usr/bin/env node
/**
 * Cross-platform replacement for bash-scripts/set_global_env.sh
 * Writes .env with CLI section (CLI_CEB_DEV, CLI_CEB_FIREFOX) and preserves CEB_* from existing .env
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const envPath = join(root, '.env');

let CLI_CEB_DEV = 'false';
let CLI_CEB_FIREFOX = 'false';
const cliValues = [];

for (const arg of process.argv.slice(2)) {
  if (!arg.includes('=')) continue;
  const [key, ...v] = arg.split('=');
  const value = v.join('=').trim();
  if (key === 'CLI_CEB_DEV') CLI_CEB_DEV = value;
  else if (key === 'CLI_CEB_FIREFOX') CLI_CEB_FIREFOX = value;
  else if (key.startsWith('CLI_CEB_')) cliValues.push(`${key}=${value}`);
}

let cebSection = '';
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const k = line.split('=')[0]?.trim();
    if (k?.startsWith('CEB_')) cebSection += line + '\n';
  }
}
if (!cebSection.trim()) {
  cebSection = 'CEB_EXAMPLE=example_env\nCEB_DEV_LOCALE=\nCEB_CI=\n';
}

const out = [
  '# THOSE VALUES ARE EDITABLE ONLY VIA CLI',
  `CLI_CEB_DEV=${CLI_CEB_DEV}`,
  `CLI_CEB_FIREFOX=${CLI_CEB_FIREFOX}`,
  ...cliValues.map((v) => v),
  '',
  '# THOSE VALUES ARE EDITABLE',
  cebSection.trimEnd(),
].join('\n');

writeFileSync(envPath, out, 'utf8');
