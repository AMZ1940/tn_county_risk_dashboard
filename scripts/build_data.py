"""Build the dashboard's data from the files in source/.

Replaceable inputs (drop a newer copy into source/ and run this script, or let the GitHub Action run it):
  *DisasterDeclarationsSummaries*.csv        OpenFEMA Disaster Declarations Summaries (v2). Any states; only TN is kept.
  *PublicAssistanceFundedProjectsDetails*.csv OpenFEMA PA Funded Projects Details (v1). Any states; only TN is kept.
  Mission_Numbers.xlsx                       TEMA mission number -> FEMA disaster number (optional).

Reference inputs (change only when needed):
  tn_counties.csv                 county, FIPS, TEMA region, economic status, 2020 population
  fema_per_capita_indicators.csv  FEMA countywide (and, where verified, statewide) per capita indicator by fiscal year
  pda_unit_costs.csv              set dollar amount per damage assessment, by dwelling type and damage level
  grrf_deobligations_AB.csv       Cat A + B gross obligations and deobligations from the GRRF workbook
                                  (the OpenFEMA project file has no deobligation history)
  tnCounties.geojson              county outlines for the map

Outputs: data/*.json, js/data-bundle.js, downloads/TN_County_Disaster_Risk_Tables.xlsx

    python scripts/build_data.py
"""
import glob
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC, DATA = ROOT / "source", ROOT / "data"
DATA.mkdir(exist_ok=True)
STATE = "TN"
WINDOW_START = pd.Timestamp("1999-01-01")   # OpenFEMA PA project records for Tennessee start with DR-1260 (1999)
CATS = list("ABCDEFGZ")
CAT_NAMES = {"A": "Debris removal", "B": "Emergency protective measures", "C": "Roads and bridges",
             "D": "Water control facilities", "E": "Buildings and equipment", "F": "Utilities",
             "G": "Parks, recreational and other", "Z": "Management costs"}
DEFAULT_CATS = list("ABCDEFG")
HAZ_GROUP = {"Severe Storm": "Severe storms & tornadoes", "Severe Storm(s)": "Severe storms & tornadoes",
             "Tornado": "Severe storms & tornadoes", "Flood": "Flooding", "Winter Storm": "Winter storms & ice",
             "Severe Ice Storm": "Winter storms & ice", "Snowstorm": "Winter storms & ice", "Hurricane": "Tropical",
             "Tropical Storm": "Tropical", "Fire": "Wildfire", "Biological": "Pandemic", "Other": "Other"}
# Declarations that are not local hazard damage (kept, but left out of the hazard risk model)
NON_HAZARD = {"3217": "Evacuation sheltering (Hurricane Katrina)", "3552": "Explosion (Nashville, 2020)"}


def find(pattern, required=True):
    hits = sorted(glob.glob(str(SRC / pattern)), key=lambda p: Path(p).stat().st_mtime)
    if not hits:
        if required:
            sys.exit(f"Missing input: source/{pattern}")
        return None
    if len(hits) > 1:
        print(f"note: {len(hits)} files match {pattern}; using the newest, {Path(hits[-1]).name}")
    return Path(hits[-1])


def read_state(path, state_col):
    """Read a (possibly nationwide) OpenFEMA CSV in chunks and keep Tennessee rows only."""
    parts = [c[c[state_col] == STATE] for c in pd.read_csv(path, dtype=str, chunksize=200_000)]
    return pd.concat(parts, ignore_index=True)


def fy(ts):
    return ts.year + 1 if ts.month >= 10 else ts.year


def date(s):
    return pd.to_datetime(s, utc=True, errors="coerce").dt.tz_localize(None).dt.normalize()


# ---------------------------------------------------------------- inputs
dec_path = find("*DisasterDeclarationsSummaries*.csv")
pa_path = find("*PublicAssistanceFundedProjectsDetails*.csv")
dec = read_state(dec_path, "state")
pa = read_state(pa_path, "stateAbbreviation")
cty = pd.read_csv(SRC / "tn_counties.csv", dtype={"fips": str})
ind_tbl = pd.read_csv(SRC / "fema_per_capita_indicators.csv")
IND = dict(zip(ind_tbl.fy.astype(int), ind_tbl.countywide.astype(float)))
IND_STATE = {int(y): float(v) for y, v in zip(ind_tbl.fy, ind_tbl.get("statewide", pd.Series(dtype=float))) if pd.notna(v)}
BASE_FY = 2026   # adjusted dollars are in this fiscal year's dollars (change to move the base year)
grrf = pd.read_csv(SRC / "grrf_deobligations_AB.csv", dtype={"disasterNumber": str, "county": str})
geo = json.loads((SRC / "tnCounties.geojson").read_text())
pda_costs = pd.read_csv(SRC / "pda_unit_costs.csv") if (SRC / "pda_unit_costs.csv").exists() else pd.DataFrame(columns=["dwelling_type"])

