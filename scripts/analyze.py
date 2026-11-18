"""County disaster-history risk analysis (starting point) from GRRF_PowerQ.xlsx.
Outputs: out/tables.json (for dashboard) and out/*.csv (for the workbook)."""
import json, math, sys
from pathlib import Path
import numpy as np
import pandas as pd

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "in/grrf.xlsx")
OUT = Path("out"); OUT.mkdir(exist_ok=True)
AS_OF = pd.Timestamp("2026-11-18")
WINDOW_START = pd.Timestamp("1999-01-01")         # PA project data in the workbook starts with DR-1260 (Jan 1999)
YEARS = (AS_OF - WINDOW_START).days / 365.25

# FEMA countywide per capita impact indicator by fiscal year.
# FY2002–FY2003: Federal Register notices (Oct 2001 $2.66, Oct 2002 $2.71); FY2004–FY2025: FEMA
# "Per Capita Impact Indicator and Project Thresholds" page; FY2026 $4.86 and FY2027 $5.03 (FR 2026-22691).
# FY1999–FY2001 not sourced -> threshold tests and $ adjustment skipped for those 5 declarations.
COUNTY_IND = {2002: 2.66, 2003: 2.71, 2004: 2.77, 2005: 2.84, 2006: 2.94, 2007: 3.05, 2008: 3.11, 2009: 3.28,
              2010: 3.23, 2011: 3.27, 2012: 3.39, 2013: 3.45, 2014: 3.50, 2015: 3.56, 2016: 3.57, 2017: 3.61,
              2018: 3.68, 2019: 3.78, 2020: 3.84, 2021: 3.89, 2022: 4.10, 2023: 4.44, 2024: 4.60, 2025: 4.72,
              2026: 4.86, 2027: 5.03}
BASE_FY = 2026

HAZ_GROUP = {"Severe Storm": "Severe storms & tornadoes", "Tornado": "Severe storms & tornadoes",
             "Flood": "Flooding", "Winter Storm": "Winter storms & ice", "Severe Ice Storm": "Winter storms & ice",
             "Snowstorm": "Winter storms & ice", "Hurricane": "Tropical", "Tropical Storm": "Tropical",
             "Fire": "Wildfire", "Biological": "Pandemic", "Other": "Other"}
# Declarations that are not local hazard damage (kept, but excluded from the hazard risk model)
NON_HAZARD = {"3217": "Evacuation sheltering (Hurricane Katrina)", "3552": "Explosion (Nashville, 2020)"}

def fy(ts):
    return ts.year + 1 if ts.month >= 10 else ts.year

def norm(s):
    return s.astype(str).str.strip().str.lower()

x = pd.ExcelFile(SRC)
dec = pd.read_excel(x, "Disaster")
pa = pd.read_excel(x, "PA1")
cty = pd.read_excel(x, "Counties2")

cty["key"] = norm(cty["County"])
cty["pop"] = cty["2020 County Population"]
names = dict(zip(cty.key, cty.County))
region = dict(zip(cty.key, cty.Region))
econ = dict(zip(cty.key, cty["Economic Status"]))
pop = dict(zip(cty.key, cty["pop"]))

# ---------------- declarations ----------------
dec["disasterNumber"] = dec.disasterNumber.astype(str)
dec["key"] = norm(dec.designatedArea)
for c in ["declarationDate", "incidentBeginDate", "incidentEndDate", "declarationRequestDate"]:
    dec[c] = pd.to_datetime(dec[c])
dis = (dec.groupby("disasterNumber")
       .agg(type=("declarationType", "first"), title=("declarationTitle", "first"), incident=("incidentType", "first"),
            declDate=("declarationDate", "first"), begin=("incidentBeginDate", "first"), end=("incidentEndDate", "first"),
            requestDate=("declarationRequestDate", "first"), incidentId=("incidentId", "first"),
            nCounties=("key", lambda s: s[s != "statewide"].nunique()), paDeclared=("paProgramDeclared", "max"),
            iaDeclared=("iaProgramDeclared", "max"), hmDeclared=("hmProgramDeclared", "max"))
       .reset_index())
