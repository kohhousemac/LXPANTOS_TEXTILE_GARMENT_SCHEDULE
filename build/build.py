#!/usr/bin/env python3
"""Assemble the static homepage (index.html) for lxpantosfashion.co.kr.

Inputs:
  build/src/*            page pieces (CSS, d3, scripts, logo)
  build/data/<id>.json   one JSON file per dataset (array of row objects)
Output:
  index.html at repo root
"""
import json, re, sys, html, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'build' / 'src'
DATA = ROOT / 'build' / 'data'

def rd(name):
    return (SRC / name).read_text(encoding='utf-8')

# ---------------------------------------------------------------- lanes
PORT = {'hcm': 'Ho Chi Minh', 'hph': 'Haiphong', 'jkt': 'Jakarta', 'srg': 'Semarang',
        'pus': 'Busan', 'inc': 'Incheon', 'sha': 'Shanghai', 'skk': 'Shekou',
        'kel': 'Keelung', 'hkg': 'Hong Kong', 'ist': 'Istanbul'}

ASIA = [  # (pol code, [(pod code, route id), ...])
    ('hcm', [('jkt', 'vnsgn_idjkt'), ('srg', 'vnsgn_idsrg'), ('pus', 'vnsgn_krpus'), ('inc', 'vnsgn_krinc'), ('sha', 'vnsgn_cnsha')]),
    ('hph', [('jkt', 'vnhph_idjkt'), ('pus', 'vnhph_krpus'), ('inc', 'vnhph_krinc'), ('sha', 'vnhph_cnsha')]),
    ('jkt', [('hph', 'idjkt_vnhph'), ('sha', 'idjkt_cnsha'), ('inc', 'idjkt_krinc')]),
    ('sha', [('hph', 'cnsha_vnhph'), ('hcm', 'cnsha_vnsgn'), ('pus', 'cnsha_krpus'), ('inc', 'cnsha_krinc')]),
    ('skk', [('hcm', 'cnshk_vnsgn')]),
    ('kel', [('hcm', 'twkel_vnsgn'), ('hph', 'twkel_vnhph')]),
    ('hkg', [('hph', 'hkhkg_vnhph'), ('hcm', 'hkhkg_vnsgn'), ('jkt', 'hkhkg_idjkt')]),
    ('pus', [('hcm', 'krpus_vnsgn'), ('jkt', 'krpus_idjkt')]),
]

PC_IDS = {'cnsha_vnhph', 'cnsha_vnsgn', 'cnshk_vnsgn', 'hkhkg_vnhph', 'hkhkg_vnsgn', 'hkhkg_idjkt', 'krpus_vnsgn', 'krpus_idjkt', 'idjkt_vnhph', 'vnsgn_idjkt'}
PC_PANEL = '''        <div class="lx-pc-wrap"><p class="lx-mkt-title">Port call schedule<span class="lx-mkt-sub">모선별 기항 일정 · 위 스케줄 행을 누르면 바뀝니다</span></p><div class="lx-pc dash-skeleton" data-draw="pc-{route}" data-source="port_calls_asia"></div></div>'''

MKT_PANEL = '''        <div class="lx-mkt-wrap"><p class="lx-mkt-title">Market rate<span class="lx-mkt-sub">시장가 추이 · USD / 40ft</span></p><div class="lx-mkt dash-skeleton" data-draw="mkt-{route}" data-source="market_rate_40"></div></div>'''
def _mkt_ids():
    try: return {r.get('routeId') for r in json.loads((DATA / 'market_rate_40.json').read_text(encoding='utf-8'))}
    except Exception: return set()
MKT_IDS = _mkt_ids()

