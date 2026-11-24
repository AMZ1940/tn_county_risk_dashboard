// Calculations. Everything here re-computes for the filters in the filter bar:
//   hazard (""= all natural hazards), PA categories (cats), missions left out of the history (xm), current missions (cm).
const HZ = () => dash.params().hazard || '';
// Missions: xm = left out of the history (e.g. a mission still under way), cm = the current mission(s) being tracked
const keySet = (p) => new Set(String(dash.params()[p] || '').split(',').filter(Boolean));
const XM = () => keySet('xm');
const CM = () => keySet('cm');
const missionLink = (missions) => { const link = new Map();
  missions.forEach((m) => { const k = `${m.year}-${m.missionNumber}`; const cur = link.get(k); if (!cur || (m.type === 'DR' && cur.type !== 'DR')) link.set(k, m); });
  return link; };
const ALL_CATS = 'ABCDEFGZ'.split('');
const DEFAULT_CATS = 'ABCDEFG';
const selCats = () => { const c = (dash.params().cats || DEFAULT_CATS).toUpperCase().split('').filter((x) => ALL_CATS.includes(x)); return c.length ? c : DEFAULT_CATS.split(''); };
const sumCats = (r, pre, cats) => cats.reduce((s, c) => s + (r[`${pre}_${c}`] || 0), 0);
const topCat = (r, cats) => { let best = null, v = 0, tot = 0; cats.forEach((c) => { const x = Math.max(0, r[`fed_${c}`] || 0); tot += x; if (x > v) { v = x; best = c; } }); return best ? { cat: best, share: v / tot } : null; };

dash.calc('xDrs', { inputs: ['missions'], title: 'Declarations left out of the history', description: 'Declarations linked to missions unchecked in the mission list.',
  fn: (missions) => { const x = XM(); return [...new Set(missions.filter((m) => x.has(`${m.year}-${m.missionNumber}`)).map((m) => String(m.disasterNumber)))]; } });

// ---- PA: county designations with the picked categories applied
dash.calc('desigCat', { inputs: ['designations'], title: 'County designations, selected PA categories',
  description: 'Federal share, total project cost and threshold test for the picked categories.',
  fn: (designations) => {
    const cats = selCats();
    return designations.map((d) => {
      const fed = sumCats(d, 'fed', cats), amt = sumCats(d, 'amt', cats);
      const t = topCat(d, cats);
      const mult = d.threshold ? amt / d.threshold : null;
      return { ...d, fed, amt, fedAdj: d.adjFactor == null ? fed : fed * d.adjFactor, amtAdj: d.adjFactor == null ? amt : amt * d.adjFactor, thresholdMultiple: mult,
        metThreshold: mult == null ? null : (mult >= 1 ? 1 : 0), zeroPA: d.pa == 1 && fed <= 0 && !d.recent,
        topCat: t ? t.cat : null, topShare: t ? t.share : null };
    });
  } });
dash.calc('desigHist', { inputs: ['desigCat', 'xDrs'], title: 'County designations, selected hazard', description: 'desigCat for the hazard filter, without declarations left out of the history.',
  fn: (desigCat, xDrs) => { const hz = HZ(), x = new Set(xDrs); return desigCat.filter((d) => (!hz || d.hazard === hz) && !x.has(String(d.disasterNumber))); } });
