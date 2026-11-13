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
function dayDiff(a, b) {
  const x = Date.parse(String(a).slice(0, 10)), y = Date.parse(String(b).slice(0, 10));
  return isNaN(x) || isNaN(y) ? null : Math.round((y - x) / 864e5);
}

// Vessel position block: map image (inline, cid:vesselmap) + what VesselFinder shows.
function posSection(r) {
  const p = r.position;
  if (!p) return '';
  const bits = [p.area, p.status, p.speed ? p.speed + ' kn' : '', p.course ? p.course + '°' : ''].filter(Boolean).join(' · ');
  return `<h3 style="font-size:13px;margin:18px 0 6px">모선 위치 Vessel position <span style="font-weight:400;color:#8a8580">(VesselFinder${p.received ? ', ' + esc(p.received) : ''}${p.approx ? ' · 무료 정보라 대략 위치' : ''})</span></h3>
${r.hasMap ? '<img src="cid:vesselmap" alt="Vessel position map" width="600" height="300" style="display:block;width:100%;max-width:600px;height:auto;border:1px solid #e6e1d8;border-radius:6px">' : ''}
<table style="border-collapse:collapse;width:100%;margin-top:6px">
${bits ? row('현재 Now', esc(bits)) : ''}${p.destination ? row('목적지 Destination', esc(p.destination)) : ''}${p.lastPort ? row('직전 항구 Last port', esc(p.lastPort)) : ''}
</table>
${p.url ? `<p style="font-size:12px;margin:6px 0 0"><a href="${esc(p.url)}" style="color:${RED}">VesselFinder에서 보기 View on VesselFinder</a></p>` : ''}`;
}

