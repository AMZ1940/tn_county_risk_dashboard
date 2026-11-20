// Calculations. Everything here re-computes for the filters in the filter bar:
//   hazard (""= all natural hazards), PA categories (cats), damage assessment mission (daMission).
// When the damage assessment mission picked is linked to a declaration, the dashboard follows that event:
// its hazard drives the hazard filter, and PA figures, KPIs and the declaration views narrow to it.
const EVENT = () => ((dash.data('eventSel').data) || [])[0] || null;
const HZ = () => { const e = EVENT(); return e && e.hazard ? e.hazard : (dash.params().hazard || ''); };
const ALL_CATS = 'ABCDEFGZ'.split('');
const DEFAULT_CATS = 'ABCDEFG';
const selCats = () => { const c = (dash.params().cats || DEFAULT_CATS).toUpperCase().split('').filter((x) => ALL_CATS.includes(x)); return c.length ? c : DEFAULT_CATS.split(''); };
const sumCats = (r, pre, cats) => cats.reduce((s, c) => s + (r[`${pre}_${c}`] || 0), 0);
const topCat = (r, cats) => { let best = null, v = 0, tot = 0; cats.forEach((c) => { const x = Math.max(0, r[`fed_${c}`] || 0); tot += x; if (x > v) { v = x; best = c; } }); return best ? { cat: best, share: v / tot } : null; };

dash.calc('eventSel', { inputs: ['missions', 'disasters'], title: 'Event linked to the picked mission',
  description: 'The declaration linked to the damage assessment mission picked (major declaration preferred); empty when none.',
  fn: (missions, disasters) => {
    const k = dash.params().daMission; if (!k) return [];
    const ms = missions.filter((m) => `${m.year}-${m.missionNumber}` === k); if (!ms.length) return [];
    const m = ms.find((x) => x.type === 'DR') || ms[0];
    const d = disasters.find((x) => String(x.disasterNumber) === String(m.disasterNumber)); if (!d) return [];
    const [yr, num] = k.split('-');
    return [{ disasterNumber: String(d.disasterNumber), type: d.type, title: d.title, hazard: d.hazard, declDate: d.declDate, begin: d.begin, end: d.end,
      nCounties: d.nCounties, missionKey: k, missionLabel: `${yr} Mission #${num}`, verified: !!m.verified }];
  } });

// ---- PA: county designations with the picked categories applied
dash.calc('desigCat', { inputs: ['designations'], title: 'County designations, selected PA categories',
  description: 'Federal share, total project cost and threshold test for the picked categories.',
  fn: (designations) => {
    const cats = selCats();
    return designations.map((d) => {
      const fed = sumCats(d, 'fed', cats), amt = sumCats(d, 'amt', cats);
      const t = topCat(d, cats);
      const mult = d.threshold ? amt / d.threshold : null;
      return { ...d, fed, amt, fedAdj: d.adjFactor == null ? fed : fed * d.adjFactor, thresholdMultiple: mult,
        metThreshold: mult == null ? null : (mult >= 1 ? 1 : 0), zeroPA: d.pa == 1 && fed <= 0 && !d.recent,
        topCat: t ? t.cat : null, topShare: t ? t.share : null };
    });
  } });
dash.calc('desigHist', { inputs: ['desigCat', 'eventSel'], title: 'County designations, selected hazard', description: 'desigCat for the hazard filter (history views).',
  fn: (desigCat) => { const hz = HZ(); return desigCat.filter((d) => !hz || d.hazard === hz); } });
dash.calc('desigSel', { inputs: ['desigHist', 'eventSel'], title: 'County designations, selected hazard or event', description: 'desigHist, narrowed to the linked declaration when a mission is picked.',
  fn: (desigHist) => { const e = EVENT(); return e ? desigHist.filter((d) => String(d.disasterNumber) === e.disasterNumber) : desigHist; } });
dash.calc('swSel', { inputs: ['desigSel', 'counties', 'meta'], title: 'Statewide figures for the filters', description: 'Statewide totals for the hazard, categories and event picked.',
  fn: (h, counties, meta) => { const tested = h.filter((x) => x.metThreshold != null); const gross = d3.sum(h, (x) => x.grossAB || 0), deob = d3.sum(h, (x) => x.deobAB || 0);
    const pop = d3.sum(counties, (c) => c.pop); const fedAdj = d3.sum(h, (x) => x.fedAdj); const fed = d3.sum(h, (x) => x.fed);
    return [{ designations: h.length, fed, fedAdj, amt: d3.sum(h, (x) => x.amt), tested: tested.length, met: tested.filter((x) => x.metThreshold === 1).length,
      zeroPA: h.filter((x) => x.zeroPA).length, grossAB: gross, deobAB: deob, deobRateAB: gross ? deob / gross : null,
      ealPerCap: fedAdj / meta.years / pop, perResident: fed / pop }]; } });
