#!/usr/bin/env node
// Bundles the game into one self-contained HTML file (CSS and JS inlined) that can be
// downloaded and opened by double-clicking. Usage: node scripts/build-single.js [out]
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'pack-rush.html'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, file) => `<style>\n${read(file)}\n</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, file) => {
  const code = read(file);
  if (/<\/script/i.test(code)) throw new Error(`${file} contains "</script", which would break inlining`);
  return `<script>/* ${file} */\n${code}\n</script>`;
});

const leftover = html.match(/(?:src|href)="(?:css|js)\/[^"]+"/);
if (leftover) throw new Error(`Not inlined: ${leftover[0]}`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${Math.round(html.length / 1024)} KB)`);
