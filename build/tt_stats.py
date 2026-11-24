"""Average transit time (T/T) per lane over the last ~2 months of sailings.

Lane files only keep the current window (about 4 weeks ahead + 14 days after
arrival), so every build records each sailing's latest ETD / T/T into
build/data/tt_history.json. Averages are taken over sailings that departed in
the last 60 days, using the last T/T seen for each sailing (for a sailing that
has already left, that is the carrier's latest schedule, close to the actual).

    python3 build/tt_stats.py --seed   # rebuild history from git log (needs full clone)
"""
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'build' / 'data'
HIST = DATA / 'tt_history.json'
WINDOW_DAYS = 60
KEEP_DAYS = 90
SKIP = {'route_meta', 'port_calls_asia', 'port_calls', 'port_calls_cc', 'sailings', 'changes', 'changes_cc', 'changes_ni',
        'nicaragua_corinto', 'market_rate_40', 'market_rates', 'tt_history', 'holidays', 'ca_news', 'freight_rate',
        'berthing_log', 'berthing_wait', 'sitc_berth_log', 'whl_berth_log'}


def lane_rows(v):
    if isinstance(v, dict):
        for k in ('rows', 'data', 'results'):
            if isinstance(v.get(k), list):
                return v[k]
        return []
    return v if isinstance(v, list) else []


def to_date(mmdd, ref):
    """'11-26 (Thu)' -> date in the year closest to ref."""
    try:
        m, d = int(mmdd[:2]), int(mmdd[3:5])
    except (TypeError, ValueError):
        return None
    best = None
    for y in (ref.year - 1, ref.year, ref.year + 1):
        try:
            c = dt.date(y, m, d)
        except ValueError:
            continue
        if best is None or abs((c - ref).days) < abs((best - ref).days):
            best = c
    return best


def record(hist, route, rows, ref):
    for r in rows:
        if not isinstance(r, dict) or not r.get('vessel'):
            continue
        tt = r.get('tt')
        try:
            tt = float(tt)
        except (TypeError, ValueError):
            continue
        etd = to_date(r.get('etd'), ref)
        if not etd or tt <= 0 or tt > 90:
            continue
        key = '|'.join([route, str(r['vessel']), str(r.get('voyage', ''))])
        hist[key] = {'routeId': route, 'carrier': r.get('carrier', ''), 'vessel': r['vessel'], 'voyage': r.get('voyage', ''),
                     'etd': etd.isoformat(), 'tt': tt, 'seen': ref.isoformat()}


def load():
    try:
        return {f"{h['routeId']}|{h['vessel']}|{h['voyage']}": h for h in json.loads(HIST.read_text(encoding='utf-8'))}
    except Exception:
        return {}


def save(hist, today):
    cut = (today - dt.timedelta(days=KEEP_DAYS)).isoformat()
    rows = sorted((h for h in hist.values() if h['etd'] >= cut), key=lambda h: (h['routeId'], h['etd'], h['vessel']))
    HIST.write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    return rows


def update(today=None):
    """Record the current lane files into the history (called by build.py)."""
    today = today or dt.date.today()
    hist = load()
    for p in sorted(DATA.glob('*.json')):
        if p.stem in SKIP or '_' not in p.stem:
            continue
        try:
            record(hist, p.stem, lane_rows(json.loads(p.read_text(encoding='utf-8'))), today)
        except Exception as e:
            print('tt_stats: skip', p.stem, e)
    return save(hist, today)


# Lane rules that drop sailings from the tables (user instructions) also apply to the averages.
TT_MAX = {'vnsgn_cnsha': 10, 'vnhph_cnsha': 10}
SITC_UNDER = {'vnsgn_idjkt': 10}
SITC_MAX = {'cnsha_vnsgn': 10}  # 2026-11-24: SITC over 10 days (incl. CBX2 to Phuoc An, ~14 days) dropped


def carriers_now():
    """Carriers each lane uses today (from the current lane files)."""
    out = {}
    for p in DATA.glob('*.json'):
        if p.stem in SKIP or '_' not in p.stem:
            continue
        try:
            rows = lane_rows(json.loads(p.read_text(encoding='utf-8')))
        except Exception:
            continue
        out[p.stem] = {c.strip() for r in rows if isinstance(r, dict) for c in str(r.get('carrier', '')).split(' / ') if c.strip()}
    return out


def stats(rows, today=None):
    today = today or dt.date.today()
    lo = (today - dt.timedelta(days=WINDOW_DAYS)).isoformat()
    hi = today.isoformat()
    now = carriers_now()
    out = {}
    for h in rows:
        if not (lo <= h['etd'] <= hi):
            continue
        route = h['routeId']
        cs = [c.strip() for c in str(h['carrier']).split(' / ') if c.strip()]
        if now.get(route):
            cs = [c for c in cs if c in now[route]]
            if not cs:
                continue
        if route in TT_MAX and h['tt'] > TT_MAX[route]:
            continue
        if route in SITC_UNDER and cs == ['SITC'] and h['tt'] >= SITC_UNDER[route]:
            continue
        if route in SITC_MAX and cs == ['SITC'] and h['tt'] > SITC_MAX[route]:
            continue
        out.setdefault(route, []).append(dict(h, carrier=' / '.join(cs)))
    res = {}
    for route, hs in out.items():
        tts = [h['tt'] for h in hs]
        by = {}
        for h in hs:
            for c in str(h['carrier']).split(' / '):
                by.setdefault(c.strip(), []).append(h['tt'])
        res[route] = {'avg': sum(tts) / len(tts), 'n': len(tts), 'min': min(tts), 'max': max(tts),
                      'first': min(h['etd'] for h in hs),
                      'carriers': sorted(((c, sum(v) / len(v), len(v)) for c, v in by.items()), key=lambda x: -x[2])}
    return res


def seed():
    """Rebuild the history from every committed version of the lane files."""
    hist = {}
    log = subprocess.run(['git', '-C', str(ROOT), 'log', '--reverse', '--format=%H %cs', '--', 'build/data'],
                         capture_output=True, text=True, check=True).stdout.split('\n')
    for line in filter(None, log):
        sha, day = line.split()
        ref = dt.date.fromisoformat(day)
        files = subprocess.run(['git', '-C', str(ROOT), 'ls-tree', '--name-only', sha, 'build/data/'],
                               capture_output=True, text=True).stdout.split()
        for f in files:
            stem = Path(f).stem
            if not f.endswith('.json') or stem in SKIP or '_' not in stem:
                continue
            blob = subprocess.run(['git', '-C', str(ROOT), 'show', f'{sha}:{f}'], capture_output=True, text=True).stdout
            try:
                record(hist, stem, lane_rows(json.loads(blob)), ref)
            except Exception:
                pass
    rows = save(hist, dt.date.today())
    print('seeded', len(rows), 'sailings')


if __name__ == '__main__':
    if '--seed' in sys.argv:
        seed()
    rows = update()
    for k, v in sorted(stats(rows).items()):
        print(f"{k:14s} avg {v['avg']:5.1f}  n={v['n']:3d}  {v['min']:.0f}-{v['max']:.0f}  from {v['first']}  " +
              ' / '.join(f'{c} {a:.1f}({n})' for c, a, n in v['carriers']))