AS_OF = max(date(dec.lastRefresh).max(), date(pa.lastRefresh).max())
YEARS = (AS_OF - WINDOW_START).days / 365.25
by_fips = dict(zip(cty.fips.str[-3:], cty.county))
by_name = {c.lower(): c for c in cty.county}
pop = dict(zip(cty.county, cty.pop2020))
region = dict(zip(cty.county, cty.region))

# ---------------------------------------------------------------- declarations
dec["disasterNumber"] = dec.disasterNumber.astype(str)
for c in ["declarationDate", "incidentBeginDate", "incidentEndDate", "declarationRequestDate"]:
    dec[c] = date(dec[c])
for c in ["paProgramDeclared", "iaProgramDeclared", "hmProgramDeclared"]:
    dec[c] = pd.to_numeric(dec[c], errors="coerce").fillna(0).astype(int)
dec["county"] = dec.fipsCountyCode.str.zfill(3).map(by_fips)          # None for statewide / tribal areas
dis = (dec.groupby("disasterNumber")
       .agg(type=("declarationType", "first"), title=("declarationTitle", "first"), incident=("incidentType", "first"),
            declDate=("declarationDate", "first"), begin=("incidentBeginDate", "first"), end=("incidentEndDate", "first"),
            incidentId=("incidentId", "first"), nCounties=("county", "nunique"),
            paDeclared=("paProgramDeclared", "max"), iaDeclared=("iaProgramDeclared", "max"))
       .reset_index())
dis["hazard"] = dis.incident.map(HAZ_GROUP).fillna("Other")
dis["durationDays"] = (dis.end.fillna(dis.begin) - dis.begin).dt.days + 1
dis["daysToDeclare"] = (dis.declDate - dis.begin).dt.days
dis["fy"] = [fy(b) if fy(b) >= 2026 else fy(d) for b, d in zip(dis.begin, dis.declDate)]  # FY2026+: by incident start
dis["nonHazard"] = dis.disasterNumber.map(NON_HAZARD)
dis.loc[dis.hazard == "Pandemic", "nonHazard"] = "Pandemic (COVID-19)"
dis["inWindow"] = dis.declDate >= WINDOW_START
dis["blanket"] = dis.nCounties >= len(cty)

# escalation: an EM whose incident ID also has a DR; otherwise a DR within 120 days, overlapping incident
# period, sharing the most designated counties
dr_by_inc = dis[dis.type == "DR"].groupby("incidentId").disasterNumber.first()
dis["escalatedTo"] = np.where(dis.type == "EM", dis.incidentId.map(dr_by_inc), None)
areas = dec.groupby("disasterNumber").county.apply(lambda s: set(s.dropna()))
for i, r in dis[(dis.type == "EM") & dis.escalatedTo.isna()].iterrows():
    em_end = r.end if pd.notna(r.end) else r.begin
    cand = dis[(dis.type == "DR") & (dis.declDate >= r.declDate) & (dis.declDate <= r.declDate + pd.Timedelta(days=120))
               & (dis.begin <= em_end) & (dis.end.fillna(dis.begin) >= r.begin)]
    if len(cand):
        shared = cand.disasterNumber.map(lambda n: len(areas[n] & areas[r.disasterNumber]))
        if shared.max() > 0:
            dis.at[i, "escalatedTo"] = cand.disasterNumber[shared.idxmax()]

cd = (dec[dec.county.notna()].groupby(["disasterNumber", "county"])
      .agg(pa=("paProgramDeclared", "max"), ia=("iaProgramDeclared", "max")).reset_index()
      .merge(dis[["disasterNumber", "type", "declDate", "hazard", "incident", "fy", "nonHazard", "durationDays",
                  "escalatedTo", "inWindow", "blanket"]], on="disasterNumber"))

# ---------------------------------------------------------------- PA projects (all categories)
pa["disasterNumber"] = pa.disasterNumber.astype(str)
pa["cat"] = pa.damageCategoryCode.str.strip().str[0].str.upper()
pa["fed"] = pd.to_numeric(pa.federalShareObligated, errors="coerce").fillna(0)
pa["amt"] = pd.to_numeric(pa.projectAmount, errors="coerce").fillna(0)
name = pa.county.str.replace(r"\s+County$", "", regex=True).str.strip().str.lower().map(by_name)
prefix = pa.applicantId.str[:3].map(by_fips)        # applicant ID starts with the county FIPS code (000 = state)
pa["countyName"] = name.fillna(prefix.where(pa.county.isna()))
pa["bucket"] = np.where(pa.countyName.notna(), "county", np.where(pa.county.eq("Statewide"), "statewide", "other"))
pa["countyInferred"] = pa.county.isna() & pa.countyName.notna()


