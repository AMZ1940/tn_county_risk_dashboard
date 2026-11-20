"""Excel tables for the dashboard (called by build_data.py)."""
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

HEAD = PatternFill("solid", fgColor="1F3A5F")


def _sheet(wb, title, rows, money=(), pct=(), dec2=()):
    ws = wb.create_sheet(title)
    cols = list(rows[0].keys()) if rows else []
    for j, c in enumerate(cols, 1):
        cell = ws.cell(1, j, c)
        cell.font, cell.fill, cell.alignment = Font(bold=True, color="FFFFFF"), HEAD, Alignment(vertical="center")
    for i, r in enumerate(rows, 2):
        for j, c in enumerate(cols, 1):
            ws.cell(i, j, r.get(c))
    for j, c in enumerate(cols, 1):
        fmt = '"$"#,##0' if c in money else "0.0%" if c in pct else "#,##0.00" if c in dec2 else None
        if fmt:
            for i in range(2, len(rows) + 2):
                ws.cell(i, j).number_format = fmt
        width = max([len(str(c))] + [len(str(r.get(c) if r.get(c) is not None else "")) for r in rows[:300]])
        ws.column_dimensions[get_column_letter(j)].width = min(max(9, width + 2), 46)
    ws.freeze_panes = "B2"
    if cols:
        ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}{len(rows) + 1}"


def write_workbook(path, out, desig, score, cats, cat_names):
    m = out["meta"]
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Read me"
    catlist = ", ".join(f"{c} ({cat_names[c]})" for c in cats)
    lines = [
        "Tennessee county disaster risk tables",
        f"Built {m['built']} from {m['sources']['declarations']['file']} and {m['sources']['pa']['file']} (Tennessee rows only).",
        f"Declarations {m['windowStart']} to {m['asOf']} ({m['years']:.2f} years). Data as of the latest OpenFEMA refresh date in the files.",
        f"Scorecard and designation measures use PA categories {catlist}. The dashboard lets you pick other categories.",
        "Federal share = OpenFEMA federalShareObligated. Total project cost = projectAmount (federal + non-federal estimate).",
        "Threshold test: total project cost for the categories vs. FEMA countywide per capita indicator for the fiscal year x 2020 population "
        "(FY2002 on; FY1999-2001 not tested). FEMA's per capita indicator measures federal + non-federal cost, so total cost is used.",
        f"Adjusted $ = federal share x (FY{m['baseFY']} indicator / indicator for the declaration FY); FY1999-2001 kept at nominal value.",
        "Deobligations (grossAB, deobAB) are Cat A + B from the GRRF workbook; the OpenFEMA project file has no deobligation history.",
        "Risk measures exclude COVID-19, Katrina evacuation sheltering (EM-3217) and the 2020 Nashville explosion (EM-3552).",
        "Score = mean percentile of designations per year, expected federal share per resident per year, and share of designations meeting the indicator.",
        "Damage assessments are not in this workbook: they load live from ArcGIS after sign-in.",
    ]
    for i, line in enumerate(lines, 1):
        ws.cell(i, 1, line).font = Font(bold=(i == 1), size=13 if i == 1 else 11)
    ws.column_dimensions["A"].width = 140

    sc = score.assign(lastDR=score.lastDR.dt.strftime("%Y-%m-%d"))
    _sheet(wb, "County scorecard", [{k: (None if v != v else v) for k, v in r.items()} for r in sc.to_dict("records")],
           money=("fed", "fedAdj"), pct=("p5yr", "metRate"), dec2=("ratePerYr", "ealPerCap", "maxMultiple"))
    dcols = ["disasterNumber", "county", "region", "hazard", "declDate", "fy", "pop", "indicator", "threshold", "fed", "fedAdj", "amt",
             "thresholdMultiple", "metThreshold", "zeroPA", "recent", "projects", "applicants", "grossAB", "deobAB"]
    dd = desig.assign(declDate=desig.declDate.dt.strftime("%Y-%m-%d"))[dcols]
    _sheet(wb, "County designations", [{k: (None if (isinstance(v, float) and v != v) else v) for k, v in r.items()} for r in dd.to_dict("records")],
           money=("threshold", "fed", "fedAdj", "amt", "grossAB", "deobAB"), dec2=("indicator", "thresholdMultiple"))
    _sheet(wb, "Designations by category", out["designations"],
           money=tuple(f"{v}_{c}" for c in "ABCDEFGZ" for v in ("fed", "amt")))
    _sheet(wb, "Declarations", out["disasters"],
           money=("statewideFed", "grossAB", "deobAB") + tuple(f"{v}_{c}" for c in "ABCDEFGZ" for v in ("fed", "amt")))
    _sheet(wb, "Hazard types", out["hazards"], pct=("deobRateAB",))
    _sheet(wb, "Gap - EM not in DR", out["emNotCarried"])
    _sheet(wb, "Counties", [{k: v for k, v in r.items()} for r in out["counties"]])
    if out["missions"]:
        _sheet(wb, "Mission crosswalk", out["missions"])
    _sheet(wb, "FEMA indicator", [{"fy": int(k), "countywide": v} for k, v in m["indicators"].items()], dec2=("countywide",))
    wb.save(path)