dis["hazard"] = dis.incident.map(HAZ_GROUP).fillna("Other")
dis["durationDays"] = ((dis.end.fillna(dis.begin) - dis.begin).dt.days + 1)
dis["daysToDeclare"] = (dis.declDate - dis.begin).dt.days
# FY: by declaration date through FY2025; FY2026+ indicators apply by incident start date
dis["fy"] = [fy(b) if fy(b) >= 2026 else fy(d) for b, d in zip(dis.begin, dis.declDate)]
dis["nonHazard"] = dis.disasterNumber.map(NON_HAZARD)
dis.loc[dis.hazard == "Pandemic", "nonHazard"] = "Pandemic (COVID-19)"
dis["inWindow"] = dis.declDate >= WINDOW_START
dis["blanket"] = dis.nCounties >= 95          # all-county declarations (e.g. winter storm 2026, COVID)

# escalation: an EM whose incidentId also has a DR
dr_by_inc = dis[dis.type == "DR"].groupby("incidentId").disasterNumber.first()
dis["escalatedTo"] = np.where(dis.type == "EM", dis.incidentId.map(dr_by_inc), None)
# Fallback when incident IDs differ (e.g. EM-3321 -> DR-1979, 2011 flooding): a DR declared within 120 days
# whose incident period overlaps the EM's, choosing the DR sharing the most designated counties.
_areas = dec.groupby("disasterNumber").key.apply(set)
for i, r in dis[(dis.type == "EM") & dis.escalatedTo.isna()].iterrows():
    em_end = r.end if pd.notna(r.end) else r.begin
    cand = dis[(dis.type == "DR") & (dis.declDate >= r.declDate) & (dis.declDate <= r.declDate + pd.Timedelta(days=120))
               & (dis.begin <= em_end) & (dis.end.fillna(dis.begin) >= r.begin)]
    if len(cand):
        shared = cand.disasterNumber.map(lambda n: len(_areas[n] & _areas[r.disasterNumber]))
        if shared.max() > 0:
            dis.at[i, "escalatedTo"] = cand.disasterNumber[shared.idxmax()]
dis["escalated"] = np.where(dis.type == "EM", dis.escalatedTo.notna(), np.nan)

# county designations (TN counties only)
cd = dec[dec.key.isin(names)].copy()
cd = (cd.groupby(["disasterNumber", "key"])
      .agg(pa=("paProgramDeclared", "max"), ia=("iaProgramDeclared", "max")).reset_index())
cd = cd.merge(dis[["disasterNumber", "type", "declDate", "begin", "end", "hazard", "incident", "fy", "nonHazard",
                   "durationDays", "incidentId", "escalatedTo", "inWindow", "blanket"]], on="disasterNumber")

# ---------------- PA projects (Cat A & B) ----------------
pa["disasterNumber"] = pa.disasterNumber.astype(str)
pa["key"] = norm(pa.county)
# Applicants with no county in the source: assign by the applicant's home county where unambiguous.
# Out-of-state applicants (Asbury, Inc. - Frederick; Tippah Electric Power Association) stay unassigned.
APPLICANT_COUNTY = {"BLEDSOE (COUNTY)": "bledsoe", "DEKALB (COUNTY)": "dekalb", "Stewart County Education Department": "stewart",
    "Clarksville-Montgomery County Museum": "montgomery", "Norris, City of": "anderson", "Beersheba Springs, Town of": "grundy",
    "Wartrace, Town of": "bedford", "SHELBYVILLE POWER WATER SYSTEM": "bedford", "Signal Mountain, Town of": "hamilton",
    "Lookout Mountain, Town of": "hamilton", "Madison Suburban Utility District": "davidson", "Jackson Utility Division": "madison",
    "West Tennessee Experiment Station University of Tennessee": "madison", "Winchester City Power System": "franklin"}
