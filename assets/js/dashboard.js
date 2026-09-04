/* Analytics dashboard — fetches /api/{ga4,search-console,cloudflare} and
 * renders charts. Append ?demo=1 to the URL to preview with sample data. */
(function () {
  'use strict';

  var TOKEN_KEY = 'mm_dash_token';
  var SERIES_1 = '#0d9488';
  var SERIES_2 = '#c98500';
  var DEMO = new URLSearchParams(location.search).has('demo');

  var state = { days: 28, loading: false, data: { ga4: null, gsc: null, cf: null, insights: null } };
  var tooltip = document.getElementById('chart-tooltip');

  /* ---------- formatting ---------- */

  function fmtNum(n) {
    if (n == null) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return Math.round(n).toLocaleString('en-US');
  }

  function fmtDur(seconds) {
    if (!seconds) return '0s';
    var m = Math.floor(seconds / 60);
    var s = Math.round(seconds % 60);
    return m ? m + 'm ' + s + 's' : s + 's';
  }

  function fmtPct(x) {
    return (x * 100).toFixed(1) + '%';
  }

  function fmtDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ---------- API ---------- */

  function apiFetch(path) {
    var headers = {};
    var token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(path, { headers: headers }).then(function (res) {
      if (res.status === 401) {
        showLogin(!!token);
        throw { auth: true };
      }
      return res.json().then(function (body) {
        if (!res.ok) throw body;
        return body;
      });
    });
  }

  /* ---------- login overlay ---------- */

  var overlay = document.getElementById('login-overlay');
  var loginForm = document.getElementById('login-form');
  var loginError = document.getElementById('login-error');

  function showLogin(failed) {
    overlay.hidden = false;
    loginError.hidden = !failed;
    document.getElementById('login-token').focus();
  }

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var value = document.getElementById('login-token').value.trim();
    if (!value) return;
    localStorage.setItem(TOKEN_KEY, value);
    overlay.hidden = true;
    loadAll();
  });

  /* ---------- line chart ---------- */

  var NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var node = document.createElementNS(NS, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function niceMax(maxValue) {
    if (maxValue <= 4) return 4;
    var rawStep = maxValue / 4;
    var mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    var candidates = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < candidates.length; i++) {
      var step = candidates[i] * mag;
      if (step >= rawStep) return step * 4;
    }
    return mag * 40;
  }

  /**
   * opts: { labels: [iso dates], series: [{ name, color, values }], area }
   * Renders an SVG line chart with hairline grid, legend (>=2 series),
   * crosshair + tooltip, and a data-table fallback.
   */
  function renderLineChart(slot, opts) {
    slot.textContent = '';
    var labels = opts.labels;
    var series = opts.series;

    if (!labels || labels.length < 2) {
      slot.appendChild(el('p', 'chart-empty', 'Not enough data yet — check back soon.'));
      return;
    }

    if (series.length >= 2) {
      var legend = el('div', 'chart-legend');
      series.forEach(function (s) {
        var key = el('span', 'key', '');
        var swatch = el('i');
        swatch.style.color = s.color;
        key.appendChild(swatch);
        key.appendChild(document.createTextNode(s.name));
        legend.appendChild(key);
      });
      slot.appendChild(legend);
    }

    // Size the viewBox to the rendered card so axis text keeps a true
    // pixel size on both wide and half-width cards.
    var W = Math.max(300, slot.clientWidth || 600);
    var H = Math.round(Math.max(180, Math.min(260, W * 0.38)));
    var pad = { top: 12, right: 16, bottom: 26, left: 44 };
    var iw = W - pad.left - pad.right;
    var ih = H - pad.top - pad.bottom;

    var maxVal = 0;
    series.forEach(function (s) {
      s.values.forEach(function (v) { if (v > maxVal) maxVal = v; });
    });
    var yMax = niceMax(maxVal);
    var ticks = [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax];

    var x = function (i) { return pad.left + (i / (labels.length - 1)) * iw; };
    var y = function (v) { return pad.top + ih - (v / yMax) * ih; };

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });

    // gridlines + y ticks
    ticks.forEach(function (t) {
      svg.appendChild(svgEl('line', {
        x1: pad.left, x2: W - pad.right, y1: y(t), y2: y(t),
        stroke: t === 0 ? '#C9CDD4' : '#ECEAE2', 'stroke-width': 1,
        'shape-rendering': 'crispEdges',
      }));
      var lbl = svgEl('text', {
        x: pad.left - 8, y: y(t) + 3.5, 'text-anchor': 'end',
        'font-size': 10.5, fill: '#8A8F99',
        style: 'font-variant-numeric: tabular-nums',
      });
      lbl.textContent = fmtNum(t);
      svg.appendChild(lbl);
    });

    // x labels — at most 6, evenly spaced
    var stepX = Math.max(1, Math.ceil(labels.length / 6));
    for (var i = 0; i < labels.length; i += stepX) {
      var tx = svgEl('text', {
        x: x(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : 'middle',
        'font-size': 10.5, fill: '#8A8F99',
      });
      tx.textContent = fmtDate(labels[i]);
      svg.appendChild(tx);
    }

    // area wash (single series only) + lines
    series.forEach(function (s) {
      var d = s.values.map(function (v, idx) {
        return (idx ? 'L' : 'M') + x(idx).toFixed(1) + ' ' + y(v).toFixed(1);
      }).join(' ');
      if (opts.area && series.length === 1) {
        svg.appendChild(svgEl('path', {
          d: d + ' L' + x(s.values.length - 1).toFixed(1) + ' ' + y(0) + ' L' + x(0) + ' ' + y(0) + ' Z',
          fill: s.color, 'fill-opacity': 0.1, stroke: 'none',
        }));
      }
      svg.appendChild(svgEl('path', {
        d: d, fill: 'none', stroke: s.color, 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }));
    });

    // hover layer: crosshair + markers + tooltip
    var cross = svgEl('line', {
      y1: pad.top, y2: pad.top + ih, stroke: '#C9CDD4', 'stroke-width': 1, visibility: 'hidden',
    });
    svg.appendChild(cross);
    var markers = series.map(function (s) {
      var c = svgEl('circle', {
        r: 5, fill: s.color, stroke: '#FFFFFF', 'stroke-width': 2, visibility: 'hidden',
      });
      svg.appendChild(c);
      return c;
    });

    var hit = svgEl('rect', {
      x: pad.left, y: pad.top, width: iw, height: ih, fill: 'transparent',
    });
    svg.appendChild(hit);

    function showAt(idx, clientX, clientY) {
      var px = x(idx);
      cross.setAttribute('x1', px);
      cross.setAttribute('x2', px);
      cross.setAttribute('visibility', 'visible');
      markers.forEach(function (m, si) {
        m.setAttribute('cx', px);
        m.setAttribute('cy', y(series[si].values[idx]));
        m.setAttribute('visibility', 'visible');
      });
      tooltip.textContent = '';
      tooltip.appendChild(el('span', 'tt-date', fmtDate(labels[idx])));
      series.forEach(function (s) {
        var row = el('span', 'tt-row');
        var key = el('i', 'tt-key');
        key.style.borderTopColor = s.color;
        row.appendChild(key);
        row.appendChild(document.createTextNode(s.name));
        row.appendChild(el('b', 'tt-value', (opts.fmt || fmtNum)(s.values[idx])));
        tooltip.appendChild(row);
      });
      tooltip.hidden = false;
      var tw = tooltip.offsetWidth;
      var left = clientX + 14;
      if (left + tw > window.innerWidth - 8) left = clientX - tw - 14;
      tooltip.style.left = left + 'px';
      tooltip.style.top = Math.max(8, clientY - tooltip.offsetHeight - 10) + 'px';
    }

    function hide() {
      cross.setAttribute('visibility', 'hidden');
      markers.forEach(function (m) { m.setAttribute('visibility', 'hidden'); });
      tooltip.hidden = true;
    }

    hit.addEventListener('pointermove', function (e) {
      var rect = svg.getBoundingClientRect();
      var relX = ((e.clientX - rect.left) / rect.width) * W;
      var idx = Math.round(((relX - pad.left) / iw) * (labels.length - 1));
      idx = Math.min(labels.length - 1, Math.max(0, idx));
      showAt(idx, e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', hide);

    slot.appendChild(svg);

    // data table fallback (tooltips enhance, never gate)
    var details = el('details', 'chart-table');
    details.appendChild(el('summary', null, 'View data table'));
    var table = document.createElement('table');
    var head = document.createElement('tr');
    head.appendChild(el('th', null, 'Date'));
    series.forEach(function (s) { head.appendChild(el('th', null, s.name)); });
    table.appendChild(head);
    labels.forEach(function (label, idx) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, fmtDate(label)));
      series.forEach(function (s) {
        tr.appendChild(el('td', null, (opts.fmt || fmtNum)(s.values[idx])));
      });
      table.appendChild(tr);
    });
    details.appendChild(table);
    slot.appendChild(details);
  }

  /* ---------- bar list ---------- */

  /** rows: [{ label, value, sub, href }] — single-hue meter rows. */
  function renderBarList(slot, rows, valueFmt) {
    slot.textContent = '';
    if (!rows || !rows.length) {
      slot.appendChild(el('p', 'chart-empty', 'No data for this period yet.'));
      return;
    }
    var max = rows.reduce(function (m, r) { return Math.max(m, r.value); }, 0) || 1;
    var list = el('div', 'bar-list');
    rows.slice(0, 10).forEach(function (r) {
      var row = el('div', 'bar-row');
      var top = el('div', 'bar-top');
      var label = el('span', 'bar-label');
      if (r.href) {
        var a = document.createElement('a');
        a.href = r.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = r.label;
        label.appendChild(a);
      } else {
        label.textContent = r.label;
      }
      label.title = r.label;
      var value = el('span', 'bar-value', (valueFmt || fmtNum)(r.value));
      if (r.sub) value.appendChild(el('span', 'bar-sub', r.sub));
      top.appendChild(label);
      top.appendChild(value);
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill');
      fill.style.width = Math.max(1.5, (r.value / max) * 100) + '%';
      track.appendChild(fill);
      row.appendChild(top);
      row.appendChild(track);
      list.appendChild(row);
    });
    slot.appendChild(list);
  }

  /* ---------- error / setup notices ---------- */

  function renderNotice(cardIds, message, notConfigured) {
    cardIds.forEach(function (id, i) {
      var card = document.getElementById(id);
      if (!card) return;
      var slot = card.querySelector('[data-chart], [data-list], [data-brief], [data-table]');
      slot.textContent = '';
      if (i > 0) {
        slot.appendChild(el('p', 'chart-empty', notConfigured ? 'Not connected yet' : 'Unavailable'));
        return;
      }
      var notice = el('div', 'setup-notice');
      notice.appendChild(el('strong', null, notConfigured ? 'Not connected yet. ' : 'Temporarily unavailable. '));
      notice.appendChild(document.createTextNode(message + ' '));
      if (notConfigured) {
        var hint = document.createElement('span');
        hint.appendChild(document.createTextNode('Follow the steps in '));
        hint.appendChild(el('code', null, 'ANALYTICS-SETUP.md'));
        hint.appendChild(document.createTextNode(' in the repository to connect this source.'));
        notice.appendChild(hint);
      }
      slot.appendChild(notice);
    });
  }

  /* ---------- insights (Objectives section) ---------- */

  var INSIGHTS_CARDS = ['card-brief', 'card-weekday', 'card-exec', 'card-articles', 'card-posts'];

  function fmtDelta(delta) {
    if (delta == null) return '';
    var pct = Math.round(delta * 100);
    return (pct >= 0 ? '\u2191 ' : '\u2193 ') + Math.abs(pct) + '% vs prior period';
  }

  function renderFunnel(funnel) {
    var grid = document.getElementById('funnel-grid');
    grid.textContent = '';
    var stages = [
      {
        label: 'Reach', value: funnel.reach.value, delta: funnel.reach.delta,
        sub: fmtNum(funnel.reach.searchImpressions) + ' search impressions \u00b7 ' + fmtNum(funnel.reach.linkedinSessions) + ' LinkedIn visits',
      },
      {
        label: 'Read', value: funnel.read.articleViews, delta: funnel.read.delta,
        sub: fmtDur(funnel.read.avgEngagementSeconds) + ' avg. engagement \u00b7 ' + fmtNum(funnel.read.engagedSessions) + ' engaged sessions',
      },
      {
        label: 'Connect', value: funnel.connect.value, delta: funnel.connect.delta,
        sub: fmtNum(funnel.connect.contactViews) + ' contact views \u00b7 ' + fmtNum(funnel.connect.linkedinProfileClicks) + ' LinkedIn profile clicks',
      },
    ];
    stages.forEach(function (st, i) {
      var tile = el('div', 'funnel-stage');
      tile.appendChild(el('span', 'kpi-label', st.label));
      tile.appendChild(el('span', 'kpi-value', fmtNum(st.value)));
      tile.appendChild(el('span', 'kpi-sub', st.sub));
      var deltaText = fmtDelta(st.delta);
      if (deltaText) tile.appendChild(el('span', 'funnel-delta', deltaText));
      grid.appendChild(tile);
      if (i < stages.length - 1) grid.appendChild(el('div', 'funnel-arrow', '\u2192'));
    });
  }

  function renderInsights(data) {
    var briefSlot = document.querySelector('#card-brief [data-brief]');
    briefSlot.textContent = '';
    var list = el('ul', 'brief-list');
    (data.brief || []).forEach(function (line) {
      list.appendChild(el('li', null, line));
    });
    briefSlot.appendChild(list);
    briefSlot.appendChild(el('p', 'brief-source',
      data.briefSource === 'claude'
        ? 'Written by Claude from this period\u2019s data.'
        : 'Computed from this period\u2019s data. Add an ANTHROPIC_API_KEY secret for a Claude-written brief.'));

    renderFunnel(data.funnel);

    renderBarList(listSlot('card-weekday'), data.weekday.pattern.map(function (d) {
      return { label: d.day, value: Math.round(d.avgSessions * 10) / 10 };
    }), function (v) { return v.toFixed(1); });

    var execSlot = listSlot('card-exec');
    execSlot.textContent = '';
    if (data.search) {
      var stat = el('p', 'exec-stat');
      stat.appendChild(el('b', null, Math.round(data.search.executiveShare * 100) + '%'));
      stat.appendChild(document.createTextNode(' of search impressions are executive-intent queries \u00b7 '));
      stat.appendChild(el('b', null, Math.round(data.search.brandShare * 100) + '%'));
      stat.appendChild(document.createTextNode(' are searches for your name.'));
      execSlot.appendChild(stat);
      var holder = el('div');
      execSlot.appendChild(holder);
      renderBarList(holder, data.search.topExecutiveQueries.map(function (q) {
        return { label: q.query, value: q.impressions, sub: 'pos. ' + q.position.toFixed(1) };
      }));
    } else {
      execSlot.appendChild(el('p', 'chart-empty', data.searchUnavailable
        ? 'Search Console unavailable: ' + data.searchUnavailable
        : 'Connect Search Console to classify your search reach.'));
    }

    var tableSlot = document.querySelector('#card-articles [data-table]');
    tableSlot.textContent = '';
    if (!data.articles.length) {
      tableSlot.appendChild(el('p', 'chart-empty', 'No article traffic in this period yet.'));
    } else {
      var wrap = el('div', 'table-wrap');
      var table = document.createElement('table');
      table.className = 'insight-table';
      var head = document.createElement('tr');
      ['Article', 'Views', 'From LinkedIn', 'Search impr.', 'Search clicks', 'Avg. read'].forEach(function (h) {
        head.appendChild(el('th', null, h));
      });
      table.appendChild(head);
      data.articles.forEach(function (a) {
        var tr = document.createElement('tr');
        var titleCell = document.createElement('td');
        var link = document.createElement('a');
        link.href = a.path;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = a.title || a.path;
        titleCell.appendChild(link);
        tr.appendChild(titleCell);
        [fmtNum(a.pageviews), fmtNum(a.linkedinSessions), fmtNum(a.searchImpressions),
         fmtNum(a.searchClicks), fmtDur(a.avgEngagementSeconds)].forEach(function (v) {
          tr.appendChild(el('td', null, v));
        });
        table.appendChild(tr);
      });
      wrap.appendChild(table);
      tableSlot.appendChild(wrap);
    }

    var postSlot = listSlot('card-posts');
    postSlot.textContent = '';
    if (data.linkedin) {
      var l = data.linkedin;
      var lift = l.avgSessionsOnOtherDays
        ? Math.round(((l.avgSessionsOnPostDays - l.avgSessionsOnOtherDays) / l.avgSessionsOnOtherDays) * 100)
        : null;
      var summary = el('p', 'exec-stat');
      summary.appendChild(document.createTextNode('Post days average '));
      summary.appendChild(el('b', null, l.avgSessionsOnPostDays.toFixed(1)));
      summary.appendChild(document.createTextNode(' sessions vs '));
      summary.appendChild(el('b', null, l.avgSessionsOnOtherDays.toFixed(1)));
      summary.appendChild(document.createTextNode(' on other days' + (lift !== null ? ' (' + (lift >= 0 ? '+' : '') + lift + '% lift)' : '') + '.'));
      postSlot.appendChild(summary);
      var holder2 = el('div');
      postSlot.appendChild(holder2);
      renderBarList(holder2, l.perPost.map(function (post) {
        var subBits = [];
        if (post.impressions != null) subBits.push(fmtNum(post.impressions) + ' LinkedIn impr.');
        if (post.clickThroughRate != null) subBits.push(fmtPct(post.clickThroughRate) + ' click-through');
        return {
          label: fmtDate(post.date) + (post.topic ? ' \u00b7 ' + post.topic : ''),
          value: post.linkedinSessionsNext48h,
          sub: subBits.join(' \u00b7 ') || 'LinkedIn sessions within 48h',
        };
      }));
    } else {
      var note = el('div', 'setup-notice');
      note.appendChild(el('strong', null, 'No LinkedIn posts logged for this period. '));
      note.appendChild(document.createTextNode(
        'LinkedIn\u2019s API doesn\u2019t expose personal post analytics, so this card runs on a post log you keep: after posting, tell a Claude Code session the date, linked article, and impression count \u2014 it updates the log and this card starts correlating posts to site traffic.'));
      postSlot.appendChild(note);
    }
  }

  /* ---------- renderers per source ---------- */

  var kpiGrid = document.getElementById('kpi-grid');

  function renderKpis(ga4, gsc) {
    kpiGrid.textContent = '';
    var tiles = [
      {
        label: 'Visitors',
        value: ga4 ? fmtNum(ga4.totals.users) : '—',
        sub: ga4 ? fmtNum(ga4.totals.sessions) + ' sessions' : 'Connect GA4',
      },
      {
        label: 'Pageviews',
        value: ga4 ? fmtNum(ga4.totals.pageviews) : '—',
        sub: 'Last ' + state.days + ' days',
      },
      {
        label: 'Avg. session length',
        value: ga4 ? fmtDur(ga4.totals.avgSessionDuration) : '—',
        sub: 'Time on site per visit',
      },
      {
        label: 'Google search clicks',
        value: gsc ? fmtNum(gsc.totals.clicks) : '—',
        sub: gsc
          ? fmtNum(gsc.totals.impressions) + ' impressions · ' + fmtPct(gsc.totals.ctr) + ' CTR'
          : 'Connect Search Console',
      },
    ];
    tiles.forEach(function (t) {
      var tile = el('div', 'kpi');
      tile.appendChild(el('span', 'kpi-label', t.label));
      tile.appendChild(el('span', 'kpi-value', t.value));
      tile.appendChild(el('span', 'kpi-sub', t.sub));
      kpiGrid.appendChild(tile);
    });
  }

  function chartSlot(cardId) {
    return document.querySelector('#' + cardId + ' [data-chart]');
  }
  function listSlot(cardId) {
    return document.querySelector('#' + cardId + ' [data-list]');
  }

  function renderGa4(data) {
    renderLineChart(chartSlot('card-ga4-traffic'), {
      labels: data.timeseries.map(function (r) { return r.date; }),
      series: [
        { name: 'Visitors', color: SERIES_1, values: data.timeseries.map(function (r) { return r.users; }) },
        { name: 'Pageviews', color: SERIES_2, values: data.timeseries.map(function (r) { return r.pageviews; }) },
      ],
    });
    renderBarList(listSlot('card-ga4-pages'), data.topPages.map(function (p) {
      return {
        label: p.title || p.path,
        value: p.pageviews,
        sub: fmtDur(p.avgEngagementSeconds) + ' avg. read',
        href: 'https://murthymalapaka.com' + p.path,
      };
    }));
    renderBarList(listSlot('card-ga4-channels'), data.channels.map(function (c) {
      return { label: c.label, value: c.sessions, sub: fmtNum(c.users) + ' visitors' };
    }));
    renderBarList(listSlot('card-ga4-sources'), data.sources.map(function (s) {
      return { label: s.label, value: s.sessions, sub: fmtNum(s.users) + ' visitors' };
    }));
    updateLivePill(data.realtimeUsers);
  }

  function renderGsc(data) {
    var labels = data.timeseries.map(function (r) { return r.date; });
    renderLineChart(chartSlot('card-gsc-clicks'), {
      labels: labels,
      series: [{ name: 'Clicks', color: SERIES_1, values: data.timeseries.map(function (r) { return r.clicks; }) }],
      area: true,
    });
    renderLineChart(chartSlot('card-gsc-impressions'), {
      labels: labels,
      series: [{ name: 'Impressions', color: SERIES_1, values: data.timeseries.map(function (r) { return r.impressions; }) }],
      area: true,
    });
    renderBarList(listSlot('card-gsc-queries'), data.topQueries.map(function (q) {
      return { label: q.label, value: q.clicks, sub: fmtNum(q.impressions) + ' impr. · pos. ' + q.position.toFixed(1) };
    }));
    renderBarList(listSlot('card-gsc-pages'), data.topPages.map(function (p) {
      return { label: p.label, value: p.clicks, sub: fmtNum(p.impressions) + ' impr.' };
    }));
  }

  function renderCf(data) {
    renderLineChart(chartSlot('card-cf-traffic'), {
      labels: data.timeseries.map(function (r) { return r.date; }),
      series: [
        { name: 'Visits', color: SERIES_1, values: data.timeseries.map(function (r) { return r.visits; }) },
        { name: 'Pageviews', color: SERIES_2, values: data.timeseries.map(function (r) { return r.pageviews; }) },
      ],
    });
    renderBarList(listSlot('card-cf-referrers'), data.topReferrers.map(function (r) {
      return { label: r.label, value: r.pageviews };
    }));
    renderBarList(listSlot('card-cf-countries'), data.countries.map(function (c) {
      return { label: c.label, value: c.pageviews };
    }));
    renderBarList(listSlot('card-cf-devices'), data.devices.map(function (d) {
      return { label: d.label, value: d.pageviews };
    }));
  }

  var livePill = document.getElementById('live-pill');
  function updateLivePill(count) {
    if (count == null) { livePill.hidden = true; return; }
    document.getElementById('live-count').textContent = fmtNum(count);
    livePill.hidden = false;
  }

  /* ---------- loading ---------- */

  var GA4_CARDS = ['card-ga4-traffic', 'card-ga4-pages', 'card-ga4-channels', 'card-ga4-sources'];
  var GSC_CARDS = ['card-gsc-clicks', 'card-gsc-impressions', 'card-gsc-queries', 'card-gsc-pages'];
  var CF_CARDS = ['card-cf-traffic', 'card-cf-referrers', 'card-cf-countries', 'card-cf-devices'];

  function setLoading(on) {
    state.loading = on;
    kpiGrid.classList.toggle('is-loading', on);
    document.querySelectorAll('.dash-card').forEach(function (card) {
      card.classList.toggle('is-loading', on);
    });
  }

  function loadAll() {
    if (DEMO) { renderDemo(); return; }
    if (!localStorage.getItem(TOKEN_KEY)) { showLogin(false); return; }
    setLoading(true);

    var results = { ga4: null, gsc: null };

    var pGa4 = apiFetch('/api/ga4?days=' + state.days).then(function (data) {
      results.ga4 = data;
      state.data.ga4 = data;
      renderGa4(data);
    }).catch(function (err) {
      state.data.ga4 = null;
      if (!err || !err.auth) renderNotice(GA4_CARDS, err && err.error || 'Request failed.', err && err.notConfigured);
    });

    var pGsc = apiFetch('/api/search-console?days=' + state.days).then(function (data) {
      results.gsc = data;
      state.data.gsc = data;
      renderGsc(data);
    }).catch(function (err) {
      state.data.gsc = null;
      if (!err || !err.auth) renderNotice(GSC_CARDS, err && err.error || 'Request failed.', err && err.notConfigured);
    });

    var pIns = apiFetch('/api/insights?days=' + state.days).then(function (data) {
      state.data.insights = data;
      renderInsights(data);
    }).catch(function (err) {
      if (!err || !err.auth) renderNotice(INSIGHTS_CARDS, err && err.error || 'Request failed.', err && err.notConfigured);
    });

    var pCf = apiFetch('/api/cloudflare?days=' + state.days).then(function (data) {
      state.data.cf = data;
      renderCf(data);
    }).catch(function (err) {
      state.data.cf = null;
      if (!err || !err.auth) renderNotice(CF_CARDS, err && err.error || 'Request failed.', err && err.notConfigured);
    });

    Promise.allSettled([pGa4, pGsc, pCf, pIns]).then(function () {
      renderKpis(results.ga4, results.gsc);
      setLoading(false);
      document.getElementById('dash-updated').textContent =
        'Last ' + state.days + ' days · updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    });
  }

  // Poll only the realtime active-user count every 60s.
  function pollRealtime() {
    if (DEMO || !localStorage.getItem(TOKEN_KEY)) return;
    apiFetch('/api/ga4?realtime=1').then(function (data) {
      updateLivePill(data.realtimeUsers);
    }).catch(function () { /* keep last value */ });
  }
  setInterval(pollRealtime, 60000);

  /* ---------- controls ---------- */

  document.querySelectorAll('.range-picker button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.range-picker button').forEach(function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      state.days = parseInt(btn.dataset.days, 10);
      loadAll();
    });
  });

  document.getElementById('refresh-btn').addEventListener('click', loadAll);

  // Re-render charts from cached data when the viewport width changes
  // (rotation, window resize) — no refetch needed.
  var lastWidth = window.innerWidth;
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (Math.abs(window.innerWidth - lastWidth) < 40) return;
      lastWidth = window.innerWidth;
      if (DEMO) { renderDemo(); return; }
      if (state.data.ga4) renderGa4(state.data.ga4);
      if (state.data.gsc) renderGsc(state.data.gsc);
      if (state.data.cf) renderCf(state.data.cf);
      if (state.data.insights) renderInsights(state.data.insights);
    }, 250);
  });

  /* ---------- demo data (preview without credentials) ---------- */

  function renderDemo() {
    var labels = [];
    var seedA = [], seedB = [], clicks = [], imps = [];
    for (var i = state.days - 1; i >= 0; i--) {
      var d = new Date(Date.now() - i * 86400000);
      labels.push(d.toISOString().slice(0, 10));
      var wave = Math.sin((state.days - i) / 3.1) * 14;
      var users = Math.max(4, Math.round(38 + wave + ((i * 7919) % 23) - 10));
      seedA.push(users);
      seedB.push(Math.round(users * (1.7 + ((i * 104729) % 10) / 30)));
      clicks.push(Math.max(0, Math.round(6 + Math.sin((state.days - i) / 2.6) * 4 + ((i * 31) % 5))));
      imps.push(Math.round(220 + Math.sin((state.days - i) / 3.4) * 90 + ((i * 61) % 40)));
    }
    var ts = labels.map(function (date, idx) {
      return { date: date, users: seedA[idx], pageviews: seedB[idx], sessions: Math.round(seedA[idx] * 1.2), avgSessionDuration: 145 };
    });
    var totalUsers = seedA.reduce(function (a, b) { return a + b; }, 0);
    var totalViews = seedB.reduce(function (a, b) { return a + b; }, 0);
    var totalClicks = clicks.reduce(function (a, b) { return a + b; }, 0);
    var totalImps = imps.reduce(function (a, b) { return a + b; }, 0);

    renderGa4({
      realtimeUsers: 3,
      totals: { users: totalUsers, pageviews: totalViews, sessions: Math.round(totalUsers * 1.2), avgSessionDuration: 148 },
      timeseries: ts,
      topPages: [
        { path: '/insights/ticket-factories/', title: 'Why Are We Still Building Ticket Factories?', pageviews: 412, users: 350, avgEngagementSeconds: 205 },
        { path: '/insights/ai-native-it-operations/', title: 'AI-Native IT Operations', pageviews: 288, users: 241, avgEngagementSeconds: 173 },
        { path: '/', title: 'Home', pageviews: 265, users: 236, avgEngagementSeconds: 64 },
        { path: '/insights/platform-intelligence/', title: 'Platform Intelligence', pageviews: 176, users: 158, avgEngagementSeconds: 188 },
        { path: '/about/', title: 'About', pageviews: 122, users: 114, avgEngagementSeconds: 92 },
      ],
      channels: [
        { label: 'Organic Social', sessions: 342, users: 300 },
        { label: 'Organic Search', sessions: 289, users: 259 },
        { label: 'Direct', sessions: 214, users: 190 },
        { label: 'Referral', sessions: 88, users: 76 },
      ],
      sources: [
        { label: 'linkedin.com', sessions: 331, users: 291 },
        { label: 'google', sessions: 289, users: 259 },
        { label: '(direct)', sessions: 214, users: 190 },
        { label: 'forbes.com', sessions: 52, users: 47 },
        { label: 'bing', sessions: 21, users: 20 },
      ],
    });
    renderGsc({
      totals: { clicks: totalClicks, impressions: totalImps, ctr: totalClicks / totalImps, position: 18.4 },
      timeseries: labels.map(function (date, idx) {
        return { date: date, clicks: clicks[idx], impressions: imps[idx], ctr: 0.03, position: 18 };
      }),
      topQueries: [
        { label: 'ai native operating model', clicks: 42, impressions: 610, ctr: 0.068, position: 6.2 },
        { label: 'murthy malapaka', clicks: 31, impressions: 120, ctr: 0.25, position: 1.1 },
        { label: 'labor centric operating model', clicks: 18, impressions: 340, ctr: 0.052, position: 8.7 },
        { label: 'ai transformation strategy', clicks: 9, impressions: 890, ctr: 0.01, position: 24.5 },
      ],
      topPages: [
        { label: '/insights/ticket-factories/', clicks: 38, impressions: 720, ctr: 0.052, position: 9.1 },
        { label: '/', clicks: 33, impressions: 410, ctr: 0.08, position: 4.3 },
        { label: '/frameworks/', clicks: 12, impressions: 380, ctr: 0.031, position: 14.2 },
      ],
    });
    renderCf({
      timeseries: ts.map(function (r) { return { date: r.date, visits: r.users, pageviews: r.pageviews }; }),
      topReferrers: [
        { label: 'linkedin.com', pageviews: 512 },
        { label: 'Direct / none', pageviews: 402 },
        { label: 'google.com', pageviews: 341 },
        { label: 'forbes.com', pageviews: 66 },
      ],
      countries: [
        { label: 'United States', pageviews: 780 },
        { label: 'India', pageviews: 310 },
        { label: 'United Kingdom', pageviews: 120 },
        { label: 'Canada', pageviews: 88 },
        { label: 'Germany', pageviews: 41 },
      ],
      devices: [
        { label: 'desktop', pageviews: 820 },
        { label: 'mobile', pageviews: 490 },
        { label: 'tablet', pageviews: 29 },
      ],
    });
    renderKpis(
      { totals: { users: totalUsers, pageviews: totalViews, sessions: Math.round(totalUsers * 1.2), avgSessionDuration: 148 } },
      { totals: { clicks: totalClicks, impressions: totalImps, ctr: totalClicks / totalImps } }
    );
    renderInsights({
      briefSource: 'computed',
      brief: [
        'Reach: 1,240 (up 18% vs the prior 28 days) — 1,050 search impressions and 190 LinkedIn-sourced visits.',
        'Read: 830 article views with 96s average engagement; 410 engaged sessions overall.',
        'Connect: 31 actions — 22 contact-page views and 9 clicks through to your LinkedIn profile.',
        '41% of search impressions come from executive-intent queries (top: \u201cai native operating model\u201d); 12% are people searching your name.',
        'Traffic peaks on Tue and Wed. Across 3 logged LinkedIn posts, post days average 52.0 sessions vs 31.0 on other days (+68% lift).',
      ],
      funnel: {
        reach: { value: 1240, searchImpressions: 1050, linkedinSessions: 190, delta: 0.18 },
        read: { value: 830, articleViews: 830, engagedSessions: 410, avgEngagementSeconds: 96, delta: 0.22 },
        connect: { value: 31, contactViews: 22, linkedinProfileClicks: 9, delta: null },
      },
      weekday: {
        pattern: [
          { day: 'Sun', avgSessions: 18 }, { day: 'Mon', avgSessions: 34 },
          { day: 'Tue', avgSessions: 52 }, { day: 'Wed', avgSessions: 47 },
          { day: 'Thu', avgSessions: 38 }, { day: 'Fri', avgSessions: 24 },
          { day: 'Sat', avgSessions: 12 },
        ],
        bestDays: ['Tue', 'Wed'],
      },
      search: {
        executiveShare: 0.41, brandShare: 0.12,
        topExecutiveQueries: [
          { query: 'ai native operating model', impressions: 610, position: 6.2 },
          { query: 'forward deployed engineers it operations', impressions: 240, position: 11.4 },
          { query: 'eliminate tickets before automating', impressions: 130, position: 14.9 },
        ],
      },
      linkedin: {
        postsInWindow: 3, avgSessionsOnPostDays: 52, avgSessionsOnOtherDays: 31,
        perPost: [
          { date: labels[labels.length - 3], topic: 'FDE article', impressions: 2300, linkedinSessionsNext48h: 41, clickThroughRate: 0.0178 },
          { date: labels[Math.max(0, labels.length - 10)], topic: 'Usage bill', impressions: 1600, linkedinSessionsNext48h: 24, clickThroughRate: 0.015 },
          { date: labels[Math.max(0, labels.length - 17)], topic: 'Governed digital labor', impressions: 900, linkedinSessionsNext48h: 11, clickThroughRate: 0.0122 },
        ],
      },
      articles: [
        { path: '/insights/it-operations-forward-deployed-engineers/', title: 'IT Operations Doesn\u2019t Need Forward-Deployed Engineers', pageviews: 214, linkedinSessions: 64, searchImpressions: 380, searchClicks: 21, avgEngagementSeconds: 208 },
        { path: '/insights/ticket-factories/', title: 'Why Are We Still Building Ticket Factories?', pageviews: 156, linkedinSessions: 12, searchImpressions: 720, searchClicks: 38, avgEngagementSeconds: 187 },
        { path: '/insights/ai-native-it-operations/', title: 'How AI-Native IT Operations Enable Peak Business Performance', pageviews: 121, linkedinSessions: 22, searchImpressions: 260, searchClicks: 12, avgEngagementSeconds: 173 },
      ],
    });
    document.getElementById('dash-updated').textContent = 'Demo data — remove ?demo=1 from the URL for live analytics.';
  }

  loadAll();
})();
