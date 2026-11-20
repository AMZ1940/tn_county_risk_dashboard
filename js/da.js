/* Damage assessments, loaded live from an ArcGIS feature layer after sign-in.
   Only the fields needed for counts are requested (no names, addresses or parcel details), and the
   records stay in the browser; nothing is saved to the GitHub site.

   Set DA_LAYER_URL below to the layer's REST URL, ending in /FeatureServer/<layer number>.
   Field names are found from the layer's field aliases (the column headers in PREDs_Fields.xlsx),
   so they don't need to be typed here unless an alias changes. */
(function () {
  "use strict";
  const CONFIG = {
    DA_LAYER_URL: "",              // e.g. "https://services.arcgis.com/<org id>/arcgis/rest/services/<service>/FeatureServer/0"
    TRAINING_MISSION_NUMBER: 999,  // mission number used for training exercises
    // logical field -> aliases or names to look for (first match wins)
    FIELDS: {
      mission: ["Mission Number:", "Mission Number", "mission_number"],
      year: ["Year"],
      trainingOrMission: ["Select Training or Mission"],
      county: ["County:", "County"],
      countyCalc: ["county_calc"],
      region: ["TEMA Region"],
      event: ["What event type caused the damage?"],
      dwelling: ["dwelling_type", "Dwelling Type"],
      level: ["level", "assessment_level"],
      assessed: ["Date & Time of assessment:"],
      created: ["CreationDate"],
      insured: ["Is there insurance for this structure? (Optional)"],
      owner: ["Owner or Renter? (Optional)"],
      floodZone: ["FEMA Flood Zone"],
      softDelete: ["Soft Delete"],
    },
  };
  const NAME = "damageAssessments";
  const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const LEVELS = { destroyed: "Destroyed", major: "Major", minor: "Minor", affected: "Affected", inaccessible: "Inaccessible", inacessible: "Inaccessible" };
  const titleCounty = (s) => {
    const t = String(s || "").replace(/\s+county$/i, "").trim();
    if (!t) return null;
    const fix = { dekalb: "DeKalb", mcminn: "McMinn", mcnairy: "McNairy" };
    return fix[t.toLowerCase()] || t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).replace(/^Van buren$/i, "Van Buren");
  };

  function request(esriRequest, url, query) {
    return esriRequest(url, { query: { f: "json", ...query }, responseType: "json" }).then((r) => {
      if (r.data && r.data.error) throw new Error(r.data.error.message || "ArcGIS error");
      return r.data;
    });
  }

  async function loadAll(esriRequest) {
    const url = CONFIG.DA_LAYER_URL.replace(/\/+$/, "");
    const info = await request(esriRequest, url, {});
    const byKey = new Map();
    (info.fields || []).forEach((f) => { byKey.set(key(f.alias), f.name); byKey.set(key(f.name), f.name); });
    const F = {};
    Object.entries(CONFIG.FIELDS).forEach(([k, opts]) => { F[k] = opts.map((o) => byKey.get(key(o))).find(Boolean) || null; });
    const missing = ["mission", "level"].filter((k) => !F[k]).concat(!F.county && !F.countyCalc ? ["county"] : []);
    if (missing.length) throw new Error(`The layer is missing expected fields: ${missing.join(", ")}. Check CONFIG.FIELDS in js/da.js.`);
    const types = new Map((info.fields || []).map((f) => [f.name, f.type]));
    const str = (n) => types.get(n) === "esriFieldTypeString";
    const where = ["1=1"];
    if (F.trainingOrMission) where.push(`(${F.trainingOrMission} IS NULL OR ${F.trainingOrMission} <> 'Training')`);
    if (F.softDelete) where.push(`(${F.softDelete} IS NULL OR ${F.softDelete} <> 'yes')`);
    where.push(str(F.mission) ? `(${F.mission} IS NULL OR ${F.mission} <> '${CONFIG.TRAINING_MISSION_NUMBER}')`
                              : `(${F.mission} IS NULL OR ${F.mission} <> ${CONFIG.TRAINING_MISSION_NUMBER})`);
    const outFields = [...new Set(Object.values(F).filter(Boolean))].join(",");
    const page = Math.min(info.maxRecordCount || 1000, 2000);
    const oid = info.objectIdField || (info.fields || []).find((f) => f.type === "esriFieldTypeOID")?.name;
    let offset = 0, feats = [];
    for (;;) {
      const q = { where: where.join(" AND "), outFields, returnGeometry: false, resultOffset: offset, resultRecordCount: page };
      if (oid) q.orderByFields = oid;
      const data = await request(esriRequest, `${url}/query`, q);
      feats = feats.concat(data.features || []);
      if (!data.exceededTransferLimit && (data.features || []).length < page) break;
      if (!(data.features || []).length) break;
      offset += (data.features || []).length;
    }
    const rows = [];
    feats.forEach(({ attributes: a }) => {
      const g = (k) => (F[k] ? a[F[k]] : null);
      if (String(g("trainingOrMission") || "").toLowerCase() === "training") return;            // never keep training records
      if (String(g("softDelete") || "").toLowerCase() === "yes") return;
      const mission = g("mission") == null || g("mission") === "" ? null : parseInt(g("mission"), 10);
      if (mission === CONFIG.TRAINING_MISSION_NUMBER) return;
      const when = g("assessed") || g("created");
      const d = when == null ? null : new Date(typeof when === "number" ? when : Date.parse(when));
      const yr = g("year") ? parseInt(g("year"), 10) : (d ? d.getUTCFullYear() : null);
      const lvl = LEVELS[String(g("level") || "").toLowerCase().trim()] || null;
      if (mission == null || !lvl) return;
      rows.push({ mission, year: yr, missionKey: `${yr}-${mission}`, county: titleCounty(g("county") || g("countyCalc")), region: g("region"),
        event: String(g("event") || "").toLowerCase().trim() || null, dwelling: g("dwelling"), level: lvl,
        date: d && !isNaN(d) ? d.toISOString().slice(0, 10) : null, insured: String(g("insured") || "").toLowerCase() || null,
        owner: String(g("owner") || "").toLowerCase() || null, floodZone: g("floodZone") ? String(g("floodZone")).trim() : null });
    });
    return rows;
  }

  window.DA = {
    load() {
      if (!CONFIG.DA_LAYER_URL) {
        dash.setData(NAME, "error", null, "Damage assessments aren't connected yet: add the ArcGIS layer URL to DA_LAYER_URL in js/da.js.");
        return;
      }
      dash.setData(NAME, "loading", null, "Loading damage assessments from ArcGIS…");
      if (typeof window.require !== "function") { dash.setData(NAME, "error", null, "The ArcGIS Maps SDK didn't load, so damage assessments can't be read."); return; }
      window.require(["esri/request"], (esriRequest) => {
        loadAll(esriRequest)
          .then((rows) => dash.setData(NAME, "ok", rows))
          .catch((e) => { console.error("damage assessments", e); dash.setData(NAME, "error", null, `Damage assessments couldn't be loaded: ${e && e.message ? e.message : e}`); });
      }, (e) => dash.setData(NAME, "error", null, `Damage assessments couldn't be loaded: ${e && e.message}`));
    },
  };
})();
