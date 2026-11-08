// Sends mail from the company shared mailbox through Microsoft Graph
// (app-only / client credentials). MAIL_MODE=log only prints the mail, for
// local testing before IT has set up the app registration.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const md = (iso) => (iso ? iso.slice(5).replace('-', '/') : '-');

export function alertMail(booking, ev, routeLabel, pageUrl) {
  const first = ev.candidates[0];
  const delayed = ev.delayDays > 0;
  const subject = `[Vessel change review] ${booking.customer ? booking.customer + ' · ' : ''}${booking.bookingNo} · ${booking.vessel}${delayed ? ` ETA +${ev.delayDays}d` : ''} → ${first.vessel} arrives ${first.daysEarlier}d earlier`;
  const rows = ev.candidates.map((c) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e6e1d8">${esc(c.carrier)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e6e1d8"><b>${esc(c.vessel)}</b> ${esc(c.voyage)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e6e1d8">${md(c.etd)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e6e1d8">${md(c.eta)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e6e1d8;color:#2f9e44"><b>${c.daysEarlier}d earlier</b></td>
      <td style="padding:6px 10px;border-bottom:1px solid #e6e1d8;color:#726d64">${c.closedCarriers ? esc(c.closedCarriers) + ' closed' : ''}</td>
    </tr>`).join('');

  const html = `<div style="font-family:'Segoe UI',Pretendard,Arial,sans-serif;font-size:14px;color:#1c1a17">
  <p>${delayed ? 'The vessel on your booking has been delayed, and ' : ''}<b>${delayed ? 'another' : 'Another'} sailing on the same route arrives earlier</b> than your booked vessel. Please review switching to a different vessel.</p>
  <table style="border-collapse:collapse;margin:12px 0">
    <tr><td style="padding:3px 12px 3px 0;color:#726d64">Customer</td><td><b>${esc(booking.customer || '-')}</b></td></tr>
    <tr><td style="padding:3px 12px 3px 0;color:#726d64">Booking No.</td><td><b>${esc(booking.bookingNo)}</b>${booking.memo ? ' · ' + esc(booking.memo) : ''}</td></tr>
    <tr><td style="padding:3px 12px 3px 0;color:#726d64">Route</td><td>${esc(routeLabel)}</td></tr>
    <tr><td style="padding:3px 12px 3px 0;color:#726d64">Booked vessel</td><td>${esc(booking.carrier)} · <b>${esc(booking.vessel)}</b> ${esc(booking.voyage)}</td></tr>
    <tr><td style="padding:3px 12px 3px 0;color:#726d64">ETA</td><td>${delayed ? `At booking ${md(booking.origEta)} → now <b style="color:#c0392b">${md(ev.eta)} (+${ev.delayDays} days)</b>` : `<b>${md(ev.eta)}</b>`}</td></tr>
  </table>
  <p style="margin:16px 0 4px"><b>Sailings arriving earlier</b></p>
  <table style="border-collapse:collapse;font-size:13px">
    <tr style="background:#faf9f6;text-align:left">
      <th style="padding:6px 10px">Carrier</th><th style="padding:6px 10px">Vessel / Voyage</th><th style="padding:6px 10px">ETD</th><th style="padding:6px 10px">ETA</th><th style="padding:6px 10px">Gain</th><th style="padding:6px 10px"></th>
    </tr>${rows}
  </table>
  <p style="color:#726d64;font-size:12px;margin-top:16px">Carrier contracts, rates and space are not checked. Please confirm with the carrier before switching.<br>
  Bookings: <a href="${esc(pageUrl)}">${esc(pageUrl)}</a></p>
</div>`;
  return { subject, html };
}

async function graphToken(env) {
  const res = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Graph token error: ' + (j.error_description || res.status));
  return j.access_token;
}

export async function sendMail(env, to, subject, html) {
  if (env.MAIL_MODE !== 'graph') {
    console.log(`[MAIL:log] to=${to.join(',')} subject=${subject}`);
    return { logged: true };
  }
  const token = await graphToken(env);
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MAIL_SENDER)}/sendMail`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  if (res.status !== 202) throw new Error('Graph sendMail ' + res.status + ': ' + (await res.text()).slice(0, 300));
  return { sent: true };
}
