// Staff-only booking page + scheduled "faster vessel" check.
// - /api/* needs the shared staff password (signed cookie, 1 year).
// - Bookings live in KV (never in the public GitHub repo).
// - The cron trigger compares each booking with the homepage's schedule data.

import page from './page.html';
import { evaluate, todayKST } from './logic.js';
import { alertMail, sendMail } from './mail.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const ROUTE_RE = /^[a-z]{5}_[a-z]{5}$/;
// Booker's office country -> POL country code in routeIds (vnsgn_..., idjkt_...).
export const COUNTRIES = { vn: 'Vietnam', id: 'Indonesia', cn: 'China', hk: 'Hong Kong', tw: 'Taiwan', kr: 'Korea' };
export const CUSTOMERS = ['SAE-A', 'HANSOLL', 'YAKJIN', 'SHINWON', 'HANSAE', 'SSTS', 'NOBRAND'];

// ---------- auth: one shared staff password ----------
// Signing in sets an HMAC-signed cookie valid for a year. The password is
// part of what is signed, so changing STAFF_PASSWORD logs everyone out.
const COOKIE = 'lxstaff';
const YEAR = 365 * 86400;
const enc = new TextEncoder();

async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const sessionSig = (env, exp) => hmac(env, `v1.${exp}.${env.STAFF_PASSWORD}`);

async function signedIn(request, env) {
  if (!env.STAFF_PASSWORD || !env.SESSION_SECRET) return false;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([\\w-]+)`).exec(request.headers.get('cookie') || '');
  if (!m || Number(m[1]) * 1000 < Date.now()) return false;
  return safeEqual(m[2], await sessionSig(env, m[1]));
}

async function login(request, env) {
  // 5 wrong passwords from one IP -> locked for an hour.
  const rlKey = 'rl:' + (request.headers.get('cf-connecting-ip') || 'local');
  const fails = Number(await env.BOOKINGS.get(rlKey)) || 0;
  if (fails >= 5) return json({ error: 'Too many attempts. Please try again in an hour.' }, 429);
  const body = await request.json().catch(() => ({}));
  if (!env.STAFF_PASSWORD || !safeEqual(String(body.password || ''), env.STAFF_PASSWORD)) {
    await env.BOOKINGS.put(rlKey, String(fails + 1), { expirationTtl: 3600 });
    return json({ error: 'Wrong password.' }, 401);
  }
  const exp = Math.floor(Date.now() / 1000) + YEAR;
  return new Response(JSON.stringify({ ok: true }), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'set-cookie': `${COOKIE}=${exp}.${await sessionSig(env, exp)}; Max-Age=${YEAR}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  } });
}