def lane_page(page_id, tab_id, pod, route, pol_name, pod_name, hidden):
    h = ' hidden' if hidden else ''
    return f'''
    <section class="lx-page" id="{page_id}" data-pod="{pod}" role="tabpanel" aria-labelledby="{tab_id}"{h}>
      <div class="lx-toolbar">
        <label class="lx-toggle">
          <input type="checkbox" class="lx-only-changes">
          <span>Show only new &amp; changed sailings</span>
        </label>
      </div>
      <section class="lx-lane" aria-labelledby="lane-{route}-h">
        <div class="lx-lane-head">
          <div class="lx-lane-head-left">
            <h2 id="lane-{route}-h"><span>{pol_name}</span><span class="lx-arrow">→</span><span>{pod_name}</span></h2>
            <span class="lx-code">{route.split("_")[0].upper()} <i>→</i> {route.split("_")[1].upper()}</span>
            <div class="lx-badges dash-skeleton" data-draw="badges-{route}" data-source="route_meta">—</div>
          </div>
          <button type="button" class="lx-btn lx-btn-sm lx-copy-table" data-route="{route}">Copy</button>
        </div>
        <div class="lx-table-wrap">
          <table class="lx-table" aria-label="{pol_name} to {pod_name} sailing schedule">
            <thead><tr><th>Carrier</th><th>Vessel</th><th>Voyage</th><th>ETD</th><th>ETA</th><th>T/T</th><th>Stage</th>{'<th>Calling order</th>' if route.startswith('krpus_') else ''}</tr></thead>
            <tbody class="dash-skeleton" data-draw="rows-{route}" data-source="{route}"></tbody>
          </table>
        </div>
{PC_PANEL.format(route=route) if not route.startswith(('krpus_trist', 'krpus_eg')) else ''}
{MKT_PANEL.format(route=route) if route in MKT_IDS else ''}
        <div class="lx-berth-mini dash-skeleton" data-draw="berthmini-{route}" data-source="berthing_wait"></div>
      </section>
    </section>
'''

LOCODE = {'egdam': 'dam', 'egsok': 'sok', 'egaly': 'aly', 'egpsd': 'psd', 'vnsgn': 'hcm', 'vnhph': 'hph', 'idjkt': 'jkt', 'idsrg': 'srg', 'krpus': 'pus', 'krinc': 'inc',
          'cnsha': 'sha', 'cnshk': 'skk', 'twkel': 'kel', 'hkhkg': 'hkg', 'trist': 'ist'}
PORT_LOCODE_NAME = {'hcm': 'Ho Chi Minh', 'hph': 'Haiphong', 'jkt': 'Jakarta', 'srg': 'Semarang', 'pus': 'Busan', 'inc': 'Incheon',
                    'sha': 'Shanghai', 'skk': 'Shekou', 'kel': 'Keelung', 'hkg': 'Hong Kong', 'ist': 'Istanbul'}

def merge_new_lanes():
    """Add lanes that exist in route_meta but not yet in ASIA (new lanes added on the dashboard)."""
    try:
        meta = json.loads((DATA / 'route_meta.json').read_text(encoding='utf-8'))
    except Exception:
        return
    known = {r for _, pods in ASIA for _, r in pods} | {r for _, pods in MED for _, r in pods}
    for row in meta:
        rid = row.get('routeId', '')
        if rid in known or row.get('group') == 'med' or not (DATA / f'{rid}.json').exists():
            continue
        a, _, b = rid.partition('_')
        pol, pod = LOCODE.get(a), LOCODE.get(b)
        if not pol or not pod:
            print('skip unknown lane', rid); continue
        for i, (p, pods) in enumerate(ASIA):
            if p == pol:
                pods.append((pod, rid)); break
        else:
            ASIA.append((pol, [(pod, rid)]))
        print('auto-added lane', rid)

COUNTRY = {'hcm': 0, 'hph': 0, 'jkt': 1, 'srg': 1, 'sha': 2, 'skk': 2, 'hkg': 2, 'pus': 3, 'inc': 3}
KR_ORDER = {'pus': 0, 'inc': 1}

BUSAN_NOTE = '''
    <p class="lx-pol-note">부산발 스케줄은 출항일(ETD)이 <b>토·일·월·화</b> 4일간인 항차만 확인하여 업데이트합니다.</p>'''

