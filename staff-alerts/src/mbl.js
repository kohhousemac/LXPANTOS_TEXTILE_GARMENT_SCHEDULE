// MBL arrival tracking: requested from the homepage footer form, tracked once a
// day by a Claude scheduled task that reads the carrier's own tracking page and
// posts what it read back here. This Worker stores the requests in KV
// ("t:<id>", never in the public repo) and sends the daily report mail.
//
// Public (homepage, CORS):   POST /api/mbl              {mbl, carrier, email}
//                            GET  /api/mbl/carriers
// Mail link (signed):        GET  /mbl/stop?id=&sig=
// Tracker (x-tracker-token): GET  /api/mbl/queue
//                            POST /api/mbl/<id>/report  {status, ...}

import { esc, sendMail } from './mail.js';

// Every carrier the schedule pages collect. Key = what the form sends.
export const CARRIERS = {
  KMTC: 'KMTC (고려해운)',
  SINOKOR: 'SINOKOR (장금상선)',
  'HEUNG-A': 'HEUNG-A (흥아라인)',
  NAMSUNG: 'NAMSUNG (남성해운)',
  PANOCEAN: 'PAN OCEAN (팬오션)',
  DONGJIN: 'DONGJIN (동진상선)',
  'SM LINE': 'SM LINE (SM상선)',
  HMM: 'HMM',
  SITC: 'SITC',
  EMC: 'EVERGREEN (EMC)',
  WHL: 'WAN HAI (WHL)',
  YML: 'YANG MING (YML)',
  GSL: 'GOLD STAR LINE (GSL)',
  CNC: 'CNC',
  'CMA CGM': 'CMA CGM',
  MSC: 'MSC',
  MSK: 'MAERSK (MSK)',
  ZIM: 'ZIM',
};

const ACTIVE_LIMIT = 300;          // all active requests together
const PER_EMAIL_LIMIT = 30;        // active requests per person
const PER_IP_DAY = 20;             // new requests per IP per day
const MAX_CC = 5;                  // extra @lxpantos.com addresses in Cc
const NOT_FOUND_STOP = 5;          // stop after this many daily "not found" in a row
const MAX_DAYS = 90;               // stop tracking after 90 days in any case
const KEEP_DONE_DAYS = 30;         // finished requests stay visible this long

const RED = '#a50034';
const cell = 'padding:7px 10px;border-bottom:1px solid #e6e1d8;font-size:13px';
const LOGO = 'https://lxpantosfashion.co.kr/mail-logo.png';

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});

// ---------- CORS (homepage → this Worker) ----------
const ORIGINS = ['https://lxpantosfashion.co.kr', 'https://www.lxpantosfashion.co.kr', 'https://kohhousemac.github.io'];
export function cors(request) {
  const o = request.headers.get('origin') || '';
  return ORIGINS.includes(o) ? {
    'access-control-allow-origin': o,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  } : {};
}

