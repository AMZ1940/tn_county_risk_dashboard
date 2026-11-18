
// ---- Everything below re-computes for the hazard picked in the filter bar ("" = all natural hazards)
dash.calc('countyHaz', { inputs: ['counties', 'designations'], title: 'County scorecard for the selected hazard',
  description: 'Designations, expected Cat A + B per resident, threshold results and score per county, for the hazard filter.',
  fn: (counties, designations) => {
    const hz = dash.params().hazard || '';
    const YEARS = (Date.UTC(2026, 10, 18) - Date.UTC(1999, 0, 1)) / 864e5 / 365.25; // analysis window, Jan 1 1999 - Nov 18 2026
    const byCounty = d3.group(designations.filter((d) => !hz || d.hazard === hz), (d) => d.county);
    const rows = counties.map((c) => {
      const h = byCounty.get(c.county) || [];
      const tested = h.filter((d) => d.metThreshold != null);
      const met = tested.filter((d) => d.metThreshold == 1).length;
      const adj = d3.sum(h, (d) => d.netAdj ?? d.net);
      const rate = h.length / YEARS;
      return { county: c.county, region: c.region, econ: c.econ, pop: c.pop, paDR: h.length, ratePerYr: rate, p5yr: 1 - Math.exp(-5 * rate),
        netAB: d3.sum(h, (d) => d.net), netABAdj: adj, ealPerCap: adj / YEARS / c.pop, gross: d3.sum(h, (d) => d.gross), deob: d3.sum(h, (d) => d.deob),
        tested: tested.length, met, metRate: tested.length ? met / tested.length : 0,
        maxMultiple: tested.length ? d3.max(tested, (d) => d.thresholdMultiple) : null,
        zeroPA: h.filter((d) => d.zeroPA === true).length, lastDR: d3.max(h, (d) => d.declDate) || null,
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

dash.calc('regionHaz', { inputs: ['designations', 'counties'], title: 'Regions and statewide for the selected hazard',
  description: 'Designations, dollars and threshold results by region plus a statewide row, for the hazard filter.',
  fn: (designations, counties) => {
    const hz = dash.params().hazard || '';
    const YEARS = (Date.UTC(2026, 10, 18) - Date.UTC(1999, 0, 1)) / 864e5 / 365.25;
    const d = designations.filter((x) => !hz || x.hazard === hz);
    const groups = [...new Set(counties.map((c) => c.region))].sort().concat('Statewide');
    return groups.map((g) => {
      const cs = g === 'Statewide' ? counties : counties.filter((c) => c.region === g);
      const names = new Set(cs.map((c) => c.county)); const h = d.filter((x) => names.has(x.county));
      const tested = h.filter((x) => x.metThreshold != null); const met = tested.filter((x) => x.metThreshold == 1).length;
      const adj = d3.sum(h, (x) => x.netAdj ?? x.net); const gross = d3.sum(h, (x) => x.gross); const deob = d3.sum(h, (x) => x.deob);
      return { region: g, designations: h.length, counties: cs.length, designationsPerCounty: h.length / cs.length, netABAdj: adj,
        ealPerCap: adj / YEARS / d3.sum(cs, (c) => c.pop), tested: tested.length, met, metRate: tested.length ? met / tested.length : null,
        zeroPA: h.filter((x) => x.zeroPA === true).length, gross, deob, deobRate: gross ? deob / gross : null, medianMultiple: d3.median(h, (x) => x.thresholdMultiple) ?? null };
    });
  } });

dash.calc('econHaz', { inputs: ['designations', 'counties'], title: 'Economic status groups for the selected hazard',
  description: 'Designations, dollars and threshold results by county economic status, for the hazard filter.',
  fn: (designations, counties) => {
    const hz = dash.params().hazard || '';
    const YEARS = (Date.UTC(2026, 10, 18) - Date.UTC(1999, 0, 1)) / 864e5 / 365.25;
    const d = designations.filter((x) => !hz || x.hazard === hz);
    return ['Distressed', 'At-Risk', 'Transitional', 'Competitive', 'Attainment'].map((g) => {
      const cs = counties.filter((c) => c.econ === g); const names = new Set(cs.map((c) => c.county)); const h = d.filter((x) => names.has(x.county));
      const tested = h.filter((x) => x.metThreshold != null); const met = tested.filter((x) => x.metThreshold == 1).length;
      const adj = d3.sum(h, (x) => x.netAdj ?? x.net);
      return { econ: g, countiesInGroup: cs.length, designationsPerCounty: cs.length ? h.length / cs.length : null, ealPerCap: adj / YEARS / d3.sum(cs, (c) => c.pop),
        metRate: tested.length ? met / tested.length : null, medianMultiple: d3.median(h, (x) => x.thresholdMultiple) ?? null, zeroPA: h.filter((x) => x.zeroPA === true).length };
    });
  } });

dash.calc('trendHaz', { inputs: ['disasters'], title: 'Trend by year for the selected hazard',
  description: 'Natural-hazard major disasters, county designations and Cat A + B dollars by declaration year.',
  fn: (disasters) => {
    const hz = dash.params().hazard || '';
    const d = disasters.filter((r) => r.type === 'DR' && !r.nonHazard && (!hz || r.hazard === hz));
    return d3.range(1999, 2027).map((y) => { const h = d.filter((r) => r.year === y);
      return { year: y, drs: h.length, counties: d3.sum(h, (r) => r.nCounties), net: d3.sum(h, (r) => r.net), netAdj: d3.sum(h, (r) => r.netAdj ?? r.net) }; });
  } });

dash.calc('countyPick', { inputs: ['countyHaz'], title: 'Selected county', description: 'The county picked on the map or list (highest score if none).',
  fn: (countyHaz) => { const want = dash.params().county; const r = countyHaz.find((c) => c.county === want) || countyHaz[0]; return r ? [r] : []; } });
dash.calc('countyHist', { inputs: ['designations', 'countyHaz'], title: 'Selected county designations', description: 'PA major-disaster designations for the picked county and hazard.',
  fn: (designations, countyHaz) => { const hz = dash.params().hazard || ''; const c = dash.params().county || (countyHaz[0] && countyHaz[0].county);
    return designations.filter((d) => d.county === c && (!hz || d.hazard === hz)).sort((a, b) => b.declDate.localeCompare(a.declDate)); } });
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
dash.calc('neverMetHaz', { inputs: ['countyHaz'], title: 'Counties that never met the indicator', description: 'Counties with no designation where Cat A + B alone met the countywide indicator, for the hazard filter.',
  fn: (countyHaz) => countyHaz.filter((r) => r.met === 0 && r.paDR > 0).sort((a, b) => a.paDR - b.paDR || a.county.localeCompare(b.county))
    .map((r) => ({ county: r.county, region: r.region, econ: r.econ, paDR: r.paDR, maxMultiple: r.maxMultiple, zeroPA: r.zeroPA })) });
dash.calc('neverMetCount', { inputs: ['neverMetHaz'], title: 'Count of counties that never met', description: 'Number of rows in the never-met list.', fn: (neverMetHaz) => neverMetHaz.length });
dash.calc('emNotCarriedCount', { inputs: ['emNotCarried'], title: 'EM designations not carried', description: 'County designations in an emergency declaration that the following major declaration left out.', fn: (emNotCarried) => emNotCarried.length });

