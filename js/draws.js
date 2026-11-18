const RK = window.RK;
const HAZ = () => dash.params().hazard || '';
// ---- filter bar
document.querySelectorAll('.rk [data-ctl]').forEach((sel) => {
  const name = sel.dataset.ctl, dflt = sel.dataset.default || '';
  sel.value = dash.params()[name] || dflt;
  sel.addEventListener('change', () => dash.setParams({ [name]: sel.value || null }));
});
document.querySelectorAll('.rk [data-reset]').forEach((b) => b.addEventListener('click', () => {
  dash.resetParams();
  document.querySelectorAll('.rk [data-ctl]').forEach((sel) => { sel.value = sel.dataset.default || ''; });
}));
dash.draw('haz-label', (el) => { el.textContent = HAZ() || 'All natural hazards'; });

// ---- headline and statewide figures
const swRow = () => (dash.data('regionHaz').data || []).find((r) => r.region === 'Statewide') || {};
dash.draw('sw-desig', (el) => RK.set(el, 'regionHaz', () => RK.num(swRow().designations)));
dash.draw('sw-met', (el) => RK.set(el, 'regionHaz', () => RK.num(swRow().met)));
dash.draw('sw-tested', (el) => RK.set(el, 'regionHaz', () => RK.num(swRow().tested)));
dash.draw('sw-haz', (el) => { el.textContent = HAZ() ? HAZ().toLowerCase() : 'natural-hazard'; });
dash.draw('top-county', (el) => RK.set(el, 'countyHaz', () => ((dash.data('countyHaz').data || [])[0] || {}).county || '—'));
dash.draw('k-desig', (el) => RK.set(el, 'regionHaz', () => RK.num(swRow().designations)));
dash.draw('k-net', (el) => RK.set(el, 'regionHaz', () => RK.money(swRow().netABAdj)));
dash.draw('k-eal', (el) => RK.set(el, 'regionHaz', () => RK.money2(swRow().ealPerCap)));
dash.draw('k-deob', (el) => RK.set(el, 'regionHaz', () => RK.money(swRow().deob)));
dash.draw('k-deobrate', (el) => RK.set(el, 'regionHaz', () => RK.pct(swRow().deobRate, 1)));
dash.draw('k-zero', (el) => RK.set(el, 'regionHaz', () => RK.num(swRow().zeroPA)));
dash.draw('c-eal-sw', (el) => RK.set(el, 'regionHaz', () => RK.money2(swRow().ealPerCap)));

