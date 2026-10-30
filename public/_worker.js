/* ---------- 최희 작가 홈페이지 서버 (Cloudflare Pages · _worker.js) ----------
   필요한 설정 (Pages 프로젝트 → 설정)
     · D1 바인딩   이름 DB        → total-db
     · 비밀 변수   이름 ADMIN_KEY → 관리자 비밀번호 (12자 이상 권장)

   total-db는 여러 홈페이지가 함께 쓰는 공용 DB입니다.
   이 홈페이지는 이름이 choihee_ 로 시작하는 표만 만들고, 읽고, 씁니다.
   다른 표는 절대 건드리지 않습니다. 표는 처음 접속할 때 자동으로 만들어집니다. */

const SCHEMA_VERSION = 1;
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS choihee_meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS choihee_content (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS choihee_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS choihee_inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS choihee_media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, width INTEGER, height INTEGER, bytes INTEGER NOT NULL, chunks INTEGER NOT NULL, name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS choihee_media_chunks (media_id TEXT NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (media_id, seq))`,
  `CREATE TABLE IF NOT EXISTS choihee_login_attempts (ip TEXT PRIMARY KEY, fails INTEGER NOT NULL, first_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS choihee_idx_inquiries_status ON choihee_inquiries (status, id)`,
  `INSERT INTO choihee_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
];

const CATEGORIES = ['강연·북토크', '기고·집필', '출판·편집·감수', '제휴·기타', '일반 문의'];
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MEDIA_MAX = 1800000;   // 사진 한 장 최대 1.8MB (관리 화면에서 자동으로 줄여 올립니다)
const CHUNK = 90000;         // D1 한 칸에 나눠 담는 크기
const COOKIE = '__Host-choihee_admin';
const SESSION_HOURS = 8;
const CONTENT_TTL = 10000;   // 문구 캐시 10초

/* ---------- 응답 도우미 ---------- */

function json(data, status = 200, extra) {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(JSON.stringify(data), { status, headers: h });
}
const fail = (status, code, message) => json({ ok: false, code, message }, status);

function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}
function setSecurityHeaders(h) {
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  if (!h.has('x-frame-options')) h.set('x-frame-options', 'SAMEORIGIN');
}

/* ---------- 스키마 (choihee_ 표만) ---------- */

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  let v = 0;
  try {
    const r = await db.prepare(`SELECT value FROM choihee_meta WHERE key = 'schema_version'`).first();
    v = r ? Number(r.value) : 0;
  } catch { v = 0; }
  if (v < SCHEMA_VERSION) await db.batch(SCHEMA_SQL.map((s) => db.prepare(s)));
  schemaReady = true;
}

/* ---------- 콘텐츠 (문구·사진·링크·목록) ---------- */

let contentCache = { at: 0, map: null };
async function loadContent(db) {
  if (contentCache.map && Date.now() - contentCache.at < CONTENT_TTL) return contentCache.map;
  const { results } = await db.prepare('SELECT key, value FROM choihee_content').all();
  const map = new Map((results || []).map((r) => [r.key, r.value]));
  contentCache = { at: Date.now(), map };
  return map;
}
function invalidateContent() { contentCache = { at: 0, map: null }; }

let defaultsCache = null;
async function loadDefaults(env, url) {
  if (defaultsCache) return defaultsCache;
  try {
    const r = await env.ASSETS.fetch(new Request(new URL('/assets/data/defaults.json', url)));
    if (r.ok) defaultsCache = await r.json();
  } catch { /* 기본 목록 없이 진행 */ }
  return defaultsCache || {};
}

const KEY_RE = /^(t|i|h|l):[a-z0-9][a-z0-9._-]{0,79}$/;

