const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(ROOT, 'storage');
const STORE_FILE = process.env.STORE_FILE || path.join(DATA_DIR, 'store.json');
const API_PORT = Number(process.env.API_PORT || 4000);
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 3001);
const STORAGE_PORT = Number(process.env.STORAGE_PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-secret-change-me';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 250 * 1024 * 1024);
const MAX_FOLDER_DEPTH = Number(process.env.MAX_FOLDER_DEPTH || 3);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const DEFAULT_STORE = () => ({
  adminPasswordHash: hashPassword(ADMIN_PASSWORD),
  tags: ['важно', 'архив', 'проект'],
  filters: [
    { id: 'category', label: 'Категория', type: 'dropdown', options: ['Документы', 'Фото', 'Видео'] },
    { id: 'approved', label: 'Согласовано', type: 'checkbox' }
  ],
  files: []
});

let store = null;
let saveQueue = Promise.resolve();

function hashPassword(password) {
  return crypto.createHash('sha256').update(`password:${password}`).digest('hex');
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signToken(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!timingSafeEqual(parts[2], expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function text(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers
  });
  res.end(body);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const tag = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function normalizeFilters(filters) {
  if (!Array.isArray(filters)) return [];
  const seen = new Set();
  const out = [];
  for (const item of filters) {
    const label = String(item?.label ?? '').trim().replace(/\s+/g, ' ');
    const type = item?.type === 'checkbox' ? 'checkbox' : 'dropdown';
    let id = String(item?.id ?? '').trim();
    if (!id) id = slugify(label || 'filter');
    id = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const normalized = { id, label: label || id, type };
    if (type === 'dropdown') {
      normalized.options = Array.isArray(item?.options)
        ? Array.from(new Set(item.options.map(v => String(v ?? '').trim()).filter(Boolean)))
        : [];
    }
    out.push(normalized);
  }
  return out;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'filter';
}

function safeFolder(folder) {
  const cleaned = String(folder ?? '').trim().replace(/\\/g, '/');
  if (!cleaned || cleaned === '.') return '';
  const normalized = path.posix.normalize(cleaned).replace(/^\/+/, '');
  if (normalized === '.' || normalized.startsWith('..')) return '';
  return normalized;
}

function safeFileName(name) {
  return String(name ?? 'file')
    .replace(/[\\/\x00]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'file';
}

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function walkFiles(dir, rel = '') {
  const results = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const nextRel = rel ? path.posix.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      results.push(...await walkFiles(abs, nextRel));
    } else if (entry.isFile()) {
      const stat = await fsp.stat(abs);
      results.push({ abs, rel: nextRel.replace(/\\/g, '/'), size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return results;
}

function fileKeyFromMeta(file) {
  return file.relativePath || `${file.folder ? `${file.folder}/` : ''}${file.storedName}`;
}

function buildFolders(files) {
  const set = new Set();
  for (const f of files) {
    if (f.folder) {
      const parts = f.folder.split('/');
      let acc = '';
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        set.add(acc);
      }
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
}

function matchesSearch(file, criteria, filterDefs) {
  const q = String(criteria.search ?? '').trim().toLowerCase();
  if (q) {
    const hay = [
      file.originalName,
      file.storedName,
      file.folder,
      ...(file.tags || []),
      ...(Object.values(file.filters || {})).map(v => Array.isArray(v) ? v.join(' ') : String(v))
    ].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }

  const folder = safeFolder(criteria.folder);
  if (folder && file.folder !== folder && !file.folder.startsWith(`${folder}/`)) return false;

  const selectedTags = normalizeTags(criteria.tags || []);
  if (selectedTags.length) {
    const tagSet = new Set((file.tags || []).map(t => t.toLowerCase()));
    const any = selectedTags.some(t => tagSet.has(t.toLowerCase()));
    if (!any) return false;
  }

  const selectedFilters = criteria.filters && typeof criteria.filters === 'object' ? criteria.filters : {};
  for (const def of filterDefs) {
    const selected = selectedFilters[def.id];
    if (selected === undefined || selected === null || selected === '') continue;
    const current = (file.filters || {})[def.id];
    if (def.type === 'checkbox') {
      const want = selected === true || selected === 'true' || selected === '1';
      if (want && !current) return false;
      if (!want && current) return false;
    } else if (String(current ?? '') !== String(selected)) {
      return false;
    }
  }
  return true;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES * 4) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJsonBody(buf) {
  if (!buf || !buf.length) return {};
  return JSON.parse(buf.toString('utf8') || '{}');
}

function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];
  let index = buffer.indexOf(boundaryBuf);
  while (index !== -1) {
    index += boundaryBuf.length;
    if (buffer.slice(index, index + 2).toString() === '--') break;
    if (buffer.slice(index, index + 2).toString() === '\r\n') index += 2;
    const next = buffer.indexOf(boundaryBuf, index);
    if (next === -1) break;
    let part = buffer.slice(index, next);
    if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2);
    parts.push(part);
    index = next;
  }

  const fields = {};
  const files = [];

  for (const part of parts) {
    const sep = part.indexOf(Buffer.from('\r\n\r\n'));
    if (sep === -1) continue;
    const headerText = part.slice(0, sep).toString('utf8');
    let content = part.slice(sep + 4);
    const headers = {};
    for (const line of headerText.split('\r\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    const disp = headers['content-disposition'] || '';
    const nameMatch = /name="([^"]+)"/.exec(disp);
    const fileMatch = /filename="([^"]*)"/.exec(disp);
    const fieldName = nameMatch ? nameMatch[1] : '';
    if (fileMatch) {
      files.push({
        fieldName,
        filename: fileMatch[1],
        contentType: headers['content-type'] || 'application/octet-stream',
        buffer: content
      });
    } else {
      fields[fieldName] = content.toString('utf8');
    }
  }

  return { fields, files };
}

async function loadStore() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(STORAGE_DIR, { recursive: true });
  try {
    const raw = await fsp.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    store = {
      adminPasswordHash: parsed.adminPasswordHash || hashPassword(ADMIN_PASSWORD),
      tags: normalizeTags(parsed.tags || []),
      filters: normalizeFilters(parsed.filters || []),
      files: Array.isArray(parsed.files) ? parsed.files : []
    };
  } catch {
    store = DEFAULT_STORE();
    await saveStore();
  }
  store.tags = normalizeTags(store.tags);
  store.filters = normalizeFilters(store.filters);
  store.files = Array.isArray(store.files) ? store.files : [];
  await syncFromDisk();
}

function queueSave() {
  saveQueue = saveQueue.then(() => saveStore()).catch(() => saveStore());
  return saveQueue;
}

async function saveStore() {
  const tmp = `${STORE_FILE}.tmp`;
  const payload = JSON.stringify(store, null, 2);
  await fsp.writeFile(tmp, payload, 'utf8');
  await fsp.rename(tmp, STORE_FILE);
}

function metaLookup() {
  const map = new Map();
  for (const file of store.files) {
    map.set(file.relativePath || file.id, file);
  }
  return map;
}

async function syncFromDisk() {
  const disk = await walkFiles(STORAGE_DIR);
  const map = metaLookup();
  const existing = new Set();

  for (const item of disk) {
    const rel = item.rel;
    existing.add(rel);
    const found = map.get(rel);
    if (found) {
      found.size = item.size;
      found.updatedAt = found.updatedAt || found.createdAt || new Date(item.mtimeMs).toISOString();
      found.relativePath = rel;
      continue;
    }
    const storedName = path.posix.basename(rel);
    const originalGuess = storedName.replace(/^[0-9a-f-]{8,36}__/, '');
    const folder = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    store.files.push({
      id: crypto.randomUUID(),
      originalName: originalGuess,
      storedName,
      relativePath: rel,
      folder,
      size: item.size,
      mimeType: 'application/octet-stream',
      tags: [],
      filters: {},
      createdAt: new Date(item.mtimeMs).toISOString(),
      updatedAt: new Date(item.mtimeMs).toISOString()
    });
  }

  const before = store.files.length;
  store.files = store.files.filter(file => existing.has(fileKeyFromMeta(file)));
  if (before !== store.files.length) await queueSave();
}

function requireAdmin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyToken(token);
  return !!payload;
}

