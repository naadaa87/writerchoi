/* 공통 스크립트 — 내비게이션 / 등장 모션 / API 도우미 */
(function () {
  // 모바일 메뉴
  var toggle = document.querySelector('.nav-toggle');
  var menu = document.querySelector('.menu');
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // 등장 모션 (reduced motion이면 CSS에서 무효화됨)
  var io = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.12 })
    : null;
  document.querySelectorAll('.reveal').forEach(function (el) {
    if (io) io.observe(el); else el.classList.add('in');
  });
})();

/* API 호출 도우미 */
window.api = async function (path, options) {
  var res = await fetch(path, Object.assign({
    headers: { 'content-type': 'application/json' }
  }, options || {}));
  var data = null;
  try { data = await res.json(); } catch (e) { /* JSON 아님 */ }
  if (!res.ok) {
    var msg = (data && data.message) ? data.message : '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.';
    var err = new Error(msg);
    err.code = data && data.code;
    err.status = res.status;
    throw err;
  }
  return data;
};

/* 날짜 표기: 2026-07-18 05:12:00 (UTC) → 2026. 7. 18. */
window.fmtDate = function (s) {
  if (!s) return '';
  var d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
};

/* 글자 수 카운터 */
window.bindCount = function (input, target, max) {
  function upd() { target.textContent = input.value.length + ' / ' + max; }
  input.addEventListener('input', upd); upd();
};
