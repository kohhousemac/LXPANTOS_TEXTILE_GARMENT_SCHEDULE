// Builds the alert mail and sends it from Gmail (see sendMail below).

import { connect } from 'cloudflare:sockets';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const md = (iso) => (iso ? iso.slice(5).replace('-', '/') : '-');

const LOGO = 'https://lxpantosfashion.co.kr/mail-logo.png';
const RED = '#a50034';
const cell = 'padding:8px 10px;border-bottom:1px solid #e6e1d8';

// Link that opens the staff page on this booking; with `to`, it also offers
// to switch the booking onto that sailing.
function deepLink(pageUrl, booking, c) {
  const q = new URLSearchParams({ find: booking.bookingNo });
  if (c) q.set('to', `${c.vessel}|${c.voyage}`);
  return `${pageUrl}?${q}`;
}

const button = (href, label, small) => `<a href="${esc(href)}" style="display:inline-block;background:${RED};color:#ffffff;text-decoration:none;font-weight:600;border-radius:6px;${small ? 'padding:5px 12px;font-size:12px' : 'padding:11px 22px;font-size:14px'}">${label}</a>`;

export function alertMail(booking, ev, routeLabel, pageUrl) {
  const delayed = ev.delayDays > 0;
  const subject = `[Vessel change] ${booking.customer ? booking.customer + ' · ' : ''}${booking.bookingNo}`;
  const rows = ev.candidates.map((c) => `
    <tr>
      <td style="${cell}">${esc(c.carrier)}</td>
      <td style="${cell}"><b>${esc(c.vessel)}</b> ${esc(c.voyage)}${c.closedCarriers ? `<br><span style="color:#726d64;font-size:11px">${esc(c.closedCarriers)} closed</span>` : ''}</td>
      <td style="${cell}">${md(c.etd)}</td>
      <td style="${cell}">${md(c.eta)}</td>
      <td style="${cell};color:#2f9e44"><b>${c.daysEarlier}d earlier</b></td>
      <td style="${cell}">${button(deepLink(pageUrl, booking, c), 'Switch', true)}</td>
    </tr>`).join('');

  const html = `<div style="font-family:'Segoe UI',Pretendard,Arial,sans-serif;font-size:14px;color:#1c1a17;max-width:680px">
  <table role="presentation" width="100%" style="border-collapse:collapse;border-bottom:3px solid ${RED};margin-bottom:18px"><tr>
    <td style="padding:6px 0 12px"><img src="${LOGO}" alt="LX Pantos" width="132" height="27" style="display:block;border:0"></td>
    <td style="padding:6px 0 12px;text-align:right;color:#726d64;font-size:12px">Booking Vessel Alerts</td>
  </tr></table>
  <p style="margin:0 0 14px">${delayed ? 'The vessel on your booking has been delayed, and ' : ''}<b>${delayed ? 'another' : 'Another'} sailing on the same route arrives earlier</b> than your booked vessel. Please review switching to a different vessel.</p>
  <table style="border-collapse:collapse;margin:0 0 18px">
    <tr><td style="padding:3px 14px 3px 0;color:#726d64">Customer</td><td><b>${esc(booking.customer || '-')}</b></td></tr>
    <tr><td style="padding:3px 14px 3px 0;color:#726d64">Booking No.</td><td><b>${esc(booking.bookingNo)}</b>${booking.memo ? ' · ' + esc(booking.memo) : ''}</td></tr>
    <tr><td style="padding:3px 14px 3px 0;color:#726d64">Route</td><td>${esc(routeLabel)}</td></tr>
    <tr><td style="padding:3px 14px 3px 0;color:#726d64">Booked vessel</td><td>${esc(booking.carrier)} · <b>${esc(booking.vessel)}</b> ${esc(booking.voyage)}</td></tr>
    <tr><td style="padding:3px 14px 3px 0;color:#726d64">ETA</td><td>${delayed ? `At booking ${md(booking.origEta)} → now <b style="color:#c0392b">${md(ev.eta)} (+${ev.delayDays} days)</b>` : `<b>${md(ev.eta)}</b>`}</td></tr>
  </table>
  <p style="margin:0 0 6px"><b>Sailings arriving earlier</b></p>
  <table style="border-collapse:collapse;font-size:13px;margin-bottom:22px">
    <tr style="background:#faf9f6;text-align:left">
      <th style="padding:8px 10px">Carrier</th><th style="padding:8px 10px">Vessel / Voyage</th><th style="padding:8px 10px">ETD</th><th style="padding:8px 10px">ETA</th><th style="padding:8px 10px">Gain</th><th style="padding:8px 10px"></th>
    </tr>${rows}
  </table>
  ${button(deepLink(pageUrl, booking), 'Open booking')}
  <p style="color:#726d64;font-size:12px;margin-top:22px">"Switch" opens the staff page and asks you to confirm the change there. Carrier contracts, rates and space are not checked. Please confirm with the carrier before switching.</p>
</div>`;
  return { subject, html };
}