function validateValue(key, value) {
  if (typeof value !== 'string') return { error: '값이 올바르지 않습니다.' };
  const type = key[0];
  if (type === 't') {
    const v = value.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (v.length > 5000) return { error: '글이 너무 깁니다 (5,000자 이하).' };
    return { value: v };
  }
  if (type === 'i') {
    const u = safeUrl(value, 'img');
    return u ? { value: u } : { error: '사진 주소가 올바르지 않습니다.' };
  }
  if (type === 'h') {
    const u = safeUrl(value, 'link');
    return u ? { value: u } : { error: '링크 주소가 올바르지 않습니다. https:// 로 시작하는 주소를 넣어 주십시오.' };
  }
  if (type === 'l') {
    const name = key.slice(2);
    let arr;
    try { arr = JSON.parse(value); } catch { return { error: '목록 형식이 올바르지 않습니다.' }; }
    const list = normalizeList(name, arr);
    if (!list) return { error: '알 수 없는 목록입니다.' };
    const s = JSON.stringify(list);
    if (enc.encode(s).length > 90000) return { error: '목록이 너무 깁니다. 항목 수나 소개 글을 줄여 주십시오.' };
    return { value: s };
  }
  return { error: '알 수 없는 항목입니다.' };
}

/** 여러 줄을 한 문장으로 묶어 저장 (D1 문장 길이·파라미터 수 제한 안에서) */
function groupRows(rows, perRow, maxBytes = 70000) {
  const groups = [];
  let cur = [], size = 0;
  for (const r of rows) {
    const len = r.reduce((n, v) => n + (typeof v === 'string' ? v.length * 3 : 16), 0);
    if (cur.length && (cur.length + 1) * perRow > 99 || cur.length && size + len > maxBytes) {
      groups.push(cur); cur = []; size = 0;
    }
    cur.push(r); size += len;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/* ---------- HTML에 문구·사진 반영 ---------- */

async function renderHtml(request, env, assetRes) {
  const url = new URL(request.url);
  let content = new Map();
  if (env.DB) {
    try { await ensureSchema(env.DB); content = await loadContent(env.DB); } catch { content = new Map(); }
  }
  const defaults = await loadDefaults(env, url);
  const lists = {};
  for (const name of Object.keys(LIST_LIMITS)) {
    let items = null;
    const saved = content.get('l:' + name);
    if (saved) { try { items = normalizeList(name, JSON.parse(saved)); } catch { items = null; } }
    if (!items && Array.isArray(defaults[name])) items = normalizeList(name, defaults[name]);
    lists[name] = items;
  }

  const rewriter = new HTMLRewriter()
    .on('[data-cms]', {
      element(el) {
        const v = content.get('t:' + el.getAttribute('data-cms'));
        if (v !== undefined) el.setInnerContent(textHtml(v), { html: true });
      },
    })
    .on('[data-cms-img]', {
      element(el) {
        const v = content.get('i:' + el.getAttribute('data-cms-img'));
        const u = v !== undefined ? safeUrl(v, 'img') : '';
        if (u) { el.setAttribute('src', u); el.removeAttribute('width'); el.removeAttribute('height'); }
      },
    })
    .on('[data-cms-href]', {
      element(el) {
        const v = content.get('h:' + el.getAttribute('data-cms-href'));
        const u = v !== undefined ? safeUrl(v, 'link') : '';
        if (u) {
          el.setAttribute('href', u);
          if (!u.startsWith('/assets/')) el.removeAttribute('download');
          if (/^https?:/i.test(u)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
        }
      },
    })
    .on('[data-cms-list]', {
      element(el) {
        const items = lists[el.getAttribute('data-cms-list')];
        if (!items) return;
        const html = renderList(el.getAttribute('data-cms-render') || el.getAttribute('data-cms-list'), items);
        if (html !== null) el.setInnerContent(html, { html: true });
      },
    });

  const out = rewriter.transform(assetRes);
  const h = new Headers(out.headers);
  h.set('cache-control', 'no-cache');
  h.delete('etag');
  h.delete('last-modified');
  setSecurityHeaders(h);
  return new Response(out.body, { status: out.status, headers: h });
}

/* ---------- 관리자 세션 ---------- */

const enc = new TextEncoder();
function b64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(env) {
  return crypto.subtle.importKey('raw', enc.encode('choihee-session|' + env.ADMIN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function makeToken(env) {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(exp));
  return exp + '.' + b64url(sig);
}
async function verifyToken(env, token) {
  if (!token || !env.ADMIN_KEY) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  try { return await crypto.subtle.verify('HMAC', await hmacKey(env), b64urlDecode(sig), enc.encode(exp)); } catch { return false; }
}
function getCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  for (const part of c.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
}
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

/* ---------- 사진 ---------- */

function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return '';
}
function toBytes(x) {
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return Uint8Array.from(x || []);
}
function randomId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

async function serveMedia(request, env, ctx, id) {
  if (!/^[a-f0-9]{24}$/.test(id)) return new Response('Not found', { status: 404 });
  const etag = `"${id}"`;
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });

  let cache = null;
  try { cache = caches.default; const hit = await cache.match(request); if (hit) return hit; } catch { cache = null; }

  if (!env.DB) return new Response('Not found', { status: 404 });
  await ensureSchema(env.DB);
  const meta = await env.DB.prepare('SELECT mime, bytes FROM choihee_media WHERE id = ?').bind(id).first();
  if (!meta) return new Response('Not found', { status: 404 });
  const { results } = await env.DB.prepare('SELECT data FROM choihee_media_chunks WHERE media_id = ? ORDER BY seq').bind(id).all();
  const out = new Uint8Array(meta.bytes);
  let off = 0;
  for (const r of results || []) {
    const part = toBytes(r.data);
    if (off + part.length > out.length) break;
    out.set(part, off); off += part.length;
  }
  const res = new Response(out, {
    headers: {
      'content-type': meta.mime,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      etag,
    },
  });
  if (cache && ctx && ctx.waitUntil) { try { ctx.waitUntil(cache.put(request, res.clone())); } catch { /* 캐시 없이 진행 */ } }
  return res;
}

/* ---------- 진입점 ---------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        return fail(500, 'server_error', '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.');
      }
    }

    if (path.startsWith('/media/')) {
      try { return await serveMedia(request, env, ctx, path.slice(7)); }
      catch { return new Response('Not found', { status: 404 }); }
    }

    // 관리 페이지: 검색 노출·프레임 삽입·캐시 금지
    if (path === '/admin' || path === '/admin.html' || path === '/admin/') {
      const res = await env.ASSETS.fetch(request);
      const h = new Headers(res.headers);
      h.set('cache-control', 'no-store');
      h.set('x-robots-tag', 'noindex, nofollow');
      h.set('x-frame-options', 'DENY');
      setSecurityHeaders(h);
      return new Response(res.body, { status: res.status, headers: h });
    }

    // HTML로 보일 수 있는 요청은 조건부 헤더를 떼고 받아와야 수정 내용이 바로 보입니다
    const maybeHtml = !/\.[a-z0-9]{2,5}$/i.test(path) || /\.html?$/i.test(path);
    let assetReq = request;
    if (maybeHtml && (request.headers.has('if-none-match') || request.headers.has('if-modified-since'))) {
      const h = new Headers(request.headers);
      h.delete('if-none-match'); h.delete('if-modified-since');
      assetReq = new Request(request, { headers: h });
    }
    const res = await env.ASSETS.fetch(assetReq);
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html') || request.headers.get('x-cms-raw') === '1') return res;
    return renderHtml(request, env, res);
  },
};

/* ---------- API ---------- */

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/health') {
    let schema = null;
    if (env.DB) { try { await ensureSchema(env.DB); schema = SCHEMA_VERSION; } catch { schema = 'error'; } }
    return json({ ok: true, db: Boolean(env.DB), admin: Boolean(env.ADMIN_KEY), schema, prefix: 'choihee_' });
  }

  if (!env.DB) return fail(503, 'db_not_configured', '저장소가 아직 연결되지 않았습니다.');
  const db = env.DB;
  await ensureSchema(db);

  /* --- 공개: 독자 게시판 --- */
  if (pathname === '/api/posts' && method === 'GET') {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 1), 30);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
    const [list, count] = await db.batch([
      db.prepare('SELECT id, name, message, created_at FROM choihee_posts ORDER BY id DESC LIMIT ? OFFSET ?').bind(limit, offset),
      db.prepare('SELECT COUNT(*) AS c FROM choihee_posts'),
    ]);
    return json({ ok: true, total: count.results?.[0]?.c ?? 0, posts: list.results || [] });
  }

  if (pathname === '/api/posts' && method === 'POST') {
    const body = await readJson(request);
    if (!body) return fail(400, 'bad_json', '요청 형식이 올바르지 않습니다.');
    if (clean(body.website, 100)) return json({ ok: true }, 201); // 스팸 차단용 숨김 칸
    const name = clean(body.name, 20);
    const message = clean(body.message, 500);
    if (!name) return fail(400, 'name_required', '이름을 적어 주십시오.');
    if (message.length < 2) return fail(400, 'message_required', '내용을 적어 주십시오.');
    await db.prepare('INSERT INTO choihee_posts (name, message) VALUES (?, ?)').bind(name, message).run();
    return json({ ok: true }, 201);
  }

  /* --- 공개: 문의·제안 --- */
  if (pathname === '/api/inquiries' && method === 'POST') {
    const body = await readJson(request);
    if (!body) return fail(400, 'bad_json', '요청 형식이 올바르지 않습니다.');
    if (clean(body.website, 100)) return json({ ok: true }, 201);
    const category = clean(body.category, 20);
    const name = clean(body.name, 30);
    const email = clean(body.email, 100);
    const phone = clean(body.phone, 30);
    const message = clean(body.message, 1000);
    if (!CATEGORIES.includes(category)) return fail(400, 'category_invalid', '문의 구분을 선택해 주십시오.');
    if (!name) return fail(400, 'name_required', '성함을 적어 주십시오.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'email_invalid', '이메일 주소를 확인해 주십시오.');
    if (message.length < 5) return fail(400, 'message_required', '내용을 조금 더 적어 주십시오.');
    await db.prepare('INSERT INTO choihee_inquiries (category, name, email, phone, message) VALUES (?, ?, ?, ?, ?)')
      .bind(category, name, email, phone, message).run();
    return json({ ok: true }, 201);
  }

  if (pathname.startsWith('/api/admin/')) return handleAdmin(request, env, url, db);

  return fail(404, 'not_found', '요청하신 주소를 찾을 수 없습니다.');
}