miss = pa.county.isna() & pa.applicantName.isin(APPLICANT_COUNTY)
pa.loc[miss, "key"] = pa.loc[miss, "applicantName"].map(APPLICANT_COUNTY)
pa["countyInferred"] = miss
pa["cat"] = pa.damageCategoryCode.str[0]
pa["amt"] = pa.federalShareObligated.astype(float)
pa["bucket"] = np.where(pa.key.isin(names), "county", np.where(pa.key == "statewide", "statewide", "unassigned"))
pa_cd = (pa[pa.bucket == "county"].assign(pos=lambda d: d.amt.clip(lower=0), neg=lambda d: (-d.amt).clip(lower=0),
                                          A=lambda d: np.where(d.cat == "A", d.amt, 0), B=lambda d: np.where(d.cat == "B", d.amt, 0))
         .groupby(["disasterNumber", "key"])
         .agg(netA=("A", "sum"), netB=("B", "sum"), gross=("pos", "sum"), deob=("neg", "sum"),
              applicants=("applicantName", "nunique"), projects=("pwNumber", "nunique")).reset_index())
pa_cd["net"] = pa_cd.netA + pa_cd.netB

cd = cd.merge(pa_cd, on=["disasterNumber", "key"], how="left")
for c in ["netA", "netB", "gross", "deob", "net", "applicants", "projects"]:
    cd[c] = cd[c].fillna(0)
# PA $ for an EM that escalated is obligated under the DR; mark those rows so they aren't read as "$0"
cd["paRolledToDR"] = (cd.type == "EM") & cd.escalatedTo.notna()
cd["pop"] = cd.key.map(pop)
cd["indicator"] = cd.fy.map(COUNTY_IND)
cd["threshold"] = cd.indicator * cd["pop"]
cd["perCapita"] = cd.net / cd["pop"]
cd["thresholdMultiple"] = cd.net / cd.threshold
cd["metThreshold"] = np.where(cd.threshold.notna(), cd.net >= cd.threshold, np.nan)
cd["adjFactor"] = COUNTY_IND[BASE_FY] / cd.indicator
cd["netAdj"] = (cd.net * cd.adjFactor).fillna(cd.net)   # FY1999-2001: no verified indicator, kept nominal
cd["deobRate"] = np.where(cd.gross > 0, cd.deob / cd.gross, np.nan)
cd["shareA"] = np.where((cd.netA.clip(lower=0) + cd.netB.clip(lower=0)) > 0,
                        cd.netA.clip(lower=0) / (cd.netA.clip(lower=0) + cd.netB.clip(lower=0)), np.nan)
cd["dominant"] = np.select([cd.shareA >= 0.6, cd.shareA <= 0.4, cd.shareA.notna()], ["Cat A", "Cat B", "Mixed"], "No A/B $")
# PA obligations for declarations under ~2 years old are still being written: flag as provisional
cd["recent"] = cd.declDate > (AS_OF - pd.DateOffset(years=2))
cd["zeroPA"] = (cd.pa == 1) & (cd.type == "DR") & (cd.net <= 0) & ~cd.recent
cd["region"] = cd.key.map(region)
cd["county"] = cd.key.map(names)

# disaster-level PA rollups (all buckets)
pa_d = (pa.assign(pos=lambda d: d.amt.clip(lower=0), neg=lambda d: (-d.amt).clip(lower=0),
                  A=lambda d: np.where(d.cat == "A", d.amt, 0), B=lambda d: np.where(d.cat == "B", d.amt, 0),
                  stw=lambda d: np.where(d.bucket == "statewide", d.amt, 0))
        .groupby("disasterNumber").agg(netA=("A", "sum"), netB=("B", "sum"), gross=("pos", "sum"), deob=("neg", "sum"),
                                       statewide=("stw", "sum")).reset_index())
dis = dis.merge(pa_d, on="disasterNumber", how="left")
for c in ["netA", "netB", "gross", "deob", "statewide"]:
    dis[c] = dis[c].fillna(0)
dis["net"] = dis.netA + dis.netB
dis["adjFactor"] = COUNTY_IND[BASE_FY] / dis.fy.map(COUNTY_IND)
dis["netAdj"] = (dis.net * dis.adjFactor).fillna(dis.net)
dis["shareA"] = np.where(dis.netA.clip(lower=0) + dis.netB.clip(lower=0) > 0,
                         dis.netA.clip(lower=0) / (dis.netA.clip(lower=0) + dis.netB.clip(lower=0)), np.nan)
