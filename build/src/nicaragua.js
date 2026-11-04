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