// ---- county map (choropleth + click to pick a county)
const MAP_METRICS = {
  score: { label: 'Score', value: (r) => r.score, fmt: (v) => RK.num(v, 1) },
  paDR: { label: 'PA major designations', value: (r) => r.paDR, fmt: (v) => RK.num(v) },
  p5yr: { label: '5-year chance', value: (r) => r.p5yr, fmt: (v) => RK.pct(v) },
  ealPerCap: { label: '$ per resident per year', value: (r) => r.ealPerCap, fmt: RK.money2 },
  met: { label: 'Times A + B met the indicator', value: (r) => r.met, fmt: (v) => RK.num(v) },
};
dash.draw('tn-map', (el) => {
  const g = dash.data('tnCounties'), c = dash.data('countyHaz');
  if (g.status !== 'ok' || c.status !== 'ok') { RK.status(el, g.status !== 'ok' ? 'tnCounties' : 'countyHaz'); return; }
  el.classList.remove('dash-skeleton'); el.replaceChildren();
  const M = MAP_METRICS[dash.params().mapMetric] || MAP_METRICS.score;
  const rows = new Map(c.data.map((r) => [r.county, r]));
  const sel = dash.params().county || (c.data[0] && c.data[0].county);
  const W = el.clientWidth || 600, H = Math.max(160, Math.round(W * 0.34));
  const proj = d3.geoMercator().fitExtent([[4, 4], [W - 4, H - 4]], g.data), path = d3.geoPath(proj);
  const vals = c.data.map(M.value);
  const steps = [0.12, 0.3, 0.5, 0.72, 0.95];
  const q = d3.scaleQuantile().domain(vals).range(steps);
  const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
    .attr('aria-label', `Map of Tennessee counties shaded by ${M.label}; select a county to load its profile`);
  const tt = RK.tooltip(el);
  const feats = g.data.features.slice().sort((a, b) => (a.properties.county === sel) - (b.properties.county === sel));
  svg.append('g').selectAll('path').data(feats).join('path')
    .attr('d', path).attr('tabindex', 0).attr('role', 'button').attr('aria-label', (f) => f.properties.county)
    .style('cursor', 'pointer').style('fill', RK.sw(0))
    .style('fill-opacity', (f) => { const r = rows.get(f.properties.county); return r ? q(M.value(r)) : 0.05; })
    .style('stroke', (f) => f.properties.county === sel ? 'var(--color-fg)' : 'var(--color-bg)')
    .style('stroke-width', (f) => f.properties.county === sel ? 2.2 : 0.8)
    .on('pointermove', (ev, f) => { const r = rows.get(f.properties.county) || {};
      tt.show(ev, [f.properties.county, `${M.label}: ${M.fmt(M.value(r))}`, `Score ${RK.num(r.score, 1)} · ${r.tier || '—'} · rank ${r.rank || '—'}`, `${RK.num(r.paDR)} PA majors · met ${r.met} of ${r.tested}`, 'Click to load this county']); })
    .on('pointerleave', () => tt.hide())
    .on('click', (ev, f) => dash.setParams({ county: f.properties.county }))
    .on('keydown', (ev, f) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); dash.setParams({ county: f.properties.county }); } });
  // legend: the five shading classes and the value range each covers
  const qs = q.quantiles(), lo = d3.min(vals), hi = d3.max(vals);
  const edges = [lo, ...qs, hi];
  const leg = document.createElement('div'); leg.className = 'legend'; leg.style.marginTop = '6px';
  steps.forEach((s, i) => {
    const span = document.createElement('span'); const sw = document.createElement('i'); sw.className = 'sw';
    sw.style.background = RK.sw(0); sw.style.opacity = s; span.appendChild(sw);
    span.appendChild(document.createTextNode(`${M.fmt(edges[i])}–${M.fmt(edges[i + 1])}`)); leg.appendChild(span);
  });
  const selSpan = document.createElement('span'); const ring = document.createElement('i'); ring.className = 'sw';
  ring.style.border = '2px solid var(--color-fg)'; ring.style.background = 'transparent'; selSpan.appendChild(ring);
  selSpan.appendChild(document.createTextNode(`Selected: ${sel || '—'}`)); leg.appendChild(selSpan);
  el.appendChild(leg);
});

// ---- county picker and profile
dash.draw('county-select', (sel) => {
  const d = dash.data('counties'), rank = dash.data('countyHaz');
  const list = d.status === 'ok' ? [...d.data].sort((a, b) => a.county.localeCompare(b.county)) : [];
  const top = rank.status === 'ok' && rank.data[0] ? rank.data[0].county : '';
  sel.replaceChildren(...list.map((c) => new Option(c.county, c.county)));
  sel.value = dash.params().county || top;
  sel.onchange = () => dash.setParams({ county: sel.value || null });
});
const pick = () => (dash.data('countyPick').data || [])[0] || {};
dash.draw('c-name', (el) => RK.set(el, 'countyPick', () => pick().county || '—'));
dash.draw('c-score', (el) => RK.set(el, 'countyPick', () => RK.num(pick().score, 1)));
dash.draw('c-tier', (el) => { RK.set(el, 'countyPick', () => pick().tier || '—'); el.style.color = RK.tierColor(pick().tier); el.style.fontWeight = '600'; });
dash.draw('c-rank', (el) => RK.set(el, 'countyPick', () => RK.num(pick().rank)));
dash.draw('c-p5', (el) => RK.set(el, 'countyPick', () => RK.pct(pick().p5yr)));
dash.draw('c-rate', (el) => RK.set(el, 'countyPick', () => RK.num(pick().ratePerYr, 2)));
dash.draw('c-eal', (el) => RK.set(el, 'countyPick', () => RK.money2(pick().ealPerCap)));
dash.draw('c-met', (el) => RK.set(el, 'countyPick', () => RK.num(pick().met)));
dash.draw('c-tested', (el) => RK.set(el, 'countyPick', () => RK.num(pick().tested)));
dash.draw('c-maxmult', (el) => RK.set(el, 'countyPick', () => pick().maxMultiple == null ? '—' : RK.num(pick().maxMultiple, 2)));
dash.draw('c-zero', (el) => RK.set(el, 'countyPick', () => RK.num(pick().zeroPA)));
dash.draw('c-last', (el) => RK.set(el, 'countyPick', () => RK.date(pick().lastDR)));

