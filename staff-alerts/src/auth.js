// Staff accounts: employee no. + password, only for people the admin approved.
//
// KV (BOOKINGS namespace):
//   acct:<empno>  {empno, name, email, salt, hash, mustChange, at}   approved account
//                 {removed: true}                                    removed by the admin
//   areq:<empno>  {empno, name, email, at}                           access request
//
// New accounts start with INITIAL_PW and must set their own password at the
// first sign-in. People already in the old STAFF_PASSWORDS secret
// ({"e-mail": "employee no."}) count as approved and start the same way.
// Admins are the employee numbers in the ADMIN_EMPNOS secret (comma-separated);
// access requests are mailed to ADMIN_MAIL (default SMTP_USER).

import { sendMail, esc } from './mail.js';

export const INITIAL_PW = '0000';
const enc = new TextEncoder();
const EMPNO_RE = /^[A-Za-z0-9]{3,12}$/;
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const htmlPage = (title, body) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><body style="font-family:system-ui,-apple-system,sans-serif;background:#f6f4ef;color:#1b1b1f;margin:0;padding:40px 16px">
<div style="max-width:460px;margin:auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 8px 30px -12px rgba(0,0,0,.25)">
<p style="margin:0;font-size:12px;font-weight:800;letter-spacing:.12em;color:#a50034">LX PANTOS · STAFF ACCESS</p>${body}</div>`,
{ headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

export const cleanEmpno = (s) => String(s || '').trim().toUpperCase();
const pageUrl = (env) => env.PAGE_URL || 'https://vessel-alert.pages.dev/';

async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hashPw(pw, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return b64u(bits);
}
const newSalt = () => b64u(crypto.getRandomValues(new Uint8Array(16)));

function legacy(env) {
  try { return JSON.parse(env.STAFF_PASSWORDS || '{}'); } catch { return {}; }
}
// SEED_EMPNOS secret: employee numbers the admin pre-approved (comma-separated).
// They sign in with INITIAL_PW and give their e-mail when they set a password.
const seeds = (env) => String(env.SEED_EMPNOS || '').split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
export function isAdmin(env, empno) {
  return String(env.ADMIN_EMPNOS || '').split(/[\s,]+/).map(cleanEmpno).filter(Boolean).includes(cleanEmpno(empno));
}

// The account for an employee number, or null. Old-list people without a KV
// record yet come back as {legacy: true, mustChange: true}.
export async function getAccount(env, empno) {
  empno = cleanEmpno(empno);
  if (!EMPNO_RE.test(empno)) return null;
  const rec = await env.BOOKINGS.get('acct:' + empno, 'json');
  if (rec) return rec.removed ? null : rec;
  const email = Object.entries(legacy(env)).find(([, no]) => cleanEmpno(no) === empno)?.[0];
  if (email) return { empno, name: '', email: email.toLowerCase(), legacy: true, mustChange: true };
  return seeds(env).includes(empno) ? { empno, name: '', email: '', legacy: true, mustChange: true } : null;
}

async function checkPassword(acct, given) {
  if (!acct) return false;
  if (acct.legacy || !acct.hash) return safeEqual(given, INITIAL_PW);
  return safeEqual(await hashPw(given, acct.salt), acct.hash);
}

async function saveAccount(env, empno, { name, email, password = INITIAL_PW, mustChange = true }) {
  const salt = newSalt();
  const rec = { empno, name: name || '', email: String(email || '').toLowerCase(), salt, hash: await hashPw(password, salt), mustChange, at: new Date().toISOString() };
  await env.BOOKINGS.put('acct:' + empno, JSON.stringify(rec));
  return rec;
}

// ---------- session cookie ----------
const COOKIE = 'lxstaff';
const YEAR = 365 * 86400;
// Signed over the password hash, so a password change, reset or removal logs the person out.
const sig = (env, exp, acct) => hmac(env, `v3.${exp}.${acct.empno}.${acct.hash}`);

export async function sessionCookie(env, acct) {
  const exp = Math.floor(Date.now() / 1000) + YEAR;
  return `${COOKIE}=${exp}.${await sig(env, exp, acct)}.u~${encodeURIComponent(acct.empno)}; Max-Age=${YEAR}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

