  // ---- Nicaragua (Corinto) sailings ----
  (function () {
    var table = document.getElementById('ni-sail-table');
    if (!table) return;
    var niPol = '';
    var niChips = Array.prototype.slice.call(document.querySelectorAll('#ni-pol-chips .chip'));
    niChips.forEach(function (b) {
      b.addEventListener('click', function () {
        niPol = b.dataset.niPol;
        niChips.forEach(function (c) { c.setAttribute('aria-pressed', String(c === b)); });
        dash.draw('rows-ni-corinto');
      });
    });

    var NI_CARRIER_COLOR = { MSK: '#0f5fa8', CMA: '#c0392b' };
    function niCarrierColor(carrier) {
      if (NI_CARRIER_COLOR[carrier]) return NI_CARRIER_COLOR[carrier];
      return (window.dash && dash.colors && dash.colors[0]) || '#6b7280';
    }

    function niParseKey(s) {
      if (!s) return Infinity;
      var m = /^(\d{2})-(\d{2})/.exec(s);
      if (!m) return Infinity;
      var mo = parseInt(m[1], 10);
      if (mo <= 3) mo += 12;
      return mo * 100 + parseInt(m[2], 10);
    }

    function niTsList(ts) {
      if (Array.isArray(ts)) return ts;
      if (typeof ts === 'string') {
        var s = ts.trim();
        if (!s) return [];
        try {
          var parsed = JSON.parse(s);
          if (Array.isArray(parsed)) return parsed;
        } catch (e) { /* not JSON */ }
        return s.split(/\s*(?:,|→|->)\s*/).filter(Boolean);
      }
      return [];
    }

    function niTsCell(ts) {
      var td = document.createElement('td');
      var list = niTsList(ts);
      if (!list.length) {
        td.appendChild(document.createTextNode('—'));
        return td;
      }
      list.forEach(function (p, i) {
        if (i > 0) td.appendChild(document.createTextNode(' → '));
        var pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = p;
        td.appendChild(pill);
      });
      return td;
    }

    function niBuildRow(r) {
      var tr = document.createElement('tr');
      tr.className = 'lx-row-carrier';
      tr.dataset.carrier = r.carrier;
      tr.style.setProperty('--row-tint', niCarrierColor(r.carrier));

      var tdPol = document.createElement('td');
      tdPol.textContent = r.pol;

      var tdVsl = document.createElement('td');
      tdVsl.className = 'lx-vessel';
      var tag = document.createElement('span');
      tag.className = 'lx-tag';
      tag.textContent = r.carrier;
      tdVsl.appendChild(tag);
      tdVsl.appendChild(document.createTextNode(' ' + r.vessel));

      var tdEtd = document.createElement('td');
      tdEtd.className = 'lx-date';
      tdEtd.textContent = r.etd;

      var tdEta = document.createElement('td');
      tdEta.className = 'lx-date';
      tdEta.textContent = r.eta;

      var tdTt = document.createElement('td');
      tdTt.className = 'lx-num';
      tdTt.textContent = r.tt;

      tr.appendChild(tdPol);
      tr.appendChild(tdVsl);
      tr.appendChild(tdEtd);
      tr.appendChild(tdEta);
      tr.appendChild(tdTt);
      tr.appendChild(niTsCell(r.ts));
      return tr;
    }

    function niRenderTable(el) {
      var g = dash.data('nicaragua_corinto');
      if (g.status === 'loading') {
        el.classList.add('dash-skeleton');
        return;
      }
      el.classList.remove('dash-skeleton');
      var emptyEl = document.getElementById('ni-sail-empty');
      if (g.status === 'error' || g.status === 'connect' || g.status === 'declined') {
        el.replaceChildren();
        var ftr = document.createElement('tr');
        ftr.className = 'lx-failstate-row';
        var ftd = document.createElement('td');
        ftd.colSpan = 6;
        ftd.textContent = 'Failed to load';
        ftr.appendChild(ftd);
        el.appendChild(ftr);
        if (emptyEl) emptyEl.hidden = true;
        return;
      }
      var rows = (g.data || []).filter(function (r) { return !niPol || r.pol === niPol; })
        .slice()
        .sort(function (a, b) { return niParseKey(a.etd) - niParseKey(b.etd); });
      if (!rows.length) {
        el.replaceChildren();
        if (emptyEl) emptyEl.hidden = false;
        return;
      }
      if (emptyEl) emptyEl.hidden = true;
      el.replaceChildren.apply(el, rows.map(niBuildRow));
    }

    dash.draw('rows-ni-corinto', function (el) { niRenderTable(el); });
  })();

  // ---- Corinto: transit time by origin, change history, routing by sailing ----
  (function () {
    var POL_ORDER = ['Busan', 'Shanghai', 'Yantian', 'Nansha', 'Ho Chi Minh'];
    function ttDays(s) {
      var m = /(\d+)\s*d(?:\s*(\d+)\s*h)?/.exec(s || '');
      return m ? (+m[1] + (m[2] ? +m[2] / 24 : 0)) : null;
    }
    function legDate(s) {
      var m = /^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s || '');
      if (!m) return null;
      var now = new Date(), best = null, bd = Infinity;
      [-1, 0, 1].forEach(function (y) {
        var d = new Date(now.getFullYear() + y, +m[1] - 1, +m[2], m[3] ? +m[3] : 0, m[4] ? +m[4] : 0);
        if (Math.abs(d - now) < bd) { bd = Math.abs(d - now); best = d; }
      });
      return best;
    }
    function dwell(arr, dep) {
      var a = legDate(arr), d = legDate(dep);
      if (!a || !d || d < a) return '';
      return Math.round((d - a) / 864e5 * 10) / 10 + 'd';
    }
    function tsList(ts) {
      if (Array.isArray(ts)) return ts;
      return String(ts || '').split(/\s*(?:,|→|->)\s*/).filter(Boolean);
    }

    // transit chart
    var box = document.getElementById('ni-tt-chart');
    function drawTT() {
      if (!box) return;
      var d = dash.data('nicaragua_corinto');
      box.replaceChildren();
      if (d.status !== 'ok' || !d.data.length) return;
      var by = {};
      d.data.forEach(function (r) { var v = ttDays(r.tt); if (v != null) (by[r.pol] = by[r.pol] || []).push(v); });
      var rows = Object.keys(by).sort(function (a, b) { return POL_ORDER.indexOf(a) - POL_ORDER.indexOf(b); }).map(function (p) {
        var v = by[p];
        return { pol: p, avg: Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length * 10) / 10,
                 min: Math.round(Math.min.apply(null, v)), max: Math.round(Math.max.apply(null, v)), n: v.length };
      });
      var W = box.clientWidth || 640, rowH = 30, top = 4, H = top + rows.length * rowH + 4;
      var svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', '0 0 ' + W + ' ' + H).attr('role', 'img').attr('aria-label', 'Average transit days to Corinto by origin port');
      var left = 96, right = 210;
      var x = d3.scaleLinear([0, d3.max(rows, function (r) { return r.max; }) || 1], [left, Math.max(left + 40, W - right)]);
      var g = svg.selectAll('g').data(rows).join('g').attr('transform', function (r, i) { return 'translate(0,' + (top + i * rowH) + ')'; });
      g.append('text').attr('x', left - 10).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('font-size', 12.5).attr('font-weight', 600).attr('fill', 'var(--color-fg)').text(function (r) { return r.pol; });
      g.append('rect').attr('x', left).attr('y', 7).attr('height', rowH - 14).attr('rx', 5).attr('fill', 'color-mix(in srgb, var(--color-fg) 7%, transparent)')
        .attr('width', function (r) { return Math.max(2, x(r.max) - left); });
      g.append('rect').attr('x', left).attr('y', 7).attr('height', rowH - 14).attr('rx', 5).attr('fill', '#0f5fa8')
        .attr('width', function (r) { return Math.max(2, x(r.avg) - left); });
      g.append('text').attr('x', function (r) { return x(r.max) + 8; }).attr('y', rowH / 2 + 4).attr('font-size', 12).attr('fill', 'var(--color-fg-muted)')
        .text(function (r) { return r.avg + 'd avg (' + r.min + '–' + r.max + 'd · ' + r.n + ' sailings)'; });
      box.style.minHeight = H + 'px';
    }
    window.gtRedraw = window.gtRedraw || {};
    window.gtRedraw.niTT = drawTT;
    dash.onData(drawTT);
    document.querySelectorAll('[data-ca-pod="ni"]').forEach(function (b) {
      b.addEventListener('click', function () { setTimeout(drawTT, 30); });
    });

    // change history
    var chg = document.getElementById('ni-chg-table');
    dash.onData(function () {
      if (!chg) return;
      var d = dash.data('changes_ni'), body = chg.tBodies[0];
      body.replaceChildren();
      if (d.status !== 'ok') return;
      d.data.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }).forEach(function (r) {
        var tr = body.insertRow();
        tr.dataset.key = r.id;
        if (r.vessel === 'All') tr.className = 'sys';
        [r.date, r.pol || '—', r.vessel].forEach(function (t) { tr.insertCell().textContent = t; });
        var c = tr.insertCell(); c.textContent = r.change;
        if (/Removed/.test(r.change)) c.className = 'late';
        else if (/New/.test(r.change)) c.className = 'early';
        else if (/changed/.test(r.change)) c.style.color = 'var(--color-warn)';
        tr.insertCell().textContent = r.old || '—';
        tr.insertCell().textContent = r.new || '—';
      });
    });

    // routing by sailing
    var pick = document.getElementById('ni-vsl-pick');
    var rot = document.getElementById('ni-rot-table');
    var chosen = '';
    if (pick) pick.addEventListener('change', function () { chosen = pick.value; drawRot(); });
    function drawRot() {
      if (!pick || !rot) return;
      var d = dash.data('nicaragua_corinto'), body = rot.tBodies[0];
      body.replaceChildren();
      if (d.status !== 'ok') return;
      var rows = d.data.slice().sort(function (a, b) { return (a.etd || '') < (b.etd || '') ? -1 : 1; });
      var keys = rows.map(function (r) { return r.pol + '|' + r.vessel; });
      if (!chosen || keys.indexOf(chosen) === -1) chosen = keys[0] || '';
      pick.replaceChildren.apply(pick, rows.map(function (r) { return new Option(r.etd.slice(0, 5) + ' · ' + r.pol + ' · ' + r.vessel, r.pol + '|' + r.vessel); }));
      pick.value = chosen;
      var r = rows[keys.indexOf(chosen)];
      if (!r) return;
      var legs = Array.isArray(r.legs) ? r.legs : [];
      var steps;
      if (legs.length) {
        // [port, role, arrival, departure, vessel, dwell]
        steps = [[legs[0].from || r.pol, 'POL', '—', legs[0].dep || r.etd, legs[0].vessel || r.vessel, '']];
        for (var i = 1; i < legs.length; i++) {
          steps.push([legs[i].from || '', 'T/S', legs[i - 1].arr || '—', legs[i].dep || '—', legs[i].vessel || '', dwell(legs[i - 1].arr, legs[i].dep)]);
        }
        var last = legs[legs.length - 1];
        steps.push([last.to || 'Corinto', 'POD', last.arr || r.eta, '—', '', '']);
      } else {
        steps = [[r.pol, 'POL', '—', r.etd, r.vessel, '']];
        tsList(r.ts).forEach(function (p) { steps.push([p, 'T/S', '—', '—', '', '']); });
        steps.push(['Corinto', 'POD', r.eta, '—', '', '']);
      }
      steps.forEach(function (s, i) {
        var tr = body.insertRow();
        var p = tr.insertCell(); p.textContent = String(s[0]).toUpperCase();
        if (i === 0 || i === steps.length - 1) p.className = 'v';
        tr.insertCell().textContent = s[1];
        tr.insertCell().textContent = s[2];
        tr.insertCell().textContent = s[3];
        var v = tr.insertCell(); v.textContent = s[4] || '—';
        if (s[5]) { var sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = 'T/S dwell ' + s[5]; v.appendChild(sub); }
      });
      var tr = body.insertRow(); tr.className = 'sys';
      var c = tr.insertCell(); c.colSpan = 5; c.textContent = 'Transit time ' + (r.tt || '—') + ' · ' + r.carrier + (legs.length ? '' : ' · 환적항 일정은 수집 대기 중');
    }
    dash.onData(drawRot);
  })();