dash.draw('cmp-eal', (el) => {
  if (!RK.status(el, 'countyCompare')) return;
  const rows = dash.data('countyCompare').data;
  RK.hbar(el, rows, { label: (r) => r.level, value: (r) => r.ealPerCap, fmt: RK.money2, color: (r) => r === rows[0] ? RK.sw(0) : 'var(--cds-chart-muted)', highlight: (r) => r === rows[0] });
});
dash.draw('cmp-freq', (el) => {
  if (!RK.status(el, 'countyCompare')) return;
  const rows = dash.data('countyCompare').data;
  RK.hbar(el, rows, { label: (r) => r.level, value: (r) => r.designations, fmt: (v) => RK.num(v, 1), color: (r) => r === rows[0] ? RK.sw(0) : 'var(--cds-chart-muted)', highlight: (r) => r === rows[0] });
});
dash.draw('c-haz', (el) => {
  if (!RK.status(el, 'countyPick')) return;
  const p = pick(), hz = HAZ();
  const rows = [['Severe storms & tornadoes', p.n_severe], ['Winter storms & ice', p.n_winter], ['Flooding', p.n_flooding], ['Tropical', p.n_tropical], ['Wildfire', p.n_wildfire]].map(([h, n]) => ({ h, n: n || 0 }));
  RK.hbar(el, rows, { label: (r) => r.h, value: (r) => r.n, fmt: (v) => RK.num(v), color: (r) => !hz || r.h === hz ? RK.sw(0) : 'var(--cds-chart-muted)', highlight: (r) => r.h === hz });
});
dash.draw('c-mult', (el) => {
  if (!RK.status(el, 'countyHist')) return;
  const rows = dash.data('countyHist').data.filter((r) => r.thresholdMultiple != null).slice().sort((a, b) => a.declDate.localeCompare(b.declDate));
  if (!rows.length) { el.replaceChildren(); const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No designations for this county and hazard with a verified indicator.'; el.appendChild(p); return; }
  const res = RK.vbar(el, rows.map((r) => ({ ...r, mult: Math.max(0, r.thresholdMultiple) })), { x: (r) => `${r.year} ${r.disasterNumber}`, keys: ['mult'], fmt: (v) => `${d3.format('.1~f')(v)}×`, height: 200,
    tip: (r) => [`DR-${r.disasterNumber} · ${r.hazard}`, RK.date(r.declDate), `Net A + B ${RK.full(r.net)}`, `Threshold ${RK.full(r.threshold)}`, `${d3.format('.2f')(r.thresholdMultiple)}× threshold`] });
  const svg = d3.select(el).select('svg'); const W = el.clientWidth || 300;
  if (res.y.domain()[1] >= 1) {
    svg.append('line').attr('x1', res.left).attr('x2', W - 8).attr('y1', res.y(1)).attr('y2', res.y(1)).style('stroke', 'var(--cds-chart-status-critical)').style('stroke-dasharray', '4 3');
    svg.append('text').attr('x', W - 10).attr('y', res.y(1) - 4).attr('text-anchor', 'end').text('1× indicator');
  }
});
dash.draw('c-hist-rows', (tb) => {
  if (!RK.ok('countyHist')) { tb.replaceChildren(); return; }
  RK.rowsInto(tb, dash.data('countyHist').data, 'disasterNumber', [
    [(r) => `DR-${r.disasterNumber}`], [(r) => RK.date(r.declDate)], [(r) => r.hazard], [(r) => RK.num(r.durationDays), 'n'],
    [(r) => RK.full(r.netA), 'n'], [(r) => RK.full(r.netB), 'n'], [(r) => RK.full(r.deob), 'n'], [(r) => RK.full(r.threshold), 'n'],
    [(r) => r.thresholdMultiple == null ? '—' : `${d3.format('.2f')(r.thresholdMultiple)}×`, 'n', (td, r) => { if (r.metThreshold == 1) td.className = 'n bad'; }],
    [(r) => r.dominant]]);
});

// ---- ranking
dash.draw('rank-bars', (el) => {
  if (!RK.status(el, 'countyHaz')) return;
  const rows = dash.data('countyHaz').data.slice(0, 15), sel = dash.params().county;
  RK.hbar(el, rows, { label: (r) => r.county, value: (r) => r.score, fmt: (v) => RK.num(v, 1), color: (r) => RK.tierColor(r.tier), highlight: (r) => r.county === sel,
    tip: (r) => [r.county, `Score ${RK.num(r.score, 1)} · ${r.tier}`, `${r.paDR} PA majors · ${RK.pct(r.p5yr)} 5-yr chance`, `${RK.money2(r.ealPerCap)} per resident per year`, `Met indicator ${r.met} of ${r.tested}`] });
});
dash.draw('rank-rows', (tb) => {
  if (!RK.ok('countyHaz')) { tb.replaceChildren(); return; }
  const sel = dash.params().county;
  RK.rowsInto(tb, dash.data('countyHaz').data, 'county', [
    [(r) => RK.num(r.rank), 'n'], [(r) => r.county, '', (td, r) => { if (r.county === sel) td.style.fontWeight = '700'; }], [(r) => r.region], [(r) => r.econ], [(r) => RK.num(r.paDR), 'n'], [(r) => RK.pct(r.p5yr), 'n'],
    [(r) => RK.money2(r.ealPerCap), 'n'], [(r) => `${r.met} / ${r.tested}`, 'n'], [(r) => RK.num(r.zeroPA), 'n'], [(r) => RK.num(r.score, 1), 'n'],
    [(r) => r.tier, '', (td, r) => { td.style.color = RK.tierColor(r.tier); td.style.fontWeight = '600'; }]]);
  tb.querySelectorAll('tr').forEach((tr) => { tr.style.cursor = 'pointer'; tr.addEventListener('click', () => dash.setParams({ county: tr.dataset.key })); });
});

// ---- regions / econ
const regRows = () => { const order = ['West', 'Middle', 'East', 'Southeast', 'Statewide']; return (dash.data('regionHaz').data || []).slice().sort((a, b) => order.indexOf(a.region) - order.indexOf(b.region)); };
const regColor = (r) => r.region === 'Statewide' ? 'var(--cds-chart-muted)' : RK.sw(0);
dash.draw('reg-freq', (el) => { if (!RK.status(el, 'regionHaz')) return; RK.hbar(el, regRows(), { label: (r) => r.region, value: (r) => r.designationsPerCounty, fmt: (v) => RK.num(v, 1), color: regColor }); });
dash.draw('reg-eal', (el) => { if (!RK.status(el, 'regionHaz')) return; RK.hbar(el, regRows(), { label: (r) => r.region, value: (r) => r.ealPerCap, fmt: RK.money2, color: regColor }); });
dash.draw('reg-met', (el) => { if (!RK.status(el, 'regionHaz')) return; RK.hbar(el, regRows(), { label: (r) => r.region, value: (r) => r.metRate || 0, fmt: (v) => RK.pct(v), color: regColor, tip: (r) => [r.region, `${r.met} of ${r.tested} designations`] }); });
dash.draw('econ-rows', (tb) => {
  if (!RK.ok('econHaz')) { tb.replaceChildren(); return; }
  RK.rowsInto(tb, dash.data('econHaz').data, 'econ', [
    [(r) => r.econ], [(r) => RK.num(r.countiesInGroup), 'n'], [(r) => RK.num(r.designationsPerCounty, 1), 'n'], [(r) => RK.money2(r.ealPerCap), 'n'],
    [(r) => RK.pct(r.metRate), 'n'], [(r) => r.medianMultiple == null ? '—' : `${d3.format('.2f')(r.medianMultiple)}×`, 'n'], [(r) => RK.num(r.zeroPA), 'n']]);
});

// ---- hazards (all hazards side by side; the picked one is bold)
dash.draw('haz-rows', (tb) => {
  if (!RK.ok('hazards')) { tb.replaceChildren(); return; }
  const hz = HAZ();
  RK.rowsInto(tb, dash.data('hazards').data, 'hazard', [
    [(r) => r.hazard], [(r) => RK.num(r.DR), 'n'], [(r) => RK.num(r.EM), 'n'], [(r) => RK.num(r.emEscalated), 'n'], [(r) => RK.num(r.medDuration, 0), 'n'],
    [(r) => RK.num(r.medDaysToDeclare, 0), 'n'], [(r) => RK.num(r.medCounties, 0), 'n'], [(r) => RK.money(r.medNetAdjPerDR), 'n'], [(r) => RK.pct(r.shareA), 'n'],
    [(r) => RK.pct(r.deobRate, 1), 'n'], [(r) => `${r.met} / ${r.tested}`, 'n']]);
  tb.querySelectorAll('tr').forEach((tr) => { tr.style.fontWeight = hz && tr.dataset.key === hz ? '700' : ''; });
});

// ---- threshold dots
dash.draw('thr-dots', (el) => {
  if (!RK.status(el, 'designations')) return;
  el.classList.remove('dash-skeleton'); el.replaceChildren();
  const hz = HAZ(), selC = dash.params().county;
  const rows = dash.data('designations').data.filter((r) => r.thresholdMultiple != null && r.thresholdMultiple > 0 && (!hz || r.hazard === hz));
  if (!rows.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No designations for this hazard.'; el.appendChild(p); return; }
  const W = el.clientWidth || 320, H = 340, m = { t: 10, r: 10, b: 28, l: 48 };
  const x = d3.scaleUtc().domain(d3.extent(rows, (r) => new Date(r.declDate + 'T00:00:00Z'))).range([m.l, W - m.r]).nice();
  const y = d3.scaleLog().domain([Math.min(0.5, d3.min(rows, (r) => r.thresholdMultiple)), Math.max(2, d3.max(rows, (r) => r.thresholdMultiple))]).range([H - m.b, m.t]).nice();
  const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'County designations by net Cat A and B as a multiple of the countywide threshold, over time');
  svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(W / 90))).tickSizeOuter(0)).select('.domain').style('stroke', 'var(--cds-chart-axis)');
  const ya = svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5, (v) => `${d3.format('~g')(v)}×`).tickSize(0)); ya.select('.domain').remove();
  svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(1)).attr('y2', y(1)).style('stroke', 'var(--cds-chart-status-critical)').style('stroke-dasharray', '4 3');
  const tt = RK.tooltip(el);
  const jit = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 997; return (h / 997 - 0.5) * 6; };
  const ordered = rows.slice().sort((a, b) => (a.county === selC) - (b.county === selC));
  svg.append('g').selectAll('circle').data(ordered).join('circle')
    .attr('cx', (r) => x(new Date(r.declDate + 'T00:00:00Z')) + jit(r.county)).attr('cy', (r) => y(r.thresholdMultiple)).attr('r', (r) => r.county === selC ? 5.5 : 3.5)
    .style('fill', (r) => r.metThreshold ? 'var(--cds-chart-status-critical)' : 'var(--cds-chart-muted)').style('opacity', (r) => r.county === selC ? 1 : 0.7)
    .style('stroke', (r) => r.county === selC ? 'var(--color-fg)' : 'none').style('stroke-width', 1.5)
    .on('pointermove', (ev, r) => tt.show(ev, [`${r.county} · DR-${r.disasterNumber}`, `${r.hazard}, ${RK.date(r.declDate)}`, `Net A + B ${RK.full(r.net)}`, `${d3.format('.2f')(r.thresholdMultiple)}× threshold of ${RK.full(r.threshold)}`]))
    .on('pointerleave', () => tt.hide());
});