dash.calc('desigSel', { inputs: ['desigHist'], title: 'County designations for the filters', description: 'Same as desigHist.', fn: (d) => d });
dash.calc('swSel', { inputs: ['desigSel', 'counties', 'meta'], title: 'Statewide figures for the filters', description: 'Statewide totals for the hazard, categories and event picked.',
  fn: (h, counties, meta) => { const tested = h.filter((x) => x.metThreshold != null); const gross = d3.sum(h, (x) => x.grossAB || 0), deob = d3.sum(h, (x) => x.deobAB || 0);
    const pop = d3.sum(counties, (c) => c.pop); const fedAdj = d3.sum(h, (x) => x.fedAdj); const fed = d3.sum(h, (x) => x.fed);
    return [{ designations: h.length, fed, fedAdj, amt: d3.sum(h, (x) => x.amt), tested: tested.length, met: tested.filter((x) => x.metThreshold === 1).length,
      zeroPA: h.filter((x) => x.zeroPA).length, grossAB: gross, deobAB: deob, deobRateAB: gross ? deob / gross : null,
      ealPerCap: fedAdj / meta.years / pop, perResident: fed / pop }]; } });
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
dash.calc('disHist', { inputs: ['disCat', 'xDrs'], title: 'Declarations, selected hazard', description: 'disCat for the hazard filter, without declarations left out of the history.',
  fn: (disCat, xDrs) => { const hz = HZ(), x = new Set(xDrs); return disCat.filter((r) => (!hz || r.hazard === hz) && !x.has(String(r.disasterNumber))); } });