// {empno, email} for an employee-number session, or null.
export async function accountSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([\\w-]+)\\.u~([^;\\s]+)`).exec(request.headers.get('cookie') || '');
  if (!m || Number(m[1]) * 1000 < Date.now()) return null;
  const acct = await getAccount(env, decodeURIComponent(m[3]));
  if (!acct || acct.mustChange || !acct.hash || !acct.email) return null;
  return safeEqual(m[2], await sig(env, m[1], acct)) ? { empno: acct.empno, email: acct.email } : null;
}

// ---------- rate limits ----------
async function bump(env, key, ttl) {
  const n = (Number(await env.BOOKINGS.get(key)) || 0) + 1;
  await env.BOOKINGS.put(key, String(n), { expirationTtl: ttl });
  return n;
}
const ipOf = (request) => request.headers.get('cf-connecting-ip') || 'local';

// ---------- sign in / change password ----------
// POST /api/login {empno, password}
export async function loginWithEmpno(request, env, body) {
  const ipKey = 'rl:' + ipOf(request);
  const empno = cleanEmpno(body.empno);
  const empKey = 'rle:' + empno;
  if ((Number(await env.BOOKINGS.get(ipKey)) || 0) >= 5 || (Number(await env.BOOKINGS.get(empKey)) || 0) >= 10) {
    return json({ error: 'Too many attempts. Please try again in an hour.' }, 429);
  }
  const acct = await getAccount(env, empno);
  if (!(await checkPassword(acct, String(body.password || '')))) {
    await bump(env, ipKey, 3600);
    if (EMPNO_RE.test(empno)) await bump(env, empKey, 3600);
    return json({ error: 'Wrong employee number or password. Not approved yet? Use "Request access".' }, 401);
  }
  // First sign-in: no cookie until they pick their own password.
  if (acct.mustChange) return json({ ok: true, mustChange: true, empno: acct.empno, needEmail: !acct.email });
  return json({ ok: true, email: acct.email }, 200, { 'set-cookie': await sessionCookie(env, acct) });
}

// POST /api/password {empno, password, newPassword}
async function changePassword(request, env) {
  const body = await request.json().catch(() => ({}));
  const ipKey = 'rl:' + ipOf(request);
  if ((Number(await env.BOOKINGS.get(ipKey)) || 0) >= 5) return json({ error: 'Too many attempts. Please try again in an hour.' }, 429);
  const empno = cleanEmpno(body.empno);
  const acct = await getAccount(env, empno);
  if (!(await checkPassword(acct, String(body.password || '')))) {
    await bump(env, ipKey, 3600);
    return json({ error: 'Current password is wrong.' }, 401);
  }
  const np = String(body.newPassword || '');
  if (np.length < 6) return json({ error: 'Use at least 6 characters.' }, 400);
  if (np === INITIAL_PW || np === empno || /^(.)\1+$/.test(np)) return json({ error: 'Choose a password that is harder to guess.' }, 400);
  let email = acct.email;
  if (!email) {
    email = String(body.email || '').trim().toLowerCase();
    if (email && !email.includes('@')) email += '@' + env.ALLOWED_DOMAIN.toLowerCase();
    if (!/^[^@\s]+@/.test(email) || !email.endsWith('@' + env.ALLOWED_DOMAIN.toLowerCase())) return json({ error: `Enter your @${env.ALLOWED_DOMAIN} e-mail.` }, 400);
  }
  const rec = await saveAccount(env, acct.empno, { name: acct.name, email, password: np, mustChange: false });
  return json({ ok: true, email: rec.email }, 200, { 'set-cookie': await sessionCookie(env, rec) });
}

// ---------- access requests ----------
const approveSig = (env, empno, at) => hmac(env, `approve.${empno}.${at}`);

async function requestAccess(request, env) {
  const body = await request.json().catch(() => ({}));
  const empno = cleanEmpno(body.empno);
  const name = String(body.name || '').trim().slice(0, 40);
  let email = String(body.email || '').trim().toLowerCase();
  if (email && !email.includes('@')) email += '@' + env.ALLOWED_DOMAIN.toLowerCase();
  if (!EMPNO_RE.test(empno)) return json({ error: 'Enter your employee number (letters and digits only).' }, 400);
  if (!name) return json({ error: 'Enter your name.' }, 400);
  if (!email.endsWith('@' + env.ALLOWED_DOMAIN.toLowerCase())) return json({ error: `Use your @${env.ALLOWED_DOMAIN} e-mail.` }, 400);
  if (await bump(env, 'rlr:' + ipOf(request), 86400) > 5) return json({ error: 'Too many requests today.' }, 429);
  if (await getAccount(env, empno)) return json({ error: 'This employee number already has access. Sign in, or ask the admin to reset the password.' }, 409);
  const at = new Date().toISOString();
  await env.BOOKINGS.put('areq:' + empno, JSON.stringify({ empno, name, email, at }), { expirationTtl: 30 * 86400 });
  const link = `${new URL(request.url).origin}/admin/approve?${new URLSearchParams({ e: empno, t: at, s: await approveSig(env, empno, at) })}`;
  const to = [env.ADMIN_MAIL || env.SMTP_USER].filter(Boolean);
  if (to.length) {
    await sendMail(env, to, `[Staff access] ${name} (${empno}) 접속 승인 요청`,
      `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1b1b1f">
