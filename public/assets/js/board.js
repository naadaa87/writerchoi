/* 독자 게시판 — 목록 불러오기 / 글 남기기 */
(function () {
  var listEl = document.getElementById('board-list');
  var stateEl = document.getElementById('board-state');
  var moreWrap = document.getElementById('board-more');
  var moreBtn = document.getElementById('board-more-btn');
  var form = document.getElementById('board-form');
  var msgEl = document.getElementById('board-form-msg');
  var nameEl = document.getElementById('bd-name');
  var textEl = document.getElementById('bd-message');
  var countEl = document.getElementById('bd-count');
  var submitBtn = document.getElementById('bd-submit');

  var offset = 0, LIMIT = 10, total = 0;

  bindCount(textEl, countEl, 500);

  function setState(text) {
    if (!text) { stateEl.style.display = 'none'; return; }
    stateEl.style.display = 'block';
    stateEl.textContent = text;
  }

  function render(posts) {
    posts.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'board-item reveal in';

      var head = document.createElement('div');
      head.className = 'board-head';
      var name = document.createElement('span');
      name.className = 'board-name';
      name.textContent = p.name;
      var date = document.createElement('span');
      date.className = 'board-date';
      date.textContent = fmtDate(p.created_at);
      head.appendChild(name); head.appendChild(date);

      var msg = document.createElement('p');
      msg.className = 'board-msg';
      msg.textContent = p.message;

      li.appendChild(head); li.appendChild(msg);
      listEl.appendChild(li);
    });
  }

  async function load() {
    try {
      setState('글을 불러오고 있습니다…');
      var data = await api('/api/posts?limit=' + LIMIT + '&offset=' + offset);
      total = data.total || 0;
      render(data.posts || []);
      offset += (data.posts || []).length;
      if (total === 0) {
        setState('아직 남겨진 글이 없습니다. 첫 글을 남겨 주시면 반갑게 읽겠습니다.');
      } else {
        setState('');
      }
      moreWrap.style.display = offset < total ? 'flex' : 'none';
    } catch (e) {
      if (e.code === 'db_not_configured') {
        setState('게시판을 준비하고 있습니다. 조금만 기다려 주십시오.');
      } else {
        setState('글을 불러오지 못했습니다. 잠시 뒤 새로고침해 주십시오.');
      }
      moreWrap.style.display = 'none';
    }
  }

  moreBtn.addEventListener('click', load);

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    msgEl.className = 'form-msg';
    var name = nameEl.value.trim();
    var message = textEl.value.trim();
    if (!name) { showMsg('err', '이름을 적어 주십시오.'); nameEl.focus(); return; }
    if (message.length < 2) { showMsg('err', '내용을 적어 주십시오.'); textEl.focus(); return; }

    submitBtn.disabled = true;
    try {
      await api('/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          name: name,
          message: message,
          website: form.querySelector('[name=website]').value
        })
      });
      form.reset();
      bindCount(textEl, countEl, 500);
      showMsg('ok', '글이 등록되었습니다. 남겨 주셔서 고맙습니다.');
      // 목록 새로 고침
      listEl.innerHTML = '';
      offset = 0;
      await load();
    } catch (e) {
      if (e.code === 'db_not_configured') {
        showMsg('err', '게시판을 준비하고 있습니다. 급한 용무는 문의·제안 페이지의 연락처를 이용해 주십시오.');
      } else {
        showMsg('err', e.message);
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  function showMsg(kind, text) {
    msgEl.textContent = text;
    msgEl.className = 'form-msg show ' + kind;
  }

  load();
})();