def cat_wide(df, keys):
    out = df.pivot_table(index=keys, columns="cat", values=["fed", "amt"], aggfunc="sum", fill_value=0)
    out.columns = [f"{v}_{c}" for v, c in out.columns]
    for c in CATS:
        for v in ("fed", "amt"):
            out[f"{v}_{c}"] = out.get(f"{v}_{c}", 0.0)
    return out[[f"{v}_{c}" for c in CATS for v in ("fed", "amt")]].reset_index()


pac = pa[pa.bucket == "county"].drop(columns="county").rename(columns={"countyName": "county"})
pa_cd = cat_wide(pac, ["disasterNumber", "county"])
pa_cd = pa_cd.merge(pac.groupby(["disasterNumber", "county"])
                    .agg(projects=("pwNumber", "count"), applicants=("applicantId", "nunique")).reset_index(),
                    on=["disasterNumber", "county"])
pa_d = cat_wide(pa, ["disasterNumber"]).merge(
    pa.assign(stw=np.where(pa.bucket == "county", 0, pa.fed)).groupby("disasterNumber").stw.sum().rename("statewideFed").reset_index(),
    on="disasterNumber")
CAT_COLS = [f"{v}_{c}" for c in CATS for v in ("fed", "amt")]

cd = cd.merge(pa_cd, on=["disasterNumber", "county"], how="left")
cd[CAT_COLS + ["projects", "applicants"]] = cd[CAT_COLS + ["projects", "applicants"]].fillna(0)
g_c = grrf[grrf.level == "county"].drop(columns="level")
cd = cd.merge(g_c, on=["disasterNumber", "county"], how="left")
cd["pop"] = cd.county.map(pop)
cd["indicator"] = cd.fy.map(IND)
cd["threshold"] = cd.indicator * cd["pop"]
cd["adjFactor"] = IND[BASE_FY] / cd.indicator                   # NaN before FY2002: no verified indicator, kept nominal
cd["recent"] = cd.declDate > (AS_OF - pd.DateOffset(years=2))   # obligations still being written
cd["region"] = cd.county.map(region)

dis = dis.merge(pa_d, on="disasterNumber", how="left")
dis[CAT_COLS + ["statewideFed"]] = dis[CAT_COLS + ["statewideFed"]].fillna(0)
dis["adjFactor"] = dis.fy.map(IND).rdiv(IND[BASE_FY])
g_d = grrf[grrf.level == "disaster"][["disasterNumber", "grossAB", "deobAB"]]
dis = dis.merge(g_d, on="disasterNumber", how="left")

# ---------------------------------------------------------------- model sets
H = cd[(cd.type == "DR") & (cd.pa == 1) & cd.nonHazard.isna() & cd.inWindow].copy()
D = dis[dis.inWindow].copy()

em_not_carried = []
for _, r in cd[(cd.type == "EM") & cd.escalatedTo.notna() & cd.nonHazard.isna() & cd.inWindow].iterrows():
    if not ((cd.disasterNumber == r.escalatedTo) & (cd.county == r.county)).any():
        em_not_carried.append({"em": r.disasterNumber, "dr": r.escalatedTo, "county": r.county, "region": r.region,
                               "hazard": r.hazard, "declDate": r.declDate})
em_not_carried = pd.DataFrame(em_not_carried, columns=["em", "dr", "county", "region", "hazard", "declDate"])

hz = []
for g, d in D[D.nonHazard.isna()].groupby("hazard"):
    dr, em = d[d.type == "DR"], d[d.type == "EM"]
    hz.append({"hazard": g, "declarations": len(d), "DR": len(dr), "EM": len(em), "FM": int((d.type == "FM").sum()),
               "emEscalated": int(em.escalatedTo.notna().sum()), "medDuration": d.durationDays.median(),
               "medDaysToDeclare": dr.daysToDeclare.median() if len(dr) else None,
               "medCounties": dr.nCounties.median() if len(dr) else None,
               "deobRateAB": dr.deobAB.sum() / dr.grossAB.sum() if dr.grossAB.sum() > 0 else None})
hz = pd.DataFrame(hz).sort_values("declarations", ascending=False)