<p>직원용 페이지 접속 승인 요청이 들어왔습니다.</p>
<table style="border-collapse:collapse;margin:12px 0">
<tr><td style="padding:4px 12px 4px 0;color:#666">사번</td><td><b>${esc(empno)}</b></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#666">이름</td><td>${esc(name)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#666">메일</td><td>${esc(email)}</td></tr></table>
<p><a href="${esc(link)}" style="display:inline-block;background:#a50034;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">승인 / 거절 화면 열기</a></p>
<p style="color:#666;font-size:12px">승인하면 초기 비밀번호 ${INITIAL_PW}으로 계정이 만들어지고, 본인에게 안내 메일이 갑니다. 첫 로그인 때 본인이 새 비밀번호를 정합니다.</p></div>`)
      .catch((e) => console.error('access mail', e));
  }
  return json({ ok: true });
}

async function approvedMail(env, rec) {
  await sendMail(env, [rec.email], 'Your LX Pantos staff page access is approved',
    `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1b1b1f">
<p>Hello ${esc(rec.name || '')},</p>
<p>Your access to the LX Pantos staff page (Booking Vessel Alerts) has been approved.</p>
<table style="border-collapse:collapse;margin:12px 0">
<tr><td style="padding:4px 12px 4px 0;color:#666">Page</td><td><a href="${esc(pageUrl(env))}">${esc(pageUrl(env))}</a></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#666">Employee No.</td><td><b>${esc(rec.empno)}</b></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#666">Initial password</td><td><b>${INITIAL_PW}</b></td></tr></table>
<p>You will be asked to set your own password the first time you sign in.</p></div>`).catch((e) => console.error('approved mail', e));
}

async function approve(env, empno, by) {
  const req = await env.BOOKINGS.get('areq:' + empno, 'json');
  if (!req) return null;
  const rec = await saveAccount(env, empno, { name: req.name, email: req.email });
  await env.BOOKINGS.delete('areq:' + empno);
  await approvedMail(env, rec);
  console.log(`access approved ${empno} by ${by}`);
  return rec;
}

// GET shows a confirm page (mail scanners open links), POST does it.
async function approveLink(request, env, url) {
  const p = request.method === 'POST' ? new URLSearchParams(await request.text()) : url.searchParams;
  const empno = cleanEmpno(p.get('e')), at = p.get('t') || '', s = p.get('s') || '';
  if (!env.SESSION_SECRET || !safeEqual(s, await approveSig(env, empno, at))) return htmlPage('Invalid link', '<h2>링크가 올바르지 않습니다.</h2>');
  const req = await env.BOOKINGS.get('areq:' + empno, 'json');
  if (!req || req.at !== at) {
    const acct = await getAccount(env, empno);
    return htmlPage('Done', acct ? `<h2>이미 승인되었습니다.</h2><p>${esc(empno)} · ${esc(acct.email)}</p>` : '<h2>요청이 없거나 이미 처리되었습니다.</h2>');
  }
  if (request.method === 'POST') {
    if (p.get('do') === 'reject') {
      await env.BOOKINGS.delete('areq:' + empno);
      return htmlPage('Rejected', `<h2>거절했습니다.</h2><p>${esc(req.name)} (${esc(empno)})</p>`);
    }
    const rec = await approve(env, empno, 'mail link');
    return htmlPage('Approved', `<h2>승인했습니다.</h2><p>${esc(rec.name)} (${esc(empno)}) · ${esc(rec.email)}</p><p style="color:#666">초기 비밀번호 ${INITIAL_PW} 안내 메일을 보냈습니다.</p>`);
  }
  const hidden = `<input type="hidden" name="e" value="${esc(empno)}"><input type="hidden" name="t" value="${esc(at)}"><input type="hidden" name="s" value="${esc(s)}">`;
  const btn = 'padding:10px 18px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer';
  return htmlPage('Approve access', `<h2 style="margin:8px 0 14px">접속 승인 요청</h2>
