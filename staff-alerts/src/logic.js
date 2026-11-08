// Pure comparison logic: is there a sailing on the same lane that now arrives
// before the vessel a booking is on? No I/O here, so it runs the same in the
// Worker and in node tests.

const DAY = 86400000;

// "11-15 (Sun)" -> "2026-11-15". The schedule has no year, so pick the year
// that puts the date closest to `today` (handles Dec -> Jan rollover).
export function parseDate(s, today) {
  const m = /^(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const mm = Number(m[1]), dd = Number(m[2]);
  const t = Date.parse(today + 'T00:00:00Z');
  const y0 = Number(today.slice(0, 4));
  let best = null;
  for (const y of [y0 - 1, y0, y0 + 1]) {
    const c = Date.UTC(y, mm - 1, dd);
    if (new Date(c).getUTCDate() !== dd) continue; // e.g. 02-29
    if (best === null || Math.abs(c - t) < Math.abs(best - t)) best = c;
  }
  return best === null ? null : new Date(best).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY);
}

export function todayKST(now = Date.now()) {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
}

const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
const normVoy = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
export const rowKey = (r) => norm(r.vessel) + '|' + normVoy(r.voyage);

// Find the booked sailing in today's lane rows: exact vessel+voyage first,
// otherwise the vessel name alone when it appears only once.
export function findBookedRow(rows, booking) {
  const v = norm(booking.vessel), voy = normVoy(booking.voyage);
  const exact = rows.find((r) => norm(r.vessel) === v && normVoy(r.voyage) === voy);
  if (exact) return exact;
  const byVessel = rows.filter((r) => norm(r.vessel) === v);
  return byVessel.length === 1 ? byVessel[0] : null;
}

// state: 'missing' | 'departed' | 'ok' | 'delayed' | 'alert'
export function evaluate(booking, rows, today) {
  const row = findBookedRow(rows, booking);
  if (!row) return { state: 'missing', candidates: [] };

  const etd = parseDate(row.etd, today);
  const eta = parseDate(row.eta, today);
  if (!etd || !eta) return { state: 'missing', candidates: [] };
  if (etd < today) return { state: 'departed', etd, eta, candidates: [] };

  const delayDays = booking.origEta ? daysBetween(booking.origEta, eta) : 0;
  const booked = rowKey(row);
  // Cargo is assumed ready only from the ETD chosen at booking time, so a
  // ship leaving before that is not a real alternative.
  const earliestEtd = booking.origEtd && booking.origEtd > today ? booking.origEtd : today;

  const candidates = rows
    .filter((r) => rowKey(r) !== booked && !r.bookingClosed && r.status !== 'departed')
    .map((r) => ({ r, etd: parseDate(r.etd, today), eta: parseDate(r.eta, today) }))
    .filter((c) => c.etd && c.eta && c.etd >= earliestEtd && c.eta < eta)
    .sort((a, b) => (a.eta < b.eta ? -1 : a.eta > b.eta ? 1 : a.etd < b.etd ? -1 : 1))
    .map((c) => ({
      carrier: c.r.carrier || '',
      vessel: c.r.vessel,
      voyage: c.r.voyage,
      etd: c.etd,
      eta: c.eta,
      tt: c.r.tt ?? null,
      closedCarriers: c.r.closedCarriers || '',
      daysEarlier: daysBetween(c.eta, eta),
    }));

  // Any sailing that can still take the cargo and arrives sooner is worth a
  // mail, whether or not the booked vessel itself slipped.
  const state = candidates.length ? 'alert' : delayDays > 0 ? 'delayed' : 'ok';
  // Mail again only when something new happens: the ETA slips further or a
  // different set of faster sailings shows up.
  const alertKey = state === 'alert'
    ? eta + '|' + candidates.map((c) => rowKey(c)).join(',')
    : null;

  return { state, etd, eta, delayDays, candidates, alertKey, carrier: row.carrier || '' };
}
