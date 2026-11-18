/*
 * dash-runtime.js — a small stand-alone engine for this dashboard.
 *
 *   dash.calc(name, { inputs, fn })   derived table, recomputed when filters change
 *   dash.draw(name, fn(el))           fills every element with data-draw="name"
 *   dash.data(name)                   -> { status: 'loading' | 'ok' | 'error', data }
 *   dash.params() / setParams / resetParams   filter state, kept in the URL (#hazard=...&county=...)
 *   dash.colors                       series colours
 *
 * Datasets are plain JSON files in /data, listed in DATASETS below. Nothing loads until
 * dash.start() is called (js/auth.js calls it after ArcGIS sign-in).
 */
(function () {
  const DATASETS = {
    counties: 'data/counties.json',
    designations: 'data/designations.json',
    disasters: 'data/disasters.json',
    hazards: 'data/hazards.json',
    emNotCarried: 'data/emNotCarried.json',
    tnCounties: 'data/tnCounties.json',
  };

  const store = {};        // name -> { status, data }
  const calcs = [];        // { name, inputs, fn }
  const draws = new Map(); // name -> fn
  // only these keys are filters; anything else in the URL hash (e.g. an OAuth response) is ignored
  const PARAM_KEYS = ['hazard', 'county', 'mapMetric'];
  let params = readHash();

  function readHash() {
    const p = {};
    new URLSearchParams(location.hash.replace(/^#/, '')).forEach((v, k) => { if (v !== '' && PARAM_KEYS.includes(k)) p[k] = v; });
    return p;
  }
  function writeHash() {
    const s = new URLSearchParams(params).toString();
    // a sandboxed embed may refuse history changes; filters still work, the link just won't update
    try { history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search); } catch (e) { /* ignore */ }
  }

  function runCalcs() {
    calcs.forEach((c) => { store[c.name] = { status: 'loading', data: null }; });
    let left = calcs.slice(), progress = true;
    while (left.length && progress) {
      progress = false;
      left = left.filter((c) => {
        const ins = c.inputs.map((i) => store[i]);
        if (ins.some((s) => !s || s.status === 'loading')) return true;
        progress = true;
        if (ins.some((s) => s.status === 'error')) { store[c.name] = { status: 'error', data: null }; return false; }
        try { store[c.name] = { status: 'ok', data: c.fn(...ins.map((s) => s.data)) }; }
        catch (e) { console.error(`calc ${c.name}`, e); store[c.name] = { status: 'error', data: null }; }
        return false;
      });
    }
  }

  function runDraw(name, fn) {
    document.querySelectorAll(`[data-draw="${CSS.escape(name)}"]`).forEach((el) => {
      try { fn(el); } catch (e) { console.error(`draw ${name}`, e); }
    });
  }
  let queued = false;
  function render() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; runCalcs(); draws.forEach((fn, name) => runDraw(name, fn)); });
  }

  window.dash = {
    colors: ['#2f6db5', '#e0892b', '#3a9e6f', '#9a5cb4', '#c94a4a', '#6b7a8f'],
    calc(name, { inputs = [], fn }) { calcs.push({ name, inputs, fn }); render(); },
    draw(name, fn) { draws.set(name, fn); render(); },
    data(name) { return store[name] || { status: 'loading', data: null }; },
    params() { return { ...params }; },
    setParams(patch) {
      Object.entries(patch).forEach(([k, v]) => { if (v == null || v === '') delete params[k]; else params[k] = String(v); });
      writeHash(); render();
    },
    resetParams() { params = {}; writeHash(); render(); },
  };

  // Load the data. js/data-bundle.js carries every dataset in one script (works inside sandboxed
  // iframes such as the Experience Builder Embed widget); if it can't load, each file is fetched.
  let started = false;
  function setFrom(bundled) {
    Object.entries(DATASETS).forEach(([name, url]) => {
      if (bundled && bundled[name]) { store[name] = { status: 'ok', data: bundled[name] }; return; }
      store[name] = { status: 'loading', data: null };
      fetch(url)
        .then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); })
        .then((d) => { store[name] = { status: 'ok', data: d }; })
        .catch((e) => { console.error(e); store[name] = { status: 'error', data: null }; })
        .finally(render);
    });
    render();
  }
  window.dash.start = function () {
    if (started) { render(); return; }
    started = true;
    if (window.DASH_DATA) return setFrom(window.DASH_DATA);
    const sc = document.createElement('script');
    sc.src = 'js/data-bundle.js';
    sc.onload = () => setFrom(window.DASH_DATA);
    sc.onerror = () => setFrom(null);
    document.head.appendChild(sc);
  };
  window.dash.redraw = render;

  // keep filters in step with back/forward and pasted links
  window.addEventListener('hashchange', () => {
    params = readHash();
    document.querySelectorAll('[data-ctl]').forEach((s) => { s.value = params[s.dataset.ctl] || s.dataset.default || ''; });
    render();
  });
  // charts size to their box, so redraw when the window (or an ArcGIS embed frame) is resized
  let w = window.innerWidth, t;
  window.addEventListener('resize', () => {
    if (window.innerWidth === w) return;
    w = window.innerWidth; clearTimeout(t); t = setTimeout(() => draws.forEach((fn, name) => runDraw(name, fn)), 150);
  });
})();