def asia_markup():
    # POD order inside each POL: Vietnam → Indonesia → China → Korea
    pols = [(pol, sorted(pods, key=lambda p: (COUNTRY.get(p[0], 9), KR_ORDER.get(p[0], 0)))) for pol, pods in ASIA]
    out = ['''
  <section class="lx-group" id="net-asia" data-net="asia" role="tabpanel" aria-labelledby="tab-net-asia">
  <div class="lx-infostrip">
  <div class="lx-group" id="lx-holidays-group">
    <p class="lx-group-label">Upcoming holidays (ID · VN · KR · TW · CN)</p>
    <div class="lx-holidays" id="lx-holidays" data-draw="holidays-banner" data-source="holidays" aria-label="Upcoming Asia port-country holidays"></div>
  </div>

  <div class="lx-group">
    <p class="lx-group-label">Carrier colors</p>
    <div class="lx-legend" id="lx-legend" aria-label="Carrier color key"></div>
  </div>
  </div>

  <div class="lx-group">
    <p class="lx-group-label">POL</p>
    <nav class="lx-nav" role="tablist" aria-label="Departure port">''']
    for i, (pol, _) in enumerate(pols):
        sel = 'true' if i == 0 else 'false'
        out.append(f'      <button class="lx-nav-btn" id="tab-pol-{pol}" role="tab" aria-selected="{sel}" aria-controls="polgroup-{pol}" data-pol="{pol}">{PORT[pol]}</button>')
    out.append('    </nav>\n  </div>')
    for i, (pol, pods) in enumerate(pols):
        h = ' hidden' if i else ''
        out.append(f'''
  <section class="lx-group" id="polgroup-{pol}" data-pol="{pol}" role="tabpanel" aria-labelledby="tab-pol-{pol}"{h}>{BUSAN_NOTE if pol == 'pus' else ''}
    <p class="lx-group-label">POD</p>
    <nav class="lx-subnav" role="tablist" aria-label="Destination port (ex {PORT[pol]})">''')
        for j, (pod, _) in enumerate(pods):
            sel = 'true' if j == 0 else 'false'
            out.append(f'      <button class="lx-subnav-btn" id="tab-pod-{pol}-{pod}" role="tab" aria-selected="{sel}" aria-controls="page-{pol}-{pod}" data-pod="{pod}">{PORT[pod]}</button>')
        out.append('    </nav>')
        for j, (pod, route) in enumerate(pods):
            out.append(lane_page(f'page-{pol}-{pod}', f'tab-pod-{pol}-{pod}', pod, route, PORT[pol], PORT[pod], j > 0))
        out.append('  </section>')
    out.append('  </section>')
    return '\n'.join(out)

MED = [('pus', [('ist', 'krpus_trist'), ('dam', 'krpus_egdam'), ('sok', 'krpus_egsok'), ('aly', 'krpus_egaly'), ('psd', 'krpus_egpsd')])]
PORT.update({'dam': 'Damietta', 'sok': 'Ain Sokhna', 'aly': 'Alexandria', 'psd': 'Port Said'})

def med_routes():
    return [r for _, pods in MED for _, r in pods if (DATA / f'{r}.json').exists()]

def med_markup():
    have = set(med_routes())
    out = ['''
  <section class="lx-group" id="net-med" data-net="med" role="tabpanel" aria-labelledby="tab-net-med" hidden>
  <p class="lx-sub"><span class="lx-updated dash-skeleton" data-draw="last-updated-med" data-source="route_meta">—</span></p>

  <div class="lx-group">
    <p class="lx-group-label">POL</p>
    <nav class="lx-nav" role="tablist" aria-label="Departure port (Mediterranean)">''']
    pols = [(pol, [p for p in pods if p[1] in have]) for pol, pods in MED]
    pols = [(pol, pods) for pol, pods in pols if pods]
    for i, (pol, _) in enumerate(pols):
        sel = 'true' if i == 0 else 'false'
        out.append(f'      <button class="lx-nav-btn" id="tab-med-pol-{pol}" role="tab" aria-selected="{sel}" aria-controls="medpolgroup-{pol}" data-pol="med{pol}">{PORT[pol]}</button>')
    out.append('    </nav>\n  </div>')
    for i, (pol, pods) in enumerate(pols):
        h = ' hidden' if i else ''
        out.append(f'''
  <section class="lx-group" id="medpolgroup-{pol}" data-pol="med{pol}" role="tabpanel" aria-labelledby="tab-med-pol-{pol}"{h}>
    <p class="lx-group-label">POD</p>
    <nav class="lx-subnav" role="tablist" aria-label="Destination port (ex {PORT[pol]})">''')
        for j, (pod, _) in enumerate(pods):
            sel = 'true' if j == 0 else 'false'
            out.append(f'      <button class="lx-subnav-btn" id="tab-med-pod-{pol}-{pod}" role="tab" aria-selected="{sel}" aria-controls="medpage-{pol}-{pod}" data-pod="{pod}">{PORT[pod]}</button>')
        out.append('    </nav>')
        for j, (pod, route) in enumerate(pods):
            out.append(lane_page(f'medpage-{pol}-{pod}', f'tab-med-pod-{pol}-{pod}', pod, route, PORT[pol], PORT[pod], j > 0))
        out.append('  </section>')
    out.append('  </section>')
    return '\n'.join(out)

