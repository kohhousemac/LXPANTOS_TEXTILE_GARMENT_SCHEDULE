import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseDate, evaluate } from '../src/logic.js';

const row = (vessel, voyage, etd, eta, extra = {}) => ({ carrier: 'SITC', vessel, voyage, etd, eta, status: 'unchanged', ...extra });
const today = '2026-11-08';

test('parseDate picks the nearest year', () => {
  assert.equal(parseDate('11-15 (Sun)', today), '2026-11-15');
  assert.equal(parseDate('01-03 (Sun)', '2026-12-28'), '2027-01-03');
  assert.equal(parseDate('12-30 (Wed)', '2027-01-02'), '2026-12-30');
  assert.equal(parseDate('', today), null);
});

test('booked vessel slipped and a faster sailing exists -> alert', () => {
  const rows = [
    row('BOOKED SHIP', '001S', '11-12 (Thu)', '11-20 (Fri)'),
    row('FAST SHIP', '777S', '11-13 (Fri)', '11-17 (Tue)'),
    row('SLOW SHIP', '888S', '11-13 (Fri)', '11-22 (Sun)'),
  ];
  const ev = evaluate({ vessel: 'booked ship', voyage: '001S', origEta: '2026-11-16' }, rows, today);
  assert.equal(ev.state, 'alert');
  assert.equal(ev.delayDays, 4);
  assert.deepEqual(ev.candidates.map((c) => [c.vessel, c.daysEarlier]), [['FAST SHIP', 3]]);
});

test('no delay but a faster ship exists -> alert', () => {
  const rows = [row('BOOKED SHIP', '001S', '11-12 (Thu)', '11-20 (Fri)'), row('FAST SHIP', '777S', '11-13 (Fri)', '11-17 (Tue)')];
  const ev = evaluate({ vessel: 'BOOKED SHIP', voyage: '001S', origEtd: '2026-11-12', origEta: '2026-11-20' }, rows, today);
  assert.equal(ev.state, 'alert');
  assert.equal(ev.delayDays, 0);
});

test('no delay and nothing faster -> ok', () => {
  const rows = [row('BOOKED SHIP', '001S', '11-12 (Thu)', '11-17 (Tue)'), row('SLOW SHIP', '777S', '11-13 (Fri)', '11-20 (Fri)')];
  assert.equal(evaluate({ vessel: 'BOOKED SHIP', voyage: '001S', origEtd: '2026-11-12', origEta: '2026-11-17' }, rows, today).state, 'ok');
});

test('closed, departed or already-sailed candidates are ignored -> delayed', () => {
  const rows = [
    row('BOOKED SHIP', '001S', '11-12 (Thu)', '11-20 (Fri)'),
    row('CLOSED SHIP', '1', '11-13 (Fri)', '11-15 (Sun)', { bookingClosed: true }),
    row('GONE SHIP', '2', '11-06 (Fri)', '11-14 (Sat)'),
    row('GONE TOO', '3', '11-09 (Mon)', '11-14 (Sat)', { status: 'departed' }),
  ];
  const ev = evaluate({ vessel: 'BOOKED SHIP', voyage: '001S', origEta: '2026-11-16' }, rows, today);
  assert.equal(ev.state, 'delayed');
  assert.equal(ev.candidates.length, 0);
});

test('ships leaving before the booked ETD are not suggested', () => {
  const rows = [
    row('BOOKED SHIP', '001S', '11-14 (Sat)', '11-24 (Tue)'),
    row('TOO EARLY', '1', '11-11 (Wed)', '11-18 (Wed)'),
    row('SAME DAY', '2', '11-12 (Thu)', '11-19 (Thu)'),
    row('LATER', '3', '11-15 (Sun)', '11-20 (Fri)'),
  ];
  const ev = evaluate({ vessel: 'BOOKED SHIP', voyage: '001S', origEtd: '2026-11-12', origEta: '2026-11-21' }, rows, today);
  assert.deepEqual(ev.candidates.map((c) => c.vessel), ['SAME DAY', 'LATER']);
});

test('booked vessel already departed / missing', () => {
  const rows = [row('BOOKED SHIP', '001S', '11-05 (Thu)', '11-20 (Fri)')];
  assert.equal(evaluate({ vessel: 'BOOKED SHIP', voyage: '001S', origEta: '2026-11-16' }, rows, today).state, 'departed');
  assert.equal(evaluate({ vessel: 'OTHER', voyage: 'X', origEta: '2026-11-16' }, rows, today).state, 'missing');
});

test('voyage renamed but vessel unique -> still matched', () => {
  const rows = [row('BOOKED SHIP', '001S-R', '11-12 (Thu)', '11-20 (Fri)')];
  assert.equal(evaluate({ vessel: 'BOOKED SHIP', voyage: '001S', origEta: '2026-11-20' }, rows, today).state, 'ok');
});

test('alertKey changes only when the situation changes', () => {
  const base = [row('BOOKED SHIP', '001S', '11-12 (Thu)', '11-20 (Fri)'), row('FAST SHIP', '777S', '11-13 (Fri)', '11-17 (Tue)')];
  const b = { vessel: 'BOOKED SHIP', voyage: '001S', origEta: '2026-11-16' };
  const k1 = evaluate(b, base, today).alertKey;
  assert.equal(evaluate(b, base.map((r) => ({ ...r })), today).alertKey, k1);
  const slipped = [row('BOOKED SHIP', '001S', '11-12 (Thu)', '11-22 (Sun)'), base[1]];
  assert.notEqual(evaluate(b, slipped, today).alertKey, k1);
});

test('runs on every real lane file without throwing', () => {
  const dir = new URL('../../build/data/', import.meta.url);
  const lanes = readdirSync(dir).filter((f) => /^[a-z]{5}_[a-z]{5}\.json$/.test(f));
  assert.ok(lanes.length > 20);
  for (const f of lanes) {
    const rows = JSON.parse(readFileSync(new URL(f, dir)));
    for (const r of rows) {
      const ev = evaluate({ vessel: r.vessel, voyage: r.voyage, origEta: '2026-11-01' }, rows, today);
      assert.ok(['ok', 'delayed', 'alert', 'departed', 'missing'].includes(ev.state), f);
      for (const c of ev.candidates) assert.ok(c.eta < ev.eta && c.etd >= today && c.daysEarlier > 0);
    }
  }
});