// ---------- helpers ----------
const enc = new TextEncoder();
async function sign(env, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET || 'dev'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('mbl-stop.' + msg)));
  return btoa(String.fromCharCode(...s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}

function tokenOk(request, env) {
  const t = request.headers.get('x-tracker-token') || '';
  const want = env.TRACKER_TOKEN || '';
  if (!want || t.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < t.length; i++) d |= t.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

export const normMbl = (s) => String(s || '').toUpperCase().replace(/[\s-]+/g, '');
const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

async function listAll(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.BOOKINGS.list({ prefix: 't:', cursor });
    const vals = await Promise.all(page.keys.map((k) => env.BOOKINGS.get(k.name, 'json')));
    out.push(...vals.filter(Boolean));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

const put = (env, t, ttlDays) => env.BOOKINGS.put('t:' + t.id, JSON.stringify(t),
  ttlDays ? { expirationTtl: ttlDays * 86400 } : undefined);

const stopUrl = async (env, t) => `${env.PAGE_URL.replace(/\/$/, '')}/mbl/stop?id=${t.id}&sig=${await sign(env, t.id)}`;

// ---------- mails ----------
function frame(title, body) {
  return `<div style="font-family:Arial,'Malgun Gothic',sans-serif;max-width:680px;color:#1d1d1f">
<div style="border-bottom:2px solid ${RED};padding:0 0 10px;margin-bottom:16px"><img src="${LOGO}" alt="LX Pantos" height="22"></div>
<h2 style="font-size:17px;margin:0 0 12px">${title}</h2>${body}
<p style="font-size:11px;color:#8a8580;margin-top:22px">LX Pantos Textile / Garment Schedule · MBL 도착 추적 (MBL arrival tracking)<br>
선사 공개 화물추적 화면에서 읽은 값이며 선사 사정에 따라 바뀔 수 있습니다. Values read from the carrier's public tracking page.</p></div>`;
}

const row = (k, v) => `<tr><td style="${cell};color:#6b6560;white-space:nowrap">${k}</td><td style="${cell}">${v}</td></tr>`;

export async function confirmMail(env, t) {
  const stop = await stopUrl(env, t);
  const html = frame(`MBL ${esc(t.mbl)} 도착 추적을 시작합니다`, `
<table style="border-collapse:collapse;width:100%">${row('MBL', esc(t.mbl))}${row('선사 Carrier', esc(CARRIERS[t.carrier] || t.carrier))}${row('받는 사람 To', esc(t.email))}${(t.cc || []).length ? row('참조 Cc', esc(t.cc.join(', '))) : ''}</table>
<p style="font-size:13px;line-height:1.6">매일 오전(한국 시간) 선사 화물추적 화면을 확인해 이 주소로 보고 메일을 보내 드리고, POD 도착이 확인되면 마지막 메일을 보내고 자동으로 끝납니다.<br>
We will check the carrier's tracking page every morning (KST) and mail you until arrival at POD is confirmed.</p>
<p><a href="${esc(stop)}" style="color:${RED};font-size:12px">추적 중지 Stop tracking</a></p>`);
  await sendMail(env, [t.email], `[LX Pantos] MBL ${t.mbl} 도착 추적 시작 (${t.carrier})`, html, t.cc || []);
}

const STATUS_KO = {
  in_transit: '운송 중 In transit', arrived: 'POD 도착 Arrived', not_found: '조회 결과 없음 Not found',
  blocked: '선사 사이트 조회 불가 Carrier site unavailable', not_departed: '선적 전 Not yet departed',
};

function fmtDate(s) { return s ? esc(String(s)) : '-'; }

export async function reportMail(env, t, r, prev) {
  const stop = await stopUrl(env, t);
  const etaChange = prev && prev.eta && r.eta && prev.eta !== r.eta
    ? ` <span style="color:#c0392b;font-weight:600">(어제 ${esc(prev.eta)} → 변경)</span>` : '';
  const events = (r.events || []).slice(-10).reverse().map((e) =>
    `<tr><td style="${cell};white-space:nowrap">${fmtDate(e.date)}</td><td style="${cell}">${esc(e.location || '')}</td><td style="${cell}">${esc(e.event || '')}</td><td style="${cell}">${esc([e.vessel, e.voyage].filter(Boolean).join(' / '))}</td></tr>`).join('');
  const final = r.status === 'arrived';
  const stopped = !final && t.state !== 'active';
  const body = `
<p style="font-size:14px;margin:0 0 10px"><b style="color:${final ? '#1f8a5b' : RED}">${esc(STATUS_KO[r.status] || r.status)}</b>${r.summary ? ' — ' + esc(r.summary) : ''}</p>
<table style="border-collapse:collapse;width:100%">
${row('MBL', esc(t.mbl))}${row('선사 Carrier', esc(CARRIERS[t.carrier] || t.carrier))}
${row('모선 Vessel / Voyage', esc([r.vessel, r.voyage].filter(Boolean).join(' / ') || '-'))}
${row('구간 POL → POD', esc([r.pol, r.pod].filter(Boolean).join(' → ') || '-'))}
${row('출항 ETD / ATD', `${fmtDate(r.etd)}${r.atd ? ' / <b>' + esc(r.atd) + '</b> (실제 actual)' : ''}`)}
${row('도착 ETA / ATA', `${fmtDate(r.eta)}${etaChange}${r.ata ? ' / <b>' + esc(r.ata) + '</b> (실제 actual)' : ''}`)}
${r.transshipment ? row('환적 T/S', esc(r.transshipment)) : ''}
</table>
${events ? `<h3 style="font-size:13px;margin:18px 0 6px">최근 이벤트 Latest events</h3>
<table style="border-collapse:collapse;width:100%"><tr>${['일시 Date', '장소 Location', '이벤트 Event', '모선 Vessel'].map((h) => `<td style="${cell};font-weight:600;background:#f6f3ee">${h}</td>`).join('')}</tr>${events}</table>` : ''}
<p style="font-size:12px;color:#6b6560;margin-top:14px">조회 ${esc(r.checkedAt || '')} KST${r.sourceUrl ? ` · <a href="${esc(r.sourceUrl)}" style="color:#6b6560">선사 화면 carrier page</a>` : ''}</p>
${final ? '<p style="font-size:13px">POD 도착이 확인되어 이 MBL 추적을 마칩니다. Tracking for this MBL is now finished.</p>'
    : stopped ? '<p style="font-size:13px">계속 조회되지 않아 추적을 마칩니다. 번호와 선사를 확인해 다시 등록해 주세요.</p>'
      : `<p><a href="${esc(stop)}" style="color:${RED};font-size:12px">추적 중지 Stop tracking</a></p>`}`;
  const tag = final ? '도착 Arrived' : r.status === 'not_found' ? '조회 안 됨' : r.status === 'blocked' ? '조회 불가' : `ETA ${r.eta || '-'}`;
  await sendMail(env, [t.email], `[LX Pantos] MBL ${t.mbl} ${tag} (${kstDate().slice(5).replace('-', '/')})`, frame(`MBL ${esc(t.mbl)} 일일 추적 보고`, body), t.cc || []);
}

// ---------- handlers ----------
export async function handleMbl(request, env, url) {
  const c = cors(request);

  if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/mbl')) return new Response(null, { status: 204, headers: c });

  if (url.pathname === '/api/mbl/carriers' && request.method === 'GET') return json(CARRIERS, 200, c);

  // New request from the homepage footer.
  if (url.pathname === '/api/mbl' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const mbl = normMbl(body.mbl);
    const carrier = String(body.carrier || '');
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[A-Z0-9]{6,25}$/.test(mbl)) return json({ error: 'MBL 번호를 확인해 주세요 (영문·숫자 6~25자).' }, 400, c);
    if (!CARRIERS[carrier]) return json({ error: '선사를 선택해 주세요.' }, 400, c);
    if (!/^[a-z0-9._%+-]+@lxpantos\.com$/.test(email)) return json({ error: '메일은 @lxpantos.com 주소만 가능합니다.' }, 400, c);
    const ccIn = (Array.isArray(body.cc) ? body.cc : String(body.cc || '').split(/[,;\s]+/))
      .map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    const cc = [...new Set(ccIn)].filter((e) => e !== email);
    const badCc = cc.filter((e) => !/^[a-z0-9._%+-]+@lxpantos\.com$/.test(e));
    if (badCc.length) return json({ error: `CC도 @lxpantos.com 주소만 가능합니다: ${badCc.join(', ')}` }, 400, c);
    if (cc.length > MAX_CC) return json({ error: `CC는 ${MAX_CC}명까지 넣을 수 있습니다.` }, 400, c);

    const ipKey = 'mrl:' + kstDate() + ':' + (request.headers.get('cf-connecting-ip') || 'local');
    const n = Number(await env.BOOKINGS.get(ipKey)) || 0;
    if (n >= PER_IP_DAY) return json({ error: '오늘 등록 가능 건수를 넘었습니다. 내일 다시 시도해 주세요.' }, 429, c);

    const all = (await listAll(env)).filter((t) => t.state === 'active');
    const dup = all.find((t) => t.mbl === mbl && t.email === email);
    if (dup) {
      const merged = [...new Set([...(dup.cc || []), ...cc])].slice(0, MAX_CC);
      if (merged.length !== (dup.cc || []).length) { dup.cc = merged; await put(env, dup); }
      return json({ ok: true, already: true, id: dup.id, cc: dup.cc || [], message: '이미 추적 중인 MBL입니다.' }, 200, c);
    }
    if (all.length >= ACTIVE_LIMIT) return json({ error: '현재 추적 건수가 많아 잠시 후 다시 시도해 주세요.' }, 429, c);
    if (all.filter((t) => t.email === email).length >= PER_EMAIL_LIMIT) return json({ error: `한 사람당 ${PER_EMAIL_LIMIT}건까지 추적할 수 있습니다.` }, 429, c);

    const t = {
      id: crypto.randomUUID(), mbl, carrier, email, cc, state: 'active',
      createdAt: new Date().toISOString(), lastReport: null, notFound: 0, reports: 0,
    };
    await put(env, t);
    await env.BOOKINGS.put(ipKey, String(n + 1), { expirationTtl: 2 * 86400 });
    try { await confirmMail(env, t); } catch (e) { console.error('confirm mail', e); }
    return json({ ok: true, id: t.id }, 201, c);
  }

  // Stop link in every mail.
  if (url.pathname === '/mbl/stop' && request.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    const ok = /^[0-9a-f-]{36}$/.test(id) && (url.searchParams.get('sig') || '') === await sign(env, id);
    const t = ok ? await env.BOOKINGS.get('t:' + id, 'json') : null;
    if (t && t.state === 'active') {
      t.state = 'stopped'; t.stoppedAt = new Date().toISOString();
      await put(env, t, KEEP_DONE_DAYS);
    }
    const msg = t ? `MBL ${esc(t.mbl)} 추적을 중지했습니다. Tracking stopped.` : '링크가 올바르지 않습니다. Invalid link.';
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LX Pantos</title><body style="font-family:Arial,sans-serif;padding:40px 20px;color:#1d1d1f"><p>${msg}</p><p><a href="https://lxpantosfashion.co.kr/" style="color:${RED}">lxpantosfashion.co.kr</a></p>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  // ----- tracker (Claude scheduled task) -----
  if (url.pathname === '/api/mbl/queue' && request.method === 'GET') {
    if (!tokenOk(request, env)) return json({ error: 'forbidden' }, 403);
    const now = Date.now();
    const list = [];
    for (const t of await listAll(env)) {
      if (t.state !== 'active') continue;
      if (now - Date.parse(t.createdAt) > MAX_DAYS * 86400e3) {
        t.state = 'expired'; await put(env, t, KEEP_DONE_DAYS); continue;
      }
      list.push({ id: t.id, mbl: t.mbl, carrier: t.carrier, createdAt: t.createdAt, last: t.lastReport, reportedToday: t.lastReportDate === kstDate() });
    }
    list.sort((a, b) => a.carrier.localeCompare(b.carrier) || a.createdAt.localeCompare(b.createdAt));
    return json({ today: kstDate(), count: list.length, items: list });
  }

  const rep = /^\/api\/mbl\/([0-9a-f-]{36})\/report$/.exec(url.pathname);
  if (rep && request.method === 'POST') {
    if (!tokenOk(request, env)) return json({ error: 'forbidden' }, 403);
    const t = await env.BOOKINGS.get('t:' + rep[1], 'json');
    if (!t) return json({ error: 'not found' }, 404);
    if (t.state !== 'active') return json({ ok: true, skipped: 'not active', state: t.state });
    if (t.lastReportDate === kstDate()) return json({ ok: true, skipped: 'already reported today' });
    const b = await request.json().catch(() => ({}));
    const status = String(b.status || '');
    if (!STATUS_KO[status]) return json({ error: 'status must be one of ' + Object.keys(STATUS_KO).join(', ') }, 400);
    const s = (v, n = 80) => (v == null ? '' : String(v).slice(0, n));
    const r = {
      status, summary: s(b.summary, 200), vessel: s(b.vessel), voyage: s(b.voyage), pol: s(b.pol), pod: s(b.pod),
      etd: s(b.etd, 20), atd: s(b.atd, 20), eta: s(b.eta, 20), ata: s(b.ata, 20), transshipment: s(b.transshipment, 120),
      sourceUrl: /^https:\/\//.test(b.sourceUrl || '') ? s(b.sourceUrl, 300) : '',
      events: (Array.isArray(b.events) ? b.events : []).slice(-20).map((e) => ({
        date: s(e.date, 20), location: s(e.location), event: s(e.event, 120), vessel: s(e.vessel), voyage: s(e.voyage, 30),
      })),
      checkedAt: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '),
    };
    const prev = t.lastReport;
    t.notFound = status === 'not_found' ? (t.notFound || 0) + 1 : 0;
    if (status === 'arrived') { t.state = 'arrived'; t.arrivedAt = new Date().toISOString(); }
    else if (t.notFound >= NOT_FOUND_STOP) { t.state = 'not_found'; }
    t.lastReport = r; t.lastReportDate = kstDate(); t.reports = (t.reports || 0) + 1;
    // "blocked" means we could not look today: tell the person only once in a row.
    const quiet = status === 'blocked' && prev && prev.status === 'blocked';
    if (!quiet) await reportMail(env, t, r, prev);
    await put(env, t, t.state === 'active' ? undefined : KEEP_DONE_DAYS);
    return json({ ok: true, mailed: !quiet, state: t.state });
  }

  return null;
}
