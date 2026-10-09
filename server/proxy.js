#!/usr/bin/env node
// Serves Pack Rush and forwards card data requests, caching responses on disk:
//   /scrydex/*  → Scrydex API, adding your credentials so the key never reaches the browser
//   /tcgdex/*   → TCGdex API (free, no key), so its per-card price lookups are cached too
//   /ppt/*      → PokemonPriceTracker (graded PSA prices), adding PPT_API_KEY
// No dependencies: needs Node 18+.
//
//   SCRYDEX_API_KEY=... SCRYDEX_TEAM_ID=... node server/proxy.js
//
// Without Scrydex credentials it still serves the game and proxies TCGdex.
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
const SCRYDEX = (process.env.SCRYDEX_UPSTREAM || 'https://api.scrydex.com/pokemon/v1').replace(/\/+$/, '');
const PPT_KEY = process.env.PPT_API_KEY || '';
const PPT = (process.env.PPT_UPSTREAM || 'https://www.pokemonpricetracker.com/api/v2').replace(/\/+$/, '');
const TCGDEX = (process.env.TCGDEX_UPSTREAM || 'https://api.tcgdex.net/v2').replace(/\/+$/, '');
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '.cache');
const CACHE_MS = (Number(process.env.CACHE_HOURS) || 12) * 3600 * 1000;
const ROOT = path.resolve(__dirname, '..');
const configured = !!(KEY && TEAM);
const MAX_BODY = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HEADERS = { ...CORS, 'Content-Type': MIME['.json'] };

const upstreamCalls = { scrydex: 0, tcgdex: 0, ppt: 0 };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), JSON_HEADERS);
}

function cacheFile(key) {
  return path.join(CACHE_DIR, crypto.createHash('sha1').update(key).digest('hex') + '.json');
}

function readCache(file) {
  try {
    const stat = fs.statSync(file);
    return { body: fs.readFileSync(file), age: Date.now() - stat.mtimeMs };
  } catch {
    return null;
  }
}

function fetchUpstream(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { method, headers: { Accept: 'application/json', ...headers }, timeout: 45000 }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('Upstream timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Forward to the upstream, serving fresh cache hits and falling back to stale cache on errors.
async function forward(res, name, target, opts = {}) {
  const file = cacheFile(target + (opts.body ? '\n' + opts.body.toString() : ''));
  const cached = readCache(file);
  if (cached && cached.age < CACHE_MS) return send(res, 200, cached.body, { ...JSON_HEADERS, 'X-Cache': 'hit' });
  try {
    upstreamCalls[name]++;
    const up = await fetchUpstream(target, opts);
    if (up.status === 200) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, up.body);
      return send(res, 200, up.body, { ...JSON_HEADERS, 'X-Cache': 'miss' });
    }
    if (cached) return send(res, 200, cached.body, { ...JSON_HEADERS, 'X-Cache': 'stale' });
    return send(res, up.status, up.body, JSON_HEADERS);
  } catch (e) {
    if (cached) return send(res, 200, cached.body, { ...JSON_HEADERS, 'X-Cache': 'stale' });
    return sendJson(res, 502, { error: e.message });
  }
}

const safePath = (rest) => /^\/[\w\-./]*$/.test(rest) && !rest.includes('..');

async function handleScrydex(req, res, url) {
  const rest = url.pathname.slice('/scrydex'.length);
  if (rest === '/health') return sendJson(res, 200, { ok: true, configured, tcgdex: true, ppt: !!PPT_KEY, upstreamCalls: upstreamCalls.scrydex + upstreamCalls.tcgdex + upstreamCalls.ppt, calls: upstreamCalls });
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!configured) return sendJson(res, 503, { error: 'Set SCRYDEX_API_KEY and SCRYDEX_TEAM_ID to enable Scrydex.' });
  if (!safePath(rest)) return sendJson(res, 400, { error: 'Bad path' });
  return forward(res, 'scrydex', SCRYDEX + rest + url.search, { headers: { 'X-Api-Key': KEY, 'X-Team-ID': TEAM } });
}

async function handlePpt(req, res, url) {
  const rest = url.pathname.slice('/ppt'.length);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!PPT_KEY) return sendJson(res, 503, { error: 'Set PPT_API_KEY to enable graded prices.' });
  if (rest !== '/cards') return sendJson(res, 400, { error: 'Bad path' });
  return forward(res, 'ppt', PPT + rest + url.search, { headers: { Authorization: 'Bearer ' + PPT_KEY } });
}

async function handleTcgdex(req, res, url) {
  const rest = url.pathname.slice('/tcgdex'.length);
  if (!safePath(rest)) return sendJson(res, 400, { error: 'Bad path' });
  if (req.method === 'POST') {
    if (rest !== '/graphql') return sendJson(res, 405, { error: 'Only /graphql accepts POST' });
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 413, { error: e.message });
    }
    return forward(res, 'tcgdex', TCGDEX + rest, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  }
  return forward(res, 'tcgdex', TCGDEX + rest + url.search);
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

const under = (p, prefix) => p === prefix || p.startsWith(prefix + '/');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '', CORS);
  if (under(url.pathname, '/scrydex')) return handleScrydex(req, res, url);
  if (under(url.pathname, '/tcgdex')) return handleTcgdex(req, res, url);
  if (under(url.pathname, '/ppt')) return handlePpt(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  return handleStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`Pack Rush running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Card data cache: ${CACHE_MS / 3600000}h in ${CACHE_DIR}`);
  console.log(PPT_KEY ? 'Graded prices (PokemonPriceTracker) enabled.' : 'Graded prices: set PPT_API_KEY for real PSA prices (optional).');
  console.log(configured ? 'Scrydex enabled.' : 'Scrydex not configured (optional): set SCRYDEX_API_KEY and SCRYDEX_TEAM_ID to enable it.');
});
