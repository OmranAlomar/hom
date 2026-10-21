// منصة البكور: خلفية الحسابات (Cloudflare Pages، وضع _worker.js)
// يلزم: KV Namespace باسم DB، ومتغير سرّي INVITE_CODE. اختياري: MAX_USERS (الافتراضي 9)، PBKDF2_ITER (الافتراضي 100000)
const enc = new TextEncoder();
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), {
  status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...h }
});
const hex = u => [...u].map(x => x.toString(16).padStart(2, '0')).join('');
const b64 = u => btoa(String.fromCharCode(...u));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const sha = async t => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t))));
const eq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; };
async function pbkdf2(pw, salt, iter) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256));
}
const cookie = (v, age) => `sid=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
async function newSession(env, u) {
  const t = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.put('sess:' + await sha(t), JSON.stringify({ u }), { expirationTtl: 2592000 });
  return t;
}
async function whoami(req, env) {
  const m = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)sid=([a-f0-9]{64})/);
  if (!m) return null;
  const s = await env.DB.get('sess:' + await sha(m[1]), 'json');
  return s ? { u: s.u, tok: m[1] } : null;
}
async function readJson(req) {
  try { return await req.json(); } catch (e) { return null; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (!env.DB) return J({ error: 'لم يُربط KV باسم DB بعد.' }, 500);
    const route = url.pathname.slice(5).replace(/\/$/, '');

    if (req.method !== 'GET') {
      const origin = req.headers.get('Origin');
      if (origin && new URL(origin).host !== url.host) return J({ error: 'مرفوض' }, 403);
      if (!(req.headers.get('Content-Type') || '').includes('application/json')) return J({ error: 'نوع الطلب غير مقبول' }, 415);
    }

    if (route === 'register' && req.method === 'POST') {
      const b = await readJson(req) || {};
      if (!env.INVITE_CODE) return J({ error: 'التسجيل مغلق: لم يُضبط INVITE_CODE.' }, 403);
      if (typeof b.invite !== 'string' || b.invite !== env.INVITE_CODE) return J({ error: 'رمز الدعوة غير صحيح.' }, 403);
      const u = String(b.username || '').toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(u)) return J({ error: 'اسم المستخدم: 3 إلى 20 حرفاً إنجليزياً صغيراً أو أرقاماً أو _' }, 400);
      if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 200) return J({ error: 'كلمة المرور 8 أحرف على الأقل.' }, 400);
      const max = parseInt(env.MAX_USERS || '9', 10);
      const list = await env.DB.list({ prefix: 'user:', limit: 1000 });
      if (list.keys.length >= max) return J({ error: 'اكتمل عدد المستخدمين المسموح.' }, 403);
      if (await env.DB.get('user:' + u)) return J({ error: 'اسم المستخدم محجوز.' }, 409);
      const iter = parseInt(env.PBKDF2_ITER || '100000', 10), salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await pbkdf2(b.password, salt, iter);
      await env.DB.put('user:' + u, JSON.stringify({ salt: b64(salt), hash: b64(hash), iter }));
      await env.DB.put('data:' + u, JSON.stringify({}));
      return J({ ok: true, username: u }, 200, { 'Set-Cookie': cookie(await newSession(env, u), 2592000) });
    }

    if (route === 'login' && req.method === 'POST') {
      const b = await readJson(req) || {};
      const u = String(b.username || '').toLowerCase();
      const bad = () => J({ error: 'بيانات الدخول غير صحيحة.' }, 401);
      if (!/^[a-z0-9_]{3,20}$/.test(u) || typeof b.password !== 'string') return bad();
      const fk = 'fail:' + u, fails = parseInt(await env.DB.get(fk) || '0', 10);
      if (fails >= 8) return J({ error: 'محاولات كثيرة، انتظر 10 دقائق.' }, 429);
      const rec = await env.DB.get('user:' + u, 'json');
      if (!rec) return bad();
      const h = await pbkdf2(b.password, unb64(rec.salt), rec.iter);
      if (!eq(h, unb64(rec.hash))) { await env.DB.put(fk, String(fails + 1), { expirationTtl: 600 }); return bad(); }
      if (fails) await env.DB.delete(fk);
      return J({ ok: true, username: u }, 200, { 'Set-Cookie': cookie(await newSession(env, u), 2592000) });
    }

    const me = await whoami(req, env);

    if (route === 'logout' && req.method === 'POST') {
      if (me) await env.DB.delete('sess:' + await sha(me.tok));
      return J({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
    }
    if (!me) return J({ error: 'غير مسجَّل' }, 401);
    if (route === 'me' && req.method === 'GET') return J({ username: me.u });
    if (route === 'data' && req.method === 'GET') return J({ mem: await env.DB.get('data:' + me.u, 'json') || {} });
    if (route === 'data' && (req.method === 'PUT' || req.method === 'POST')) {
      const raw = await req.text();
      if (raw.length > 600000) return J({ error: 'البيانات كبيرة جداً.' }, 413);
      let b; try { b = JSON.parse(raw); } catch (e) { return J({ error: 'JSON غير صالح' }, 400); }
      if (!b || typeof b.mem !== 'object' || Array.isArray(b.mem) || Object.keys(b.mem).length > 5000) return J({ error: 'شكل البيانات غير صحيح' }, 400);
      await env.DB.put('data:' + me.u, JSON.stringify(b.mem));
      return J({ ok: true });
    }
    return J({ error: 'غير موجود' }, 404);
  }
};
