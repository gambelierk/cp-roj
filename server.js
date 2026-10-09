'use strict';

// CP-Röj – server utan externa beroenden (kräver Node 18+).
// Serverar spelet, inbäddningsskriptet, adminpanelen och ett litet JSON-API.

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
// Vilka sajter som får bädda in spelet i en iframe, t.ex. "https://dinbutik.se https://dinbutik.myshopify.com".
const FRAME_ANCESTORS = process.env.FRAME_ANCESTORS || '*';

// minMs: snabbare tider än så här (nära världsrekorden) räknas som fusk.
const LEVELS = {
  beginner: { label: 'Nybörjare', minMs: 1000 },
  intermediate: { label: 'Medel', minMs: 6000 },
  expert: { label: 'Expert', minMs: 25000 },
};

const DEFAULT_COLORS = {
  pageBg: '#ffffff',
  frame: '#c0c0c0',
  bevelLight: '#ffffff',
  bevelDark: '#808080',
  cellHidden: '#c0c0c0',
  cellOpen: '#c0c0c0',
  gridLine: '#808080',
  counterBg: '#000000',
  counterText: '#ff0000',
  titleBg: '#000080',
  titleText: '#ffffff',
  text: '#000000',
  mineHit: '#ff0000',
  flag: '#ff0000',
  n1: '#0000ff',
  n2: '#008000',
  n3: '#ff0000',
  n4: '#000080',
  n5: '#800000',
  n6: '#008080',
  n7: '#000000',
  n8: '#808080',
};

const DEFAULT_TEXTS = {
  title: 'CP-Röj',
  leaderboardIntro: 'Klara spelet snabbast och lämna din mailadress – de bästa kan få en rabattkod!',
  consentText: 'Jag godkänner att min mailadress sparas så att jag kan kontaktas om en eventuell rabattkod.',
  privacyUrl: '',
};

const DEFAULT_CONFIG = { colors: DEFAULT_COLORS, texts: DEFAULT_TEXTS, icons: [] };

const MAX_ICONS = 40;
const MAX_ICON_BYTES = 1024 * 1024;
const GAME_TTL_MS = 3 * 60 * 60 * 1000;

// ---------- Lagring ----------

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadConfig() {
  const stored = readJson(CONFIG_FILE, {});
  return {
    colors: { ...DEFAULT_COLORS, ...(stored.colors || {}) },
    texts: { ...DEFAULT_TEXTS, ...(stored.texts || {}) },
    icons: Array.isArray(stored.icons) ? stored.icons : [],
  };
}

let config = loadConfig();
let scores = readJson(SCORES_FILE, []);

// Skrivningar köas så att två samtidiga anrop inte skriver över varandra.
let writeQueue = Promise.resolve();
function persist(file, data) {
  writeQueue = writeQueue.then(async () => {
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
    await fsp.rename(tmp, file);
  }).catch((err) => console.error('Kunde inte spara', file, err));
  return writeQueue;
}
const saveConfig = () => persist(CONFIG_FILE, config);
const saveScores = () => persist(SCORES_FILE, scores);

// ---------- Hjälpfunktioner ----------

function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const payload = isBuffer || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuffer || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

const json = (res, status, body) => send(res, status, body, { 'Cache-Control': 'no-store' });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('För stor förfrågan'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit = 16 * 1024) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw Object.assign(new Error('Content-Type måste vara application/json'), { status: 415 });
  }
  const raw = await readBody(req, limit);
  try {
    return JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Ogiltig JSON'), { status: 400 });
  }
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0] : req.socket.remoteAddress || '').trim();
}