dash.calc('eventCounties', { inputs: ['desigSel', 'eventSel'], title: 'Counties in the linked declaration', description: 'Per-county PA results for the event (empty when no event).',
  fn: (desigSel) => EVENT() ? desigSel.slice().sort((a, b) => (b.thresholdMultiple ?? -1) - (a.thresholdMultiple ?? -1) || a.county.localeCompare(b.county)) : [] });

dash.calc('countyHaz', { inputs: ['counties', 'desigHist', 'meta'], title: 'County scorecard for the filters',
  description: 'Designations, expected federal share per resident, threshold results and score per county.',
  fn: (counties, desigHist, meta) => {
    const YEARS = meta.years;
    const byCounty = d3.group(desigHist, (d) => d.county);
    const rows = counties.map((c) => {
      const h = byCounty.get(c.county) || [];
      const tested = h.filter((d) => d.metThreshold != null);
      const met = tested.filter((d) => d.metThreshold === 1).length;
      const adj = d3.sum(h, (d) => d.fedAdj);
      const rate = h.length / YEARS;
      return { county: c.county, region: c.region, econ: c.econ, pop: c.pop, paDR: h.length, ratePerYr: rate, p5yr: 1 - Math.exp(-5 * rate),
        fed: d3.sum(h, (d) => d.fed), fedAdj: adj, ealPerCap: adj / YEARS / c.pop, amt: d3.sum(h, (d) => d.amt),
        tested: tested.length, met, metRate: tested.length ? met / tested.length : 0,
        maxMultiple: tested.length ? d3.max(tested, (d) => d.thresholdMultiple) : null,
        zeroPA: h.filter((d) => d.zeroPA).length, lastDR: d3.max(h, (d) => d.declDate) || null,
        n_severe: c.n_severe, n_winter: c.n_winter, n_flooding: c.n_flooding, n_tropical: c.n_tropical, n_wildfire: c.n_wildfire };
    });
    // percentile rank with ties averaged (same as the workbook's method)
    const pct = (vals) => { const o = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = []; let i = 0;
      while (i < o.length) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = ((i + j) / 2 + 1) / o.length; i = j + 1; } return r; };
    const pf = pct(rows.map((r) => r.ratePerYr)), pe = pct(rows.map((r) => r.ealPerCap)), pm = pct(rows.map((r) => r.metRate));
    rows.forEach((r, i) => {
      r.score = Math.round(1000 * (pf[i] + pe[i] + pm[i]) / 3) / 10;
      r.tier = r.score <= 20 ? 'Very Low' : r.score <= 40 ? 'Low' : r.score <= 60 ? 'Moderate' : r.score <= 80 ? 'High' : 'Very High';
    });
    rows.sort((a, b) => b.score - a.score || a.county.localeCompare(b.county));
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  } });

dash.calc('regionHaz', { inputs: ['desigHist', 'counties', 'meta'], title: 'Regions and statewide for the filters',
  description: 'Designations, dollars and threshold results by region plus a statewide row.',
  fn: (d, counties, meta) => {
    const YEARS = meta.years;
    const groups = [...new Set(counties.map((c) => c.region))].sort().concat('Statewide');
    return groups.map((g) => {
      const cs = g === 'Statewide' ? counties : counties.filter((c) => c.region === g);
      const names = new Set(cs.map((c) => c.county)); const h = d.filter((x) => names.has(x.county));
      const tested = h.filter((x) => x.metThreshold != null); const met = tested.filter((x) => x.metThreshold === 1).length;
      const adj = d3.sum(h, (x) => x.fedAdj); const gross = d3.sum(h, (x) => x.grossAB || 0); const deob = d3.sum(h, (x) => x.deobAB || 0);
      return { region: g, designations: h.length, counties: cs.length, designationsPerCounty: h.length / cs.length, fed: d3.sum(h, (x) => x.fed), fedAdj: adj,
        amt: d3.sum(h, (x) => x.amt), ealPerCap: adj / YEARS / d3.sum(cs, (c) => c.pop), tested: tested.length, met, metRate: tested.length ? met / tested.length : null,
        zeroPA: h.filter((x) => x.zeroPA).length, grossAB: gross, deobAB: deob, deobRateAB: gross ? deob / gross : null,
        medianMultiple: d3.median(h, (x) => x.thresholdMultiple) ?? null };
    });
  } });