dis["dominant"] = np.select([dis.shareA >= 0.6, dis.shareA <= 0.4, dis.shareA.notna()], ["Cat A", "Cat B", "Mixed"], "No A/B $")
dis["deobRate"] = np.where(dis.gross > 0, dis.deob / dis.gross, np.nan)
ct = cd.groupby("disasterNumber").agg(cMet=("metThreshold", lambda s: int((s == 1).sum())),
                                       cTested=("metThreshold", lambda s: int(s.notna().sum())),
                                       cZero=("zeroPA", "sum"))
dis = dis.merge(ct, on="disasterNumber", how="left")

# ---------------- hazard model set ----------------
H = cd[(cd.type == "DR") & (cd.pa == 1) & cd.nonHazard.isna() & cd.inWindow].copy()   # PA-designated natural-hazard DRs since 1999

def county_row(k):
    h = H[H.key == k]
    p = pop[k]
    lam = len(h) / YEARS
    tested = h[h.metThreshold.notna()]
    last = h.declDate.max()
    em = cd[(cd.key == k) & (cd.type == "EM") & cd.nonHazard.isna() & cd.inWindow]
    em_esc = em[em.escalatedTo.notna()]
    em_carried = sum(1 for _, r in em_esc.iterrows()
                     if ((cd.disasterNumber == r.escalatedTo) & (cd.key == k)).any())
    haz = h.hazard.value_counts()
    adj_pc = (h.netAdj / p)
    return {
        "key": k, "county": names[k], "region": region[k], "econ": econ[k], "pop": int(p),
        "drAllTime": int(cd[(cd.key == k) & (cd.type == "DR")].disasterNumber.nunique()),
        "emAllTime": int(cd[(cd.key == k) & (cd.type == "EM")].disasterNumber.nunique()),
        "paDR": int(len(h)), "targeted": int((~h.blanket).sum()), "ratePerYr": lam, "p5yr": 1 - math.exp(-5 * lam),
        "topHazard": haz.index[0] if len(haz) else None,
        "hazCounts": {g: int(n) for g, n in haz.items()},
        "netAB": float(h.net.sum()), "netABAdj": float(h.netAdj.fillna(h.net).sum()),
        "netA": float(h.netA.sum()), "netB": float(h.netB.sum()),
        "gross": float(h.gross.sum()), "deob": float(h.deob.sum()),
        "ealAdj": float(h.netAdj.sum() / YEARS) if h.netAdj.notna().any() else 0.0,
        "ealPerCap": float(h.netAdj.sum() / YEARS / p) if h.netAdj.notna().any() else 0.0,
        "medianPerCapAdj": float(adj_pc[adj_pc.notna() & (h.net > 0)].median()) if (h.net > 0).any() else None,
        "maxMultiple": float(tested.thresholdMultiple.max()) if len(tested) else None,
        "tested": int(len(tested)), "met": int((tested.metThreshold == 1).sum()),
        "zeroPA": int(h.zeroPA.sum()),
        "emHazard": int(em.disasterNumber.nunique()), "emEscalated": int(em_esc.disasterNumber.nunique()),
        "emCarried": int(em_carried),
        "lastDR": last.strftime("%Y-%m-%d") if pd.notna(last) else None,
        "yearsSinceLast": round((AS_OF - last).days / 365.25, 1) if pd.notna(last) else None,
        "domA": int((h.dominant == "Cat A").sum()), "domB": int((h.dominant == "Cat B").sum()),
    }

counties = pd.DataFrame([county_row(k) for k in cty.key])
# Composite history-based score: mean percentile of frequency, adjusted expected annual A+B per capita,
# and share of tested designations where Cat A+B alone exceeded the countywide indicator.
counties["metRate"] = np.where(counties.tested > 0, counties.met / counties.tested, 0)
counties["pFreq"] = counties.ratePerYr.rank(pct=True)
counties["pEal"] = counties.ealPerCap.rank(pct=True)
counties["pMet"] = counties.metRate.rank(pct=True)
counties["score"] = (100 * (counties.pFreq + counties.pEal + counties.pMet) / 3).round(1)
counties["tier"] = pd.cut(counties.score, [-1, 20, 40, 60, 80, 101], labels=["Very Low", "Low", "Moderate", "High", "Very High"]).astype(str)
counties = counties.sort_values(["score", "county"], ascending=[False, True])
counties["rank"] = range(1, len(counties) + 1)