const rateBuckets = new Map();
function rateLimited(req, key, max, windowMs) {
  const id = `${key}:${clientIp(req)}`;
  const now = Date.now();
  const bucket = rateBuckets.get(id);
  if (!bucket || now - bucket.start > windowMs) {
    rateBuckets.set(id, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  let v = value.trim();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}

function cleanText(value, max) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function publicConfig(admin = false) {
  return {
    colors: config.colors,
    texts: config.texts,
    icons: config.icons.map((icon) => ({ id: icon.id, url: `/uploads/${icon.file}`, ...(admin ? { name: icon.name } : {}) })),
  };
}

function leaderboard(level, limit = 10) {
  // En rad per mailadress: bästa tiden räknas.
  const best = new Map();
  for (const s of scores) {
    if (s.level !== level) continue;
    const key = s.email.toLowerCase();
    const prev = best.get(key);
    if (!prev || s.timeMs < prev.timeMs) best.set(key, s);
  }
  return [...best.values()].sort((a, b) => a.timeMs - b.timeMs || a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
}

// ---------- Spelomgångar (servern mäter tiden) ----------

const games = new Map();
setInterval(() => {
  const cutoff = Date.now() - GAME_TTL_MS;
  for (const [id, game] of games) if (game.startedAt < cutoff) games.delete(id);
  for (const [id, bucket] of rateBuckets) if (bucket.start < Date.now() - 10 * 60 * 1000) rateBuckets.delete(id);
}, 10 * 60 * 1000).unref();

// ---------- Statiska filer ----------

const PUBLIC_FILES = {
  '/game': ['game.html', 'text/html; charset=utf-8'],
  '/static/game.css': ['game.css', 'text/css; charset=utf-8'],
  '/static/game.js': ['game.js', 'text/javascript; charset=utf-8'],
  '/embed.js': ['embed.js', 'text/javascript; charset=utf-8'],
};
const ADMIN_FILES = {
  '/admin': ['admin.html', 'text/html; charset=utf-8'],
  '/admin/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/admin/admin.css': ['admin.css', 'text/css; charset=utf-8'],
};

function serveFile(res, [file, type], extraHeaders = {}) {
  fs.readFile(path.join(PUBLIC_DIR, file), (err, data) => {
    if (err) return send(res, 404, 'Hittades inte');
    send(res, 200, data, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extraHeaders });
  });
}

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

function sniffImage(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 6 && /^GIF8[79]a/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const head = buf.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

// ---------- Admin-autentisering ----------

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkAdmin(req, res) {
  if (!ADMIN_PASSWORD) {
    send(res, 503, 'Adminpanelen är avstängd. Sätt miljövariabeln ADMIN_PASSWORD och starta om servern.');
    return false;
  }
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    if (sep > -1 && safeEqual(user, ADMIN_USER) && safeEqual(pass, ADMIN_PASSWORD)) {
      // Skydd mot CSRF: ändringar måste komma från adminsidan själv.
      if (req.method !== 'GET' && req.headers.origin) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        let originHost = '';
        try { originHost = new URL(req.headers.origin).host; } catch { /* ogiltig origin */ }
        if (originHost !== host) {
          send(res, 403, 'Fel ursprung');
          return false;
        }
      }
      return true;
    }
  }
  send(res, 401, 'Inloggning krävs', { 'WWW-Authenticate': 'Basic realm="CP-Röj admin", charset="UTF-8"' });
  return false;
}

// ---------- Routing ----------

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (p === '/' && m === 'GET') return send(res, 302, '', { Location: '/game' });
  if (p === '/health') return json(res, 200, { ok: true });

  if (m === 'GET' && PUBLIC_FILES[p]) {
    const headers = p === '/game' ? { 'Content-Security-Policy': `frame-ancestors ${FRAME_ANCESTORS}` } : {};
    if (p === '/embed.js') headers['Access-Control-Allow-Origin'] = '*';
    return serveFile(res, PUBLIC_FILES[p], headers);
  }

  if (m === 'GET' && p.startsWith('/uploads/')) {
    const name = p.slice('/uploads/'.length);
    const match = /^[a-f0-9]{24}\.(png|jpg|gif|webp|svg)$/.exec(name);
    if (!match) return send(res, 404, 'Hittades inte');
    return fs.readFile(path.join(UPLOAD_DIR, name), (err, data) => {
      if (err) return send(res, 404, 'Hittades inte');
      send(res, 200, data, {
        'Content-Type': IMAGE_TYPES[match[1]],
        'Cache-Control': 'public, max-age=31536000, immutable',
        // Uppladdade SVG:er får aldrig köra skript på vår domän.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      });
    });
  }

  // ----- Publikt API -----

  if (p === '/api/config' && m === 'GET') return json(res, 200, publicConfig());

  if (p === '/api/leaderboard' && m === 'GET') {
    const level = url.searchParams.get('level');
    if (!LEVELS[level]) return json(res, 400, { error: 'Okänd nivå' });
    return json(res, 200, leaderboard(level).map((s) => ({ name: s.name, timeMs: s.timeMs, date: s.createdAt.slice(0, 10) })));
  }

  if (p === '/api/game/start' && m === 'POST') {
    if (rateLimited(req, 'start', 120, 60 * 1000)) return json(res, 429, { error: 'För många förfrågningar' });
    const body = await readJsonBody(req);
    if (!LEVELS[body.level]) return json(res, 400, { error: 'Okänd nivå' });
    const id = crypto.randomBytes(16).toString('hex');
    games.set(id, { level: body.level, startedAt: Date.now(), finishedAt: null, used: false });
    return json(res, 200, { id });
  }

  if (p === '/api/game/finish' && m === 'POST') {
    const body = await readJsonBody(req);
    const game = games.get(String(body.id || ''));
    if (!game) return json(res, 404, { error: 'Spelomgången hittades inte' });
    if (!game.finishedAt) game.finishedAt = Date.now();
    return json(res, 200, { timeMs: game.finishedAt - game.startedAt });
  }

  if (p === '/api/scores' && m === 'POST') {
    if (rateLimited(req, 'score', 10, 60 * 1000)) return json(res, 429, { error: 'För många försök, vänta en stund.' });
    const body = await readJsonBody(req);
    const game = games.get(String(body.id || ''));
    if (!game || !game.finishedAt) return json(res, 404, { error: 'Spelomgången hittades inte eller är inte avslutad.' });
    if (game.used) return json(res, 409, { error: 'Resultatet är redan sparat.' });
    if (game.finishedAt - game.startedAt < LEVELS[game.level].minMs) {
      return json(res, 400, { error: 'Tiden är orimligt snabb och kan inte sparas på topplistan.' });
    }
    const name = cleanText(body.name, 24);
    const email = cleanText(body.email, 254).toLowerCase();
    if (!name) return json(res, 400, { error: 'Skriv ditt namn.' });
    if (!isValidEmail(email)) return json(res, 400, { error: 'Skriv en giltig mailadress.' });
    if (body.consent !== true) return json(res, 400, { error: 'Du behöver godkänna villkoren för att spara.' });
    game.used = true;
    const entry = {
      id: crypto.randomBytes(8).toString('hex'),
      level: game.level,
      name,
      email,
      timeMs: game.finishedAt - game.startedAt,
      consent: true,
      notified: false,
      createdAt: new Date().toISOString(),
    };
    scores.push(entry);
    await saveScores();
    const board = leaderboard(game.level, Infinity);
    const rank = board.findIndex((s) => s.email === email) + 1;
    return json(res, 201, { ok: true, rank, timeMs: entry.timeMs });
  }

  // ----- Admin -----

  if (p === '/admin' || p.startsWith('/admin/') || p.startsWith('/api/admin/')) {
    if (!checkAdmin(req, res)) return;
    const adminHeaders = { 'Content-Security-Policy': "frame-ancestors 'self'", 'Cache-Control': 'no-store' };

    if (m === 'GET' && ADMIN_FILES[p]) return serveFile(res, ADMIN_FILES[p], adminHeaders);

    if (p === '/api/admin/config' && m === 'GET') {
      return json(res, 200, { ...publicConfig(true), defaults: { colors: DEFAULT_COLORS, texts: DEFAULT_TEXTS } });
    }

    if (p === '/api/admin/config' && m === 'PUT') {
      const body = await readJsonBody(req);
      const colors = { ...config.colors };
      const errors = [];
      for (const key of Object.keys(DEFAULT_COLORS)) {
        if (body.colors && key in body.colors) {
          const hex = normalizeHex(body.colors[key]);
          if (hex) colors[key] = hex;
          else errors.push(`Ogiltig HEX-kod för ${key}: ${body.colors[key]}`);
        }
      }
      const texts = { ...config.texts };
      if (body.texts) {
        if ('title' in body.texts) texts.title = cleanText(body.texts.title, 40) || DEFAULT_TEXTS.title;
        if ('leaderboardIntro' in body.texts) texts.leaderboardIntro = cleanText(body.texts.leaderboardIntro, 300);
        if ('consentText' in body.texts) texts.consentText = cleanText(body.texts.consentText, 400) || DEFAULT_TEXTS.consentText;
        if ('privacyUrl' in body.texts) {
          const u = cleanText(body.texts.privacyUrl, 500);
          if (u && !/^https?:\/\//i.test(u)) errors.push('Länken till integritetspolicyn måste börja med http:// eller https://');
          else texts.privacyUrl = u;
        }
      }
      if (errors.length) return json(res, 400, { error: errors.join('\n') });
      config = { ...config, colors, texts };
      await saveConfig();
      return json(res, 200, publicConfig(true));
    }

    if (p === '/api/admin/icons' && m === 'POST') {
      if (config.icons.length >= MAX_ICONS) return json(res, 400, { error: `Max ${MAX_ICONS} ikoner.` });
      const body = await readJsonBody(req, Math.ceil(MAX_ICON_BYTES * 1.4) + 4096);
      const match = /^data:[^;,]*;base64,(.+)$/.exec(String(body.data || ''));
      if (!match) return json(res, 400, { error: 'Ogiltig bildfil.' });
      const buf = Buffer.from(match[1], 'base64');
      if (buf.length > MAX_ICON_BYTES) return json(res, 400, { error: 'Bilden är större än 1 MB.' });
      const ext = sniffImage(buf);
      if (!ext) return json(res, 400, { error: 'Filformatet stöds inte. Använd PNG, JPG, GIF, WEBP eller SVG.' });
      const file = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
      await fsp.writeFile(path.join(UPLOAD_DIR, file), buf);
      const icon = { id: crypto.randomBytes(6).toString('hex'), file, name: cleanText(body.name, 100) };
      config = { ...config, icons: [...config.icons, icon] };
      await saveConfig();
      return json(res, 201, publicConfig(true));
    }

    const iconMatch = /^\/api\/admin\/icons\/([a-f0-9]+)$/.exec(p);
    if (iconMatch && m === 'DELETE') {
      const icon = config.icons.find((i) => i.id === iconMatch[1]);
      if (!icon) return json(res, 404, { error: 'Ikonen hittades inte.' });
      config = { ...config, icons: config.icons.filter((i) => i !== icon) };
      await saveConfig();
      await fsp.unlink(path.join(UPLOAD_DIR, icon.file)).catch(() => {});
      return json(res, 200, publicConfig(true));
    }

    if (p === '/api/admin/scores' && m === 'GET') {
      return json(res, 200, [...scores].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }

    if (p === '/api/admin/scores' && m === 'DELETE') {
      const level = url.searchParams.get('level');
      scores = LEVELS[level] ? scores.filter((s) => s.level !== level) : [];
      await saveScores();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/admin/scores.csv' && m === 'GET') {
      const cell = (v) => {
        let s = String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return `"${s.replace(/"/g, '""')}"`;
      };
      const rows = [['Datum', 'Namn', 'E-post', 'Nivå', 'Tid (s)', 'Samtycke', 'Meddelad']];
      for (const s of [...scores].sort((a, b) => a.level.localeCompare(b.level) || a.timeMs - b.timeMs)) {
        rows.push([s.createdAt.replace('T', ' ').slice(0, 19), s.name, s.email, LEVELS[s.level].label,
          (s.timeMs / 1000).toFixed(2).replace('.', ','), s.consent ? 'Ja' : 'Nej', s.notified ? 'Ja' : 'Nej']);
      }
      const csv = `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}`;
      return send(res, 200, csv, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="cp-roj-topplista-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      });
    }

    const scoreMatch = /^\/api\/admin\/scores\/([a-f0-9]+)$/.exec(p);
    if (scoreMatch) {
      const entry = scores.find((s) => s.id === scoreMatch[1]);
      if (!entry) return json(res, 404, { error: 'Raden hittades inte.' });
      if (m === 'PATCH') {
        const body = await readJsonBody(req);
        if (typeof body.notified === 'boolean') entry.notified = body.notified;
        await saveScores();
        return json(res, 200, entry);
      }
      if (m === 'DELETE') {
        scores = scores.filter((s) => s !== entry);
        await saveScores();
        return json(res, 200, { ok: true });
      }
    }
  }

  // CORS-preflight eller okänd väg.
  return send(res, 404, 'Hittades inte');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (!err.status) console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : 'Serverfel' });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`CP-Röj kör på http://localhost:${PORT}`);
    console.log(`  Spelet:  http://localhost:${PORT}/game`);
    console.log(`  Admin:   http://localhost:${PORT}/admin${ADMIN_PASSWORD ? '' : '  (avstängd – sätt ADMIN_PASSWORD)'}`);
    console.log(`  Data:    ${DATA_DIR}`);
  });
}

module.exports = server;
