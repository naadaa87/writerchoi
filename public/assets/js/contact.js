/* 문의·제안 — 접수 폼 */
(function () {
  var form = document.getElementById('inq-form');
  var msgEl = document.getElementById('inq-msg');
  var submitBtn = document.getElementById('inq-submit');
  var textEl = document.getElementById('inq-message');
  var countEl = document.getElementById('inq-count');

  bindCount(textEl, countEl, 1000);

  function showMsg(kind, text) {
    msgEl.textContent = text;
    msgEl.className = 'form-msg show ' + kind;
    msgEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    msgEl.className = 'form-msg';

    var category = form.category.value;
    var name = form.name.value.trim();
    var email = form.email.value.trim();
    var phone = form.phone.value.trim();
    var message = textEl.value.trim();

    if (!category) { showMsg('err', '문의 구분을 선택해 주십시오.'); form.category.focus(); return; }
    if (!name) { showMsg('err', '성함을 적어 주십시오.'); form.name.focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showMsg('err', '이메일 주소를 확인해 주십시오.'); form.email.focus(); return; }
    if (message.length < 5) { showMsg('err', '내용을 조금 더 적어 주십시오.'); textEl.focus(); return; }
    if (!form.consent.checked) { showMsg('err', '개인정보 수집·이용에 동의해 주셔야 접수할 수 있습니다.'); form.consent.focus(); return; }

    submitBtn.disabled = true;
    try {
      await api('/api/inquiries', {
        method: 'POST',
        body: JSON.stringify({
          category: category, name: name, email: email, phone: phone,
          message: message, website: form.querySelector('[name=website]').value
        })
      });
      form.reset();
      bindCount(textEl, countEl, 1000);
      showMsg('ok', '잘 받았습니다. 남겨 주신 이메일로 답장드리겠습니다.');
    } catch (e) {
      if (e.code === 'db_not_configured') {
        showMsg('err', '접수 시스템을 준비하고 있습니다. 잠시 뒤 다시 시도해 주십시오.');
      } else {
        showMsg('err', e.message);
      }
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