# ---------------- comparisons ----------------
def agg_group(df, by):
    g = df.groupby(by)
    return pd.DataFrame({
        "designations": g.size(),
        "counties": g.key.nunique(),
        "netAB": g.net.sum(), "netABAdj": g.netAdj.sum(),
        "gross": g.gross.sum(), "deob": g.deob.sum(),
        "tested": g.metThreshold.apply(lambda s: int(s.notna().sum())),
        "met": g.metThreshold.apply(lambda s: int((s == 1).sum())),
        "zeroPA": g.zeroPA.sum(),
        "medianMultiple": g.thresholdMultiple.median(),
    }).reset_index()

reg = agg_group(H, "region")
regpop = cty.groupby("Region")["pop"].sum()
reg["pop"] = reg.region.map(regpop)
reg["countiesInRegion"] = reg.region.map(cty.Region.value_counts())
reg["designationsPerCounty"] = reg.designations / reg.countiesInRegion
reg["ealPerCap"] = reg.netABAdj / YEARS / reg["pop"]

ecn = agg_group(H.assign(econ=H.key.map(econ)), "econ")
ecn["countiesInGroup"] = ecn.econ.map(cty["Economic Status"].value_counts())
ecn["designationsPerCounty"] = ecn.designations / ecn.countiesInGroup

statewide = {
    "pop": int(cty["pop"].sum()), "designations": int(len(H)),
    "designationsPerCounty": len(H) / len(cty), "ratePerCountyYr": len(H) / len(cty) / YEARS,
    "netAB": float(H.net.sum()), "netABAdj": float(H.netAdj.sum()),
    "ealPerCap": float(H.netAdj.sum() / YEARS / cty["pop"].sum()),
    "tested": int(H.metThreshold.notna().sum()), "met": int((H.metThreshold == 1).sum()),
    "zeroPA": int(H.zeroPA.sum()), "gross": float(H.gross.sum()), "deob": float(H.deob.sum()),
}

# hazard type characteristics (disaster level, natural hazards since 1999 incl. EM/FM)
D = dis[dis.inWindow & dis.nonHazard.isna()]
hz = []
for g, d in D.groupby("hazard"):
    dr = d[d.type == "DR"]
    em = d[d.type == "EM"]
    hcd = H[H.hazard == g]
    hz.append({
        "hazard": g, "declarations": int(len(d)), "DR": int(len(dr)), "EM": int(len(em)), "FM": int((d.type == "FM").sum()),
        "emEscalated": int(em.escalated.fillna(False).astype(bool).sum()),
        "medDuration": float(d.durationDays.median()), "medDaysToDeclare": float(dr.daysToDeclare.median()) if len(dr) else None,
        "medCounties": float(dr.nCounties.median()) if len(dr) else None,
        "netAB": float(dr.net.sum()), "netABAdj": float(dr.netAdj.sum()),
        "medNetAdjPerDR": float(dr.netAdj.median()) if len(dr) else None,
        "shareA": float(dr.netA.clip(lower=0).sum() / max(1, dr.netA.clip(lower=0).sum() + dr.netB.clip(lower=0).sum())),
        "deobRate": float(dr.deob.sum() / dr.gross.sum()) if dr.gross.sum() > 0 else None,
        "designations": int(len(hcd)), "tested": int(hcd.metThreshold.notna().sum()), "met": int((hcd.metThreshold == 1).sum()),
        "zeroPA": int(hcd.zeroPA.sum()),
        "domA": int((dr.dominant == "Cat A").sum()), "domB": int((dr.dominant == "Cat B").sum()), "domMixed": int((dr.dominant == "Mixed").sum()),
    })
hz = pd.DataFrame(hz).sort_values("declarations", ascending=False)

# trend by year (natural-hazard DRs)
trend = (D[D.type == "DR"].assign(year=D.declDate.dt.year)
         .groupby("year").agg(drs=("disasterNumber", "size"), counties=("nCounties", "sum"), net=("net", "sum"), netAdj=("netAdj", "sum"))
         .reindex(range(1999, 2027), fill_value=0).reset_index())