dash.calc('econHaz', { inputs: ['desigHist', 'counties', 'meta'], title: 'Economic status groups for the filters',
  description: 'Designations, dollars and threshold results by county economic status.',
  fn: (d, counties, meta) => ['Distressed', 'At-Risk', 'Transitional', 'Competitive', 'Attainment'].map((g) => {
    const cs = counties.filter((c) => c.econ === g); const names = new Set(cs.map((c) => c.county)); const h = d.filter((x) => names.has(x.county));
    const tested = h.filter((x) => x.metThreshold != null); const met = tested.filter((x) => x.metThreshold === 1).length;
    return { econ: g, countiesInGroup: cs.length, designationsPerCounty: cs.length ? h.length / cs.length : null,
      ealPerCap: d3.sum(h, (x) => x.fedAdj) / meta.years / d3.sum(cs, (c) => c.pop),
      metRate: tested.length ? met / tested.length : null, medianMultiple: d3.median(h, (x) => x.thresholdMultiple) ?? null, zeroPA: h.filter((x) => x.zeroPA).length };
  }) });

// ---- declarations with the picked categories applied (all hazards; disSel applies the hazard filter)
dash.calc('disCat', { inputs: ['disasters', 'desigCat'], title: 'Declarations, selected PA categories',
  description: 'Federal share by declaration (county and statewide applicants) and county threshold results.',
  fn: (disasters, desigCat) => {
    const cats = selCats(); const byDis = d3.group(desigCat, (d) => String(d.disasterNumber));
    return disasters.map((r) => {
      const fed = sumCats(r, 'fed', cats), amt = sumCats(r, 'amt', cats), t = topCat(r, cats);
      const cs = byDis.get(String(r.disasterNumber)) || []; const tested = cs.filter((x) => x.metThreshold != null);
      return { ...r, fed, amt, fedAdj: r.adjFactor == null ? fed : fed * r.adjFactor, topCat: t ? t.cat : null, topShare: t ? t.share : null,
        cMet: tested.filter((x) => x.metThreshold === 1).length, cTested: tested.length, cZero: cs.filter((x) => x.zeroPA).length,
        deobRateAB: r.grossAB ? r.deobAB / r.grossAB : null };
    });
  } });
dash.calc('disHist', { inputs: ['disCat', 'eventSel'], title: 'Declarations, selected hazard', description: 'disCat for the hazard filter (trend).',
  fn: (disCat) => { const hz = HZ(); return disCat.filter((r) => !hz || r.hazard === hz); } });
dash.calc('disSel', { inputs: ['disHist', 'eventSel'], title: 'Declarations, selected hazard or event', description: 'disHist, narrowed to the linked declaration when a mission is picked.',
  fn: (disHist) => { const e = EVENT(); return e ? disHist.filter((r) => String(r.disasterNumber) === e.disasterNumber) : disHist; } });

dash.calc('trendHaz', { inputs: ['disHist', 'meta'], title: 'Trend by year for the filters',
  description: 'Natural-hazard major disasters, county designations and federal share by declaration year.',
  fn: (disHist, meta) => {
    const d = disHist.filter((r) => r.type === 'DR' && !r.nonHazard);
    return d3.range(+meta.windowStart.slice(0, 4), +meta.asOf.slice(0, 4) + 1).map((y) => { const h = d.filter((r) => r.year === y);
      return { year: y, drs: h.length, counties: d3.sum(h, (r) => r.nCounties), fed: d3.sum(h, (r) => r.fed), fedAdj: d3.sum(h, (r) => r.fedAdj) }; });
  } });