NI_TAB = '      <button class="lx-subnav-btn" id="tab-ca-pod-ni" role="tab" aria-selected="false" aria-controls="ca-page-ni" data-ca-pod="ni">Corinto (NI)</button>\n'
NI_PAGE = '''
  <section class="lx-page" id="ca-page-ni" data-ca-pod="ni" role="tabpanel" aria-labelledby="tab-ca-pod-ni" hidden>
  <div class="gt">
    <header id="ni-top">
      <p class="gt-title">Corinto (Nicaragua) Schedules — Asia → Corinto</p>
    </header>

    <section class="card" id="ni-sailings">
      <h2>Sailings to Corinto</h2>
      <p class="note">Maersk(MSK) point-to-point 스케줄. POL을 선택하면 해당 출항지만 표시되고, 환적(T/S) 열에서 경유 항구를 한눈에 확인할 수 있습니다.</p>
      <div class="bar" id="ni-pol-chips" role="group" aria-label="Select origin port">
        <button type="button" class="chip" data-ni-pol="" aria-pressed="true">전체</button>
        <button type="button" class="chip" data-ni-pol="Busan" aria-pressed="false">Busan</button>
        <button type="button" class="chip" data-ni-pol="Shanghai" aria-pressed="false">Shanghai</button>
        <button type="button" class="chip" data-ni-pol="Yantian" aria-pressed="false">Yantian</button>
        <button type="button" class="chip" data-ni-pol="Nansha" aria-pressed="false">Nansha</button>
        <button type="button" class="chip" data-ni-pol="Ho Chi Minh" aria-pressed="false">Ho Chi Minh</button>
      </div>
      <div class="scroll">
        <table id="ni-sail-table" class="lx-table" aria-label="Asia to Corinto, Nicaragua sailing schedule">
          <thead><tr>
            <th>POL</th>
            <th>Vessel / Voyage</th>
            <th>ETD</th>
            <th>ETA</th>
            <th>T/T</th>
            <th>환적 (T/S)</th>
          </tr></thead>
          <tbody class="dash-skeleton" data-draw="rows-ni-corinto" data-source="nicaragua_corinto"></tbody>
        </table>
      </div>
      <p class="empty" id="ni-sail-empty" hidden>No sailings to display.</p>
    </section>

    <section class="card" id="ni-market"><div class="lx-mkt-wrap lx-mkt-card"><p class="lx-mkt-title">Shanghai → Corinto Market rate<span class="lx-mkt-sub">시장가 추이 · USD / 40ft</span></p><div class="lx-mkt dash-skeleton" data-draw="mkt-cnsha_nicto" data-source="market_rate_40"></div></div></section>

    <section class="card" id="ni-transit">
      <h2>Transit time by origin</h2>
      <p class="note">Average transit days from each POL to Corinto across the sailings listed above. The number beside each bar shows the fastest/slowest transit and number of sailings.</p>
      <div class="chart" id="ni-tt-chart" data-source="nicaragua_corinto" style="min-height: 140px"></div>
    </section>

    <div class="grid2">
      <section class="card" id="ni-changes">
        <h2>Schedule change history</h2>
        <p class="note">ETD/ETA and transshipment changes versus the prior day's collection, plus new and removed sailings.</p>
        <div class="scroll" style="max-height: 24rem">
          <table id="ni-chg-table" data-source="changes_ni" data-row-key="id">
            <thead><tr>
              <th data-field="date">Date</th>
              <th data-field="pol">POL</th>
              <th data-field="vessel">Vessel / Voyage</th>
              <th data-field="change">Change</th>
              <th data-field="old">Previous</th>
              <th data-field="new">New</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </section>

      <section class="card" id="ni-rotation">
        <h2>Routing by sailing</h2>
        <p class="note">Port-by-port arrival and departure for the selected sailing, including the vessel on each leg and dwell time at transshipment hubs.</p>
        <div class="bar"><select id="ni-vsl-pick" aria-label="Select sailing"></select></div>
        <div class="scroll" style="max-height: 24rem">
          <table id="ni-rot-table">
            <thead><tr><th>Port</th><th>Role</th><th>Arrival</th><th>Departure</th><th>Vessel / Voyage</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
  </section>
'''

