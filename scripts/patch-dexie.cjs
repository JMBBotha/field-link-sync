#!/usr/bin/env node
// Patches dexie.d.ts to replace 'module' keyword with 'namespace' (TS 5.5+ compat)
const fs = require('fs');
const path = require('path');

const dexieDts = path.join(__dirname, '..', 'node_modules', 'dexie', 'dist', 'dexie.d.ts');

try {
  if (fs.existsSync(dexieDts)) {
    let content = fs.readFileSync(dexieDts, 'utf8');
    if (content.includes('module Dexie')) {
      content = content.replace(/\bmodule Dexie\b/g, 'namespace Dexie');
      fs.writeFileSync(dexieDts, content, 'utf8');
      console.log('[patch-dexie] Patched dexie.d.ts: module -> namespace');
    } else {
      console.log('[patch-dexie] Already patched or not needed');
    }
  }
} catch (e) {
  console.warn('[patch-dexie] Could not patch:', e.message);
}