export async function reportMail(env, t, r, prev, inline = []) {
  const stop = await stopUrl(env, t);
  // Original (first reported) date struck through, new date beside it with the day difference.
  const first = t.first || {};
  const dateCell = (key, actual) => {
    const now = r[key], orig = first[key], before = prev && prev.status !== 'blocked' ? prev[key] : '';
    let html = fmtDate(now);
    if (orig && now && orig !== now) {
      const d = dayDiff(orig, now);
      const tagTxt = d == null ? '변경' : d > 0 ? `+${d}일 지연` : `${d}일 당김`;
      html = `<s style="color:#8a8580">${esc(orig)}</s> → <b style="color:#c0392b">${esc(now)}</b> <span style="color:#c0392b;font-size:12px">(${tagTxt})</span>`;
    }
    if (before && now && before !== now && before !== orig) html += ` <span style="color:#8a8580;font-size:12px">· 어제 ${esc(before)}</span>`;
    else if (before && now && before !== now && !(orig && orig !== now)) html += ` <span style="color:#c0392b;font-size:12px">(어제 ${esc(before)} → 변경)</span>`;
    if (r[actual]) html += ` / <b>${esc(r[actual])}</b> (실제 actual)`;
    return html;
  };
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
${row('출항 ETD / ATD', dateCell('etd', 'atd'))}
${row('도착 ETA / ATA', dateCell('eta', 'ata'))}
${r.transshipment ? row('환적 T/S', esc(r.transshipment)) : ''}
</table>
${posSection(r)}
${events ? `<h3 style="font-size:13px;margin:18px 0 6px">최근 이벤트 Latest events</h3>
<table style="border-collapse:collapse;width:100%"><tr>${['일시 Date', '장소 Location', '이벤트 Event', '모선 Vessel'].map((h) => `<td style="${cell};font-weight:600;background:#f6f3ee">${h}</td>`).join('')}</tr>${events}</table>` : ''}
<p style="font-size:12px;color:#6b6560;margin-top:14px">조회 ${esc(r.checkedAt || '')} KST${r.sourceUrl ? ` · <a href="${esc(r.sourceUrl)}" style="color:#6b6560">선사 화면 carrier page</a>` : ''}</p>
${final ? '<p style="font-size:13px">POD 도착이 확인되어 이 MBL 추적을 마칩니다. Tracking for this MBL is now finished.</p>'
    : stopped ? '<p style="font-size:13px">계속 조회되지 않아 추적을 마칩니다. 번호와 선사를 확인해 다시 등록해 주세요.</p>'
      : `<p><a href="${esc(stop)}" style="color:${RED};font-size:12px">추적 중지 Stop tracking</a></p>`}`;
  const etaMoved = first.eta && r.eta && first.eta !== r.eta;
  const tag = final ? '도착 Arrived' : r.status === 'not_found' ? '조회 안 됨' : r.status === 'blocked' ? '조회 불가'
    : etaMoved ? `ETA 변경 ${first.eta.slice(5, 10)}→${r.eta.slice(5, 10)}` : `ETA ${r.eta || '-'}`;
  await sendMail(env, [t.email], `[LX Pantos] MBL ${t.mbl} ${tag} (${kstDate().slice(5).replace('-', '/')})`, frame(`MBL ${esc(t.mbl)} 일일 추적 보고`, body), t.cc || [], inline);
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

  // Map drawing helper for the tracker task (public, no data).
  if (url.pathname === '/mbl/map.js' && request.method === 'GET') {
    return new Response(MAP_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=300' } });
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
    const pos = b.position && typeof b.position === 'object' ? b.position : null;
    if (pos) {
      r.position = {
        area: s(pos.area), status: s(pos.status), speed: s(pos.speed, 10), course: s(pos.course, 10), destination: s(pos.destination),
        lastPort: s(pos.lastPort, 120), received: s(pos.received, 40), approx: !!pos.approx,
        url: /^https:\/\/www\.vesselfinder\.com\//.test(pos.url || '') ? s(pos.url, 200) : '',
      };
    }
    // Map image: PNG data URL drawn by /mbl/map.js in the tracker's browser (kept out of KV; mailed inline only).
    const inline = [];
    const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.mapImage || ''));
    if (m && m[2].length < 900000) { inline.push({ cid: 'vesselmap', mime: 'image/' + m[1], data: m[2] }); r.hasMap = true; }
    const prev = t.lastReport;
    t.notFound = status === 'not_found' ? (t.notFound || 0) + 1 : 0;
    if (status === 'arrived') { t.state = 'arrived'; t.arrivedAt = new Date().toISOString(); }
    else if (t.notFound >= NOT_FOUND_STOP) { t.state = 'not_found'; }
    // Remember the first published ETD/ETA so later mails can show "original → new".
    t.first = t.first || {};
    if (!t.first.etd && r.etd) t.first.etd = r.etd;
    if (!t.first.eta && r.eta) t.first.eta = r.eta;
    t.lastReport = r; t.lastReportDate = kstDate(); t.reports = (t.reports || 0) + 1;
    // "blocked" means we could not look today: tell the person only once in a row.
    const quiet = status === 'blocked' && prev && prev.status === 'blocked';
    if (!quiet) await reportMail(env, t, r, prev, inline);
    await put(env, t, t.state === 'active' ? undefined : KEEP_DONE_DAYS);
    return json({ ok: true, mailed: !quiet, state: t.state });
  }

  return null;
}

// window.lxVesselMap({lat, lon, cog, name, zoom}) -> Promise<"data:image/png;base64,...">
// Draws OpenStreetMap tiles around the vessel position on a canvas with a heading marker.
const MAP_JS = `window.lxVesselMap = async function (o) {
  // 600x300 map drawn at 2x (tiles of zoom+1) - Esri Ocean basemap + English reference labels; JPEG to keep mail small.
  var S = 2, W = 600 * S, H = 300 * S, T = 256, z = (o.approx ? Math.min(o.zoom || 5, 5) : (o.zoom || 6)) + 1, lat = +o.lat, lon = +o.lon;
  var n = Math.pow(2, z), xt = (lon + 180) / 360 * n;
  var yt = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  var x0 = xt * T - W / 2, y0 = yt * T - H / 2;
  var c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d');
  g.fillStyle = '#c7dbe8'; g.fillRect(0, 0, W, H);
  async function layer(svc) {
    var jobs = [];
    for (var tx = Math.floor(x0 / T); tx <= Math.floor((x0 + W) / T); tx++) for (var ty = Math.floor(y0 / T); ty <= Math.floor((y0 + H) / T); ty++) {
      if (ty < 0 || ty >= n) continue;
      (function (tx, ty) { jobs.push(new Promise(function (res) {
        var im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = function () { g.drawImage(im, tx * T - x0, ty * T - y0, T, T); res(); }; im.onerror = function () { res(); };
        im.src = 'https://server.arcgisonline.com/ArcGIS/rest/services/' + svc + '/MapServer/tile/' + z + '/' + ty + '/' + (((tx % n) + n) % n);
      })); })(tx, ty);
    }
    await Promise.all(jobs);
  }
  await layer('Ocean/World_Ocean_Base');
  await layer('Ocean/World_Ocean_Reference');
  var cx = W / 2, cy = H / 2;
  if (o.approx) {
    g.beginPath(); g.arc(cx, cy, 34 * S, 0, 2 * Math.PI); g.fillStyle = 'rgba(165,0,52,.12)'; g.fill();
    g.lineWidth = 1.5 * S; g.strokeStyle = 'rgba(165,0,52,.6)'; g.setLineDash([5 * S, 4 * S]); g.stroke(); g.setLineDash([]);
  }
  g.save(); g.translate(cx, cy); g.rotate(((+o.cog || 0) * Math.PI) / 180); g.scale(S, S);
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 4;
  g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath();
  g.fillStyle = '#a50034'; g.fill(); g.shadowBlur = 0; g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke(); g.restore();
  if (o.name) {
    g.font = 'bold ' + 13 * S + 'px Arial, sans-serif'; var tw = g.measureText(o.name).width, bx = cx + 18 * S, by = cy - 26 * S;
    g.fillStyle = 'rgba(255,255,255,.95)'; g.strokeStyle = 'rgba(0,0,0,.15)'; g.lineWidth = S;
    g.beginPath(); g.rect(bx, by, tw + 14 * S, 22 * S); g.fill(); g.stroke();
    g.fillStyle = '#1d1d1f'; g.fillText(o.name, bx + 7 * S, by + 16 * S);
  }
  g.font = 10 * S + 'px Arial, sans-serif'; var at = 'Esri, GEBCO, NOAA · position: VesselFinder'; var aw = g.measureText(at).width;
  g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(W - aw - 10 * S, H - 16 * S, aw + 10 * S, 16 * S); g.fillStyle = '#555'; g.fillText(at, W - aw - 5 * S, H - 5 * S);
  return c.toDataURL('image/jpeg', 0.85);
};`;
