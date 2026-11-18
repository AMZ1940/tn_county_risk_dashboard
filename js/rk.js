window.RK = (() => {
  const money = (v) => v == null || isNaN(v) ? '—' : Math.abs(v) >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v/1e3)}K` : `$${Math.round(v)}`;
  const money2 = (v) => v == null || isNaN(v) ? '—' : `$${(+v).toFixed(2)}`;
  const full = (v) => v == null || isNaN(v) ? '—' : `$${d3.format(',.0f')(v)}`;
  const pct = (v, d = 0) => v == null || isNaN(v) ? '—' : `${(v * 100).toFixed(d)}%`;
  const num = (v, d = 0) => v == null || isNaN(v) ? '—' : d3.format(`,.${d}f`)(v);
  const date = (s) => s ? d3.utcFormat('%b %-d, %Y')(new Date(s + 'T00:00:00Z')) : '—';
  const ok = (id) => dash.data(id).status === 'ok';
  const set = (el, id, txt) => { const s = dash.data(id).status; el.textContent = s === 'ok' ? txt() : (s === 'error' ? 'Failed to load' : '—'); el.classList.toggle('dash-skeleton', s === 'loading'); };
  const sw = (i) => dash.colors[i % dash.colors.length];

  function tooltip(el) {
    let t = el.querySelector(':scope > .tip');
    if (!t) { t = document.createElement('div'); t.className = 'tip'; t.hidden = true; el.appendChild(t); }
    return {
      show(ev, lines) {
        t.replaceChildren(...lines.map((l, i) => { const d = document.createElement('div'); d.textContent = l; if (i === 0) d.style.fontWeight = '600'; return d; }));
        t.hidden = false;
        const r = el.getBoundingClientRect(); let x = ev.clientX - r.left + 12, y = ev.clientY - r.top + 12;
        if (x + t.offsetWidth > el.clientWidth) x = Math.max(0, ev.clientX - r.left - t.offsetWidth - 12);
        t.style.left = x + 'px'; t.style.top = y + 'px';
      },
      hide() { t.hidden = true; }
    };
  }
  function status(el, id) {
    const s = dash.data(id).status;
    if (s === 'ok') return true;
    el.replaceChildren(); const p = document.createElement('p'); p.className = 'muted';
    p.textContent = s === 'error' ? 'Failed to load' : '—'; el.appendChild(p);
    el.classList.toggle('dash-skeleton', s === 'loading');
    return false;
  }
  // horizontal bars with printed values
  function hbar(el, rows, { label, value, fmt, color, tip, highlight }) {
    el.classList.remove('dash-skeleton'); el.replaceChildren();
    const W = el.clientWidth || 300, bh = 20, gap = 6, H = rows.length * (bh + gap) + 4;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', el.closest('[id]')?.querySelector('h3')?.textContent || 'Bar chart');
    const tmp = svg.append('g'); let lw = 0, vw = 0;
    rows.forEach((r) => { const t = tmp.append('text').text(label(r)); lw = Math.max(lw, t.node().getComputedTextLength()); const v = tmp.append('text').text(fmt(value(r))); vw = Math.max(vw, v.node().getComputedTextLength()); });
    tmp.remove(); lw = Math.min(lw + 8, W * 0.45);
    const x = d3.scaleLinear().domain([0, d3.max(rows, value) || 1]).range([0, Math.max(10, W - lw - vw - 10)]);
    const tt = tooltip(el);
    const g = svg.selectAll('g.r').data(rows).join('g').attr('class', 'r').attr('transform', (d, i) => `translate(0,${i * (bh + gap)})`);
    g.append('text').attr('class', 'lbl').attr('x', lw - 8).attr('y', bh / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(label)
      .style('font-weight', (d) => highlight && highlight(d) ? '600' : null);
    g.append('rect').attr('x', lw).attr('height', bh).attr('rx', 3).attr('width', (d) => Math.max(1, x(value(d) || 0)))
      .style('fill', (d) => color ? color(d) : sw(0));
    g.append('text').attr('x', (d) => lw + x(value(d) || 0) + 4).attr('y', bh / 2).attr('dy', '0.35em').text((d) => fmt(value(d)));
    g.append('rect').attr('width', W).attr('height', bh + gap).attr('y', -gap / 2).style('fill', 'transparent')
      .on('pointermove', (ev, d) => tt.show(ev, tip ? tip(d) : [label(d), fmt(value(d))])).on('pointerleave', () => tt.hide());
  }
  // vertical (optionally stacked) bars
  function vbar(el, rows, { x, keys, fmt, colors, tip, height = 240, labelEvery }) {
    el.classList.remove('dash-skeleton'); el.replaceChildren();
    const W = el.clientWidth || 300, H = height, m = { t: 10, r: 8, b: 34, l: 10 };
    const max = d3.max(rows, (r) => d3.sum(keys, (k) => Math.max(0, r[k] || 0))) || 1;
    const y = d3.scaleLinear().domain([0, max]).nice().range([H - m.b, m.t]);
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', el.closest('[id]')?.querySelector('h3')?.textContent || 'Bar chart');
    const ya = svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(fmt).tickSize(0));
    let lw = 0; ya.selectAll('text').each(function () { lw = Math.max(lw, this.getComputedTextLength()); });
    m.l = lw + 8; ya.attr('transform', `translate(${m.l - 2},0)`); ya.select('.domain').remove();
    svg.insert('g', ':first-child').selectAll('line').data(y.ticks(5)).join('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y).attr('y2', y).style('stroke', 'var(--cds-chart-grid)');
    const xb = d3.scaleBand().domain(rows.map(x)).range([m.l, W - m.r]).padding(0.2);
    const every = labelEvery || Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor((W - m.l) / 46))));
    const xa = svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(xb).tickSize(0).tickFormat((d, i) => i % every ? '' : String(d).split(' ')[0]));
    xa.select('.domain').style('stroke', 'var(--cds-chart-axis)');
    const tt = tooltip(el);
    rows.forEach((r) => {
      let acc = 0;
      keys.forEach((k, i) => {
        const v = Math.max(0, r[k] || 0);
        svg.append('rect').attr('x', xb(x(r))).attr('width', xb.bandwidth()).attr('y', y(acc + v)).attr('height', Math.max(0, y(acc) - y(acc + v)))
          .style('fill', colors ? colors[i] : sw(i));
        acc += v;
      });
      svg.append('rect').attr('x', xb(x(r)) - xb.step() * xb.paddingInner() / 2).attr('width', xb.step()).attr('y', m.t).attr('height', H - m.b - m.t).style('fill', 'transparent')
        .on('pointermove', (ev) => tt.show(ev, tip(r))).on('pointerleave', () => tt.hide());
    });
    return { y, left: m.l };
  }
  function tierColor(t) { return t === 'Very High' ? 'var(--color-bad)' : t === 'High' ? 'var(--color-warn)' : t === 'Moderate' ? 'var(--color-fg)' : 'var(--color-ok)'; }
  function rowsInto(tbody, rows, key, cells) {
    tbody.replaceChildren();
    rows.forEach((r) => {
      const tr = document.createElement('tr'); tr.dataset.key = String(r[key]);
      cells.forEach(([v, cls, style]) => { const td = document.createElement('td'); if (cls) td.className = cls; td.textContent = v(r); if (style) style(td, r); tr.appendChild(td); });
      tbody.appendChild(tr);
    });
  }
  return { money, money2, full, pct, num, date, ok, set, sw, tooltip, status, hbar, vbar, tierColor, rowsInto };
})();