counties = cty.rename(columns={"pop2020": "pop"}).copy()
hc = H.groupby(["county", "hazard"]).size().unstack(fill_value=0)
for g in ["Severe storms & tornadoes", "Winter storms & ice", "Flooding", "Tropical", "Wildfire"]:
    counties["n_" + g.split()[0].lower()] = counties.county.map(hc[g] if g in hc else {}).fillna(0).astype(int)

# TEMA mission number -> FEMA disaster number (Mission_Numbers.xlsx). One row per mission; a cell such as
# "#24 (... 24, 25, and 26)" gives several missions, "Possibly ..." marks the link unverified, "N/A" is skipped.
# Mission numbers restart each year, so a mission is identified by (incident year, number).
def parse_missions(path):
    raw = pd.read_excel(path, dtype=object) if path.suffix.lower() in (".xlsx", ".xls") else pd.read_csv(path, dtype=str)
    raw.columns = [str(c).strip().lower() for c in raw.columns]
    col = lambda *keys: next((c for c in raw.columns if all(k in c for k in keys)), None)
    c_date, c_fema, c_tema, c_type = col("incident", "date"), col("fema"), col("tema"), col("incident", "type")
    rows = []
    for _, r in raw.iterrows():
        dn = pd.Series([str(r[c_fema])]).str.extract(r"(\d{4})", expand=False)[0]
        when = pd.to_datetime(re.sub(r",\s*", ", ", str(r[c_date]).strip()), errors="coerce")
        txt = str(r[c_tema]) if pd.notna(r[c_tema]) else ""
        nums = sorted({int(n) for n in re.findall(r"(?<!ICS )(?<![\w.])(\d+)(?![\w.])", txt)})
        if pd.isna(dn) or pd.isna(when) or not nums:
            continue
        for n in nums:
            rows.append({"year": int(when.year), "missionNumber": n, "disasterNumber": dn,
                         "incident": str(r[c_type]).strip() if c_type else "", "verified": "possibl" not in txt.lower(),
                         "note": txt.strip()})
    return pd.DataFrame(rows, columns=["year", "missionNumber", "disasterNumber", "incident", "verified", "note"])


xw_path = find("*Mission_Numbers*.xlsx", required=False) or find("*mission*crosswalk*.csv", required=False)
missions = parse_missions(xw_path) if xw_path else pd.DataFrame(columns=["year", "missionNumber", "disasterNumber", "incident", "verified", "note"])
if len(missions):
    missions["inTnDeclarations"] = missions.disasterNumber.isin(dis.disasterNumber)
    missions["type"] = missions.disasterNumber.map(dict(zip(dis.disasterNumber, dis.type)))
    missions["hazard"] = missions.disasterNumber.map(dict(zip(dis.disasterNumber, dis.hazard)))


# ---------------------------------------------------------------- derived view for one category set
# (the page does the same in js/calcs.js for whichever categories are picked; this copy feeds the workbook)
def derive(cats):
    d = H.copy()
    d["fed"] = sum(d[f"fed_{c}"] for c in cats)
    d["amt"] = sum(d[f"amt_{c}"] for c in cats)
    d["fedAdj"] = (d.fed * d.adjFactor).fillna(d.fed)
    d["thresholdMultiple"] = d.amt / d.threshold
    d["metThreshold"] = np.where(d.threshold.notna(), (d.amt >= d.threshold).astype(float), np.nan)
    d["zeroPA"] = (d.pa == 1) & (d.fed <= 0) & ~d.recent
    rows = []
    for _, c in counties.iterrows():
        h = d[d.county == c.county]
        t = h[h.metThreshold.notna()]
        rate = len(h) / YEARS
        rows.append({"county": c.county, "region": c.region, "econ": c.econ, "pop": c["pop"], "paDR": len(h),
                     "ratePerYr": rate, "p5yr": 1 - math.exp(-5 * rate), "fed": h.fed.sum(), "fedAdj": h.fedAdj.sum(),
                     "ealPerCap": h.fedAdj.sum() / YEARS / c["pop"], "tested": len(t), "met": int((t.metThreshold == 1).sum()),
                     "metRate": (t.metThreshold == 1).sum() / len(t) if len(t) else 0,
                     "maxMultiple": t.thresholdMultiple.max() if len(t) else None, "zeroPA": int(h.zeroPA.sum()),
                     "lastDR": h.declDate.max()})
    s = pd.DataFrame(rows)
    pct = lambda v: v.rank(method="average") / len(v)
    s["score"] = (100 * (pct(s.ratePerYr) + pct(s.ealPerCap) + pct(s.metRate)) / 3).round(1)
    s["tier"] = pd.cut(s.score, [-1, 20, 40, 60, 80, 101], labels=["Very Low", "Low", "Moderate", "High", "Very High"]).astype(str)
    s = s.sort_values(["score", "county"], ascending=[False, True])
    s["rank"] = range(1, len(s) + 1)
    return d, s


