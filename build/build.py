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
            <div class="lx-badges dash-skeleton" data-draw="badges-{route}" data-source="route_meta">—</div>
          </div>
          <button type="button" class="lx-btn lx-btn-sm lx-copy-table" data-route="{route}">Copy</button>
        </div>
        <div class="lx-table-wrap">
          <table class="lx-table" aria-label="{pol_name} to {pod_name} sailing schedule">
            <thead><tr><th>Carrier</th><th>Vessel</th><th>Voyage</th><th>ETD</th><th>ETA</th><th>T/T</th><th>Stage</th></tr></thead>
            <tbody class="dash-skeleton" data-draw="rows-{route}" data-source="{route}"></tbody>
          </table>
        </div>
        <div class="lx-berth-mini dash-skeleton" data-draw="berthmini-{route}" data-source="berthing_wait"></div>
      </section>
    </section>
'''

def asia_markup():
    out = ['''
  <section class="lx-group" id="net-asia" data-net="asia" role="tabpanel" aria-labelledby="tab-net-asia">
  <div class="lx-group" id="lx-holidays-group">
    <p class="lx-group-label">Upcoming holidays (ID · VN · KR · TW · CN)</p>
    <div class="lx-holidays" id="lx-holidays" data-draw="holidays-banner" data-source="holidays" aria-label="Upcoming Asia port-country holidays"></div>
  </div>

  <div class="lx-group">
    <p class="lx-group-label">Carrier colors</p>
    <div class="lx-legend" id="lx-legend" aria-label="Carrier color key"></div>
  </div>

  <div class="lx-group">
    <p class="lx-group-label">POL</p>
    <nav class="lx-nav" role="tablist" aria-label="Departure port">''']
    for i, (pol, _) in enumerate(ASIA):
        sel = 'true' if i == 0 else 'false'
        out.append(f'      <button class="lx-nav-btn" id="tab-pol-{pol}" role="tab" aria-selected="{sel}" aria-controls="polgroup-{pol}" data-pol="{pol}">{PORT[pol]}</button>')
    out.append('    </nav>\n  </div>')
    for i, (pol, pods) in enumerate(ASIA):
        h = ' hidden' if i else ''
        out.append(f'''
  <section class="lx-group" id="polgroup-{pol}" data-pol="{pol}" role="tabpanel" aria-labelledby="tab-pol-{pol}"{h}>
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

def med_markup():
    return '''
  <section class="lx-group" id="net-med" data-net="med" role="tabpanel" aria-labelledby="tab-net-med" hidden>
  <p class="lx-sub"><span class="lx-updated dash-skeleton" data-draw="last-updated-med" data-source="route_meta">—</span></p>

  <div class="lx-group">
    <p class="lx-group-label">POL</p>
    <nav class="lx-nav" role="tablist" aria-label="Departure port (Mediterranean)">
      <button class="lx-nav-btn" id="tab-med-pol-pus" role="tab" aria-selected="true" aria-controls="medpolgroup-pus" data-pol="medpus">Busan</button>
    </nav>
  </div>

  <section class="lx-group" id="medpolgroup-pus" data-pol="medpus" role="tabpanel" aria-labelledby="tab-med-pol-pus">
    <p class="lx-group-label">POD</p>
    <nav class="lx-subnav" role="tablist" aria-label="Destination port (ex Busan)">
      <button class="lx-subnav-btn" id="tab-med-pod-pus-ist" role="tab" aria-selected="true" aria-controls="medpage-pus-ist" data-pod="ist">Istanbul</button>
    </nav>
''' + lane_page('medpage-pus-ist', 'tab-med-pod-pus-ist', 'ist', 'krpus_trist', 'Busan', 'Istanbul', False) + '''
  </section>
  </section>
'''

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

    gt = rd('gt.html')
    marker = '  // ---- POL/POD port flags ----'
    assert marker in gt
    gt = gt.replace(marker, rd('nicaragua.js') + marker, 1)
    if "'Corinto (NI)'" not in gt:
        gt = gt.replace("'Caucedo (DO)': '🇩🇴',", "'Caucedo (DO)': '🇩🇴',\n      'Corinto (NI)': '🇳🇮',", 1)

    built = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d %H:%M KST')
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
    <span class="lx-updated-pill" id="hero-updated">—</span>
  </div>
</section>
<div class="lx-dash">
  <section class="lx-kpis" aria-label="Summary">
    <div class="lx-kpi"><p class="lx-kpi-label">운영 노선</p><p class="lx-kpi-value" id="kpi-lanes">—</p><p class="lx-kpi-note" id="kpi-lanes-note">&nbsp;</p></div>
    <div class="lx-kpi"><p class="lx-kpi-label">향후 7일 출항</p><p class="lx-kpi-value" id="kpi-week">—</p><p class="lx-kpi-note" id="kpi-week-note">&nbsp;</p></div>
    <div class="lx-kpi lx-kpi--ok"><p class="lx-kpi-label">신규 항차</p><p class="lx-kpi-value" id="kpi-new">—</p><p class="lx-kpi-note">최근 수집 대비 새로 잡힌 항차</p></div>
    <div class="lx-kpi lx-kpi--warn"><p class="lx-kpi-label">일정 변경</p><p class="lx-kpi-value" id="kpi-chg">—</p><p class="lx-kpi-note">ETD · ETA · T/T 변경 항차</p></div>
  </section>
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
{rd('main.html')}
{rd('calcs.html')}
{gt}
{rd('summary.html')}
</body>
</html>
'''
    (ROOT / 'index.html').write_text(page, encoding='utf-8')
    print('wrote index.html', len(page), 'bytes;', len(data), 'datasets')

if __name__ == '__main__':
    main()