// ---- A vs B per disaster
const disRows = () => { const hz = HAZ(); return (dash.data('disasters').data || []).filter((r) => !hz || r.hazard === hz); };
dash.draw('ab-bars', (el) => {
  if (!RK.status(el, 'disasters')) return;
  const rows = disRows().filter((r) => r.type === 'DR' && !r.nonHazard && (r.netA > 0 || r.netB > 0)).map((r) => ({ ...r, a: r.netA / 1e6, b: r.netB / 1e6 }));
  if (!rows.length) { el.replaceChildren(); const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No major disasters with A or B dollars for this hazard.'; el.appendChild(p); return; }
  RK.vbar(el, rows, { x: (r) => `${r.year} ${r.disasterNumber}`, keys: ['a', 'b'], fmt: (v) => `$${d3.format('~g')(v)}M`, height: 320,
    tip: (r) => [`DR-${r.disasterNumber} · ${r.hazard}`, RK.date(r.declDate), `Cat A ${RK.full(r.netA)}`, `Cat B ${RK.full(r.netB)}`, `${r.dominant} dominant`] });
});
document.querySelectorAll('.rk [data-sw]').forEach((i) => { i.style.background = dash.colors[+i.dataset.sw]; });

dash.draw('dis-rows', (tb) => {
  if (!RK.ok('disasters')) { tb.replaceChildren(); return; }
  RK.rowsInto(tb, disRows().slice().reverse(), 'disasterNumber', [
    [(r) => r.disasterNumber], [(r) => r.type], [(r) => RK.date(r.declDate)], [(r) => r.hazard], [(r) => RK.num(r.durationDays), 'n'], [(r) => RK.num(r.daysToDeclare), 'n'],
    [(r) => RK.num(r.nCounties), 'n'], [(r) => r.escalatedTo ? `DR-${r.escalatedTo}` : (r.type === 'EM' ? 'No' : '')], [(r) => RK.money(r.net), 'n'], [(r) => r.dominant],
    [(r) => r.deobRate == null ? '—' : RK.pct(r.deobRate, 1), 'n'], [(r) => r.cTested ? `${r.cMet} / ${r.cTested}` : '—', 'n'], [(r) => RK.num(r.cZero || 0), 'n'], [(r) => r.nonHazard || '']]);
});

// ---- trend
dash.draw('tr-dollars', (el) => { if (!RK.status(el, 'trendHaz')) return; RK.vbar(el, dash.data('trendHaz').data.map((r) => ({ ...r, m: r.netAdj / 1e6 })), { x: (r) => String(r.year), keys: ['m'], fmt: (v) => `$${d3.format('~g')(v)}M`, tip: (r) => [String(r.year), `${RK.full(r.netAdj)} (FY2026 $)`, `${RK.full(r.net)} nominal`, `${r.drs} major declarations`] }); });
dash.draw('tr-counties', (el) => { if (!RK.status(el, 'trendHaz')) return; RK.vbar(el, dash.data('trendHaz').data, { x: (r) => String(r.year), keys: ['counties'], fmt: (v) => d3.format('~d')(v), tip: (r) => [String(r.year), `${r.counties} county designations`, `${r.drs} major declarations`] }); });

// ---- gaps
dash.draw('g-never-n', (el) => RK.set(el, 'neverMetCount', () => RK.num(dash.data('neverMetCount').data)));
dash.draw('g-em-n', (el) => RK.set(el, 'emNotCarriedCount', () => RK.num(dash.data('emNotCarriedCount').data)));
dash.draw('g-never-rows', (tb) => {
  if (!RK.ok('neverMetHaz')) { tb.replaceChildren(); return; }
  RK.rowsInto(tb, dash.data('neverMetHaz').data, 'county', [[(r) => r.county], [(r) => r.region], [(r) => r.econ], [(r) => RK.num(r.paDR), 'n'],
    [(r) => r.maxMultiple == null ? '—' : `${d3.format('.2f')(r.maxMultiple)}×`, 'n'], [(r) => RK.num(r.zeroPA), 'n']]);
});
dash.draw('g-em-rows', (tb) => {
  if (!RK.ok('emNotCarried')) { tb.replaceChildren(); return; }
  RK.rowsInto(tb, dash.data('emNotCarried').data.slice().sort((a, b) => a.county.localeCompare(b.county)), 'county', [[(r) => r.county], [(r) => r.region], [(r) => `EM-${r.em}`], [(r) => `DR-${r.dr}`]]);
});