// ---------- sending: Gmail over SMTP (app password) ----------
// SMTP_USER / SMTP_PASS are a Gmail address and its 16-letter app password.
// MAIL_MODE=log only prints, for local testing.

const b64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const encWord = (str) => `=?UTF-8?B?${b64(str)}?=`;

function buildMessage(from, fromName, to, subject, html) {
  const body = b64(html).replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${encWord(fromName)} <${from}>`,
    `To: ${to.join(', ')}`,
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@lxpantosfashionstaff>`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

async function smtpSend(env, to, subject, html) {
  const host = env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(env.SMTP_PORT || 465);
  const socket = connect({ hostname: host, port }, { secureTransport: env.SMTP_TLS === 'off' ? 'off' : 'on' });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const dec = new TextDecoder();
  let buf = '';

  // Read one full SMTP reply (last line is "NNN text") and check its code.
  async function reply(expect) {
    for (;;) {
      const lines = buf.split('\r\n');
      const done = lines.slice(0, -1).find((l) => /^\d{3} /.test(l));
      if (done) {
        const end = buf.indexOf(done) + done.length + 2;
        const text = buf.slice(0, end); buf = buf.slice(end);
        if (!String(expect).split('|').includes(done.slice(0, 3))) throw new Error('SMTP: ' + text.trim().slice(0, 200));
        return text;
      }
      const { value, done: eof } = await reader.read();
      if (eof) throw new Error('SMTP: connection closed');
      buf += dec.decode(value, { stream: true });
    }
  }
  const send = (line) => writer.write(new TextEncoder().encode(line + '\r\n'));

  try {
    await reply(220);
    await send('EHLO lxpantosfashionstaff'); await reply(250);
    if (env.SMTP_PASS) {
      await send('AUTH LOGIN'); await reply(334);
      await send(btoa(env.SMTP_USER)); await reply(334);
      await send(btoa(env.SMTP_PASS)); await reply(235);
    }
    await send(`MAIL FROM:<${env.SMTP_USER}>`); await reply(250);
    for (const r of to) { await send(`RCPT TO:<${r}>`); await reply('250|251'); }
    await send('DATA'); await reply(354);
    await send(buildMessage(env.SMTP_USER, env.MAIL_FROM_NAME || 'LX Pantos Vessel Alerts', to, subject, html) + '\r\n.');
    await reply(250);
    await send('QUIT');
  } finally {
    socket.close().catch(() => {});
  }
}

export async function sendMail(env, to, subject, html) {
  if (env.MAIL_MODE !== 'gmail') {
    console.log(`[MAIL:log] to=${to.join(',')} subject=${subject}`);
    return { logged: true };
  }
  if (!env.SMTP_USER || !env.SMTP_PASS) throw new Error('Gmail is not set up (SMTP_USER / SMTP_PASS).');
  await smtpSend(env, to, subject, html);
  return { sent: true };
}