/* ---------- 관리자 API ---------- */

async function handleAdmin(request, env, url, db) {
  const { pathname } = url;
  const method = request.method;

  if (!env.ADMIN_KEY) {
    return fail(503, 'admin_not_configured', '관리자 비밀번호(ADMIN_KEY)가 아직 설정되지 않았습니다.');
  }
  // 다른 사이트에서 몰래 보내는 요청 차단
  if (method !== 'GET' && request.headers.get('x-choihee-admin') !== '1') {
    return fail(403, 'forbidden', '허용되지 않은 요청입니다.');
  }

  /* 로그인 */
  if (pathname === '/api/admin/login' && method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const now = Math.floor(Date.now() / 1000);
    const row = await db.prepare('SELECT fails, first_at FROM choihee_login_attempts WHERE ip = ?').bind(ip).first();
    if (row && now - row.first_at < 900 && row.fails >= 8) {
      return fail(429, 'too_many', '비밀번호를 여러 번 틀려 잠시 잠겼습니다. 15분 뒤 다시 시도해 주십시오.');
    }
    const body = await readJson(request);
    const key = body && typeof body.key === 'string' ? body.key : '';
    if (!key || !(await sameSecret(key, env.ADMIN_KEY))) {
      if (row && now - row.first_at < 900) {
        await db.prepare('UPDATE choihee_login_attempts SET fails = fails + 1 WHERE ip = ?').bind(ip).run();
      } else {
        await db.prepare('INSERT INTO choihee_login_attempts (ip, fails, first_at) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET fails = 1, first_at = excluded.first_at').bind(ip, now).run();
      }
      return fail(401, 'wrong_key', '비밀번호가 맞지 않습니다.');
    }
    await db.batch([
      db.prepare('DELETE FROM choihee_login_attempts WHERE ip = ?').bind(ip),
      db.prepare('DELETE FROM choihee_login_attempts WHERE first_at < ?').bind(now - 86400),
    ]);
    const token = await makeToken(env);
    return json({ ok: true }, 200, {
      'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`,
    });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }

  if (!(await verifyToken(env, getCookie(request, COOKIE)))) {
    return fail(401, 'unauthorized', '다시 로그인해 주십시오.');
  }

  if (pathname === '/api/admin/session') return json({ ok: true });

  /* 한눈에 보기 */
  if (pathname === '/api/admin/overview' && method === 'GET') {
    const r = await db.batch([
      db.prepare(`SELECT COUNT(*) AS c FROM choihee_inquiries WHERE status = 'new'`),
      db.prepare('SELECT COUNT(*) AS c FROM choihee_inquiries'),
      db.prepare('SELECT COUNT(*) AS c FROM choihee_posts'),
      db.prepare('SELECT COUNT(*) AS c FROM choihee_content'),
      db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM choihee_media'),
      db.prepare('SELECT MAX(updated_at) AS t FROM choihee_content'),
    ]);
    return json({
      ok: true,
      inquiriesNew: r[0].results[0].c, inquiries: r[1].results[0].c, posts: r[2].results[0].c,
      edits: r[3].results[0].c, media: r[4].results[0].c, mediaBytes: r[4].results[0].b,
      lastEdit: r[5].results[0].t || null,
    });
  }

  /* 문구·사진·링크·목록 */
  if (pathname === '/api/admin/content' && method === 'GET') {
    const { results } = await db.prepare('SELECT key, value, updated_at FROM choihee_content').all();
    const items = {}, updated = {};
    for (const r of results || []) { items[r.key] = r.value; updated[r.key] = r.updated_at; }
    return json({ ok: true, items, updated });
  }

  if (pathname === '/api/admin/content' && method === 'PUT') {
    const body = await readJson(request);
    if (!body || typeof body !== 'object') return fail(400, 'bad_json', '요청 형식이 올바르지 않습니다.');
    const set = body.set && typeof body.set === 'object' ? body.set : {};
    const unset = Array.isArray(body.unset) ? body.unset : [];
    const setKeys = Object.keys(set);
    if (setKeys.length + unset.length === 0) return json({ ok: true, saved: 0 });
    if (setKeys.length + unset.length > 300) return fail(400, 'too_many', '한 번에 저장할 수 있는 항목 수를 넘었습니다.');

    const rows = [];
    for (const k of setKeys) {
      if (!KEY_RE.test(k)) return fail(400, 'bad_key', '알 수 없는 항목입니다: ' + k);
      const v = validateValue(k, set[k]);
      if (v.error) return fail(400, 'bad_value', v.error);
      rows.push([k, v.value]);
    }
    for (const k of unset) if (typeof k !== 'string' || !KEY_RE.test(k)) return fail(400, 'bad_key', '알 수 없는 항목입니다.');

    const stmts = [];
    for (let i = 0; i < unset.length; i += 90) {
      const part = unset.slice(i, i + 90);
      stmts.push(db.prepare(`DELETE FROM choihee_content WHERE key IN (${part.map(() => '?').join(',')})`).bind(...part));
    }
    for (const g of groupRows(rows, 2)) {
      stmts.push(db.prepare(
        `INSERT INTO choihee_content (key, value, updated_at) VALUES ${g.map(() => `(?, ?, datetime('now'))`).join(',')}
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(...g.flat()));
    }
    if (stmts.length > 45) return fail(400, 'too_big', '한 번에 저장하기에 내용이 너무 많습니다. 나눠서 저장해 주십시오.');
    await db.batch(stmts);
    invalidateContent();
    return json({ ok: true, saved: rows.length + unset.length });
  }

  /* 사진 올리기 (복원 시 id 지정 가능) */
  if (pathname === '/api/admin/media' && method === 'POST') {
    const declared = (request.headers.get('content-type') || '').split(';')[0].trim();
    if (!MEDIA_TYPES.includes(declared)) return fail(415, 'bad_type', 'JPG, PNG, WEBP 사진만 올릴 수 있습니다.');
    const buf = new Uint8Array(await request.arrayBuffer());
    if (!buf.length) return fail(400, 'empty', '사진 파일이 비어 있습니다.');
    if (buf.length > MEDIA_MAX) return fail(413, 'too_large', '사진이 너무 큽니다 (1.8MB 이하).');
    const mime = sniffImage(buf);
    if (!mime) return fail(415, 'bad_type', '사진 파일이 아닙니다.');
    const reqId = url.searchParams.get('id') || '';
    const id = /^[a-f0-9]{24}$/.test(reqId) ? reqId : randomId();
    const w = Math.max(0, Math.min(20000, parseInt(url.searchParams.get('w') || '0', 10) || 0));
    const hgt = Math.max(0, Math.min(20000, parseInt(url.searchParams.get('h') || '0', 10) || 0));
    const name = clean(url.searchParams.get('name') || '', 120);
    const created = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(url.searchParams.get('created') || '') ? url.searchParams.get('created') : null;
    const n = Math.ceil(buf.length / CHUNK);
    const stmts = [
      db.prepare('DELETE FROM choihee_media_chunks WHERE media_id = ?').bind(id),
      db.prepare(`INSERT INTO choihee_media (id, mime, width, height, bytes, chunks, name, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
                  ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, width = excluded.width, height = excluded.height,
                  bytes = excluded.bytes, chunks = excluded.chunks, name = excluded.name`)
        .bind(id, mime, w, hgt, buf.length, n, name, created),
    ];
    for (let i = 0; i < n; i++) {
      stmts.push(db.prepare('INSERT INTO choihee_media_chunks (media_id, seq, data) VALUES (?, ?, ?)')
        .bind(id, i, buf.slice(i * CHUNK, (i + 1) * CHUNK).buffer));
    }
    await db.batch(stmts);
    return json({ ok: true, id, url: `/media/${id}`, bytes: buf.length }, 201);
  }

  if (pathname === '/api/admin/media' && method === 'GET') {
    const [m, c] = await db.batch([
      db.prepare('SELECT id, mime, width, height, bytes, name, created_at FROM choihee_media ORDER BY created_at DESC'),
      db.prepare('SELECT value FROM choihee_content'),
    ]);
    const used = new Set();
    for (const r of c.results || []) for (const x of String(r.value).matchAll(/\/media\/([a-f0-9]{24})/g)) used.add(x[1]);
    return json({ ok: true, media: (m.results || []).map((r) => ({ ...r, url: `/media/${r.id}`, used: used.has(r.id) })) });
  }

  let m;
  if ((m = pathname.match(/^\/api\/admin\/media\/([a-f0-9]{24})$/)) && method === 'DELETE') {
    await db.batch([
      db.prepare('DELETE FROM choihee_media_chunks WHERE media_id = ?').bind(m[1]),
      db.prepare('DELETE FROM choihee_media WHERE id = ?').bind(m[1]),
    ]);
    return json({ ok: true });
  }

  /* 문의함 */
  if (pathname === '/api/admin/inquiries' && method === 'GET') {
    const { results } = await db.prepare(
      'SELECT id, category, name, email, phone, message, status, created_at FROM choihee_inquiries ORDER BY id DESC LIMIT 300'
    ).all();
    return json({ ok: true, inquiries: results || [] });
  }
  if ((m = pathname.match(/^\/api\/admin\/inquiries\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === 'PATCH') {
      const body = await readJson(request);
      const status = body && body.status === 'done' ? 'done' : 'new';
      await db.prepare('UPDATE choihee_inquiries SET status = ? WHERE id = ?').bind(status, id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM choihee_inquiries WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  /* 게시판 정리 */
  if ((m = pathname.match(/^\/api\/admin\/posts\/(\d+)$/)) && method === 'DELETE') {
    await db.prepare('DELETE FROM choihee_posts WHERE id = ?').bind(Number(m[1])).run();
    return json({ ok: true });
  }

  /* 백업 (사진 파일은 관리 화면이 /media 주소에서 하나씩 받아 함께 묶습니다) */
  if (pathname === '/api/admin/backup' && method === 'GET') {
    const [c, p, md] = await db.batch([
      db.prepare('SELECT key, value, updated_at FROM choihee_content ORDER BY key'),
      db.prepare('SELECT id, name, message, created_at FROM choihee_posts ORDER BY id'),
      db.prepare('SELECT id, mime, width, height, bytes, name, created_at FROM choihee_media ORDER BY created_at'),
    ]);
    return json({
      ok: true, format: 'choihee-site-backup', version: 1, created_at: new Date().toISOString(),
      content: c.results || [], posts: p.results || [], media: md.results || [],
    });
  }

  if (pathname === '/api/admin/restore' && method === 'POST') {
    const body = await readJson(request);
    if (!body || typeof body !== 'object') return fail(400, 'bad_json', '백업 파일 형식이 올바르지 않습니다.');
    const stmts = [];
    if (Array.isArray(body.content)) {
      const rows = [];
      for (const r of body.content.slice(0, 400)) {
        if (!r || !KEY_RE.test(r.key)) continue;
        const v = validateValue(r.key, r.value);
        if (!v.error) rows.push([r.key, v.value]);
      }
      stmts.push(db.prepare('DELETE FROM choihee_content'));
      for (const g of groupRows(rows, 2)) {
        stmts.push(db.prepare(`INSERT INTO choihee_content (key, value, updated_at) VALUES ${g.map(() => `(?, ?, datetime('now'))`).join(',')}`).bind(...g.flat()));
      }
    }
    if (Array.isArray(body.posts)) {
      const rows = [];
      for (const r of body.posts.slice(0, 400)) {
        const id = Number(r && r.id);
        const name = clean(r && r.name, 20), message = clean(r && r.message, 500);
        const created = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r && r.created_at) ? r.created_at : null;
        if (Number.isInteger(id) && id > 0 && name && message && created) rows.push([id, name, message, created]);
      }
      for (const g of groupRows(rows, 4)) {
        stmts.push(db.prepare(`INSERT OR IGNORE INTO choihee_posts (id, name, message, created_at) VALUES ${g.map(() => '(?, ?, ?, ?)').join(',')}`).bind(...g.flat()));
      }
    }
    if (!stmts.length) return json({ ok: true, restored: 0 });
    if (stmts.length > 45) return fail(400, 'too_big', '한 번에 되돌리기에 내용이 너무 많습니다.');
    await db.batch(stmts);
    invalidateContent();
    return json({ ok: true });
  }

  return fail(404, 'not_found', '요청하신 주소를 찾을 수 없습니다.');
}


/* ---------- 공용: 안전한 출력 + 목록 정리 + 목록 렌더링 ----------
   이 파일은 빌드할 때 _worker.js 안으로 그대로 들어갑니다. */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 줄바꿈은 <br>로, 나머지는 모두 이스케이프 */
function textHtml(s) {
  return esc(s).replace(/\r?\n/g, ' <br>');
}

/** 이미지·링크 주소 검사. 통과하지 못하면 빈 문자열 */
function safeUrl(u, kind) {
  u = String(u ?? '').trim();
  if (!u || u.length > 1000 || /[\s"'<>\\]/.test(u)) return '';
  if (kind === 'img') {
    if (/^\/media\/[a-f0-9]{24}$/.test(u)) return u;
    if (/^\/assets\/[^?#]+\.(jpe?g|png|webp|svg)$/i.test(u)) return u;
    if (/^https:\/\//i.test(u)) return u;
    return '';
  }
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/(?!\/)/.test(u)) return u;
  if (/^#[\w-]*$/.test(u)) return u;
  if (/^mailto:[^@]+@[^@]+$/i.test(u)) return u;
  if (/^tel:[+\d\-() ]+$/i.test(u)) return u;
  return '';
}

function str(v, max) {
  return String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
function stripQuotes(s) {
  return s.replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '').trim();
}

const LIST_LIMITS = { timeline: 60, books: 20 };

/** 목록 데이터를 허용된 칸만 남기고 길이를 제한해 정리합니다. */
function normalizeList(name, arr) {
  if (!Array.isArray(arr)) return null;
  const max = LIST_LIMITS[name];
  if (!max) return null;
  const out = [];
  const usedSlugs = new Set();
  for (const raw of arr.slice(0, max)) {
    if (!raw || typeof raw !== 'object') continue;
    if (name === 'timeline') {
      const it = {
        yr: str(raw.yr, 20),
        title: str(raw.title, 80),
        desc: str(raw.desc, 400),
        award: raw.award === true || raw.award === 1 || raw.award === 'true',
      };
      if (!it.title && !it.desc) continue;
      out.push(it);
    } else if (name === 'books') {
      const b = {
        slug: str(raw.slug, 40).toLowerCase().replace(/[^a-z0-9-]/g, ''),
        title: str(raw.title, 80),
        cover: safeUrl(raw.cover, 'img'),
        badge: str(raw.badge, 80),
        badgeStyle: raw.badgeStyle === 'bronze' ? 'bronze' : 'prize',
        meta: str(raw.meta, 200),
        desc1: str(raw.desc1, 1200),
        desc2: str(raw.desc2, 1200),
        keywords: str(raw.keywords, 300),
        note: str(raw.note, 300),
        reviewQuote: stripQuotes(str(raw.reviewQuote, 300)),
        reviewCite: str(raw.reviewCite, 120).replace(/^[—\-–\s]+/, ''),
        buy1Label: str(raw.buy1Label, 40),
        buy1Url: safeUrl(raw.buy1Url, 'link'),
        buy2Label: str(raw.buy2Label, 40),
        buy2Url: safeUrl(raw.buy2Url, 'link'),
        showHome: raw.showHome !== false && raw.showHome !== 0 && raw.showHome !== 'false',
        homeMeta: str(raw.homeMeta, 80),
        homeDesc: str(raw.homeDesc, 200),
      };
      if (!b.title) continue;
      if (!b.slug || usedSlugs.has(b.slug)) b.slug = 'book-' + (out.length + 1);
      while (usedSlugs.has(b.slug)) b.slug += '-x';
      usedSlugs.add(b.slug);
      out.push(b);
    }
  }
  return out;
}

function keywordsOf(s) {
  return String(s || '').split(/[,，·\n]/).map((k) => k.trim()).filter(Boolean).slice(0, 12);
}

function renderTimeline(items) {
  return items.map((it) =>
    `\n        <li${it.award ? ' class="award"' : ''}>` +
    `\n          <div class="t">${it.yr ? `<span class="yr">${esc(it.yr)}</span>` : ''}${esc(it.title)}</div>` +
    (it.desc ? `\n          <div class="d">${textHtml(it.desc)}</div>` : '') +
    `\n        </li>`
  ).join('') + '\n      ';
}

function buyButton(label, url, cls) {
  if (!url) return '';
  const ext = /^https?:/i.test(url);
  return `<a class="btn ${cls}" href="${esc(url)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(label || '도서정보')}${ext ? ' ↗' : ''}</a>`;
}

function renderBooksFull(items) {
  return items.map((b, i) => {
    const kws = keywordsOf(b.keywords);
    const buys = [buyButton(b.buy1Label, b.buy1Url, 'btn-forest'), buyButton(b.buy2Label, b.buy2Url, 'btn-line')].filter(Boolean);
    return `
    <article class="work reveal" id="${esc(b.slug)}">
      <div class="book-cover">${b.cover
        ? `<img src="${esc(b.cover)}" alt="『${esc(b.title)}』 표지"${i > 0 ? ' loading="lazy"' : ''}>`
        : `<span class="cover-ph">${esc(b.title)}</span>`}</div>
      <div>
        <p class="eyebrow">Selected Work ${String(i + 1).padStart(2, '0')}</p>
        <h2 class="h-display">『${esc(b.title)}』</h2>` +
      (b.badge ? `\n        <p class="badge-line ${b.badgeStyle}">${esc(b.badge)}</p>` : '') +
      (b.meta ? `\n        <p class="meta">${esc(b.meta)}</p>` : '') +
      (b.desc1 ? `\n        <p class="work-desc first">${textHtml(b.desc1)}</p>` : '') +
      (b.desc2 ? `\n        <p class="work-desc">${textHtml(b.desc2)}</p>` : '') +
      (kws.length ? `\n        <ul class="kw">${kws.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>` : '') +
      (b.note ? `\n        <div class="authornote"><b>작가의 한 줄</b> — ${esc(b.note)}</div>` : '') +
      (b.reviewQuote ? `\n        <blockquote class="review">"${esc(b.reviewQuote)}"${b.reviewCite ? `<cite>— ${esc(b.reviewCite)}</cite>` : ''}</blockquote>` : '') +
      (buys.length ? `\n        <div class="buy">${buys.join('')}</div>` : '') + `
      </div>
    </article>`;
  }).join('\n') + '\n    ';
}

function renderBooksHome(items) {
  const shown = items.filter((b) => b.showHome);
  return shown.map((b) => `
      <article class="book reveal">
        <a class="book-cover" href="/books#${esc(b.slug)}" aria-label="${esc(b.title)} 자세히 보기">${b.cover
          ? `<img src="${esc(b.cover)}" alt="『${esc(b.title)}』 표지" loading="lazy">`
          : `<span class="cover-ph">${esc(b.title)}</span>`}</a>
        <h3>${esc(b.title)}</h3>` +
      (b.homeMeta ? `\n        <p class="meta">${esc(b.homeMeta)}</p>` : '') +
      (b.homeDesc ? `\n        <p class="desc">${esc(b.homeDesc)}</p>` : '') + `
      </article>`).join('') + '\n    ';
}

function renderList(mode, items) {
  if (mode === 'timeline') return renderTimeline(items);
  if (mode === 'books-full') return renderBooksFull(items);
  if (mode === 'books-home') return renderBooksHome(items);
  return null;
}