function adminGuard(req, res) {
  if (!requireAdmin(req)) {
    json(res, 401, { ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'POST' && pathname === '/api/admin/login') {
      const body = parseJsonBody(await readBody(req));
      const ok = hashPassword(String(body.password ?? '')) === store.adminPasswordHash;
      if (!ok) return json(res, 401, { ok: false, error: 'Неверный пароль' });
      const token = signToken({ role: 'admin', exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 });
      return json(res, 200, { ok: true, token });
    }

    if (req.method === 'GET' && pathname === '/api/public/config') {
      await syncFromDisk();
      return json(res, 200, {
        ok: true,
        tags: store.tags,
        filters: store.filters,
        folders: buildFolders(store.files)
      });
    }

    if (req.method === 'POST' && pathname === '/api/public/search') {
      await syncFromDisk();
      const body = parseJsonBody(await readBody(req));
      const filtered = store.files
        .filter(f => matchesSearch(f, body, store.filters))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .map(file => ({
          ...file,
          downloadUrl: `/api/files/${encodeURIComponent(file.id)}/download`
        }));
      return json(res, 200, { ok: true, files: filtered, folders: buildFolders(filtered) });
    }

    const adminPaths = [
      ['GET', '/api/admin/config'],
      ['POST', '/api/admin/tags'],
      ['DELETE', /^\/api\/admin\/tags\/([^/]+)$/],
      ['POST', '/api/admin/filters'],
      ['DELETE', /^\/api\/admin\/filters\/([^/]+)$/],
      ['POST', '/api/admin/upload'],
      ['GET', '/api/admin/files'],
      ['PATCH', /^\/api\/admin\/files\/([^/]+)$/],
      ['DELETE', /^\/api\/admin\/files\/([^/]+)$/]
    ];

    if (req.method === 'GET' && pathname === '/api/admin/config') {
      if (!adminGuard(req, res)) return;
      await syncFromDisk();
      return json(res, 200, {
        ok: true,
        tags: store.tags,
        filters: store.filters,
        folders: buildFolders(store.files),
        files: store.files.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      });
    }

    if (req.method === 'POST' && pathname === '/api/admin/tags') {
      if (!adminGuard(req, res)) return;
      const body = parseJsonBody(await readBody(req));
      store.tags = normalizeTags(body.tags || []);
      await queueSave();
      return json(res, 200, { ok: true, tags: store.tags });
    }

    const tagDelete = pathname.match(/^\/api\/admin\/tags\/([^/]+)$/);
    if (req.method === 'DELETE' && tagDelete) {
      if (!adminGuard(req, res)) return;
      const tag = decodeURIComponent(tagDelete[1]).toLowerCase();
      store.tags = store.tags.filter(t => t.toLowerCase() !== tag);
      await queueSave();
      return json(res, 200, { ok: true, tags: store.tags });
    }

    if (req.method === 'POST' && pathname === '/api/admin/filters') {
      if (!adminGuard(req, res)) return;
      const body = parseJsonBody(await readBody(req));
      store.filters = normalizeFilters(body.filters || []);
      await queueSave();
      return json(res, 200, { ok: true, filters: store.filters });
    }

    const filterDelete = pathname.match(/^\/api\/admin\/filters\/([^/]+)$/);
    if (req.method === 'DELETE' && filterDelete) {
      if (!adminGuard(req, res)) return;
      const id = decodeURIComponent(filterDelete[1]);
      store.filters = store.filters.filter(f => f.id !== id);
      await queueSave();
      return json(res, 200, { ok: true, filters: store.filters });
    }

    if (req.method === 'POST' && pathname === '/api/admin/upload') {
      if (!adminGuard(req, res)) return;
      const ctype = req.headers['content-type'] || '';
      const boundaryMatch = /boundary=([^;]+)/i.exec(ctype);
      if (!boundaryMatch) return json(res, 400, { ok: false, error: 'No boundary' });
      const body = await readBody(req);
      const { fields, files } = parseMultipart(body, boundaryMatch[1]);
      const folder = safeFolder(fields.folder);
      if (folder && folderDepth(folder) > MAX_FOLDER_DEPTH) {
        return json(res, 400, { ok: false, error: `Глубина папки не должна быть больше ${MAX_FOLDER_DEPTH} уровней` });
      }
      const tags = normalizeTags(JSON.parse(fields.tags || '[]'));
      const filterValues = fields.filterValues ? JSON.parse(fields.filterValues) : {};
      const saved = [];
      for (const file of files) {
        if (file.fieldName !== 'files') continue;
        const id = crypto.randomUUID();
        const originalName = safeFileName(file.filename || 'file');
        const storedName = `${id}__${originalName}`;
        const relDir = folder ? path.join(STORAGE_DIR, folder) : STORAGE_DIR;
        await fsp.mkdir(relDir, { recursive: true });
        const abs = path.join(relDir, storedName);
        await fsp.writeFile(abs, file.buffer);
        const relativePath = folder ? path.posix.join(folder.replace(/\\/g, '/'), storedName) : storedName;
        const entry = {
          id,
          originalName,
          storedName,
          relativePath,
          folder,
          size: file.buffer.length,
          mimeType: file.contentType || 'application/octet-stream',
          tags,
          filters: filterValues,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        store.files.push(entry);
        saved.push(entry);
      }
      await queueSave();
      return json(res, 200, { ok: true, saved: saved.length, files: saved });
    }

    if (req.method === 'GET' && pathname === '/api/admin/files') {
      if (!adminGuard(req, res)) return;
      await syncFromDisk();
      return json(res, 200, { ok: true, files: store.files.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))) });
    }

    const editMatch = pathname.match(/^\/api\/admin\/files\/([^/]+)$/);
    if (editMatch && req.method === 'PATCH') {
      if (!adminGuard(req, res)) return;
      const id = decodeURIComponent(editMatch[1]);
      const body = parseJsonBody(await readBody(req));
      const file = store.files.find(f => f.id === id);
      if (!file) return json(res, 404, { ok: false, error: 'File not found' });
      if (body.tags !== undefined) file.tags = normalizeTags(body.tags);
      if (body.filters && typeof body.filters === 'object') file.filters = body.filters;
      file.updatedAt = new Date().toISOString();
      await queueSave();
      return json(res, 200, { ok: true, file });
    }

    if (editMatch && req.method === 'DELETE') {
      if (!adminGuard(req, res)) return;
      const id = decodeURIComponent(editMatch[1]);
      const idx = store.files.findIndex(f => f.id === id);
      if (idx === -1) return json(res, 404, { ok: false, error: 'File not found' });
      const file = store.files[idx];
      const abs = path.join(STORAGE_DIR, file.relativePath || fileKeyFromMeta(file));
      try { await fsp.unlink(abs); } catch {}
      store.files.splice(idx, 1);
      await queueSave();
      return json(res, 200, { ok: true });
    }

    const downloadMatch = pathname.match(/^\/api\/files\/([^/]+)\/download$/);
    if (req.method === 'GET' && downloadMatch) {
      await syncFromDisk();
      const id = decodeURIComponent(downloadMatch[1]);
      const file = store.files.find(f => f.id === id);
      if (!file) return text(res, 404, 'File not found');
      const abs = path.join(STORAGE_DIR, file.relativePath || fileKeyFromMeta(file));
      try {
        const stat = await fsp.stat(abs);
        const fallbackName = safeFileName(file.originalName || 'file').replace(/"/g, '_');
        const encodedName = encodeURIComponent(file.originalName || fallbackName);
        res.writeHead(200, {
          'Content-Type': file.mimeType || 'application/octet-stream',
          'Content-Length': stat.size,
          'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
          'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(abs).pipe(res);
      } catch {
        text(res, 404, 'File not found');
      }
      return;
    }

    json(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    console.error(err);
    json(res, 500, { ok: false, error: err.message || 'Server error' });
  }
}

function serveStatic(mode, req, res) {
  if (req.url === '/config.js') {
    const host = (req.headers.host || 'localhost').split(':')[0];
    const apiBase = `http://${host}:${API_PORT}`;
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(`window.APP_CONFIG=${JSON.stringify({ apiBase, mode, apiPort: API_PORT, storagePort: STORAGE_PORT, adminPort: ADMIN_PORT })};`);
    return;
  }

  const pubDir = path.join(ROOT, 'public', mode);
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.normalize(path.join(pubDir, rel));
  if (!abs.startsWith(pubDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      if (rel !== '/index.html') {
        fs.readFile(path.join(pubDir, 'index.html'), (e2, data2) => {
          if (e2) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data2);
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ct = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  });
}

async function main() {
  ensureDirSync(DATA_DIR);
  ensureDirSync(STORAGE_DIR);
  await loadStore();

  const mode = process.argv[2] || 'api';
  if (mode === 'api') {
    http.createServer((req, res) => handleApi(req, res)).listen(API_PORT, () => {
      console.log(`API listening on ${API_PORT}`);
    });
  } else if (mode === 'storage') {
    http.createServer((req, res) => serveStatic('storage', req, res)).listen(STORAGE_PORT, () => {
      console.log(`Storage site listening on ${STORAGE_PORT}`);
    });
  } else if (mode === 'admin') {
    http.createServer((req, res) => serveStatic('admin', req, res)).listen(ADMIN_PORT, () => {
      console.log(`Admin site listening on ${ADMIN_PORT}`);
    });
  } else {
    console.error('Unknown mode. Use api, storage, or admin.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
