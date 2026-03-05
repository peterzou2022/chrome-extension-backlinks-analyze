#!/usr/bin/env node
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const envPath = join(root, '.env');
const examplePath = join(root, '.example.env');

if (!existsSync(envPath) && existsSync(examplePath)) {
  copyFileSync(examplePath, envPath);
  console.log('.example.env has been copied to .env');
}