dash.calc('hazCat', { inputs: ['hazards', 'disCat', 'desigCat'], title: 'Hazard types for the PA categories',
  description: 'Static declaration counts plus federal share and threshold results for the picked categories (all hazards).',
  fn: (hazards, disCat, desigCat) => hazards.map((h) => {
    const dr = disCat.filter((r) => r.type === 'DR' && !r.nonHazard && r.hazard === h.hazard);
    const cats = selCats(); const tot = {}; cats.forEach((c) => { tot[c] = d3.sum(dr, (r) => Math.max(0, r[`fed_${c}`] || 0)); });
    const all = d3.sum(cats, (c) => tot[c]); const top = cats.slice().sort((a, b) => tot[b] - tot[a])[0];
    const cs = desigCat.filter((x) => x.hazard === h.hazard && x.metThreshold != null);
    return { ...h, medFedAdjPerDR: d3.median(dr, (r) => r.fedAdj) ?? null, topCat: all ? top : null, topShare: all ? tot[top] / all : null,
      met: cs.filter((x) => x.metThreshold === 1).length, tested: cs.length };
  }) });

// ---- selected county
dash.calc('countyPick', { inputs: ['countyHaz'], title: 'Selected county', description: 'The county picked on the map or list (highest score if none).',
  fn: (countyHaz) => { const want = dash.params().county; const r = countyHaz.find((c) => c.county === want) || countyHaz[0]; return r ? [r] : []; } });
dash.calc('countyHist', { inputs: ['desigHist', 'countyHaz'], title: 'Selected county designations', description: 'PA major-disaster designations for the picked county.',
  fn: (desigHist, countyHaz) => { const c = dash.params().county || (countyHaz[0] && countyHaz[0].county);
    return desigHist.filter((d) => d.county === c).sort((a, b) => b.declDate.localeCompare(a.declDate)); } });
dash.calc('countyCompare', { inputs: ['countyHaz', 'regionHaz'], title: 'County vs region vs state', description: 'Picked county beside its region average and the statewide average.',
  fn: (countyHaz, regionHaz) => {
    const want = dash.params().county; const c = countyHaz.find((x) => x.county === want) || countyHaz[0];
    if (!c) return [];
    const reg = regionHaz.find((r) => r.region === c.region), sw = regionHaz.find((r) => r.region === 'Statewide');
    return [
      { level: c.county, designations: c.paDR, ealPerCap: c.ealPerCap },
      { level: `${c.region} region`, designations: reg ? reg.designationsPerCounty : null, ealPerCap: reg ? reg.ealPerCap : null },
      { level: 'Statewide', designations: sw ? sw.designationsPerCounty : null, ealPerCap: sw ? sw.ealPerCap : null }];
  } });
dash.calc('neverMetHaz', { inputs: ['countyHaz'], title: 'Counties that never met the indicator', description: 'Designated counties where no designation met the countywide indicator.',
  fn: (countyHaz) => countyHaz.filter((r) => r.met === 0 && r.paDR > 0).sort((a, b) => a.paDR - b.paDR || a.county.localeCompare(b.county))
    .map((r) => ({ county: r.county, region: r.region, econ: r.econ, paDR: r.paDR, maxMultiple: r.maxMultiple, zeroPA: r.zeroPA })) });
dash.calc('neverMetCount', { inputs: ['neverMetHaz'], title: 'Count of counties that never met', description: 'Rows in the never-met list.', fn: (n) => n.length });
dash.calc('emNotCarriedCount', { inputs: ['emNotCarried'], title: 'EM designations not carried', description: 'County designations in an EM left out of the following DR.', fn: (e) => e.length });

// ---- damage assessments (rows come from ArcGIS via js/da.js, training already removed)
const DA_LEVELS = ['Destroyed', 'Major', 'Minor', 'Affected', 'Inaccessible'];
const DA_EVENT_HAZARD = { tornado: 'Severe storms & tornadoes', flood: 'Flooding' };
dash.calc('daLinked', { inputs: ['damageAssessments', 'missions', 'disasters'], title: 'Damage assessments linked to declarations',
  description: 'Each assessment with its mission linked to a FEMA declaration through the mission crosswalk (major declaration preferred).',
  fn: (rows, missions, disasters) => {
    const dis = new Map(disasters.map((d) => [String(d.disasterNumber), d]));
    const link = new Map();
    missions.forEach((m) => { const k = `${m.year}-${m.missionNumber}`; const cur = link.get(k);
      if (!cur || (m.type === 'DR' && cur.type !== 'DR')) link.set(k, m); });
    return rows.map((r) => { const m = link.get(`${r.year}-${r.mission}`); const d = m ? dis.get(String(m.disasterNumber)) : null;
      return { ...r, disasterNumber: m ? String(m.disasterNumber) : null, linkVerified: m ? !!m.verified : null,
        hazard: d ? d.hazard : (m && m.hazard) || DA_EVENT_HAZARD[r.event] || null, hazardFrom: d || (m && m.hazard) ? 'declaration' : DA_EVENT_HAZARD[r.event] ? 'event type' : null }; });
  } });