# gaps
never = counties[(counties.met == 0)][["county", "region", "econ", "pop", "paDR", "targeted", "tested", "maxMultiple", "zeroPA", "lastDR"]].sort_values("paDR")
zero_rows = H[H.zeroPA][["disasterNumber", "county", "region", "hazard", "declDate", "threshold"]].sort_values("declDate")
em_not_carried = []
for _, r in cd[(cd.type == "EM") & cd.escalatedTo.notna() & cd.nonHazard.isna() & cd.inWindow].iterrows():
    if not ((cd.disasterNumber == r.escalatedTo) & (cd.key == r.key)).any():
        em_not_carried.append({"em": r.disasterNumber, "dr": r.escalatedTo, "county": names[r.key], "region": region[r.key],
                               "hazard": r.hazard, "declDate": r.declDate})
em_not_carried = pd.DataFrame(em_not_carried)

# disaster table for dashboard
dis_out = dis[dis.inWindow].sort_values("declDate")

def clean(v):
    if isinstance(v, (pd.Timestamp,)):
        return None if pd.isna(v) else v.strftime("%Y-%m-%d")
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if (v is None or math.isnan(v)) else round(float(v), 4)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if v is pd.NaT:
        return None
    return v

def recs(df):
    return [{k: clean(v) for k, v in r.items()} for r in df.to_dict("records")]

designations = H[["disasterNumber", "key", "county", "region", "hazard", "incident", "declDate", "durationDays", "fy",
                  "pop", "indicator", "threshold", "netA", "netB", "net", "netAdj", "gross", "deob", "perCapita",
                  "thresholdMultiple", "metThreshold", "dominant", "zeroPA", "recent", "blanket", "applicants", "projects"]].sort_values("declDate")

tables = {
    "asOf": AS_OF.strftime("%Y-%m-%d"), "windowStart": WINDOW_START.strftime("%Y-%m-%d"), "years": round(YEARS, 2),
    "baseFY": BASE_FY, "indicators": COUNTY_IND,
    "statewide": {k: clean(v) for k, v in statewide.items()},
    "counties": recs(counties.drop(columns=["hazCounts"])),
    "hazCounts": {r.key: r.hazCounts for r in counties.itertuples()},
    "regions": recs(reg), "econ": recs(ecn), "hazards": recs(hz), "trend": recs(trend),
    "disasters": recs(dis_out[["disasterNumber", "type", "title", "incident", "hazard", "declDate", "begin", "end", "durationDays",
                               "daysToDeclare", "nCounties", "paDeclared", "iaDeclared", "fy", "nonHazard", "escalated", "escalatedTo",
                               "netA", "netB", "net", "netAdj", "gross", "deob", "statewide", "deobRate", "shareA", "dominant",
                               "cMet", "cTested", "cZero"]]),
    "designations": recs(designations),
    "gaps": {"neverMet": recs(never), "zeroPA": recs(zero_rows), "emNotCarried": recs(em_not_carried)},
    "paBuckets": {b: float(v) for b, v in pa.groupby("bucket").amt.sum().items()},
    "unassignedApplicants": sorted(pa[pa.bucket == "unassigned"].applicantName.unique().tolist()),
    "inferredCounty": APPLICANT_COUNTY,
}
(OUT / "tables.json").write_text(json.dumps(tables))
for name, df in {"counties": counties.drop(columns=["hazCounts"]), "designations": designations, "disasters": dis_out,
                 "hazards": hz, "regions": reg, "econ": ecn, "trend": trend, "gap_neverMet": never, "gap_zeroPA": zero_rows,
                 "gap_emNotCarried": em_not_carried}.items():
    df.to_csv(OUT / f"{name}.csv", index=False)

print("years", round(YEARS, 2), "| H designations", len(H), "| counties never met", len(never), "| zeroPA", int(H.zeroPA.sum()),
      "| emNotCarried", len(em_not_carried))