<p>사번 <b>${esc(empno)}</b><br>이름 ${esc(req.name)}<br>메일 ${esc(req.email)}</p>
<form method="post" style="display:flex;gap:10px;margin-top:20px">${hidden}
<button name="do" value="approve" style="${btn};background:#a50034;color:#fff;border:0">승인</button>
<button name="do" value="reject" style="${btn};background:#fff;color:#1b1b1f;border:1px solid #ccc">거절</button></form>`);
}

// ---------- admin API (signed-in admins only) ----------
async function adminApi(request, env, url, session) {
  if (!session || !isAdmin(env, session.empno)) return json({ error: 'Admins only.' }, 403);
  if (url.pathname === '/api/admin/access' && request.method === 'GET') {
    const accounts = [], requests = [], seen = new Set();
    for (const prefix of ['acct:', 'areq:']) {
      let cursor;
      do {
        const page = await env.BOOKINGS.list({ prefix, cursor });
        for (const k of page.keys) {
          const v = await env.BOOKINGS.get(k.name, 'json');
          if (!v) continue;
          const empno = k.name.slice(prefix.length);
          if (prefix === 'acct:') { seen.add(empno); if (!v.removed) accounts.push({ empno, name: v.name, email: v.email, mustChange: !!v.mustChange, at: v.at }); }
          else requests.push(v);
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    }
    for (const [email, no] of Object.entries(legacy(env))) {
      const empno = cleanEmpno(no);
      if (!seen.has(empno)) { seen.add(empno); accounts.push({ empno, name: '', email: email.toLowerCase(), mustChange: true, legacy: true }); }
    }
    for (const empno of seeds(env)) if (!seen.has(empno)) accounts.push({ empno, name: '', email: '', mustChange: true, legacy: true });
    accounts.sort((a, b) => a.empno.localeCompare(b.empno));
    requests.sort((a, b) => a.at.localeCompare(b.at));
    return json({ accounts, requests, initial: INITIAL_PW, admins: String(env.ADMIN_EMPNOS || '').split(/[\s,]+/).map(cleanEmpno).filter(Boolean) });
  }
  if (url.pathname === '/api/admin/access' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const empno = cleanEmpno(body.empno);
    let email = String(body.email || '').trim().toLowerCase();
    if (email && !email.includes('@')) email += '@' + env.ALLOWED_DOMAIN.toLowerCase();
    if (!EMPNO_RE.test(empno)) return json({ error: 'Employee number: letters and digits only.' }, 400);
    if (!email.endsWith('@' + env.ALLOWED_DOMAIN.toLowerCase())) return json({ error: `Use an @${env.ALLOWED_DOMAIN} e-mail.` }, 400);
    if (await getAccount(env, empno)) return json({ error: 'This employee number already has access.' }, 409);
    const rec = await saveAccount(env, empno, { name: String(body.name || '').trim().slice(0, 40), email });
    await env.BOOKINGS.delete('areq:' + empno);
    if (body.notify) await approvedMail(env, rec);
    return json({ ok: true });
  }
  const m = /^\/api\/admin\/access\/([A-Za-z0-9]{3,12})\/(approve|reject|reset|remove)$/.exec(url.pathname);
  if (m && request.method === 'POST') {
    const empno = cleanEmpno(m[1]);
    if (m[2] === 'approve') return (await approve(env, empno, session.empno)) ? json({ ok: true }) : json({ error: 'No such request.' }, 404);
    if (m[2] === 'reject') { await env.BOOKINGS.delete('areq:' + empno); return json({ ok: true }); }
    const acct = await getAccount(env, empno);
    if (!acct) return json({ error: 'No such account.' }, 404);
    if (m[2] === 'reset') { await saveAccount(env, empno, { name: acct.name, email: acct.email }); return json({ ok: true }); }
    if (empno === cleanEmpno(session.empno)) return json({ error: 'You cannot remove yourself.' }, 400);
    await env.BOOKINGS.put('acct:' + empno, JSON.stringify({ removed: true, at: new Date().toISOString() }));
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}

// Routes handled here; returns null for anything else.
export async function handleAuth(request, env, url) {
  if (url.pathname === '/api/password' && request.method === 'POST') return changePassword(request, env);
  if (url.pathname === '/api/access-request' && request.method === 'POST') return requestAccess(request, env);
  if (url.pathname === '/admin/approve') return approveLink(request, env, url);
  if (url.pathname.startsWith('/api/admin/')) return adminApi(request, env, url, await accountSession(request, env));
  return null;
}