# ---------------------------------------------------------------- write
def clean(v):
    if isinstance(v, pd.Timestamp):
        return None if pd.isna(v) else v.strftime("%Y-%m-%d")
    if v is pd.NaT or v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if math.isnan(v) else round(float(v), 2)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


def recs(df):
    return [{k: clean(v) for k, v in r.items()} for r in df.to_dict("records")]


desig_cols = (["disasterNumber", "county", "region", "hazard", "incident", "declDate", "durationDays", "fy", "pop", "indicator",
               "threshold", "adjFactor", "recent", "blanket", "pa", "projects", "applicants", "grossAB", "deobAB"] + CAT_COLS)
dis_cols = (["disasterNumber", "type", "title", "incident", "hazard", "declDate", "begin", "end", "durationDays", "daysToDeclare",
             "nCounties", "paDeclared", "iaDeclared", "fy", "nonHazard", "escalatedTo", "adjFactor", "statewideFed",
             "grossAB", "deobAB"] + CAT_COLS)
D_out = D.sort_values("declDate")[dis_cols].assign(year=lambda d: d.declDate.dt.year,
                                                    nonHazard=lambda d: d.nonHazard.fillna(""), escalatedTo=lambda d: d.escalatedTo.fillna(""))
outputs = {
    "counties": recs(counties),
    "designations": recs(H.sort_values("declDate")[desig_cols].assign(year=lambda d: d.declDate.dt.year)),
    "disasters": recs(D_out),
    "hazards": recs(hz),
    "emNotCarried": recs(em_not_carried),
    "missions": recs(missions),
    "tnCounties": geo,
    "pdaCosts": recs(pda_costs.rename(columns={"dwelling_type": "dwelling"})),
    "meta": {
        "asOf": AS_OF.strftime("%Y-%m-%d"), "windowStart": WINDOW_START.strftime("%Y-%m-%d"), "years": YEARS,
        "baseFY": BASE_FY, "indicators": {str(k): v for k, v in IND.items()},
        "statewideIndicators": {str(k): v for k, v in IND_STATE.items()}, "statePop": int(cty.pop2020.sum()),
        "categories": [{"code": c, "name": CAT_NAMES[c], "default": c in DEFAULT_CATS} for c in CATS],
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "sources": {"declarations": {"file": dec_path.name, "rows": len(dec), "lastRefresh": clean(date(dec.lastRefresh).max())},
                    "pa": {"file": pa_path.name, "rows": len(pa), "lastRefresh": clean(date(pa.lastRefresh).max())},
                    "missions": {"file": xw_path.name if xw_path else None, "rows": len(missions)}},
        "paBuckets": {b: round(float(v), 2) for b, v in pa.groupby("bucket").fed.sum().items()},
        "countyFromApplicantId": int(pa.countyInferred.sum()),
        "otherPaCounties": sorted(pa[pa.bucket == "other"].county.dropna().unique().tolist()),
    },
}
for k, v in outputs.items():
    (DATA / f"{k}.json").write_text(json.dumps(v, separators=(",", ":"), allow_nan=False))
(ROOT / "js" / "data-bundle.js").write_text(
    "// Generated by scripts/build_data.py from source/. Do not edit by hand.\n"
    "window.DASH_DATA = " + json.dumps(outputs, separators=(",", ":"), allow_nan=False) + ";\n")

# ---------------------------------------------------------------- workbook (default categories A-G)
d_def, s_def = derive(DEFAULT_CATS)
sys.path.insert(0, str(ROOT / "scripts"))
from build_xlsx import write_workbook  # noqa: E402
write_workbook(ROOT / "downloads" / "TN_County_Disaster_Risk_Tables.xlsx", outputs, d_def, s_def, DEFAULT_CATS, CAT_NAMES)

print(f"as of {outputs['meta']['asOf']} | {len(dec)} TN declaration rows, {len(pa)} TN PA projects | "
      f"{len(H)} county designations | {len(D)} declarations in window | missions {len(missions)}")
sw = d_def
print(f"A-G statewide: fed ${sw.fed.sum():,.0f}  adj ${sw.fedAdj.sum():,.0f}  met {int((sw.metThreshold == 1).sum())} of "
      f"{int(sw.metThreshold.notna().sum())}  eal/cap ${sw.fedAdj.sum() / YEARS / cty.pop2020.sum():.2f}")
print(s_def.head(5)[["rank", "county", "paDR", "ealPerCap", "met", "tested", "score", "tier"]].to_string())