dash.calc('disSel', { inputs: ['disHist'], title: 'Declarations for the filters', description: 'Same as disHist.', fn: (d) => d });
dash.calc('trendHaz', { inputs: ['disHist', 'meta'], title: 'Trend by year for the filters',
  description: 'Natural-hazard major disasters, county designations and federal share by declaration year.',
  fn: (disHist, meta) => {
    const d = disHist.filter((r) => r.type === 'DR' && !r.nonHazard);
    return d3.range(+meta.windowStart.slice(0, 4), +meta.asOf.slice(0, 4) + 1).map((y) => { const h = d.filter((r) => r.year === y);
      return { year: y, drs: h.length, counties: d3.sum(h, (r) => r.nCounties), fed: d3.sum(h, (r) => r.fed), fedAdj: d3.sum(h, (r) => r.fedAdj), amtAdj: d3.sum(h, (r) => r.adjFactor == null ? r.amt : r.amt * r.adjFactor) }; });
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
dash.calc('daLinked', { inputs: ['damageAssessments', 'missions', 'disasters', 'pdaCosts'], title: 'Damage assessments linked to declarations',
  description: 'Each assessment with its mission linked to a FEMA declaration (major declaration preferred) and its set dollar amount.',
  fn: (rows, missions, disasters, pdaCosts) => {
    const dis = new Map(disasters.map((d) => [String(d.disasterNumber), d])); const link = missionLink(missions);
    const cost = new Map(pdaCosts.map((c) => [String(c.dwelling || '').toLowerCase(), c]));
    return rows.map((r) => { const m = link.get(r.missionKey); const d = m ? dis.get(String(m.disasterNumber)) : null;
      const c = cost.get(String(r.dwelling || '').toLowerCase()); const est = c && c[r.level] != null && c[r.level] !== '' ? +c[r.level] : null;
      return { ...r, disasterNumber: m ? String(m.disasterNumber) : null, declType: m ? m.type : null, linkVerified: m ? !!m.verified : null, estCost: est,
        hazard: d ? d.hazard : (m && m.hazard) || DA_EVENT_HAZARD[r.event] || null }; });
  } });
// history set: hazard filter, without missions left out of the history
dash.calc('daSel', { inputs: ['daLinked'], title: 'Damage assessments in the history', description: 'Hazard filter applied; missions unchecked in the mission list left out.',
  fn: (rows) => { const hz = HZ(), x = XM(); return rows.filter((r) => (!hz || r.hazard === hz) && !x.has(r.missionKey)); } });
// current mission(s)
dash.calc('daCur', { inputs: ['daLinked'], title: 'Damage assessments for the current mission', description: 'Assessments in the missions marked current.',
  fn: (rows) => { const c = CM(); return c.size ? rows.filter((r) => c.has(r.missionKey)) : []; } });
const daTally = (h) => { const o = { total: h.length }; DA_LEVELS.forEach((l) => { o[l] = h.filter((r) => r.level === l).length; });
  const priced = h.filter((r) => r.estCost != null); o.priced = priced.length; o.estCost = priced.length ? d3.sum(priced, (r) => r.estCost) : null; o.avgCost = priced.length ? o.estCost / priced.length : null; return o; };
dash.calc('daCounty', { inputs: ['daSel', 'counties'], title: 'Damage assessments by county', description: 'Count by damage level per county.',
  fn: (rows, counties) => { const g = d3.group(rows, (r) => r.county);
    return counties.map((c) => ({ county: c.county, region: c.region, ...daTally(g.get(c.county) || []) })).map((r) => ({ ...r, severe: r.Destroyed + r.Major })); } });
dash.calc('daMissions', { inputs: ['daLinked', 'missions', 'disasters'], title: 'Damage assessment missions', description: 'Every mission in the damage assessment data and in the mission list, newest first.',
  fn: (rows, missions, disasters) => { const dis = new Map(disasters.map((d) => [String(d.disasterNumber), d])); const link = missionLink(missions);
    const keys = new Set([...rows.map((r) => r.missionKey)]);
    return Array.from(keys, (k) => { const h = rows.filter((r) => r.missionKey === k); const [yr, num] = k.split('-'); const m = link.get(k); const d = m ? dis.get(String(m.disasterNumber)) : null;
      return { missionKey: k, year: +yr, mission: +num, disasterNumber: m ? String(m.disasterNumber) : null, linkVerified: m ? !!m.verified : null,
        declaration: d ? `${d.type}-${d.disasterNumber}` : (m ? `#${m.disasterNumber}` : ''), hazard: d ? d.hazard : (h[0] && h[0].hazard) || null,
        counties: new Set(h.map((r) => r.county).filter(Boolean)).size, first: d3.min(h, (r) => r.date), last: d3.max(h, (r) => r.date), ...daTally(h) };
    }).sort((a, b) => b.year - a.year || b.mission - a.mission); } });
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

// ================= Declaration justification view =================
const fyNow = () => { const d = new Date(); return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear(); };
const indicatorNow = (meta, which = 'countywide') => {
  const t = (which === 'statewide' ? meta.statewideIndicators : meta.indicators) || {};
  const ys = Object.keys(t).map(Number).filter((y) => y <= fyNow()).sort((a, b) => a - b); const y = ys[ys.length - 1];
  return y ? { fy: y, value: +t[y] } : null; };
const adjAmt = (r) => (r.adjFactor == null ? r.amt : r.amt * r.adjFactor);
const jStats = (h, cs) => {
  const tested = h.filter((d) => d.metThreshold != null); const pop = d3.sum(cs, (c) => c.pop); const total = d3.sum(h, (d) => d.amtAdj);
  return { counties: cs.length, pop, designations: h.length, drs: new Set(h.map((d) => d.disasterNumber)).size, desigPerCounty: cs.length ? h.length / cs.length : null,
    totalAdj: total, avgPerDesig: h.length ? total / h.length : null, medPerDesig: h.length ? d3.median(h, (d) => d.amtAdj) : null,
    avgPerCapPerDesig: h.length ? d3.mean(h, (d) => d.amtAdj / d.pop) : null, maxPerDesig: h.length ? d3.max(h, (d) => d.amtAdj) : null,
    met: tested.filter((d) => d.metThreshold === 1).length, tested: tested.length, metRate: tested.length ? tested.filter((d) => d.metThreshold === 1).length / tested.length : null,
    medMultiple: tested.length ? d3.median(tested, (d) => d.thresholdMultiple) : null };
};

dash.calc('jState', { inputs: ['desigHist', 'disHist', 'counties', 'meta', 'daSel'], title: 'Statewide history for the event type',
  description: 'Major declarations of the event type: cost per declaration and per county designation, threshold results and damage assessments.',
  fn: (h, dis, counties, meta, da) => {
    const drs = dis.filter((r) => r.type === 'DR' && !r.nonHazard).map((r) => ({ ...r, amtAdj: adjAmt(r) }));
    const pop = meta.statePop; const st = indicatorNow(meta, 'statewide'); const ct = indicatorNow(meta);
    return [{ ...jStats(h, counties), drCount: drs.length, avgPerDR: drs.length ? d3.mean(drs, (r) => r.amtAdj) : null, medPerDR: drs.length ? d3.median(drs, (r) => r.amtAdj) : null,
      maxPerDR: drs.length ? d3.max(drs, (r) => r.amtAdj) : null, avgPerCapPerDR: drs.length ? d3.mean(drs, (r) => r.amtAdj / pop) : null,
      avgCountiesPerDR: drs.length ? d3.mean(drs, (r) => r.nCounties) : null, stateIndicator: st, countyIndicator: ct, stateThreshold: st ? st.value * pop : null,
      drsOverState: st ? drs.filter((r) => r.amtAdj / pop >= st.value).length : null, ...Object.fromEntries(Object.entries(daTally(da)).map(([k, v]) => [`da_${k}`, v])) }];
  } });

dash.calc('jRegions', { inputs: ['desigHist', 'counties', 'daSel'], title: 'Regions for the event type', description: 'Cost per county designation and threshold results by TEMA region, plus statewide.',
  fn: (h, counties, da) => { const regs = [...new Set(counties.map((c) => c.region))].sort();
    return regs.concat('Statewide').map((g) => { const cs = g === 'Statewide' ? counties : counties.filter((c) => c.region === g); const n = new Set(cs.map((c) => c.county));
      return { region: g, ...jStats(h.filter((d) => n.has(d.county)), cs), ...Object.fromEntries(Object.entries(daTally(da.filter((r) => n.has(r.county)))).map(([k, v]) => [`da_${k}`, v])) }; }); } });

dash.calc('jCounty', { inputs: ['desigHist', 'counties', 'countyHaz', 'daSel', 'meta'], title: 'Counties for the event type', description: 'Per-county history, today’s threshold and damage assessments.',
  fn: (h, counties, countyHaz, da, meta) => { const g = d3.group(h, (d) => d.county), dg = d3.group(da, (r) => r.county), ch = new Map(countyHaz.map((r) => [r.county, r]));
    const ind = indicatorNow(meta);
    return counties.map((c) => { const rows = g.get(c.county) || []; const x = ch.get(c.county) || {};
      return { county: c.county, region: c.region, econ: c.econ, pop: c.pop, ...jStats(rows, [c]), thresholdNow: ind ? ind.value * c.pop : null, indicatorFY: ind ? ind.fy : null,
        p5yr: x.p5yr, score: x.score, tier: x.tier, rank: x.rank, lastDR: d3.max(rows, (d) => d.declDate) || null,
        ...Object.fromEntries(Object.entries(daTally(dg.get(c.county) || [])).map(([k, v]) => [`da_${k}`, v])) }; }); } });

dash.calc('jEvents', { inputs: ['disHist', 'desigHist', 'daSel', 'meta'], title: 'Past major declarations of the event type', description: 'Total project cost per declaration, statewide per capita, counties meeting the indicator, and linked damage assessments.',
  fn: (dis, h, da, meta) => { const g = d3.group(h, (d) => String(d.disasterNumber)), dg = d3.group(da.filter((r) => r.disasterNumber), (r) => r.disasterNumber);
    return dis.filter((r) => r.type === 'DR' && !r.nonHazard).map((r) => { const cs = g.get(String(r.disasterNumber)) || []; const t = cs.filter((d) => d.metThreshold != null);
      const a = adjAmt(r); const p = daTally(dg.get(String(r.disasterNumber)) || []);
      return { disasterNumber: String(r.disasterNumber), title: r.title, hazard: r.hazard, declDate: r.declDate, year: r.year, nCounties: cs.length, amtAdj: a, perCapState: a / meta.statePop,
        countyAdj: d3.sum(cs, (d) => d.amtAdj), met: t.filter((d) => d.metThreshold === 1).length, tested: t.length, topCat: r.topCat, topShare: r.topShare,
        pdaN: p.total, pdaCost: p.estCost, combined: p.estCost != null ? a + p.estCost : null }; }).sort((x, y) => y.declDate.localeCompare(x.declDate)); } });

dash.calc('pdaMatrix', { inputs: ['daSel'], title: 'Average set cost per assessment by event type and dwelling', description: 'Damage assessments in the history, by recorded event type and dwelling type.',
  fn: (da) => { const ev = (r) => r.event === 'tornado' ? 'Tornado' : r.event === 'flood' ? 'Flood' : r.event ? 'Other' : 'Not recorded';
    const dw = [...new Set(da.map((r) => r.dwelling || 'Not recorded'))].sort();
    return dw.concat('All dwellings').map((w) => { const rows = w === 'All dwellings' ? da : da.filter((r) => (r.dwelling || 'Not recorded') === w); const o = { dwelling: w };
      ['Tornado', 'Flood', 'Other', 'Not recorded', 'All events'].forEach((e) => { const x = daTally(e === 'All events' ? rows : rows.filter((r) => ev(r) === e)); o[e] = x; });
      return o; }); } });

dash.calc('curMissions', { inputs: ['daMissions', 'missions', 'disasters'], title: 'Current missions', description: 'Missions marked current and the declarations they link to.',
  fn: (list, missions, disasters) => { const c = CM(); const link = missionLink(missions); const dis = new Map(disasters.map((d) => [String(d.disasterNumber), d]));
    return [...c].map((k) => { const m = link.get(k); const d = m ? dis.get(String(m.disasterNumber)) : null; const l = list.find((x) => x.missionKey === k) || {};
      const [yr, num] = k.split('-'); return { missionKey: k, label: `${yr} Mission #${num}`, disasterNumber: d ? String(d.disasterNumber) : null, declaration: d ? `${d.type}-${d.disasterNumber}` : null,
        declType: d ? d.type : null, title: d ? d.title : null, hazard: d ? d.hazard : l.hazard || null, verified: m ? !!m.verified : null, total: l.total || 0 }; }); } });

dash.calc('curCounties', { inputs: ['daCur', 'curMissions', 'desigCat', 'counties', 'meta'], title: 'Current mission by county', description: 'Damage assessments coming in, PA for any linked declaration so far, and today’s county threshold.',
  fn: (da, cur, desigCat, counties, meta) => { if (!cur.length) return [];
    const drs = new Set(cur.filter((m) => m.declType === 'DR').map((m) => m.disasterNumber)); const pa = desigCat.filter((d) => drs.has(String(d.disasterNumber)));
    const pg = d3.group(pa, (d) => d.county), dg = d3.group(da, (r) => r.county); const ind = indicatorNow(meta);
    const names = new Set([...pg.keys(), ...dg.keys()].filter(Boolean));
    return counties.filter((c) => names.has(c.county)).map((c) => { const p = pg.get(c.county) || []; const t = daTally(dg.get(c.county) || []);
      const amt = d3.sum(p, (d) => d.amt); const thr = ind ? ind.value * c.pop : null;
      return { county: c.county, region: c.region, pop: c.pop, designated: p.length > 0, paAmt: p.length ? amt : null, paFed: p.length ? d3.sum(p, (d) => d.fed) : null,
        thresholdNow: thr, paMultiple: p.length && thr ? amt / thr : null, ...Object.fromEntries(Object.entries(t).map(([k, v]) => [`da_${k}`, v])),
        combined: (p.length ? amt : 0) + (t.estCost || 0) }; }).sort((a, b) => (b.da_total || 0) - (a.da_total || 0) || (b.paAmt || 0) - (a.paAmt || 0)); } });
