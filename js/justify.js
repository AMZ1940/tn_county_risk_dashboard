// Declaration justification view: tabs, mission list, county side panel, and the simple
// history-by-event-type page. Uses the calculations in js/calcs.js and the helpers in js/rk.js.
(function () {
  const RK = window.RK;
  const P = () => dash.params();
  const D = (id) => dash.data(id);
  const rows = (id) => D(id).data || [];
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const money = (v) => (v == null || isNaN(v) ? '—' : RK.money(v));
  const pct = (v) => (v == null ? '—' : RK.pct(v));
  const fy = () => (META().baseFY || 2026);
  const EV = () => HZ() || 'all natural hazards';

  // ---------------------------------------------------------------- tabs
  // Show the right tab before anything is drawn: charts size themselves to their box, and a box
  // inside a hidden tab has no width, so drawing it there squashes or stretches it.
  const applyView = (v) => {
    document.querySelectorAll('.rk [data-tab]').forEach((b) => { const on = b.dataset.tab === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    document.getElementById('view-justify').hidden = v !== 'justify';
    document.getElementById('view-analysis').hidden = v !== 'analysis';
    document.querySelectorAll('.rk .analysis-only').forEach((n) => { n.hidden = v !== 'analysis'; });
  };
  const viewNow = () => (P().view === 'analysis' ? 'analysis' : 'justify');
  applyView(viewNow());
  document.querySelectorAll('.rk [data-tab]').forEach((b) => b.addEventListener('click', () => {
    applyView(b.dataset.tab);                                   // unhide first, then redraw at the real width
    dash.setParams({ view: b.dataset.tab === 'justify' ? null : b.dataset.tab });
  }));
  window.addEventListener('hashchange', () => applyView(viewNow()));
  dash.draw('views', () => applyView(viewNow()));

  // ---------------------------------------------------------------- missions: in history / current
  const STORE = 'tnRisk.missions';
  const save = (xm, cm) => { try { localStorage.setItem(STORE, JSON.stringify({ xm, cm })); } catch (e) { /* storage unavailable */ } };
  const setMissions = (xm, cm) => { const a = [...xm].join(','), b = [...cm].join(','); save(a, b); dash.setParams({ xm: a || null, cm: b || null }); };
  if (P().xm == null && P().cm == null) {
    try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s && (s.xm || s.cm)) dash.setParams({ xm: s.xm || null, cm: s.cm || null }); } catch (e) { /* ignore */ }
  }
  const btn = document.querySelector('.rk [data-missions-toggle]'), panel = document.querySelector('.rk [data-draw="mission-panel"]');
  if (btn && panel) {
    btn.addEventListener('click', () => { panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', !panel.hidden); });
    document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  }
  dash.draw('missions-label', (n) => {
    const all = rows('daMissions'), x = XM(), c = CM();
    if (D('daMissions').status !== 'ok') { n.textContent = D('damageAssessments').message ? 'Missions (not loaded)' : 'Missions…'; return; }
    n.textContent = `Missions: ${all.length - all.filter((m) => x.has(m.missionKey)).length} of ${all.length} in history${c.size ? ` · ${c.size} current` : ''}`;
  });
  dash.draw('mission-panel', (box) => {
    box.replaceChildren();
    if (D('daMissions').status !== 'ok') { box.append(el('p', 'muted', D('damageAssessments').message || 'Loading missions from ArcGIS…')); return; }
    const x = XM(), c = CM();
    box.append(el('p', 'muted', 'Uncheck "In history" for a mission still under way so it doesn’t skew the averages (its linked declaration is left out too). Check "Current" to follow its damage assessments as they come in.'));
    const bar = el('div', 'row');
    const b1 = el('button', 'btn sm', 'All in history'); b1.type = 'button'; b1.onclick = () => setMissions(new Set(), c);
    const b2 = el('button', 'btn sm', 'Clear current'); b2.type = 'button'; b2.onclick = () => setMissions(x, new Set());
    bar.append(b1, b2); box.append(bar);
    const wrap = el('div', 'tw'); wrap.style.maxHeight = '320px'; wrap.style.overflow = 'auto';
    const t = el('table'); t.innerHTML = '<thead><tr><th>Mission</th><th>Declaration</th><th>Hazard</th><th class="n">Assessments</th><th>In history</th><th>Current</th></tr></thead>';
    const tb = el('tbody');
    rows('daMissions').forEach((m) => {
      const tr = el('tr');
      tr.append(el('td', '', `${m.year} #${m.mission}`), el('td', '', m.declaration ? `${m.declaration}${m.linkVerified === false ? ' (unverified)' : ''}` : 'Not linked'),
        el('td', '', m.hazard || '—'), el('td', 'n', RK.num(m.total)));
      const h = el('td'), hc = el('input'); hc.type = 'checkbox'; hc.checked = !x.has(m.missionKey); hc.setAttribute('aria-label', `${m.year} mission ${m.mission} in history`);
      hc.onchange = () => { const nx = new Set(x); if (hc.checked) nx.delete(m.missionKey); else nx.add(m.missionKey); setMissions(nx, c); };
      const cu = el('td'), cc = el('input'); cc.type = 'checkbox'; cc.checked = c.has(m.missionKey); cc.setAttribute('aria-label', `${m.year} mission ${m.mission} current`);
      cc.onchange = () => { const nc = new Set(c); if (cc.checked) nc.add(m.missionKey); else nc.delete(m.missionKey); setMissions(x, nc); };
      h.append(hc); cu.append(cc); tr.append(h, cu); tb.append(tr);
    });
    t.append(tb); wrap.append(t); box.append(wrap);
  });

  // ---------------------------------------------------------------- statewide history cards
  const st = () => rows('jState')[0] || {};
  const card = (label, value, sub) => { const c = el('div', 'card kpi'); c.append(el('div', 'l', label), el('div', 'v', value), el('div', 'l', sub || '')); return c; };
  dash.draw('j-event-label', (n) => { n.textContent = HZ() || 'All natural hazards'; });
  dash.draw('j-state', (box) => {
    if (D('jState').status !== 'ok') { box.replaceChildren(el('p', 'muted', '—')); return; }
    const s = st(); const si = s.stateIndicator;
    box.replaceChildren(
      card('Major declarations since 1999', RK.num(s.drCount), `Average ${RK.num(s.avgCountiesPerDR, 0)} counties designated each`),
      card('Average total project cost per declaration', money(s.avgPerDR), `Median ${money(s.medPerDR)} · largest ${money(s.maxPerDR)} · FY${fy()} $`),
      card('Average cost per Tennessee resident, per declaration', RK.money2(s.avgPerCapPerDR), si ? `Statewide indicator FY${si.fy}: ${RK.money2(si.value)} · ${s.drsOverState} of ${s.drCount} past declarations were above it` : 'Statewide indicator not on file'),
      card('Average cost per county designation', money(s.avgPerDesig), `Median ${money(s.medPerDesig)} · ${RK.money2(s.avgPerCapPerDesig)} per county resident`),
      card('County designations meeting the countywide indicator', pct(s.metRate), `${RK.num(s.met)} of ${RK.num(s.tested)} · median ${s.medMultiple == null ? '—' : d3.format('.1f')(s.medMultiple) + '×'} the indicator`),
      card('Damage assessments in the history', RK.num(s.da_total), s.da_avgCost != null ? `Average set cost ${money(s.da_avgCost)} per assessment` : (s.da_total ? 'Set amounts not entered yet' : (D('damageAssessments').message || 'None for this event type'))));
  });
  dash.draw('j-cats', (n) => { n.textContent = catText(); });

  // ---------------------------------------------------------------- map
  const J_METRICS = {
    avgPerDesig: { label: 'Average total project cost per designation', v: (r) => r.avgPerDesig, f: money },
    avgPerCap: { label: 'Average cost per resident per designation', v: (r) => r.avgPerCapPerDesig, f: RK.money2 },
    designations: { label: 'Designations since 1999', v: (r) => r.designations, f: (v) => RK.num(v) },
    metRate: { label: 'Share of designations meeting the indicator', v: (r) => (r.tested ? r.metRate : null), f: pct },
    daSevere: { label: 'Destroyed + major (damage assessments in the history)', v: (r) => (r.da_Destroyed || 0) + (r.da_Major || 0), f: (v) => RK.num(v), zeroNone: true },
  };
  const jSel = document.querySelector('.rk [data-jmetric]');
  if (jSel) { jSel.value = P().jMetric || 'avgPerDesig'; jSel.addEventListener('change', () => dash.setParams({ jMetric: jSel.value === 'avgPerDesig' ? null : jSel.value })); }
  dash.draw('j-map', (box) => {
    const g = D('tnCounties'), c = D('jCounty');
    if (g.status !== 'ok' || c.status !== 'ok') { RK.status(box, g.status !== 'ok' ? 'tnCounties' : 'jCounty'); return; }
    if (jSel) jSel.value = P().jMetric || 'avgPerDesig';
    box.classList.remove('dash-skeleton'); box.replaceChildren();
    const M = J_METRICS[P().jMetric] || J_METRICS.avgPerDesig;
    const byC = new Map(c.data.map((r) => [r.county, r])); const sel = P().county;
    const vals = c.data.map(M.v).filter((v) => v != null && (!M.zeroNone || v > 0)); if (!vals.length) vals.push(0);
    const steps = [0.14, 0.32, 0.52, 0.74, 0.95]; const q = d3.scaleQuantile().domain(vals).range(steps);
    const W = box.clientWidth || 600, H = Math.max(160, Math.round(W * 0.34));
    const proj = d3.geoMercator().fitExtent([[4, 4], [W - 4, H - 4]], g.data), path = d3.geoPath(proj);
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', `Tennessee counties shaded by ${M.label}; select a county to open its comparison panel`);
    const tt = RK.tooltip(box);
    const feats = g.data.features.slice().sort((a, b) => (a.properties.county === sel) - (b.properties.county === sel));
    const pick = (f) => dash.setParams({ county: f.properties.county });
    svg.append('g').selectAll('path').data(feats).join('path').attr('d', path).attr('tabindex', 0).attr('role', 'button').attr('aria-label', (f) => f.properties.county)
      .style('cursor', 'pointer').style('fill', RK.sw(0))
      .style('fill-opacity', (f) => { const r = byC.get(f.properties.county); const v = r ? M.v(r) : null; return v == null || (M.zeroNone && !v) ? 0.04 : q(v); })
      .style('stroke', (f) => (f.properties.county === sel ? 'var(--color-fg)' : 'var(--cds-chart-axis)')).style('stroke-width', (f) => (f.properties.county === sel ? 2.4 : 0.5))
      .on('pointermove', (ev, f) => { const r = byC.get(f.properties.county) || {};
        tt.show(ev, [f.properties.county, `${M.label}: ${M.f(M.v(r))}`, `${RK.num(r.designations)} designations · met ${r.met} of ${r.tested}`, `Threshold today ${money(r.thresholdNow)}`, 'Click to compare']); })
      .on('pointerleave', () => tt.hide()).on('click', (ev, f) => pick(f))
      .on('keydown', (ev, f) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(f); } });
    const qs = q.quantiles(), edges = [d3.min(vals), ...qs, d3.max(vals)]; const leg = el('div', 'legend'); leg.style.marginTop = '6px';
    leg.append((() => { const s = el('span'); const i = el('i', 'sw'); i.style.background = RK.sw(0); i.style.opacity = 0.04; i.style.border = '1px solid var(--cds-chart-axis)'; s.append(i, 'None'); return s; })());
    steps.forEach((o, i) => { if (i > 0 && edges[i] === edges[i + 1] && edges[i] === edges[i - 1]) return; const s = el('span'); const sw = el('i', 'sw'); sw.style.background = RK.sw(0); sw.style.opacity = o; s.append(sw, `${M.f(edges[i])}–${M.f(edges[i + 1])}`); leg.append(s); });
    box.append(leg);
  });

  // ---------------------------------------------------------------- regions table
  dash.draw('j-region-rows', (tb) => {
    if (!RK.ok('jRegions')) { tb.replaceChildren(); return; }
    const order = ['West', 'Middle', 'East', 'Southeast', 'Statewide']; const sel = rows('jCounty').find((r) => r.county === P().county);
    const list = rows('jRegions').slice().sort((a, b) => order.indexOf(a.region) - order.indexOf(b.region));
    RK.rowsInto(tb, list, 'region', [
      [(r) => r.region, '', (td, r) => { if (r.region === 'Statewide' || (sel && sel.region === r.region)) td.style.fontWeight = '700'; }],
      [(r) => RK.num(r.counties), 'n'], [(r) => RK.num(r.designations), 'n'], [(r) => RK.num(r.desigPerCounty, 1), 'n'],
      [(r) => money(r.avgPerDesig), 'n'], [(r) => money(r.medPerDesig), 'n'], [(r) => RK.money2(r.avgPerCapPerDesig), 'n'], [(r) => (r.tested ? `${pct(r.metRate)} (${r.met}/${r.tested})` : '—'), 'n'],
      [(r) => RK.num(r.da_total), 'n'], [(r) => money(r.da_avgCost), 'n']]);
  });

  // ---------------------------------------------------------------- trend
  dash.draw('j-trend', (box) => {
    if (!RK.status(box, 'trendHaz')) return;
    RK.vbar(box, rows('trendHaz').map((r) => ({ ...r, m: r.amtAdj / 1e6 })), { x: (r) => String(r.year), keys: ['m'], fmt: (v) => `$${d3.format('~g')(v)}M`, height: 220,
      tip: (r) => [String(r.year), `${RK.full(r.amtAdj)} total project cost (FY${fy()} $)`, `${r.drs} major declarations · ${r.counties} counties`] });
  });

  // ---------------------------------------------------------------- past declarations
  dash.draw('j-event-rows', (tb) => {
    if (!RK.ok('jEvents')) { tb.replaceChildren(); return; }
    const si = (st().stateIndicator || {}).value;
    RK.rowsInto(tb, rows('jEvents'), 'disasterNumber', [
      [(r) => `DR-${r.disasterNumber}`], [(r) => RK.date(r.declDate)], [(r) => titleCase(r.title)], [(r) => RK.num(r.nCounties), 'n'],
      [(r) => money(r.amtAdj), 'n'], [(r) => RK.money2(r.perCapState), 'n', (td, r) => { if (si && r.perCapState >= si) td.className = 'n bad'; }],
      [(r) => (r.tested ? `${r.met} / ${r.tested}` : '—'), 'n'], [(r) => (r.topCat ? `${r.topCat} (${RK.pct(r.topShare)})` : '—')],
      [(r) => (r.pdaN ? RK.num(r.pdaN) : '—'), 'n'], [(r) => money(r.pdaCost), 'n'], [(r) => money(r.combined), 'n']]);
  });

  // ---------------------------------------------------------------- damage assessment costs
  const EVENTS = ['Tornado', 'Flood', 'Other', 'Not recorded', 'All events'];
  dash.draw('j-pda-rows', (tb) => {
    if (!RK.ok('pdaMatrix')) { tb.replaceChildren(); const tr = el('tr'); const td = el('td', 'muted', D('damageAssessments').message || 'Loading damage assessments…'); td.colSpan = 6; tr.append(td); tb.append(tr); return; }
    RK.rowsInto(tb, rows('pdaMatrix'), 'dwelling', [[(r) => r.dwelling, '', (td, r) => { if (r.dwelling === 'All dwellings') td.style.fontWeight = '700'; }],
      ...EVENTS.map((e) => [(r) => { const x = r[e]; if (!x.total) return '—'; return x.avgCost != null ? `${money(x.avgCost)} (${RK.num(x.total)})` : `— (${RK.num(x.total)})`; }, 'n'])]);
  });
  dash.draw('j-unit-rows', (tb) => {
    const c = rows('pdaCosts'); if (!c.length) { tb.replaceChildren(); return; }
    RK.rowsInto(tb, c, 'dwelling', [[(r) => r.dwelling], ...DA_LEVELS.map((l) => [(r) => (r[l] == null || r[l] === '' ? 'not set' : RK.full(+r[l])), 'n'])]);
  });
  dash.draw('j-unit-note', (n) => {
    const c = rows('pdaCosts'); const set = c.some((r) => DA_LEVELS.some((l) => r[l] != null && r[l] !== ''));
    n.textContent = set ? 'Set amounts from source/pda_unit_costs.csv. Each assessment is valued at the amount for its dwelling type and damage level.'
      : 'The set amounts haven’t been entered yet. Fill in source/pda_unit_costs.csv (one row per dwelling type, one column per damage level) and the averages and estimated costs will appear.';
  });

  // ---------------------------------------------------------------- current mission
  dash.draw('j-cur-section', (sec) => { sec.hidden = CM().size === 0; });
  dash.draw('j-cur-title', (n) => { const c = rows('curMissions'); n.textContent = c.map((m) => `${m.label}${m.declaration ? ` → ${m.declaration}` : ''}`).join(', ') || '—'; });
  dash.draw('j-cur-facts', (n) => {
    const c = rows('curMissions'); if (!c.length) { n.textContent = ''; return; }
    const linked = c.filter((m) => m.declType === 'DR');
    n.textContent = `${linked.length ? `PA columns show what has been obligated so far for ${linked.map((m) => `${m.declaration} (${titleCase(m.title)})`).join(', ')}. ` : 'No major declaration is linked to these missions yet, so only damage assessments are shown. '}`
      + `Each county's threshold uses today's FY${(indicatorNow(META()) || {}).fy || ''} countywide indicator × 2020 population. Damage assessment costs are residential and business set amounts, so they're shown beside PA, not tested against the PA indicator.`;
  });
  const curTot = () => { const r = rows('curCounties'); const s = (k) => d3.sum(r, (x) => x[k] || 0);
    const priced = r.some((x) => x.da_estCost != null);
    return { county: 'Total, counties involved', designated: r.some((x) => x.designated), paAmt: r.some((x) => x.paAmt != null) ? s('paAmt') : null, thresholdNow: s('thresholdNow'),
      da_total: s('da_total'), da_Destroyed: s('da_Destroyed'), da_Major: s('da_Major'), da_Minor: s('da_Minor'), da_Affected: s('da_Affected'), da_Inaccessible: s('da_Inaccessible'),
      da_estCost: priced ? s('da_estCost') : null, combined: s('combined'), n: r.length }; };
  dash.draw('j-cur-kpis', (box) => {
    if (!CM().size) { box.replaceChildren(); return; }
    if (D('curCounties').status !== 'ok') { box.replaceChildren(el('p', 'muted', D('damageAssessments').message || 'Loading…')); return; }
    const t = curTot(); const si = indicatorNow(META(), 'statewide');
    box.replaceChildren(card('Counties involved', RK.num(t.n)), card('Damage assessments', RK.num(t.da_total), `${t.da_Destroyed} destroyed · ${t.da_Major} major · ${t.da_Minor} minor · ${t.da_Affected} affected`),
      card('Estimated cost from damage assessments', money(t.da_estCost), t.da_estCost == null ? 'Set amounts not entered yet' : 'Set amounts × assessments'),
      card('PA total project cost so far', money(t.paAmt), t.paAmt == null ? 'No linked major declaration yet' : 'Linked declaration, selected categories'),
      card('Statewide PA indicator', si ? money(si.value * META().statePop) : '—', si ? `FY${si.fy}: ${RK.money2(si.value)} × ${RK.num(META().statePop)} Tennesseans` : ''));
  });
  dash.draw('j-cur-rows', (tb) => {
    if (!CM().size || !RK.ok('curCounties')) { tb.replaceChildren(); return; }
    const sel = P().county; const si = indicatorNow(META(), 'statewide');
    const cols = [[(r) => r.county, '', (td, r) => { if (r.county === sel || r.n != null || r.state) td.style.fontWeight = '700'; }],
      [(r) => RK.num(r.da_total), 'n'], [(r) => RK.num(r.da_Destroyed), 'n'], [(r) => RK.num(r.da_Major), 'n'], [(r) => RK.num(r.da_Minor), 'n'], [(r) => RK.num(r.da_Affected), 'n'],
      [(r) => money(r.da_estCost), 'n'], [(r) => (r.paAmt == null ? '—' : money(r.paAmt)), 'n'], [(r) => money(r.thresholdNow), 'n'],
      [(r) => (r.paAmt == null || !r.thresholdNow ? '—' : `${d3.format('.2f')(r.paAmt / r.thresholdNow)}×`), 'n', (td, r) => { if (r.paAmt != null && r.paAmt >= r.thresholdNow) td.className = 'n bad'; }],
      [(r) => money(r.combined), 'n']];
    const list = rows('curCounties').concat([curTot()]);
    if (si) { const t = curTot(); list.push({ county: `Statewide (FY${si.fy} statewide indicator)`, state: true, thresholdNow: si.value * META().statePop, paAmt: t.paAmt, da_estCost: t.da_estCost, combined: t.combined }); }
    RK.rowsInto(tb, list, 'county', cols);
    tb.querySelectorAll('tr').forEach((tr, i) => { if (i < rows('curCounties').length) { tr.style.cursor = 'pointer'; tr.addEventListener('click', () => dash.setParams({ county: tr.dataset.key })); } else tr.className = 'total'; });
  });

  // ---------------------------------------------------------------- county side panel
  dash.draw('j-side', (box) => {
    box.replaceChildren();
    const name = P().county; const c = rows('jCounty').find((r) => r.county === name);
    if (!name || !c) { box.append(el('h3', '', 'County comparison'), el('p', 'muted', 'Click a county on the map, or pick one below, to see its numbers beside its region and the state.'));
      const s = el('select', 'dash-select'); s.setAttribute('aria-label', 'County'); s.append(new Option('Pick a county…', ''), ...rows('counties').map((x) => x.county).sort().map((n) => new Option(n, n)));
      s.onchange = () => dash.setParams({ county: s.value || null }); box.append(s); return; }
    const reg = rows('jRegions').find((r) => r.region === c.region) || {}, sw = rows('jRegions').find((r) => r.region === 'Statewide') || {};
    const head = el('div', 'row'); head.style.justifyContent = 'space-between'; const h = el('h3', '', `${c.county} County`); const x = el('button', 'btn sm', 'Close'); x.type = 'button'; x.onclick = () => dash.setParams({ county: null });
    head.append(h, x); box.append(head);
    box.append(el('p', 'muted', `${c.region} region · ${c.econ} · ${RK.num(c.pop)} people (2020) · ${EV()}, PA ${catText()}`));
    const big = el('div', 'side-kpi'); big.append(el('div', 'l', `Countywide threshold, FY${c.indicatorFY}`), el('div', 'v', money(c.thresholdNow)), el('div', 'l', `${RK.money2((indicatorNow(META()) || {}).value)} × ${RK.num(c.pop)}`)); box.append(big);
    const t = el('table', 'cmp'); t.innerHTML = '<thead><tr><th></th><th class="n">County</th><th class="n">Region avg</th><th class="n">State avg</th></tr></thead>';
    const tb = el('tbody');
    const line = (label, a, b, s) => { const tr = el('tr'); tr.append(el('td', '', label), el('td', 'n', a), el('td', 'n', b), el('td', 'n', s)); tb.append(tr); };
    line('Designations since 1999', RK.num(c.designations), RK.num(reg.desigPerCounty, 1), RK.num(sw.desigPerCounty, 1));
    line('Avg cost per designation', money(c.avgPerDesig), money(reg.avgPerDesig), money(sw.avgPerDesig));
    line('Median cost per designation', money(c.medPerDesig), money(reg.medPerDesig), money(sw.medPerDesig));
    line('Avg cost per resident', RK.money2(c.avgPerCapPerDesig), RK.money2(reg.avgPerCapPerDesig), RK.money2(sw.avgPerCapPerDesig));
    line('Met the indicator', c.tested ? `${c.met} of ${c.tested}` : '—', pct(reg.metRate), pct(sw.metRate));
    line('Largest designation', money(c.maxPerDesig), money(reg.maxPerDesig), money(sw.maxPerDesig));
    line('Damage assessments', RK.num(c.da_total), RK.num(reg.da_total), RK.num(sw.da_total));
    line('Avg set cost per assessment', money(c.da_avgCost), money(reg.da_avgCost), money(sw.da_avgCost));
    t.append(tb); box.append(t);
    box.append(el('p', 'muted', `Costs are total project cost (federal + non-federal) in FY${fy()} dollars. Region and state columns average their counties' designations. Chance of at least one PA major declaration in 5 years: ${pct(c.p5yr)}. History-based score ${RK.num(c.score, 1)} (${c.tier || '—'}, rank ${c.rank || '—'} of 95).`));
    const cur = rows('curCounties').find((r) => r.county === c.county);
    if (CM().size) {
      box.append(el('h4', '', 'Current mission'));
      box.append(el('p', '', cur ? `${RK.num(cur.da_total)} assessments (${cur.da_Destroyed} destroyed, ${cur.da_Major} major, ${cur.da_Minor} minor, ${cur.da_Affected} affected). Estimated cost ${money(cur.da_estCost)}. PA so far ${cur.paAmt == null ? '—' : money(cur.paAmt)}${cur.paAmt != null && cur.thresholdNow ? ` (${d3.format('.2f')(cur.paAmt / cur.thresholdNow)}× threshold)` : ''}.` : 'No assessments or PA for this county in the current mission yet.'));
    }
    const past = rows('desigHist').filter((d) => d.county === c.county).sort((a, b) => b.declDate.localeCompare(a.declDate)).slice(0, 8);
    box.append(el('h4', '', `Past ${HZ() ? HZ().toLowerCase() : ''} designations`.replace('  ', ' ')));
    if (!past.length) box.append(el('p', 'muted', 'None since 1999.'));
    else { const pt = el('table', 'cmp'); pt.innerHTML = '<thead><tr><th>DR</th><th>Declared</th><th class="n">Total cost</th><th class="n">× threshold</th></tr></thead>'; const pb = el('tbody');
      past.forEach((d) => { const tr = el('tr'); tr.append(el('td', '', `DR-${d.disasterNumber}`), el('td', '', RK.date(d.declDate)), el('td', 'n', money(d.amtAdj)), el('td', d.metThreshold === 1 ? 'n bad' : 'n', d.thresholdMultiple == null ? '—' : `${d3.format('.2f')(d.thresholdMultiple)}×`)); pb.append(tr); });
      pt.append(pb); box.append(pt); }
  });
})();