const logout = () => new Response(JSON.stringify({ ok: true }), { headers: {
  'content-type': 'application/json; charset=utf-8',
  'set-cookie': `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
} });

const inDomain = (email, env) => email.endsWith('@' + env.ALLOWED_DOMAIN.toLowerCase());

// ---------- schedule data (the homepage's published JSON) ----------
async function getData(env, name) {
  const res = await fetch(`${env.DATA_BASE}/${name}.json`, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error(`data ${name}: ${res.status}`);
  return res.json();
}

async function routeLabels(env) {
  const meta = await getData(env, 'route_meta');
  return Object.fromEntries(meta.map((m) => [m.routeId, m.label]));
}

// ---------- bookings (KV) ----------
async function listBookings(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.BOOKINGS.list({ prefix: 'b:', cursor });
    const vals = await Promise.all(page.keys.map((k) => env.BOOKINGS.get(k.name, 'json')));
    out.push(...vals.filter(Boolean));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const putBooking = (env, b, ttlDays) => env.BOOKINGS.put('b:' + b.id, JSON.stringify(b),
  ttlDays ? { expirationTtl: ttlDays * 86400 } : undefined);

function cleanEmails(input, user, env) {
  const list = (Array.isArray(input) ? input : String(input || '').split(/[,;\s]+/))
    .map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  const all = [...new Set(user ? [user, ...list] : list)];
  const bad = all.filter((e) => !/^[^@\s]+@[^@\s]+$/.test(e) || !inDomain(e, env));
  return { emails: all, bad };
}

// HQ ops staff per customer, edited on the page. Read at send time, so a team
// change also applies to bookings registered earlier.
// Starting lists; once someone saves a team on the page, that version wins.
const DEFAULT_TEAMS = {
  'SAE-A': ['miae.nam@lxpantos.com', 'yj.choi@lxpantos.com'],
  HANSOLL: ['yj.choi@lxpantos.com'],
  YAKJIN: ['dahye.park@lxpantos.com'],
  SHINWON: ['dahye.park@lxpantos.com'],
  HANSAE: ['yj.choi@lxpantos.com', 'juri.oh@lxpantos.com'],
  SSTS: ['juri.oh@lxpantos.com'],
  NOBRAND: [],
};

async function getTeams(env) {
  const vals = await Promise.all(CUSTOMERS.map((c) => env.BOOKINGS.get('team:' + c, 'json')));
  return Object.fromEntries(CUSTOMERS.map((c, i) => [c, vals[i]?.emails ?? DEFAULT_TEAMS[c] ?? []]));
}

// Booker e-mails per office country, picked on the opening screen.
// Starting lists; once someone saves a country's list on the page, that version wins.
const DEFAULT_BOOKERS = {
  vn: ['van.dinh', 'trang.pham', 'giang.luu', 'giang.nhu'],
  id: ['benny.mabrur', 'mul.yadi'],
  cn: ['cong.ma', 'meitong.su'],
  hk: ['hang.lee'],
  tw: ['may.yang'],
  kr: ['sanghyun.koh'],
};

async function getBookers(env) {
  const ccs = Object.keys(COUNTRIES);
  const vals = await Promise.all(ccs.map((c) => env.BOOKINGS.get('bookers:' + c, 'json')));
  return Object.fromEntries(ccs.map((c, i) => [c,
    vals[i]?.emails ?? (DEFAULT_BOOKERS[c] || []).map((id) => `${id}@${env.ALLOWED_DOMAIN}`)]));
}

// Korea's list is its own staff plus every HQ PIC.
async function allowedBookers(env, country) {
  const bookers = await getBookers(env);
  if (country !== 'kr') return bookers[country];
  const teams = await getTeams(env);
  return [...new Set([...bookers.kr, ...Object.values(teams).flat()])];
}

const recipients = (b, teams) => [...new Set([...(b.notify || []), ...(teams[b.customer] || [])])];

// Mail language per address: Korea side (every HQ PIC and the Korea list) gets
// Korean; overseas bookers get their own language with English underneath.
const COUNTRY_LANG = { vn: 'vi', id: 'id', cn: 'zh', tw: 'zht', hk: 'zht' };
async function langMap(env, teams) {
  const bookers = await getBookers(env);
  const m = new Map();
  for (const [cc, list] of Object.entries(bookers)) for (const e of list) m.set(e, COUNTRY_LANG[cc] || 'en');
  for (const e of [...Object.values(teams).flat(), ...bookers.kr]) m.set(e, 'ko');
  return m;
}
const langOf = (email, m) => m.get(email) || 'en';

// ---------- checker ----------
async function runCheck(env, { onlyId } = {}) {
  const today = todayKST();
  const bookings = (await listBookings(env)).filter((b) => b.state !== 'departed' && b.state !== 'cancelled' && (!onlyId || b.id === onlyId));
  const labels = await routeLabels(env);
  const teams = await getTeams(env);
  const langs = await langMap(env, teams);
  const lanes = {};
  const log = [];
  for (const b of bookings) {
    try {
      lanes[b.routeId] ??= await getData(env, b.routeId);
      const ev = evaluate(b, lanes[b.routeId], today);
      if (ev.state === 'departed') {
        // Vessel has sailed: stop alerting and remove the booking.
        await env.BOOKINGS.delete('b:' + b.id);
        log.push(`departed ${b.bookingNo}: deleted`);
        continue;
      }
      b.state = ev.state;
      b.currentEta = ev.eta || null;
      b.currentEtd = ev.etd || null;
      b.delayDays = ev.delayDays ?? null;
      b.candidates = ev.candidates.slice(0, 5);
      b.lastCheckedAt = new Date().toISOString();
      if (ev.state === 'alert' && ev.alertKey !== b.lastAlertKey) {
        const to = recipients(b, teams);
        const groups = {};
        for (const e of to) (groups[langOf(e, langs)] ??= []).push(e);
        for (const [lang, group] of Object.entries(groups)) {
          const { subject, html } = alertMail(b, ev, labels[b.routeId] || b.routeId, env.PAGE_URL, lang);
          await sendMail(env, group, subject, html);
        }
        b.lastAlertKey = ev.alertKey;
        b.lastAlertAt = new Date().toISOString();
        b.lastAlertTo = to;
        log.push(`mail ${b.bookingNo} -> ${to.join(',')}`);
      }
      await putBooking(env, b);
    } catch (e) {
      log.push(`error ${b.bookingNo}: ${e.message}`);
      console.error(e);
    }
  }
  return { today, checked: bookings.length, log };
}

// ---------- HTTP ----------
async function handle(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === '/' && request.method === 'GET') {
    return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (url.pathname === '/api/login' && request.method === 'POST') return login(request, env);
  if (url.pathname === '/api/logout' && request.method === 'POST') return logout();
  // Public: what the opening screen needs before the password (countries and
  // the e-mails to pick from; Korea = its own list plus every HQ PIC).
  if (url.pathname === '/api/login-info') {
    const bookers = await getBookers(env);
    const teams = await getTeams(env);
    bookers.kr = [...new Set([...bookers.kr, ...Object.values(teams).flat()])];
    return json({ countries: COUNTRIES, choices: bookers });
  }
  if (!(await signedIn(request, env))) return json({ error: 'login' }, 401);

  // Who is acting: the booker e-mail picked on the opening screen.
  const actor = String(request.headers.get('x-booker') || '').toLowerCase();
  const user = /^[^@\s]+@[^@\s]+$/.test(actor) && inDomain(actor, env) ? actor : null;

  if (url.pathname === '/api/me') return json({ domain: env.ALLOWED_DOMAIN, customers: CUSTOMERS, countries: COUNTRIES });

  if (url.pathname === '/api/teams' && request.method === 'GET') return json(await getTeams(env));
  if (url.pathname === '/api/bookers' && request.method === 'GET') return json(await getBookers(env));

  const bk = /^\/api\/bookers\/([a-z]{2})$/.exec(url.pathname);
  if (bk && request.method === 'PUT') {
    if (!COUNTRIES[bk[1]]) return json({ error: 'Unknown country.' }, 400);
    const body = await request.json().catch(() => ({}));
    const { emails, bad } = cleanEmails(body.emails, null, env);
    if (bad.length) return json({ error: `Only @${env.ALLOWED_DOMAIN} addresses are allowed: ${bad.join(', ')}` }, 400);
    await env.BOOKINGS.put('bookers:' + bk[1], JSON.stringify({ emails, updatedBy: user || 'staff', updatedAt: new Date().toISOString() }));
    return json({ country: bk[1], emails });
  }

  const team = /^\/api\/teams\/([A-Z-]+)$/.exec(url.pathname);
  if (team && request.method === 'PUT') {
    if (!CUSTOMERS.includes(team[1])) return json({ error: 'Unknown customer.' }, 400);
    const body = await request.json().catch(() => ({}));
    const { emails, bad } = cleanEmails(body.emails, null, env);
    if (bad.length) return json({ error: `Only @${env.ALLOWED_DOMAIN} addresses can receive alerts: ${bad.join(', ')}` }, 400);
    await env.BOOKINGS.put('team:' + team[1], JSON.stringify({ emails, updatedBy: user || 'staff', updatedAt: new Date().toISOString() }));
    return json({ customer: team[1], emails });
  }

  if (url.pathname === '/api/routes') {
    const meta = await getData(env, 'route_meta');
    return json(meta.map((m) => ({ routeId: m.routeId, label: m.label, updateDate: m.updateDate })));
  }

  const lane = /^\/api\/lane\/([a-z_]+)$/.exec(url.pathname);
  if (lane) {
    if (!ROUTE_RE.test(lane[1])) return json({ error: 'Invalid route.' }, 400);
    return json(await getData(env, lane[1]));
  }

  if (url.pathname === '/api/bookings' && request.method === 'GET') return json(await listBookings(env));

  if (url.pathname === '/api/bookings' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (!CUSTOMERS.includes(body.customer)) return json({ error: 'Please select a customer.' }, 400);
    if (!COUNTRIES[body.country]) return json({ error: 'Please select your country.' }, 400);
    // The booker picked on the opening screen gets the alerts. It must be on
    // that country's list (any company e-mail while the list is still empty).
    const allowed = await allowedBookers(env, body.country);
    const booker = String(body.booker || '').toLowerCase();
    if (allowed.length ? !allowed.includes(booker) : !inDomain(booker, env)) {
      return json({ error: 'Please pick your e-mail on the opening screen.' }, 400);
    }
    const bookingNo = String(body.bookingNo || '').trim().slice(0, 40);
    if (!bookingNo) return json({ error: 'Please enter a booking number.' }, 400);
    if (!ROUTE_RE.test(body.routeId || '')) return json({ error: 'Please select a route.' }, 400);

    // Take the booked sailing from the live schedule so origEta is what the
    // schedule said at booking time, not what was typed.
    const rows = await getData(env, body.routeId);
    const today = todayKST();
    const ev = evaluate({ vessel: body.vessel, voyage: body.voyage }, rows, today);
    if (ev.state === 'missing') return json({ error: 'The selected vessel is not in the current schedule.' }, 400);
    if (ev.state === 'departed') return json({ error: 'This vessel has already departed.' }, 400);

    const b = {
      id: crypto.randomUUID(),
      customer: body.customer,
      country: body.country,
      bookingNo,
      memo: String(body.memo || '').trim().slice(0, 80),
      routeId: body.routeId,
      carrier: ev.carrier,
      vessel: String(body.vessel).trim(),
      voyage: String(body.voyage || '').trim(),
      origEtd: ev.etd,
      origEta: ev.eta,
      notify: [booker],  // the booker; the customer's HQ PIC is added at send time
      booker,
      createdBy: booker,
      createdAt: new Date().toISOString(),
      state: 'ok',
      currentEta: ev.eta,
      currentEtd: ev.etd,
      delayDays: 0,
      candidates: [],
    };
    await putBooking(env, b);
    return json(b, 201);
  }

  const one = /^\/api\/bookings\/([0-9a-f-]{36})\/(check|cancel|vessel)$/.exec(url.pathname);
  if (one && request.method === 'POST') {
    const [, id, action] = one;
    if (action === 'check') return json(await runCheck(env, { onlyId: id }));

    const b = await env.BOOKINGS.get('b:' + id, 'json');
    if (!b) return json({ error: 'Booking not found.' }, 404);
    if (b.state === 'cancelled') return json({ error: 'This booking is already cancelled.' }, 400);
    const now = new Date().toISOString();
    const by = user || 'staff';
    b.history = b.history || [];

    if (action === 'cancel') {
      b.history.push({ at: now, by, action: 'cancelled', from: `${b.vessel} ${b.voyage}` });
      b.state = 'cancelled';
      b.cancelledBy = by;
      b.cancelledAt = now;
      b.candidates = [];
      await putBooking(env, b, 30); // kept 30 days for reference, then expires
      return json(b);
    }

    // action === 'vessel': rebook onto another sailing on the same route
    const body = await request.json().catch(() => ({}));
    const rows = await getData(env, b.routeId);
    const ev = evaluate({ vessel: body.vessel, voyage: body.voyage }, rows, todayKST());
    if (ev.state === 'missing') return json({ error: 'The selected vessel is not in the current schedule.' }, 400);
    if (ev.state === 'departed') return json({ error: 'This vessel has already departed.' }, 400);
    b.history.push({ at: now, by, action: 'vessel changed', from: `${b.vessel} ${b.voyage}`, to: `${body.vessel} ${body.voyage || ''}`.trim() });
    Object.assign(b, {
      carrier: ev.carrier,
      vessel: String(body.vessel).trim(),
      voyage: String(body.voyage || '').trim(),
      origEtd: ev.etd, origEta: ev.eta,
      currentEtd: ev.etd, currentEta: ev.eta,
      state: 'ok', delayDays: 0, candidates: [],
      lastAlertKey: null, lastAlertAt: null,
      updatedBy: by, updatedAt: now,
    });
    await putBooking(env, b);
    return json(b);
  }

  if (url.pathname === '/api/test-mail' && request.method === 'POST') {
    if (!user) return json({ error: 'Pick your e-mail on the opening screen first.' }, 400);
    const body = await request.json().catch(() => ({}));
    if (body.sample) {
      // A real-looking alert built from live data, without saving any booking.
      const rows = await getData(env, 'vnsgn_idjkt');
      const today = todayKST();
      const pick = rows.find((r) => evaluate({ vessel: r.vessel, voyage: r.voyage, origEtd: '0000', origEta: '9999' }, rows, today).candidates.length);
      if (!pick) return json({ error: 'No sample sailing available right now.' }, 400);
      const ev0 = evaluate({ vessel: pick.vessel, voyage: pick.voyage }, rows, today);
      const b = { customer: 'SAMPLE', bookingNo: 'SAMPLE-0001', memo: 'test only', carrier: pick.carrier,
        vessel: pick.vessel, voyage: pick.voyage, origEtd: ev0.etd, origEta: ev0.eta };
      const ev = evaluate(b, rows, today);
      const lang = body.lang || langOf(user, await langMap(env, await getTeams(env)));
      const { subject, html } = alertMail(b, ev, 'Ho Chi Minh → Jakarta', env.PAGE_URL, lang);
      await sendMail(env, [user], subject, html);
    } else {
      await sendMail(env, [user], '[LX Pantos] Vessel alert test mail',
        '<p>Vessel change alerts are being delivered correctly.</p>');
    }
    return json({ ok: true, to: user, mode: env.MAIL_MODE || 'log' });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    const r = await runCheck(env);
    console.log(JSON.stringify(r));
  },
};
