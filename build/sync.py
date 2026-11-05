#!/usr/bin/env python3
"""Copy freshly downloaded dashboard dataset files into build/data.

Usage: python3 build/sync.py <dataset_id>=<path/to/blob.json> [...]

Each file must be a JSON array of row objects (or an object holding one
under rows/data/results). A file that fails to parse is skipped and the
previous build/data/<id>.json is kept, so one bad download never blanks a lane.
"""
import json, sys, datetime
from pathlib import Path

# datasets whose day-to-day changes are logged into their own change file
TRACK = {'nicaragua_corinto': 'changes_ni'}
KST = datetime.timezone(datetime.timedelta(hours=9))

def _key(r):
    return (r.get('pol') or '') + '|' + (r.get('vessel') or '')

def _ts(r):
    t = r.get('ts')
    return ' → '.join(t) if isinstance(t, list) else (t or '')

def _mmdd_date(s, today):
    try:
        m, d = int(s[0:2]), int(s[3:5])
    except Exception:
        return None
    best = None
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            c = datetime.date(y, m, d)
        except ValueError:
            continue
        if best is None or abs((c - today).days) < abs((best - today).days):
            best = c
    return best

RETAIN_DAYS = 14
NO_RETAIN = {'krpus_trist', 'krpus_egdam', 'krpus_egsok', 'krpus_egaly', 'krpus_egpsd'}

def is_lane(ds):
    a, _, b = ds.partition('_')
    return len(a) == 5 and len(b) == 5 and ds not in NO_RETAIN

def _rkey(r):
    return '|'.join(str(r.get(k) or '').strip().upper() for k in ('vessel', 'voyage'))

def _carriers(r):
    return {c.strip().upper() for c in str(r.get('carrier') or '').split('/') if c.strip()}

def retain_departed(old, new):
    """Collection drops sailings once their ETD has passed. Keep those rows
    (unchanged) until 14 days after their ETA so arrivals stay visible."""
    today = datetime.datetime.now(KST).date()
    have = {}
    for r in new:
        have.setdefault(_rkey(r), set()).update(_carriers(r))
    kept = []
    for r in old or []:
        # same vessel/voyage already in the new collection under an overlapping carrier
        # (e.g. "KMTC" now merged as "KMTC / PANOCEAN") -> not a departed leftover
        if _rkey(r) in have and (not _carriers(r) or _carriers(r) & have[_rkey(r)]):
            continue
        etd = _mmdd_date(r.get('etd', ''), today)
        eta = _mmdd_date(r.get('eta', ''), today)
        if not etd or etd >= today:
            continue  # not departed: genuinely removed from the schedule
        if eta and (today - eta).days > RETAIN_DAYS:
            continue  # arrived more than 14 days ago
        r = dict(r); r['status'] = 'departed'; r['changedFields'] = []
        kept.append(r)
    return new + kept, len(kept)

def track_changes(ds, old, new):
    out = DATA / f'{TRACK[ds]}.json'
    log = json.loads(out.read_text(encoding='utf-8')) if out.exists() else []
    today = datetime.datetime.now(KST).date()
    stamp = today.isoformat()
    if not log:
        log.append({'id': f'{stamp}-baseline', 'date': stamp, 'pol': '', 'vessel': 'All', 'change': 'Baseline collection', 'old': '', 'new': f'{len(new)} sailings'})
    o = {_key(r): r for r in (old or [])}
    n = {_key(r): r for r in new}
    rows = []
    for k, r in n.items():
        if k not in o:
            rows.append(('New sailing', r, '', r.get('etd', '')))
            continue
        p = o[k]
        for f, label in (('etd', 'ETD changed'), ('eta', 'ETA changed')):
            if (p.get(f) or '') != (r.get(f) or ''):
                rows.append((label, r, p.get(f) or '', r.get(f) or ''))
        if _ts(p) != _ts(r):
            rows.append(('T/S changed', r, _ts(p), _ts(r)))
    for k, p in o.items():
        if k in n:
            continue
        etd = _mmdd_date(p.get('etd', ''), today)
        if etd and etd < today:
            continue  # departed, not a schedule change
        rows.append(('Removed', p, p.get('etd', ''), ''))
    for i, (chg, r, a, b) in enumerate(rows):
        log.append({'id': f'{stamp}-{i}-{_key(r)}', 'date': stamp, 'pol': r.get('pol', ''), 'vessel': r.get('vessel', ''), 'change': chg, 'old': a, 'new': b})
    cutoff = (today - datetime.timedelta(days=90)).isoformat()
    log = [x for x in log if x['date'] >= cutoff]
    out.write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding='utf-8')
    return len(rows)

DATA = Path(__file__).resolve().parent / 'data'

def main(pairs):
    ok, skipped = [], []
    for pair in pairs:
        ds, _, src = pair.partition('=')
        try:
            v = json.loads(Path(src).read_text(encoding='utf-8'))
            if isinstance(v, dict):
                for k in ('rows', 'data', 'results'):
                    if isinstance(v.get(k), list):
                        v = v[k]; break
            if not isinstance(v, list):
                raise ValueError('not a list')
            target = DATA / f'{ds}.json'
            old = json.loads(target.read_text(encoding='utf-8')) if target.exists() else None
            if is_lane(ds):
                v, n_kept = retain_departed(old, v)
                if n_kept:
                    print(f'{ds}: kept {n_kept} departed sailing(s)')
            if ds in TRACK:
                n = track_changes(ds, old, v)
                print(f'{ds}: {n} change(s) logged to {TRACK[ds]}.json')
            target.write_text(json.dumps(v, ensure_ascii=False, indent=1), encoding='utf-8')
            ok.append(ds)
        except Exception as e:  # keep the previous copy
            skipped.append(f'{ds} ({e})')
    print('updated:', ', '.join(ok) or '-')
    print('kept previous:', ', '.join(skipped) or '-')

if __name__ == '__main__':
    main(sys.argv[1:])