print(json.dumps({k: clean(v) for k, v in statewide.items()}, indent=1))
print(hz.to_string())
print(reg.to_string())
print(counties.head(12)[["rank", "county", "region", "econ", "paDR", "p5yr", "ealPerCap", "tested", "met", "zeroPA", "score", "tier"]].to_string())
print(counties.tail(5)[["rank", "county", "paDR", "score"]].to_string())
print(tables["paBuckets"], tables["unassignedApplicants"][:5])

# ---------------- dashboard dataset files: {rows, meta} with this script attached ----------------
CODE = Path(__file__).read_text()
META = [{"label": "analyze.py", "value": CODE, "type": "code", "lang": "python"},
        {"label": "Input", "value": "GRRF_PowerQ.xlsx (sheets Disaster, PA1, Counties2)"},
        {"label": "Window", "value": f"Declarations {WINDOW_START.date()} to {AS_OF.date()} ({YEARS:.2f} years); $ in FY{BASE_FY} dollars where adjusted"}]
DS = OUT / "ds"; DS.mkdir(exist_ok=True)
def write_ds(name, df):
    rows = recs(df)
    (DS / f"{name}.json").write_text(json.dumps({"rows": rows, "meta": META}, allow_nan=False))

c_out = counties.drop(columns=["hazCounts", "key"]).copy()
for g in ["Severe storms & tornadoes", "Winter storms & ice", "Flooding", "Tropical", "Wildfire"]:
    c_out["n_" + g.split()[0].lower()] = [h.get(g, 0) for h in counties.hazCounts]
write_ds("counties", c_out)
write_ds("designations", designations.assign(year=designations.declDate.dt.year).drop(columns=["key"]))
write_ds("disasters", dis_out[["disasterNumber", "type", "title", "incident", "hazard", "declDate", "begin", "end", "durationDays",
                               "daysToDeclare", "nCounties", "paDeclared", "iaDeclared", "fy", "nonHazard", "escalatedTo",
                               "netA", "netB", "net", "netAdj", "gross", "deob", "statewide", "deobRate", "shareA", "dominant",
                               "cMet", "cTested", "cZero"]].assign(year=dis_out.declDate.dt.year,
                               nonHazard=dis_out.nonHazard.fillna(""), escalatedTo=dis_out.escalatedTo.fillna("")))
write_ds("hazards", hz)
sw = pd.DataFrame([{"region": "Statewide", "designations": statewide["designations"], "counties": 95,
                    "netAB": statewide["netAB"], "netABAdj": statewide["netABAdj"], "gross": statewide["gross"], "deob": statewide["deob"],
                    "tested": statewide["tested"], "met": statewide["met"], "zeroPA": statewide["zeroPA"],
                    "medianMultiple": float(H.thresholdMultiple.median()), "pop": statewide["pop"], "countiesInRegion": 95,
                    "designationsPerCounty": statewide["designationsPerCounty"], "ealPerCap": statewide["ealPerCap"]}])
write_ds("regions", pd.concat([reg, sw], ignore_index=True).assign(metRate=lambda d: d.met / d.tested, deobRate=lambda d: d.deob / d.gross))
write_ds("econ", ecn.assign(metRate=lambda d: d.met / d.tested, ealPerCap=lambda d: d.netABAdj / YEARS / d.econ.map(cty.groupby("Economic Status")["pop"].sum())))
write_ds("trend", trend)
write_ds("emNotCarried", em_not_carried.assign(declDate=em_not_carried.declDate.dt.strftime("%Y-%m-%d")) if len(em_not_carried) else em_not_carried)
write_ds("neverMet", never)
write_ds("indicators", pd.DataFrame([{"fy": k, "countywide": v, "source":
    "Federal Register notice (FR 01-25250)" if k == 2002 else "Federal Register notice (FR 02-25967)" if k == 2003 else
    "Federal Register notice (FR 2026-22691); applies by incident start date" if k == 2027 else
    "FEMA notice; applies by incident start date" if k == 2026 else "FEMA Per Capita Impact Indicator table"} for k, v in COUNTY_IND.items()]))
print("datasets:", sorted(p.name for p in DS.iterdir()), sum(p.stat().st_size for p in DS.iterdir()) // 1024, "KB")
