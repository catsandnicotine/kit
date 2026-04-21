#!/usr/bin/env node
/**
 * Patch the iOS capacitor.config.json to include Kit's custom Swift plugins.
 *
 * `npx cap sync` only scans npm packages for @objc(Name) patterns — it never
 * sees classes that live in ios/App/App/Plugins/. Without them in
 * packageClassList, the JS bridge can't instantiate them and every call is
 * a silent no-op.
 *
 * Run this script after every `cap sync ios`. The npm `sync:ios` script does
 * that automatically; run it manually if you `npx cap sync` directly.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CUSTOM_CLASSES = ['ICloudPlugin', 'ICloudSyncPlugin'];
const CONFIG_PATH = resolve('ios/App/App/capacitor.config.json');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const existing = new Set(config.packageClassList ?? []);
let changed = false;

for (const cls of CUSTOM_CLASSES) {
  if (!existing.has(cls)) {
    existing.add(cls);
    changed = true;
  }
}

if (changed) {
  config.packageClassList = Array.from(existing);
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, '\t') + '\n');
  console.log(`Patched ${CONFIG_PATH} with: ${CUSTOM_CLASSES.join(', ')}`);
} else {
  console.log('packageClassList already includes custom plugins — nothing to do.');
}
