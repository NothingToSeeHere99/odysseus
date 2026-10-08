#!/usr/bin/env node
// Serves Pack Rush and forwards /scrydex/* to the Scrydex API, adding your credentials
// on the server so the key never reaches the browser. Responses are cached on disk to
// save credits. No dependencies: needs Node 18+.
//
//   SCRYDEX_API_KEY=... SCRYDEX_TEAM_ID=... node server/proxy.js
//
// Without credentials it still serves the game (which then uses the free Pokémon TCG API).
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const KEY = process.env.SCRYDEX_API_KEY || '';
const TEAM = process.env.SCRYDEX_TEAM_ID || '';
const UPSTREAM = (process.env.SCRYDEX_UPSTREAM || 'https://api.scrydex.com/pokemon/v1').replace(/\/+$/, '');
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '.cache');
const CACHE_MS = (Number(process.env.CACHE_HOURS) || 12) * 3600 * 1000;
const ROOT = path.resolve(__dirname, '..');
const configured = !!(KEY && TEAM);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

let upstreamCalls = 0;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { ...CORS, 'Content-Type': MIME['.json'] });
}

function cacheFile(url) {
  return path.join(CACHE_DIR, crypto.createHash('sha1').update(url).digest('hex') + '.json');
}

function readCache(file) {
  try {
    const stat = fs.statSync(file);
    return { body: fs.readFileSync(file), age: Date.now() - stat.mtimeMs };
  } catch {
    return null;
  }
}

function fetchUpstream(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    upstreamCalls++;
    const req = lib.get(url, { headers: { 'X-Api-Key': KEY, 'X-Team-ID': TEAM, Accept: 'application/json' }, timeout: 45000 }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('Upstream timed out')));
    req.on('error', reject);
  });
}

async function handleScrydex(req, res, url) {
  const rest = url.pathname.slice('/scrydex'.length);
  if (rest === '/health') return sendJson(res, 200, { ok: true, configured, upstreamCalls });
  if (!configured) return sendJson(res, 503, { error: 'Set SCRYDEX_API_KEY and SCRYDEX_TEAM_ID to enable Scrydex.' });
  if (!/^\/[\w\-./]*$/.test(rest) || rest.includes('..')) return sendJson(res, 400, { error: 'Bad path' });

  const target = UPSTREAM + rest + url.search;
  const file = cacheFile(target);
  const cached = readCache(file);
  if (cached && cached.age < CACHE_MS) {
    return send(res, 200, cached.body, { ...CORS, 'Content-Type': MIME['.json'], 'X-Cache': 'hit' });
  }
  try {
    const up = await fetchUpstream(target);
    if (up.status === 200) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, up.body);
      return send(res, 200, up.body, { ...CORS, 'Content-Type': MIME['.json'], 'X-Cache': 'miss' });
    }
    if (cached) return send(res, 200, cached.body, { ...CORS, 'Content-Type': MIME['.json'], 'X-Cache': 'stale' });
    return send(res, up.status, up.body, { ...CORS, 'Content-Type': MIME['.json'] });
  } catch (e) {
    if (cached) return send(res, 200, cached.body, { ...CORS, 'Content-Type': MIME['.json'], 'X-Cache': 'stale' });
    return sendJson(res, 502, { error: e.message });
  }
}

function handleStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  // Only the game itself: index.html, css/ and js/. Never dotfiles.
  const inside = (dir) => file.startsWith(path.join(ROOT, dir) + path.sep);
  if (/[\\/]\./.test(rel) || !(file === path.join(ROOT, 'index.html') || inside('css') || inside('js'))) return send(res, 404, 'Not found');
  fs.readFile(file, (err, body) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, body, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '', CORS);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (url.pathname === '/scrydex' || url.pathname.startsWith('/scrydex/')) return handleScrydex(req, res, url);
  return handleStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`Pack Rush running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(configured ? `Scrydex proxy enabled (cache: ${CACHE_MS / 3600000}h in ${CACHE_DIR})` : 'Scrydex not configured: set SCRYDEX_API_KEY and SCRYDEX_TEAM_ID to enable it.');
});
