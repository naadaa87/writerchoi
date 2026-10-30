/* 최희 홈페이지 — 관리 화면 */
(function () {
  'use strict';

  /* ================= 기본 도구 ================= */
  const $ = (s, root = document) => root.querySelector(s);

  function h(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'value') e.value = v;
        else if (k === 'checked') e.checked = !!v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (v === true) e.setAttribute(k, '');
        else e.setAttribute(k, v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  let toastTimer;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind === 'err' ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'err' ? 5200 : 3000);
  }

  function fmtDate(s, withTime) {
    if (!s) return '';
    const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('T') ? '' : 'Z'));
    if (isNaN(d)) return s;
    const o = { year: 'numeric', month: 'long', day: 'numeric' };
    if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return d.toLocaleString('ko-KR', o);
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + 'KB';
    return (n / 1024 / 1024).toFixed(1) + 'MB';
  }

  async function api(path, opts = {}) {
    const o = { method: opts.method || 'GET', credentials: 'same-origin', headers: { 'x-choihee-admin': '1' } };
    if (opts.json !== undefined) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(opts.json); }
    if (opts.body) { o.body = opts.body; if (opts.type) o.headers['content-type'] = opts.type; }
    const res = await fetch(path, o);
    let data = null;
    try { data = await res.json(); } catch { /* 본문 없음 */ }
    if (!res.ok) {
      const err = new Error((data && data.message) || '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.');
      err.status = res.status; err.code = data && data.code;
      if (res.status === 401 && !path.endsWith('/login')) showGate('로그인 시간이 지났습니다. 다시 들어와 주십시오.');
      throw err;
    }
    return data;
  }

  const SAFE_LINK = /^(https?:\/\/[^\s"'<>\\]+|\/(?!\/)[^\s"'<>\\]*|#[\w-]*|mailto:[^@\s]+@[^@\s]+|tel:[+\d\-() ]+)$/i;

  /* ================= 상태 ================= */
  const state = {
    content: {},          // 저장된 값 (key → value)
    pending: new Map(),   // 저장 전 값 (key → value | null[기본값으로])
    defaults: null,       // 기본 목록 (defaults.json)
    fieldCache: {},       // 페이지별 편집 항목
    lastHash: '',
  };

  function savedOr(key, def) {
    return Object.prototype.hasOwnProperty.call(state.content, key) ? state.content[key] : def;
  }
  function current(key, def) {
    if (state.pending.has(key)) { const v = state.pending.get(key); return v === null ? def : v; }
    return savedOr(key, def);
  }
  function setValue(key, value, def) {
    const has = Object.prototype.hasOwnProperty.call(state.content, key);
    if (value === def) { if (has) state.pending.set(key, null); else state.pending.delete(key); }
    else if (has && state.content[key] === value) state.pending.delete(key);
    else state.pending.set(key, value);
    updateSavebar();
  }

  async function loadContent() {
    const r = await api('/api/admin/content');
    state.content = r.items || {};
  }
  async function loadDefaults() {
    if (state.defaults) return state.defaults;
    const r = await fetch('/assets/data/defaults.json', { cache: 'no-store' });
    state.defaults = await r.json();
    return state.defaults;
  }

  /* ================= 저장 막대 ================= */
  function updateSavebar() {
    const n = state.pending.size;
    $('#savebar').hidden = n === 0;
    $('#save-count').textContent = `저장하지 않은 변경 ${n}개`;
  }
  async function saveAll() {
    if (!state.pending.size) return;
    const set = {}, unset = [];
    for (const [k, v] of state.pending) { if (v === null) unset.push(k); else set[k] = v; }
    const btn = $('#save-btn');
    btn.disabled = true; btn.textContent = '저장하는 중…';
    try {
      await api('/api/admin/content', { method: 'PUT', json: { set, unset } });
      state.pending.clear();
      await loadContent();
      updateSavebar();
      toast('저장했습니다. 홈페이지에 반영되었습니다.');
      route(true);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      btn.disabled = false; btn.textContent = '저장하고 홈페이지에 반영';
    }
  }
  $('#save-btn').addEventListener('click', saveAll);
  $('#discard-btn').addEventListener('click', () => {
    if (!confirm('저장하지 않은 변경을 모두 취소할까요?')) return;
    state.pending.clear(); updateSavebar(); route(true);
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.pending.size) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ================= 로그인 ================= */
  function showGate(msg) {
    $('#app').hidden = true; $('#savebar').hidden = true; $('#logout-btn').hidden = true;
    $('#gate').hidden = false;
    const m = $('#login-msg');
    if (msg) { m.textContent = msg; m.className = 'msg err'; m.hidden = false; } else m.hidden = true;
    setTimeout(() => $('#admin-key').focus(), 30);
  }

  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const key = $('#admin-key').value;
    if (!key) return;
    const btn = $('#login-btn');
    btn.disabled = true;
    try {
      await api('/api/admin/login', { method: 'POST', json: { key } });
      $('#admin-key').value = '';
      await startApp();
    } catch (e) {
      const m = $('#login-msg'); m.textContent = e.message; m.className = 'msg err'; m.hidden = false;
    } finally { btn.disabled = false; }
  });

  $('#logout-btn').addEventListener('click', async () => {
    if (state.pending.size && !confirm('저장하지 않은 변경이 있습니다. 그래도 나갈까요?')) return;
    state.pending.clear();
    try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* 무시 */ }
    showGate();
  });

  async function startApp() {
    await Promise.all([loadContent(), loadDefaults()]);
    $('#gate').hidden = true; $('#app').hidden = false; $('#logout-btn').hidden = false;
    refreshBadge();
    if (!location.hash) location.hash = '#/overview'; else route(true);
  }

  async function boot() {
    let health = null;
    try { health = await (await fetch('/api/health', { cache: 'no-store' })).json(); } catch { /* 무시 */ }
    const hm = $('#health-msg');
    if (!health || !health.db) hm.textContent = '아직 DB(total-db)가 연결되지 않았습니다. Cloudflare에서 D1 바인딩(DB)을 먼저 연결해 주십시오.';
    else if (!health.admin) hm.textContent = '관리자 비밀번호(ADMIN_KEY)가 아직 설정되지 않았습니다. Cloudflare 설정에서 먼저 등록해 주십시오.';
    try {
      const r = await fetch('/api/admin/session', { credentials: 'same-origin' });
      if (r.ok) { await startApp(); return; }
    } catch { /* 무시 */ }
    showGate();
  }

  /* ================= 이동 ================= */
  const ROUTES = {
    overview: viewOverview,
    page: viewPage,
    books: viewBooks,
    timeline: viewTimeline,
    inquiries: viewInquiries,
    posts: viewPosts,
    media: viewMedia,
    backup: viewBackup,
  };

  window.addEventListener('hashchange', () => {
    if (state.pending.size && location.hash !== state.lastHash) {
      if (!confirm('저장하지 않은 변경이 있습니다. 다른 화면으로 가면 변경이 사라집니다. 이동할까요?')) {
        history.replaceState(null, '', state.lastHash);
        return;
      }
      state.pending.clear(); updateSavebar();
    }
    route();
  });

  async function route() {
    if ($('#app').hidden) return;
    const hash = location.hash || '#/overview';
    state.lastHash = hash;
    const parts = hash.replace(/^#\/?/, '').split('/');
    const name = parts[0] || 'overview';
    const fn = ROUTES[name] || viewOverview;
    const routeId = name === 'page' ? parts.slice(0, 2).join('/') : name;
    document.querySelectorAll('#side a').forEach((a) => {
      if (a.dataset.route === routeId) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const view = $('#view');
    view.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), ' 불러오는 중…'));
    try {
      await fn(view, parts[1]);
    } catch (e) {
      if (e.status !== 401) view.replaceChildren(h('div', { class: 'empty' }, '화면을 불러오지 못했습니다. ', e.message));
    }
    view.focus({ preventScroll: true });
  }

  function head(title, desc, actions) {
    return h('div', { class: 'view-head' },
      h('div', null, h('h1', { text: title }), desc ? h('p', { class: 'muted', text: desc }) : null),
      actions || null);
  }

  async function refreshBadge() {
    try {
      const o = await api('/api/admin/overview');
      const b = $('#inq-badge');
      b.hidden = !o.inquiriesNew; b.textContent = o.inquiriesNew;
      return o;
    } catch { return null; }
  }

  /* ================= 한눈에 보기 ================= */
  async function viewOverview(view) {
    const [o, health] = await Promise.all([
      api('/api/admin/overview'),
      fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    ]);
    const b = $('#inq-badge'); b.hidden = !o.inquiriesNew; b.textContent = o.inquiriesNew;

    view.replaceChildren(
      head('한눈에 보기', '홈페이지의 문구와 사진, 저서, 이력을 이곳에서 직접 고칠 수 있습니다.'),
      h('div', { class: 'stats' },
        h('a', { class: 'stat' + (o.inquiriesNew ? ' hot' : ''), href: '#/inquiries' }, h('b', { text: o.inquiriesNew }), h('span', { text: '새 문의' })),
        h('a', { class: 'stat', href: '#/inquiries' }, h('b', { text: o.inquiries }), h('span', { text: '전체 문의' })),
        h('a', { class: 'stat', href: '#/posts' }, h('b', { text: o.posts }), h('span', { text: '독자 게시글' })),
        h('a', { class: 'stat', href: '#/media' }, h('b', { text: o.media }), h('span', { text: `올린 사진 · ${fmtBytes(o.mediaBytes)}` }))),
      h('section', { class: 'panel' },
        h('h2', { text: '자주 하는 일' }),
        h('div', { class: 'filters' },
          h('a', { class: 'btn btn-line btn-sm', href: '#/page/home' }, '홈 첫 화면 고치기'),
          h('a', { class: 'btn btn-line btn-sm', href: '#/books' }, '저서 추가·수정'),
          h('a', { class: 'btn btn-line btn-sm', href: '#/timeline' }, '이력 추가·수정'),
          h('a', { class: 'btn btn-line btn-sm', href: '#/page/contact' }, '문의 페이지 사진 바꾸기'),
          h('a', { class: 'btn btn-line btn-sm', href: '#/backup' }, '백업 받기'))),
      h('section', { class: 'panel' },
        h('h2', { text: '상태' }),
        h('dl', { class: 'kv' },
          h('dt', { text: '데이터베이스' }), h('dd', { text: health.db ? 'total-db 연결됨' : '연결 안 됨' }),
          h('dt', { text: '이 홈페이지 전용 표' }), h('dd', null, h('code', { text: 'choihee_' }), ' 로 시작하는 표만 사용합니다'),
          h('dt', { text: '고친 항목' }), h('dd', { text: `${o.edits}개 (기본값과 다르게 바꾼 문구·사진·목록)` }),
          h('dt', { text: '마지막으로 고친 때' }), h('dd', { text: o.lastEdit ? fmtDate(o.lastEdit, true) : '아직 없음' })),
        h('p', { class: 'muted small', style: 'margin:14px 0 0' },
          '저장하면 홈페이지에 바로 반영됩니다. 다른 기기에서 열어 둔 화면에는 길어야 10초 뒤에 반영됩니다.')),
    );
  }

  /* ================= 페이지 문구·사진 편집 ================= */
  const PAGES = {
    home: { path: '/', title: '홈', note: { '주요 저서': ['책 목록은 ', ['저서 목록', '#/books'], ' 메뉴에서 고칩니다.'] } },
    about: { path: '/about', title: '작가 소개', note: { '이력과 여정': ['이력 항목은 ', ['이력 (연보)', '#/timeline'], ' 메뉴에서 고칩니다.'] } },
    books: { path: '/books', title: '저서 페이지 문구', note: { '저서 목록': ['책 한 권 한 권의 내용·표지·구매 링크는 ', ['저서 목록', '#/books'], ' 메뉴에서 고칩니다.'] } },
    board: { path: '/board', title: '독자 게시판 문구', note: { '글 남기기': ['독자들이 남긴 글은 ', ['독자 게시판 글', '#/posts'], ' 메뉴에서 정리합니다.'] } },
    contact: { path: '/contact', title: '문의·제안 문구', note: { '문의 남기기': ['접수된 문의는 ', ['문의함', '#/inquiries'], '에서 확인합니다. 거점 주소는 ', ['머리글·바닥글', '#/page/common'], '에서 고칩니다.'] } },
    common: { path: '/', title: '머리글·바닥글', common: true },
  };

  function htmlToText(el) {
    const clone = el.cloneNode(true);
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach((t) => { t.nodeValue = t.nodeValue.replace(/\s+/g, ' '); });
    clone.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
    return clone.textContent.split(' ').map((s) => s.trim()).join('\n').trim();
  }

  async function pageFields(pageId) {
    if (state.fieldCache[pageId]) return state.fieldCache[pageId];
    const pg = PAGES[pageId];
    const res = await fetch(pg.path, { headers: { 'x-cms-raw': '1' }, cache: 'no-store' });
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const groups = new Map();
    const seen = new Set();
    doc.querySelectorAll('[data-cms],[data-cms-img],[data-cms-href]').forEach((el) => {
      if (el.closest('[data-cms-list]')) return;
      const g = el.closest('[data-cms-group]');
      const group = g ? g.getAttribute('data-cms-group') : '기타';
      const add = (f) => {
        const isCommon = f.name.startsWith('common.');
        if (!!pg.common !== isCommon || seen.has(f.key)) return;
        seen.add(f.key);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(f);
      };
      if (el.hasAttribute('data-cms')) {
        const name = el.getAttribute('data-cms');
        const def = htmlToText(el);
        add({ kind: 'text', name, key: 't:' + name, label: el.getAttribute('data-cms-label') || name, def,
          multi: def.includes('\n') || def.length > 64 });
      }
      if (el.hasAttribute('data-cms-img')) {
        const name = el.getAttribute('data-cms-img');
        add({ kind: 'img', name, key: 'i:' + name, label: el.getAttribute('data-cms-label') || '사진', def: el.getAttribute('src'),
          ratio: el.getAttribute('data-cms-ratio') || '', w: Number(el.getAttribute('data-cms-w')) || 1200 });
      }
      if (el.hasAttribute('data-cms-href')) {
        const name = el.getAttribute('data-cms-href');
        add({ kind: 'href', name, key: 'h:' + name, label: el.getAttribute('data-cms-href-label') || '링크 주소', def: el.getAttribute('href') });
      }
    });
    state.fieldCache[pageId] = groups;
    return groups;
  }

  function noteLine(parts) {
    return h('div', { class: 'notice-box' }, h('p', null, parts.map((p) => Array.isArray(p) ? h('a', { href: p[1] }, p[0]) : p)));
  }

  async function viewPage(view, pageId) {
    const pg = PAGES[pageId] || PAGES.home;
    const groups = await pageFields(pageId in PAGES ? pageId : 'home');
    const panels = [];
    for (const [group, fields] of groups) {
      const panel = h('section', { class: 'panel' }, h('h2', { text: group }));
      if (pg.note && pg.note[group]) panel.append(noteLine(pg.note[group]));
      fields.forEach((f) => panel.append(fieldEl(f)));
      panels.push(panel);
    }
    view.replaceChildren(
      head(pg.title,
        pg.common ? '모든 페이지 위·아래에 공통으로 나오는 부분입니다. 한 번 고치면 모든 페이지에 함께 바뀝니다.'
          : '고칠 곳을 바꾼 뒤 화면 아래 "저장하고 홈페이지에 반영"을 누르십시오. 줄을 바꾸면 홈페이지에서도 줄이 바뀝니다.',
        h('a', { class: 'btn btn-line btn-sm', href: pg.path, target: '_blank', rel: 'noopener' }, '이 페이지 보기 ↗')),
      ...panels);
  }

  function fieldEl(f) {
    const id = 'f-' + f.key.replace(/[^a-z0-9]/gi, '-');
    const tagMod = h('span', { class: 'tag', text: '바꾼 내용' });
    const tagDirty = h('span', { class: 'tag dirty', text: '저장 전' });
    const reset = h('button', { class: 'link', type: 'button' }, f.kind === 'img' ? '처음 사진으로' : '처음 내용으로');
    const wrap = h('div', { class: 'fld' }, h('div', { class: 'fld-head' }, h('label', { class: 'fld-label', for: id, text: f.label }), tagMod, tagDirty, reset));

    const refresh = () => {
      const cur = current(f.key, f.def);
      tagMod.hidden = cur === f.def || state.pending.has(f.key);
      tagDirty.hidden = !state.pending.has(f.key);
      reset.hidden = cur === f.def;
    };

    if (f.kind === 'text') {
      const input = f.multi
        ? h('textarea', { class: 'inp', id, rows: Math.min(8, Math.max(2, Math.ceil(f.def.length / 46) + (f.def.match(/\n/g) || []).length)) })
        : h('input', { class: 'inp', id, type: 'text' });
      input.value = current(f.key, f.def);
      input.addEventListener('input', () => { setValue(f.key, input.value, f.def); refresh(); });
      reset.addEventListener('click', () => { input.value = f.def; setValue(f.key, f.def, f.def); refresh(); });
      wrap.append(input);
      if (!input.value.trim()) wrap.append(h('p', { class: 'hint', text: '비워 두면 홈페이지에서 이 자리가 비어 보입니다.' }));
    } else if (f.kind === 'img') {
      const thumb = h('img', { class: 'thumb', id, alt: f.label + ' 미리보기', src: current(f.key, f.def) });
      const change = h('button', { class: 'btn btn-line btn-sm', type: 'button' }, '사진 바꾸기');
      change.addEventListener('click', async () => {
        const r = await pickAndCrop({ ratio: f.ratio, w: f.w, label: f.label });
        if (r) { thumb.src = r.url; setValue(f.key, r.url, f.def); refresh(); }
      });
      reset.addEventListener('click', () => { thumb.src = f.def; setValue(f.key, f.def, f.def); refresh(); });
      wrap.append(h('div', { class: 'imgfld' }, thumb,
        h('div', { class: 'acts' }, change,
          h('p', { class: 'hint', text: f.ratio ? `${ratioText(f.ratio)} 비율로 맞춰 올립니다. 모양이 달라도 자를 위치를 고를 수 있습니다.` : '' }))));
    } else if (f.kind === 'href') {
      const input = h('input', { class: 'inp', id, type: 'text', inputmode: 'url', spellcheck: 'false' });
      const warn = h('p', { class: 'hint', style: 'color:var(--err)', hidden: true, text: 'https:// 로 시작하는 주소를 넣어 주십시오.' });
      input.value = current(f.key, f.def);
      input.addEventListener('input', () => {
        const v = input.value.trim();
        const ok = !v || SAFE_LINK.test(v);
        warn.hidden = ok;
        if (ok) { setValue(f.key, v || f.def, f.def); refresh(); }
      });
      reset.addEventListener('click', () => { input.value = f.def; warn.hidden = true; setValue(f.key, f.def, f.def); refresh(); });
      wrap.append(input, warn);
    }
    refresh();
    return wrap;
  }

  function ratioText(r) {
    if (!r) return '';
    const [a, b] = r.split(':').map(Number);
    if (a === 4 && b === 5) return '세로 4:5';
    if (a === 2 && b === 1) return '가로 2:1';
    if (a === 2 && b === 3) return '세로 2:3 (책 표지)';
    return a > b ? '가로형' : '세로형';
  }

  /* ================= 목록 공통 ================= */
  function listOf(name) {
    const saved = current('l:' + name, null);
    if (saved) { try { return JSON.parse(saved); } catch { /* 기본값 사용 */ } }
    return JSON.parse(JSON.stringify(state.defaults[name] || []));
  }
  function defaultJson(name) { return JSON.stringify(normalizeClient(name, state.defaults[name] || [])); }

  function normalizeClient(name, arr) {
    const s = (v) => String(v ?? '').trim();
    if (name === 'timeline') {
      return arr.map((it) => ({ yr: s(it.yr), title: s(it.title), desc: s(it.desc), award: !!it.award }))
        .filter((it) => it.title || it.desc);
    }
    return arr.map((b) => ({
      slug: s(b.slug).toLowerCase().replace(/[^a-z0-9-]/g, ''), title: s(b.title), cover: s(b.cover), badge: s(b.badge),
      badgeStyle: b.badgeStyle === 'bronze' ? 'bronze' : 'prize', meta: s(b.meta), desc1: s(b.desc1), desc2: s(b.desc2),
      keywords: s(b.keywords), note: s(b.note), reviewQuote: s(b.reviewQuote), reviewCite: s(b.reviewCite),
      buy1Label: s(b.buy1Label), buy1Url: s(b.buy1Url), buy2Label: s(b.buy2Label), buy2Url: s(b.buy2Url),
      showHome: b.showHome !== false, homeMeta: s(b.homeMeta), homeDesc: s(b.homeDesc),
    })).filter((b) => b.title);
  }
  function commitList(name, draft) {
    const savedRaw = state.content['l:' + name];
    let savedJson = null;
    if (savedRaw) { try { savedJson = JSON.stringify(normalizeClient(name, JSON.parse(savedRaw))); } catch { /* 무시 */ } }
    const json = JSON.stringify(normalizeClient(name, draft));
    const def = defaultJson(name);
    if (json === def) { if (savedRaw !== undefined) state.pending.set('l:' + name, null); else state.pending.delete('l:' + name); }
    else if (savedJson === json) state.pending.delete('l:' + name);
    else state.pending.set('l:' + name, json);
    updateSavebar();
  }
  function move(arr, i, d) {
    const j = i + d;
    if (j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return true;
  }
  function tools(onUp, onDown, onDel) {
    const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
    return h('div', { class: 'row-tools' },
      h('button', { class: 'icon-btn', type: 'button', title: '위로', 'aria-label': '위로', onclick: stop(onUp) }, '↑'),
      h('button', { class: 'icon-btn', type: 'button', title: '아래로', 'aria-label': '아래로', onclick: stop(onDown) }, '↓'),
      h('button', { class: 'icon-btn del', type: 'button', title: '지우기', 'aria-label': '지우기', onclick: stop(onDel) }, '✕'));
  }

  /* ================= 이력 (연보) ================= */
  async function viewTimeline(view) {
    await loadDefaults();
    const draft = listOf('timeline');
    const listBox = h('div');

    const render = () => {
      listBox.replaceChildren(...draft.map((it, i) => {
        const yr = h('input', { class: 'inp', placeholder: '연도', value: it.yr || '', 'aria-label': '연도' });
        const title = h('input', { class: 'inp', placeholder: '제목 (예: 『쓰나미』 출간)', value: it.title || '', 'aria-label': '제목' });
        const desc = h('textarea', { class: 'inp', rows: 2, placeholder: '설명', 'aria-label': '설명' });
        desc.value = it.desc || '';
        const award = h('input', { type: 'checkbox', checked: !!it.award });
        yr.addEventListener('input', () => { it.yr = yr.value; commitList('timeline', draft); });
        title.addEventListener('input', () => { it.title = title.value; commitList('timeline', draft); });
        desc.addEventListener('input', () => { it.desc = desc.value; commitList('timeline', draft); });
        award.addEventListener('change', () => { it.award = award.checked; commitList('timeline', draft); });
        return h('div', { class: 'tl-row' },
          yr,
          h('div', { class: 'tl-main' }, title, desc),
          h('div', { class: 'tl-side' },
            h('label', { class: 'chk' }, award, '수상 강조 (붉은 점)'),
            tools(() => { if (move(draft, i, -1)) { commitList('timeline', draft); render(); } },
              () => { if (move(draft, i, 1)) { commitList('timeline', draft); render(); } },
              () => { if (confirm(`"${it.title || '이 항목'}"을 지울까요?`)) { draft.splice(i, 1); commitList('timeline', draft); render(); } })));
      }));
    };
    render();

    const add = h('button', { class: 'add-row', type: 'button' }, '+ 이력 항목 더하기');
    add.addEventListener('click', () => {
      draft.push({ yr: String(new Date().getFullYear()), title: '', desc: '', award: false });
      render();
      const rows = listBox.querySelectorAll('.tl-row');
      const last = rows[rows.length - 1];
      if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); last.querySelectorAll('input')[1].focus(); }
    });
    const reset = h('button', { class: 'link', type: 'button' }, '처음 이력으로 되돌리기');
    reset.addEventListener('click', () => {
      if (!confirm('이력을 처음 만들었을 때의 내용으로 되돌릴까요? (저장해야 반영됩니다)')) return;
      draft.splice(0, draft.length, ...JSON.parse(JSON.stringify(state.defaults.timeline)));
      commitList('timeline', draft); render();
    });

    view.replaceChildren(
      head('이력 (연보)', '작가 소개 페이지의 "이력과 문학의 여정"에 위에서부터 차례로 나옵니다.',
        h('a', { class: 'btn btn-line btn-sm', href: '/about', target: '_blank', rel: 'noopener' }, '작가 소개 보기 ↗')),
      h('div', { class: 'notice-box' }, h('p', { text: '연도는 비워 둬도 됩니다. 수상 강조를 켜면 줄 앞의 점이 붉은색으로 바뀝니다. 제목과 설명이 모두 빈 줄은 저장되지 않습니다.' })),
      h('section', { class: 'panel' }, listBox, add, h('p', { style: 'margin:14px 0 0' }, reset)));
  }

  /* ================= 저서 목록 ================= */
  async function viewBooks(view) {
    await loadDefaults();
    const draft = listOf('books');
    const opened = new Set();
    const listBox = h('div');

    const field = (label, input, hint) => h('div', { class: 'fld' },
      h('div', { class: 'fld-head' }, h('label', { class: 'fld-label', text: label })), input, hint ? h('p', { class: 'hint', text: hint }) : null);

    const bind = (b, key, input, after) => {
      input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', () => {
        b[key] = input.type === 'checkbox' ? input.checked : input.value;
        commitList('books', draft);
        if (after) after();
      });
      return input;
    };
    const txt = (b, key, ph) => bind(b, key, h('input', { class: 'inp', type: 'text', value: b[key] || '', placeholder: ph || '' }));
    const area = (b, key, rows, ph) => { const t = h('textarea', { class: 'inp', rows: rows || 3, placeholder: ph || '' }); t.value = b[key] || ''; return bind(b, key, t); };

    const render = () => {
      listBox.replaceChildren(...draft.map((b, i) => {
        const cover = h('img', { class: 'row-cover', alt: '', src: b.cover || '/assets/img/favicon.svg' });
        const titleEl = h('span', { text: b.title || '(제목 없음)' });
        const metaEl = h('small', { text: b.meta || '' });
        const syncSummary = () => { titleEl.textContent = b.title || '(제목 없음)'; metaEl.textContent = b.meta || ''; };

        const bigCover = h('img', { class: 'thumb', alt: '표지 미리보기', src: b.cover || '/assets/img/favicon.svg' });
        const coverBtn = h('button', { class: 'btn btn-line btn-sm', type: 'button' }, b.cover ? '표지 바꾸기' : '표지 올리기');
        coverBtn.addEventListener('click', async () => {
          const r = await pickAndCrop({ ratio: '2:3', w: 660, label: '책 표지', allowFree: true });
          if (r) { b.cover = r.url; bigCover.src = r.url; cover.src = r.url; coverBtn.textContent = '표지 바꾸기'; commitList('books', draft); }
        });

        const style = h('select', { class: 'inp' },
          h('option', { value: 'prize', text: '붉은색 — 수상·선정' }),
          h('option', { value: 'bronze', text: '청동색 — 일반 소개' }));
        style.value = b.badgeStyle === 'bronze' ? 'bronze' : 'prize';
        bind(b, 'badgeStyle', style);

        const showHome = h('input', { type: 'checkbox', checked: b.showHome !== false });
        bind(b, 'showHome', showHome);

        const det = h('details', { class: 'row-card' },
          h('summary', null, cover, h('div', { class: 'row-title' }, titleEl, metaEl),
            tools(() => { if (move(draft, i, -1)) { commitList('books', draft); render(); } },
              () => { if (move(draft, i, 1)) { commitList('books', draft); render(); } },
              () => { if (confirm(`『${b.title || '이 책'}』을 목록에서 지울까요?`)) { draft.splice(i, 1); opened.delete(b); commitList('books', draft); render(); } })),
          h('div', { class: 'row-body' },
            h('div', { class: 'fld' }, h('div', { class: 'fld-head' }, h('label', { class: 'fld-label', text: '표지' })),
              h('div', { class: 'imgfld' }, bigCover, h('div', { class: 'acts' }, coverBtn,
                h('p', { class: 'hint', text: '세로 2:3 비율로 맞추거나, 원본 비율 그대로 올릴 수 있습니다.' })))),
            h('div', { class: 'grid2' },
              field('책 제목', bind(b, 'title', h('input', { class: 'inp', type: 'text', value: b.title || '', placeholder: '겹낫표 없이 제목만' }), syncSummary)),
              field('주소 이름 (영문)', txt(b, 'slug', 'dalgrian'), '홈에서 이 책으로 바로 가는 주소에 쓰입니다. 영문 소문자·숫자·- 만 씁니다.')),
            h('div', { class: 'grid2' },
              field('강조 문구', txt(b, 'badge', '예: 제1회 문학의봄소설상 당선작')),
              field('강조 문구 색', style)),
            field('서지 정보', bind(b, 'meta', h('input', { class: 'inp', type: 'text', value: b.meta || '', placeholder: '장편소설 · 출판사 · 2026. 9. 1 · ISBN …' }), syncSummary)),
            field('소개 — 첫째 문단', area(b, 'desc1', 4)),
            field('소개 — 둘째 문단', area(b, 'desc2', 4)),
            field('키워드', txt(b, 'keywords', '쉼표로 구분: 제주, 동백꽃, 사랑'), '쉼표(,)로 나누면 하나씩 작은 상자로 나옵니다.'),
            field('작가의 한 줄', txt(b, 'note')),
            h('div', { class: 'grid2' },
              field('서평 인용 (선택)', txt(b, 'reviewQuote', '따옴표 없이 적어 주십시오')),
              field('서평 출처', txt(b, 'reviewCite', '예: 사이채 소설가, 당선작 서평에서'))),
            h('div', { class: 'grid2' },
              field('구매 버튼 1 — 글자', txt(b, 'buy1Label', '예: 교보문고 도서정보')),
              field('구매 버튼 1 — 주소', txt(b, 'buy1Url', 'https://'))),
            h('div', { class: 'grid2' },
              field('구매 버튼 2 — 글자', txt(b, 'buy2Label', '예: 알라딘 도서정보')),
              field('구매 버튼 2 — 주소', txt(b, 'buy2Url', 'https://'))),
            h('div', { class: 'fld' }, h('label', { class: 'chk' }, showHome, '홈 화면 "주요 저서"에도 보이기')),
            h('div', { class: 'grid2' },
              field('홈 화면용 짧은 서지', txt(b, 'homeMeta', '예: 장편소설 · 좋은땅 · 2010')),
              field('홈 화면용 한 줄 소개', txt(b, 'homeDesc')))));
        if (opened.has(b)) det.open = true;
        det.addEventListener('toggle', () => { if (det.open) opened.add(b); else opened.delete(b); });
        return det;
      }));
    };
    render();

    const add = h('button', { class: 'add-row', type: 'button' }, '+ 새 책 더하기');
    add.addEventListener('click', () => {
      const b = { slug: 'book-' + Date.now().toString(36).slice(-5), title: '', cover: '', badge: '', badgeStyle: 'prize', meta: '', desc1: '', desc2: '',
        keywords: '', note: '', reviewQuote: '', reviewCite: '', buy1Label: '', buy1Url: '', buy2Label: '', buy2Url: '', showHome: true, homeMeta: '', homeDesc: '' };
      draft.push(b); opened.add(b); render();
      const cards = listBox.querySelectorAll('.row-card');
      const last = cards[cards.length - 1];
      if (last) last.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const reset = h('button', { class: 'link', type: 'button' }, '처음 목록으로 되돌리기');
    reset.addEventListener('click', () => {
      if (!confirm('저서 목록을 홈페이지에 처음 들어 있던 상태로 되돌릴까요? (저장해야 반영됩니다)')) return;
      draft.splice(0, draft.length, ...JSON.parse(JSON.stringify(state.defaults.books)));
      opened.clear(); commitList('books', draft); render();
    });

    view.replaceChildren(
      head('저서 목록', '저서 페이지와 홈 화면 "주요 저서"에 나오는 책입니다. 위에서부터 차례로 나옵니다.',
        h('a', { class: 'btn btn-line btn-sm', href: '/books', target: '_blank', rel: 'noopener' }, '저서 페이지 보기 ↗')),
      h('div', { class: 'notice-box' }, h('p', { text: '책 제목을 누르면 내용을 고칠 수 있습니다. 제목이 빈 책은 저장되지 않습니다. 비워 둔 칸은 홈페이지에 나오지 않습니다.' })),
      h('section', { class: 'panel' }, listBox, add, h('p', { style: 'margin:14px 0 0' }, reset)));
  }

  /* ================= 문의함 ================= */
  async function viewInquiries(view, filter) {
    const f = ['new', 'done', 'all'].includes(filter) ? filter : 'new';
    const r = await api('/api/admin/inquiries');
    const all = r.inquiries || [];
    const list = all.filter((q) => f === 'all' || q.status === f);
    const newCount = all.filter((q) => q.status === 'new').length;
    const b = $('#inq-badge'); b.hidden = !newCount; b.textContent = newCount;

    const chip = (id, label) => h('a', { class: 'chip', href: '#/inquiries/' + id, 'aria-pressed': String(f === id), style: 'text-decoration:none' }, label);
    const items = list.map((q) => {
      const subject = encodeURIComponent('[최희 작가] 문의 주신 내용에 대한 답변');
      const toggle = h('button', { class: 'btn btn-line btn-sm', type: 'button' }, q.status === 'done' ? '새 문의로 되돌리기' : '답변 완료로 표시');
      toggle.addEventListener('click', async () => {
        try { await api('/api/admin/inquiries/' + q.id, { method: 'PATCH', json: { status: q.status === 'done' ? 'new' : 'done' } }); route(); }
        catch (e) { toast(e.message, 'err'); }
      });
      const del = h('button', { class: 'btn btn-danger btn-sm', type: 'button' }, '지우기');
      del.addEventListener('click', async () => {
        if (!confirm(`${q.name} 님의 문의를 지울까요? 지운 문의는 되살릴 수 없습니다.`)) return;
        try { await api('/api/admin/inquiries/' + q.id, { method: 'DELETE' }); toast('지웠습니다.'); route(); }
        catch (e) { toast(e.message, 'err'); }
      });
      return h('article', { class: 'item' + (q.status === 'new' ? ' new' : '') },
        h('div', { class: 'item-head' },
          h('span', { class: 'state ' + q.status, text: q.status === 'new' ? '새 문의' : '답변 완료' }),
          h('span', { class: 'cat', text: q.category }),
          h('b', { text: q.name }),
          h('span', { class: 'date', text: fmtDate(q.created_at, true) })),
        h('p', { class: 'contact' }, q.email, q.phone ? ' · ' + q.phone : ''),
        h('p', { class: 'body', text: q.message }),
        h('div', { class: 'item-acts' },
          h('a', { class: 'btn btn-forest btn-sm', href: `mailto:${q.email}?subject=${subject}` }, '답장 메일 쓰기'),
          toggle, del));
    });

    view.replaceChildren(
      head('문의함', '문의·제안 페이지로 들어온 문의입니다. 답장은 메일로 보내고, 끝나면 "답변 완료"로 표시해 두십시오.'),
      h('div', { class: 'filters' }, chip('new', `새 문의 ${newCount}`), chip('done', '답변 완료'), chip('all', `전체 ${all.length}`)),
      ...(items.length ? items : [h('div', { class: 'empty', text: f === 'new' ? '새 문의가 없습니다.' : '문의가 없습니다.' })]),
      h('p', { class: 'muted small', style: 'margin-top:16px' }, '문의 페이지에 "답변 후 파기합니다"라고 안내하고 있습니다. 답변을 마친 문의는 정기적으로 지워 주십시오.'));
  }

  /* ================= 독자 게시판 글 ================= */
  async function viewPosts(view) {
    let offset = 0;
    const box = h('div');
    const more = h('button', { class: 'btn btn-line', type: 'button', hidden: true }, '지난 글 더 보기');
    const counter = h('p', { class: 'muted' });

    const load = async () => {
      const r = await api(`/api/posts?limit=30&offset=${offset}`);
      counter.textContent = `모두 ${r.total}개`;
      (r.posts || []).forEach((p) => {
        const del = h('button', { class: 'btn btn-danger btn-sm', type: 'button' }, '지우기');
        const item = h('article', { class: 'item' },
          h('div', { class: 'item-head' }, h('b', { text: p.name }), h('span', { class: 'date', text: fmtDate(p.created_at, true) })),
          h('p', { class: 'body', text: p.message }),
          h('div', { class: 'item-acts' }, del));
        del.addEventListener('click', async () => {
          if (!confirm(`${p.name} 님의 글을 지울까요? 지운 글은 되살릴 수 없습니다.`)) return;
          try { await api('/api/admin/posts/' + p.id, { method: 'DELETE' }); item.remove(); toast('지웠습니다.'); }
          catch (e) { toast(e.message, 'err'); }
        });
        box.append(item);
      });
      offset += (r.posts || []).length;
      more.hidden = offset >= r.total;
      if (!r.total) box.replaceChildren(h('div', { class: 'empty', text: '아직 남겨진 글이 없습니다.' }));
    };
    more.addEventListener('click', () => load().catch((e) => toast(e.message, 'err')));
    view.replaceChildren(
      head('독자 게시판 글', '광고 글이나 비방 글이 올라오면 이곳에서 지웁니다.',
        h('a', { class: 'btn btn-line btn-sm', href: '/board', target: '_blank', rel: 'noopener' }, '게시판 보기 ↗')),
      counter, box, h('div', { style: 'text-align:center;margin-top:14px' }, more));
    await load();
  }

  /* ================= 사진 보관함 ================= */
  async function viewMedia(view) {
    const r = await api('/api/admin/media');
    const media = r.media || [];
    const unused = media.filter((m) => !m.used);
    const total = media.reduce((n, m) => n + m.bytes, 0);

    const delOne = async (m) => {
      const msg = m.used
        ? '이 사진은 지금 홈페이지에 쓰이고 있습니다. 지우면 그 자리에 사진이 보이지 않습니다. 그래도 지울까요?'
        : '이 사진을 지울까요?';
      if (!confirm(msg)) return;
      try { await api('/api/admin/media/' + m.id, { method: 'DELETE' }); toast('지웠습니다.'); route(); }
      catch (e) { toast(e.message, 'err'); }
    };
    const cleanBtn = h('button', { class: 'btn btn-line btn-sm', type: 'button', disabled: !unused.length }, `쓰지 않는 사진 정리 (${unused.length}장)`);
    cleanBtn.addEventListener('click', async () => {
      if (!confirm(`홈페이지에 쓰이지 않는 사진 ${unused.length}장을 지울까요?`)) return;
      cleanBtn.disabled = true;
      try {
        for (const m of unused) await api('/api/admin/media/' + m.id, { method: 'DELETE' });
        toast('정리했습니다.'); route();
      } catch (e) { toast(e.message, 'err'); cleanBtn.disabled = false; }
    });

    view.replaceChildren(
      head('사진 보관함', `관리 화면에서 올린 사진입니다. 모두 ${media.length}장, ${fmtBytes(total)}.`, cleanBtn),
      h('div', { class: 'notice-box' }, h('p', { text: '사진은 공용 DB(total-db)에 저장됩니다. 사진을 바꾸면 예전 사진은 "쓰지 않음"으로 남으니, 가끔 정리해 주시면 DB를 가볍게 유지할 수 있습니다. 처음부터 홈페이지에 들어 있던 사진은 여기에 나오지 않습니다.' })),
      media.length
        ? h('div', { class: 'media-grid' }, media.map((m) => h('div', { class: 'media-card' },
          h('div', { class: 'ph' }, h('img', { src: m.url, alt: m.name || '올린 사진', loading: 'lazy' })),
          h('div', { class: 'meta' },
            h('span', { class: 'tag' + (m.used ? '' : ' dirty'), text: m.used ? '사용 중' : '쓰지 않음' }),
            h('span', { text: `${m.width}×${m.height} · ${fmtBytes(m.bytes)}` }),
            h('span', { text: fmtDate(m.created_at) }),
            h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => delOne(m) }, '지우기')))))
        : h('div', { class: 'empty', text: '아직 올린 사진이 없습니다.' }));
  }

  /* ================= 백업·복원 ================= */
  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }
  function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type });
  }

  async function viewBackup(view) {
    const progress = h('p', { class: 'muted small', role: 'status' });
    const dl = h('button', { class: 'btn btn-forest', type: 'button' }, '백업 파일 내려받기');
    dl.addEventListener('click', async () => {
      dl.disabled = true;
      try {
        progress.textContent = '내용을 모으는 중…';
        const data = await api('/api/admin/backup');
        const media = [];
        for (let i = 0; i < data.media.length; i++) {
          const m = data.media[i];
          progress.textContent = `사진을 담는 중… (${i + 1}/${data.media.length})`;
          const res = await fetch('/media/' + m.id);
          if (!res.ok) continue;
          media.push({ ...m, data: await blobToBase64(await res.blob()) });
        }
        const out = { format: data.format, version: data.version, site: 'choihee', created_at: data.created_at,
          content: data.content, posts: data.posts, media };
        const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        const a = h('a', { href: URL.createObjectURL(blob), download: `choihee-backup-${stamp}.json` });
        document.body.append(a); a.click(); a.remove();
        progress.textContent = `백업 파일을 내려받았습니다. (${fmtBytes(blob.size)}, 고친 항목 ${data.content.length}개 · 게시글 ${data.posts.length}개 · 사진 ${media.length}장)`;
      } catch (e) {
        progress.textContent = ''; toast(e.message, 'err');
      } finally { dl.disabled = false; }
    });

    const rprog = h('p', { class: 'muted small', role: 'status' });
    const up = h('button', { class: 'btn btn-line', type: 'button' }, '백업 파일 고르기');
    const pick = $('#backup-pick');
    up.addEventListener('click', () => { pick.value = ''; pick.click(); });
    pick.onchange = async () => {
      const file = pick.files && pick.files[0];
      if (!file) return;
      let data;
      try { data = JSON.parse(await file.text()); } catch { toast('백업 파일을 읽지 못했습니다.', 'err'); return; }
      if (!data || data.format !== 'choihee-site-backup') { toast('이 홈페이지의 백업 파일이 아닙니다.', 'err'); return; }
      if (!confirm(`${fmtDate(data.created_at, true)}에 받은 백업으로 되돌립니다.\n\n· 문구·사진·목록 설정이 백업 시점으로 바뀝니다.\n· 게시판 글은 지워지지 않고, 백업에만 있는 글이 다시 들어옵니다.\n· 문의함은 그대로 둡니다.\n\n계속할까요?`)) return;
      up.disabled = true;
      try {
        const media = Array.isArray(data.media) ? data.media : [];
        for (let i = 0; i < media.length; i++) {
          const m = media[i];
          if (!m.data || !/^[a-f0-9]{24}$/.test(m.id)) continue;
          rprog.textContent = `사진을 되돌리는 중… (${i + 1}/${media.length})`;
          const q = new URLSearchParams({ id: m.id, w: m.width || 0, h: m.height || 0, name: m.name || '', created: m.created_at || '' });
          await api('/api/admin/media?' + q, { method: 'POST', body: base64ToBlob(m.data, m.mime), type: m.mime });
        }
        const posts = Array.isArray(data.posts) ? data.posts : [];
        rprog.textContent = '문구와 목록을 되돌리는 중…';
        await api('/api/admin/restore', { method: 'POST', json: { content: data.content || [], posts: posts.slice(0, 300) } });
        for (let i = 300; i < posts.length; i += 300) {
          rprog.textContent = `게시글을 되돌리는 중… (${Math.min(i + 300, posts.length)}/${posts.length})`;
          await api('/api/admin/restore', { method: 'POST', json: { posts: posts.slice(i, i + 300) } });
        }
        state.pending.clear(); await loadContent(); updateSavebar();
        rprog.textContent = '되돌렸습니다.';
        toast('백업 내용으로 되돌렸습니다.');
      } catch (e) {
        rprog.textContent = ''; toast(e.message, 'err');
      } finally { up.disabled = false; }
    };

    view.replaceChildren(
      head('백업·복원', '이 홈페이지의 내용만 따로 파일로 받아 두고, 필요할 때 되돌립니다.'),
      h('section', { class: 'panel' },
        h('h2', { text: '백업 파일 내려받기' }),
        h('p', null, '고친 문구·사진·저서·이력, 독자 게시판 글을 파일 하나로 받습니다. 개인정보가 담긴 문의 내역은 백업에 넣지 않습니다.'),
        h('p', { class: 'muted small', text: '큰 수정을 하기 전이나 한 달에 한 번쯤 받아 두시길 권합니다. 받은 파일은 컴퓨터나 개인 드라이브에 보관하시고, GitHub에는 올리지 마십시오.' }),
        dl, progress),
      h('section', { class: 'panel' },
        h('h2', { text: '백업으로 되돌리기' }),
        h('p', null, '전에 받아 둔 백업 파일을 고르면 그 시점의 내용으로 되돌립니다.'),
        up, rprog),
      h('section', { class: 'panel' },
        h('h2', { text: '공용 DB(total-db)를 쓸 때 알아 둘 점' }),
        h('div', { class: 'notice-box warn' },
          h('p', null, h('b', { text: 'Cloudflare의 "시간 되돌리기(Time Travel)"는 쓰지 마십시오. ' }),
            'total-db 전체가 한꺼번에 되돌아가서, 같은 DB를 쓰는 다른 홈페이지의 데이터까지 과거로 돌아갑니다. 이 홈페이지만 되돌릴 때는 위의 백업 파일을 쓰십시오.')),
        h('p', { class: 'muted small' }, '이 홈페이지가 쓰는 표: ',
          ['choihee_content', 'choihee_posts', 'choihee_inquiries', 'choihee_media', 'choihee_media_chunks', 'choihee_meta', 'choihee_login_attempts']
            .map((t, i) => [i ? ', ' : '', h('code', { text: t })]))));
  }

  /* ================= 사진 고르기·맞추기 ================= */
  const crop = {
    dlg: $('#crop'), canvas: $('#crop-canvas'), pos: $('#crop-pos'), free: $('#crop-free'),
    img: null, opts: null, resolve: null, axis: null, rect: null, scale: 1,
  };

  function pickAndCrop(opts) {
    return new Promise((resolve) => {
      const input = $('#file-pick');
      input.value = '';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        try { resolve(await openCrop(file, opts)); } catch (e) { toast(e.message, 'err'); resolve(null); }
      };
      input.click();
    });
  }

  async function openCrop(file, opts) {
    if (file.size > 40 * 1024 * 1024) throw new Error('사진 파일이 너무 큽니다 (40MB 이하).');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { URL.revokeObjectURL(url); throw new Error('이 사진은 열 수 없습니다. JPG나 PNG로 저장해서 다시 올려 주십시오.'); }
    crop.img = img; crop.opts = opts; crop.name = file.name;
    crop.pos.value = 50; crop.free.checked = false;
    $('#crop-free-wrap').hidden = !opts.allowFree;
    $('#crop-guide').textContent = opts.ratio
      ? `"${opts.label}" 자리는 ${ratioText(opts.ratio)} 비율입니다. 밝게 보이는 부분만 홈페이지에 나옵니다.`
      : '사진 크기를 알맞게 줄여서 올립니다.';
    drawCrop();
    crop.dlg.showModal();
    return new Promise((resolve) => { crop.resolve = (v) => { URL.revokeObjectURL(url); resolve(v); }; });
  }

  function cropRect() {
    const W = crop.img.naturalWidth, H = crop.img.naturalHeight;
    const [a, b] = (crop.opts.ratio || '').split(':').map(Number);
    if (!a || !b || crop.free.checked) return { x: 0, y: 0, w: W, h: H, axis: null };
    const r = a / b, s = W / H, p = Number(crop.pos.value) / 100;
    if (Math.abs(s - r) < 0.005) return { x: 0, y: 0, w: W, h: H, axis: null };
    if (s > r) { const cw = Math.round(H * r); return { x: Math.round((W - cw) * p), y: 0, w: cw, h: H, axis: 'x' }; }
    const ch = Math.round(W / r); return { x: 0, y: Math.round((H - ch) * p), w: W, h: ch, axis: 'y' };
  }

  function outputSize(rect) {
    const maxW = crop.opts.w || 1200;
    let w = Math.min(maxW, rect.w);
    if (crop.free.checked || !crop.opts.ratio) w = Math.min(maxW, rect.w);
    return { w: Math.round(w), h: Math.round(w * rect.h / rect.w) };
  }

  function drawCrop() {
    const c = crop.canvas, img = crop.img;
    const W = img.naturalWidth, H = img.naturalHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const maxW = 560, maxH = 400;
    const sc = Math.min(maxW / W, maxH / H, 1);
    const dw = Math.round(W * sc), dh = Math.round(H * sc);
    c.width = dw * dpr; c.height = dh * dpr;
    c.style.width = dw + 'px';
    crop.scale = sc;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, dw, dh);
    const r = cropRect();
    crop.rect = r; crop.axis = r.axis;
    const x = r.x * sc, y = r.y * sc, w = r.w * sc, hh = r.h * sc;
    ctx.fillStyle = 'rgba(15,22,19,.62)';
    ctx.fillRect(0, 0, dw, y); ctx.fillRect(0, y + hh, dw, dh - y - hh);
    ctx.fillRect(0, y, x, hh); ctx.fillRect(x + w, y, dw - x - w, hh);
    ctx.strokeStyle = '#C9A15C'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, hh - 2);
    $('#crop-range-wrap').hidden = !r.axis;
    const o = outputSize(r);
    $('#crop-info').textContent = `올라갈 크기: ${o.w}×${o.h}px` + (o.w < 500 ? ' · 사진이 작아 홈페이지에서 흐리게 보일 수 있습니다.' : '');
  }

  crop.pos.addEventListener('input', drawCrop);
  crop.free.addEventListener('change', drawCrop);
  (function enableDrag() {
    let start = null;
    crop.canvas.addEventListener('pointerdown', (e) => {
      if (!crop.axis) return;
      start = { x: e.clientX, y: e.clientY, pos: Number(crop.pos.value) };
      crop.canvas.setPointerCapture(e.pointerId);
    });
    crop.canvas.addEventListener('pointermove', (e) => {
      if (!start || !crop.axis) return;
      const W = crop.img.naturalWidth, H = crop.img.naturalHeight, r = crop.rect;
      const free = crop.axis === 'x' ? (W - r.w) * crop.scale : (H - r.h) * crop.scale;
      if (free <= 0) return;
      const d = crop.axis === 'x' ? e.clientX - start.x : e.clientY - start.y;
      crop.pos.value = Math.max(0, Math.min(100, start.pos + (d / free) * 100));
      drawCrop();
    });
    const end = () => { start = null; };
    crop.canvas.addEventListener('pointerup', end);
    crop.canvas.addEventListener('pointercancel', end);
  })();

  $('#crop-cancel').addEventListener('click', () => { if (crop.resolve) crop.resolve(null); crop.resolve = null; });
  crop.dlg.addEventListener('cancel', () => { if (crop.resolve) crop.resolve(null); crop.resolve = null; });

  function renderOutput(rect, w, h2) {
    // 큰 사진은 반씩 줄여 가며 그려야 선명합니다
    let src = crop.img, sx = rect.x, sy = rect.y, sw = rect.w, sh = rect.h;
    while (sw / 2 > w) {
      const c = document.createElement('canvas');
      c.width = Math.round(sw / 2); c.height = Math.round(sh / 2);
      const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high';
      cx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
      src = c; sx = 0; sy = 0; sw = c.width; sh = c.height;
    }
    const out = document.createElement('canvas');
    out.width = w; out.height = h2;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h2);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h2);
    return out;
  }
  const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));

  $('#crop-ok').addEventListener('click', async () => {
    const btn = $('#crop-ok');
    btn.disabled = true; btn.textContent = '올리는 중…';
    try {
      const rect = cropRect();
      let { w, h: hh } = outputSize(rect);
      let blob = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const canvas = renderOutput(rect, w, hh);
        blob = await toBlob(canvas, attempt === 0 ? 0.86 : 0.8);
        if (blob && blob.size <= 1500000) break;
        w = Math.round(w * 0.82); hh = Math.round(hh * 0.82);
      }
      if (!blob) throw new Error('사진을 만들지 못했습니다.');
      const q = new URLSearchParams({ w, h: hh, name: (crop.name || '').slice(0, 100) });
      const r = await api('/api/admin/media?' + q, { method: 'POST', body: blob, type: 'image/jpeg' });
      crop.dlg.close();
      if (crop.resolve) crop.resolve({ url: r.url, w, h: hh });
      crop.resolve = null;
      toast('사진을 올렸습니다. "저장하고 홈페이지에 반영"을 눌러야 바뀝니다.');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      btn.disabled = false; btn.textContent = '이 사진으로 바꾸기';
    }
  });

  boot();
})();
