/* شاشة الدخول: تتحقق من الجلسة ثم تشغّل التطبيق */
(async () => {
  const $ = id => document.getElementById(id);
  const api = async (path, method = 'GET', body) => {
    const r = await fetch('/api/' + path, { method, credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    let j = {}; try { j = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, j };
  };
  let register = false;
  function showLogin(msg) {
    $('auth').hidden = false;
    if (msg) $('authErr').textContent = msg;
    $('authSwitch').onclick = () => {
      register = !register;
      $('invWrap').hidden = !register;
      $('authMode').textContent = register ? 'إنشاء حساب جديد' : 'تسجيل الدخول';
      $('authSubmit').textContent = register ? 'إنشاء الحساب' : 'دخول';
      $('authSwitch').textContent = register ? 'لدي حساب' : 'حساب جديد؟ (برمز دعوة)';
      $('ap').autocomplete = register ? 'new-password' : 'current-password';
      $('authErr').textContent = '';
    };
    $('authForm').onsubmit = async e => {
      e.preventDefault();
      $('authErr').textContent = '';
      $('authSubmit').disabled = true;
      try {
        const r = await api(register ? 'register' : 'login', 'POST',
          { username: $('au').value.trim(), password: $('ap').value, invite: $('ai').value.trim() });
        if (r.ok) location.reload(); else $('authErr').textContent = r.j.error || ('خطأ ' + r.status);
      } catch (err) { $('authErr').textContent = 'تعذّر الاتصال بالخادم.'; }
      $('authSubmit').disabled = false;
    };
  }
  try {
    const me = await api('me');
    if (me.ok) {
      const d = await api('data');
      if (!d.ok) throw new Error('data');
      $('appRoot').hidden = false;
      window.startApp(d.j.mem || {}, me.j.username);
    } else if (me.status === 401) showLogin();
    else showLogin('خدمة الحسابات غير متاحة. تأكد من رفع ملف _worker.js وربط KV باسم DB.');
  } catch (e) { showLogin('تعذّر الاتصال بالخادم.'); }
})();