dash.calc('daSel', { inputs: ['daLinked', 'eventSel'], title: 'Damage assessments for the filters', description: 'Hazard filter and mission filter applied.',
  fn: (rows) => { const hz = HZ(), m = dash.params().daMission || ''; return rows.filter((r) => (!hz || r.hazard === hz) && (!m || r.missionKey === m)); } });
const daTally = (h) => { const o = { total: h.length }; DA_LEVELS.forEach((l) => { o[l] = h.filter((r) => r.level === l).length; }); return o; };
dash.calc('daCounty', { inputs: ['daSel', 'counties'], title: 'Damage assessments by county', description: 'Count by damage level per county.',
  fn: (rows, counties) => { const g = d3.group(rows, (r) => r.county);
    return counties.map((c) => ({ county: c.county, region: c.region, ...daTally(g.get(c.county) || []) })).map((r) => ({ ...r, severe: r.Destroyed + r.Major })); } });
dash.calc('daMissions', { inputs: ['daLinked', 'disasters'], title: 'Damage assessments by mission', description: 'One row per mission (hazard filter applied, mission filter not).',
  fn: (rows, disasters) => { const hz = dash.params().hazard || ''; const dis = new Map(disasters.map((d) => [String(d.disasterNumber), d]));
    return Array.from(d3.group(rows.filter((r) => !hz || r.hazard === hz), (r) => r.missionKey), ([k, h]) => {
      const f = h[0]; const d = f.disasterNumber ? dis.get(f.disasterNumber) : null;
      return { missionKey: k, year: f.year, mission: f.mission, disasterNumber: f.disasterNumber, linkVerified: f.linkVerified,
        declaration: d ? `${d.type}-${d.disasterNumber}` : (f.disasterNumber ? `#${f.disasterNumber}` : ''), hazard: f.hazard,
        counties: new Set(h.map((r) => r.county).filter(Boolean)).size, first: d3.min(h, (r) => r.date), last: d3.max(h, (r) => r.date), ...daTally(h) };
    }).sort((a, b) => b.year - a.year || b.total - a.total); } });
dash.calc('daKpi', { inputs: ['daSel'], title: 'Damage assessment totals', description: 'Totals for the filters.',
  fn: (rows) => { const ins = rows.filter((r) => ['yes', 'no', 'partial'].includes(r.insured)); const fz = rows.filter((r) => r.floodZone);
    return [{ ...daTally(rows), insuredKnown: ins.length, insuredYes: ins.filter((r) => r.insured !== 'no').length,
      zoneKnown: fz.length, inSfha: fz.filter((r) => /^A|^V/i.test(r.floodZone)).length, missions: new Set(rows.map((r) => r.missionKey)).size,
      counties: new Set(rows.map((r) => r.county).filter(Boolean)).size, first: d3.min(rows, (r) => r.date), last: d3.max(rows, (r) => r.date) }]; } });
dash.calc('daDwelling', { inputs: ['daSel'], title: 'Damage assessments by structure type', description: 'Count by dwelling type and level.',
  fn: (rows) => Array.from(d3.group(rows, (r) => r.dwelling || 'Not recorded'), ([k, h]) => ({ dwelling: k, ...daTally(h) })).sort((a, b) => b.total - a.total) });
dash.calc('daPick', { inputs: ['daSel', 'countyHaz'], title: 'Damage assessments in the selected county', description: 'Totals and missions for the picked county.',
  fn: (rows, countyHaz) => { const c = dash.params().county || (countyHaz[0] && countyHaz[0].county); const h = rows.filter((r) => r.county === c);
    return [{ county: c, ...daTally(h), missions: [...new Set(h.map((r) => `${r.year} #${r.mission}`))].join(', ') }]; } });
dash.calc('daByDisaster', { inputs: ['daLinked'], title: 'Damage assessments per declaration', description: 'Count of linked assessments per declaration.',
  fn: (rows) => Array.from(d3.rollup(rows.filter((r) => r.disasterNumber), (h) => h.length, (r) => r.disasterNumber), ([k, n]) => ({ disasterNumber: k, n })) });