def ca_markup():
    old = rd('ca_section.html')
    anchor = 'data-ca-pod="cc">Caucedo (DO)</button>\n'
    assert anchor in old, 'Caucedo tab anchor missing'
    old = old.replace(anchor, anchor + NI_TAB, 1)
    old = old.rstrip()
    assert old.endswith('</section>')
    return old[: -len('</section>')] + NI_PAGE + '  </section>\n'

# ---------------------------------------------------------------- shim
SHIM = r'''<script>
(function () {
  var cache = {}, calcs = {}, draws = {};
  function data(id) {
    if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id];
    var S = window.__LX_STATIC__ || {};
    if (Object.prototype.hasOwnProperty.call(S, id)) {
      var rows = S[id] || [];
      cache[id] = { status: 'ok', data: rows, rows: rows, columns: rows[0] ? Object.keys(rows[0]) : [], refreshing: false, meta: [] };
      return cache[id];
    }
    if (calcs[id]) {
      try {
        var r = calcs[id].fn.apply(null, calcs[id].inputs.map(function (i) { return data(i).data || []; }));
        cache[id] = { status: 'ok', data: r, rows: r, columns: r && r[0] ? Object.keys(r[0]) : [], refreshing: false, meta: [] };
      } catch (e) {
        console.error('calc failed', id, e);
        cache[id] = { status: 'error', data: [], message: String(e) };
      }
      return cache[id];
    }
    return { status: 'missing', data: [] };
  }
  function draw(name, fn) {
    if (fn) draws[name] = fn;
    var f = draws[name];
    if (!f) return;
    document.querySelectorAll('[data-draw="' + name + '"]').forEach(function (el) {
      try { f(el); } catch (e) { console.error('draw failed', name, e); }
    });
  }
  var listeners = [];
  function onData(fn) { listeners.push(fn); try { fn(); } catch (e) { console.error(e); } }
  var t;
  window.addEventListener('resize', function () {
    clearTimeout(t);
    t = setTimeout(function () { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }, 150);
  });
  window.dash = {
    data: data, draw: draw, calc: function (id, spec) { calcs[id] = spec; delete cache[id]; },
    loader: function () {}, onData: onData,
    setLink: function (x) { try { history.replaceState(null, '', '#' + x); } catch (e) {} },
    refresh: function () {}, params: function () { return {}; }, setParams: function () {}, resetParams: function () {},
    colors: ['#2f9e44', '#eab308', '#8a5a2e', '#3b82f6', '#ec4899', '#0891b2', '#7c3aed', '#ea580c']
  };
})();
</script>'''

def main():
    data = {}
    for p in sorted(DATA.glob('*.json')):
        v = json.loads(p.read_text(encoding='utf-8'))
        if isinstance(v, dict):
            for k in ('rows', 'data', 'results'):
                if isinstance(v.get(k), list):
                    v = v[k]; break
        data[p.stem] = v
    data_js = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

    merge_new_lanes()
    route_ids = [r for _, pods in ASIA for _, r in pods] + med_routes()
    gt = rd('gt.html')
    marker = '  // ---- POL/POD port flags ----'
    assert marker in gt
    gt = gt.replace(marker, rd('nicaragua.js') + marker, 1)
    if "'Corinto (NI)'" not in gt:
        gt = gt.replace("'Caucedo (DO)': '🇩🇴',", "'Caucedo (DO)': '🇩🇴',\n      'Corinto (NI)': '🇳🇮',", 1)

    built = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d %H:%M KST')
    now_kst = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    built_short = now_kst.strftime('%m/%d %H:%M')
    logo = rd('logo.txt').strip()

    page = f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LX Pantos Textile / Garment Schedule</title>
<meta name="description" content="LX Pantos Textile / Garment 선적 스케줄 (Asia · C.America · Mediterranean)">
<link rel="icon" href="{logo}">
{rd('base.css')}
{rd('page.css')}
{rd('extra.css')}
{rd('theme.css')}
</head>
<body>
<div class="lx-page-wrap">
<header class="lx-topbar">
  <div class="lx-topbar-in">
    <a class="lx-brand" href="./"><img src="{logo}" alt="LX Pantos"><span class="lx-brand-div"></span><span class="lx-brand-name">Textile / Garment Schedule</span></a>
  </div>
</header>
<section class="lx-hero">
  <svg class="lx-hero-routes" viewBox="0 0 720 320" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
    <defs><linearGradient id="lxArc" x1="0" x2="1"><stop offset="0" stop-color="#ff3d6e" stop-opacity="0"/><stop offset=".45" stop-color="#ff3d6e" stop-opacity=".9"/><stop offset="1" stop-color="#ffb3c6" stop-opacity=".5"/></linearGradient></defs>
    <path d="M120 250 C 260 90, 470 70, 640 150"/>
    <path d="M180 270 C 300 170, 420 160, 560 230"/>
    <path d="M90 200 C 230 40, 520 20, 700 90"/>
    <path d="M240 290 C 360 220, 500 220, 620 280"/>
    <g><circle cx="120" cy="250" r="3.5"/><circle class="halo" cx="120" cy="250" r="5"/></g>
    <g><circle cx="640" cy="150" r="3.5"/><circle class="halo" cx="640" cy="150" r="5" style="animation-delay:.9s"/></g>
    <g><circle cx="560" cy="230" r="3"/><circle class="halo" cx="560" cy="230" r="4.5" style="animation-delay:1.6s"/></g>
    <g><circle cx="700" cy="90" r="3"/></g><g><circle cx="180" cy="270" r="2.6"/></g><g><circle cx="620" cy="280" r="2.6"/></g>
  </svg>
  <div class="lx-hero-in">
    <p class="lx-hero-eyebrow">Asia · Central America · Mediterranean</p>
    <h1>LX Pantos <span class="thin">Textile &amp; Garment Schedule</span></h1>
    <p class="lx-hero-sub">주요 노선의 직항 선박 스케줄을 선사별로 모아 평일 매일 업데이트합니다.</p>
    <span class="lx-updated-pill" id="hero-updated" data-built="{built_short}">—</span>
  </div>
</section>
<div class="lx-dash">
  <div class="lx-group lx-netgroup">
    <p class="lx-group-label">Network</p>
    <nav class="lx-nav" role="tablist" aria-label="Network">
      <button class="lx-nav-btn" id="tab-net-asia" role="tab" aria-selected="true" aria-controls="net-asia" data-net="asia">Asia</button>
      <button class="lx-nav-btn" id="tab-net-ca" role="tab" aria-selected="false" aria-controls="net-ca" data-net="ca">C.America</button>
      <button class="lx-nav-btn" id="tab-net-med" role="tab" aria-selected="false" aria-controls="net-med" data-net="med">Mediterranean</button>
    </nav>
  </div>
  <header class="lx-head">
    <p class="lx-sub" id="lx-updated-row"><span class="lx-updated dash-skeleton" data-draw="last-updated" data-source="route_meta">—</span></p>
  </header>
{asia_markup()}
{ca_markup()}
{med_markup()}
</div>
<footer class="lx-footer">
  <div class="lx-footer-in">
    <div><img src="{logo}" alt="LX Pantos"><p>Textile / Garment Schedule</p><p>사이트 생성 {built}</p></div>
    <div><h3>업데이트</h3><p>평일 매일 오전, 각 선사 공개 스케줄 조회 결과를 반영합니다. 노선별 업데이트 날짜는 각 노선 상단 배지와 상단 업데이트 표시를 참고하세요.</p></div>
    <div><h3>안내</h3><p>표시된 일정은 선사 사정에 따라 변경될 수 있으며, 실제 부킹 시 선사 확정 스케줄을 확인해 주세요.</p></div>
  </div>
</footer>
</div>
{rd('d3.html')}
<script>window.__LX_STATIC__ = {data_js};</script>
{SHIM}
{rd('main.html').replace('__ROUTE_IDS__', json.dumps(route_ids))}
{rd('calcs.html')}
{gt}
{rd('pc.html')}
{rd('mkt.html')}
{rd('summary.html')}
</body>
</html>
'''
    (ROOT / 'index.html').write_text(page, encoding='utf-8')
    print('wrote index.html', len(page), 'bytes;', len(data), 'datasets')

if __name__ == '__main__':
    main()
