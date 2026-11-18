"""Rebuild TN_County_Disaster_Risk_Tables.xlsx from the fixed analysis outputs (out/ds/*.json)."""
import json
import sys
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

DS = Path(sys.argv[1] if len(sys.argv) > 1 else "out/ds")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "out/TN_County_Disaster_Risk_Tables.xlsx")

def rows(name):
    return json.loads((DS / f"{name}.json").read_text())["rows"]

SHEETS = [
    ("County scorecard", rows("counties")),
    ("County designations", rows("designations")),
    ("Declarations", rows("disasters")),
    ("Hazard types", rows("hazards")),
    ("Regions", rows("regions")),
    ("Economic status", rows("econ")),
    ("Trend by year", rows("trend")),
    ("Gap - never met", rows("neverMet")),
    ("Gap - EM not in DR", rows("emNotCarried")),
    ("FEMA indicator", rows("indicators")),
]

README = [
    "About this workbook",
    "Computed from GRRF_PowerQ.xlsx (Disaster, PA1, Counties2). Declarations Jan 1, 1999 - Nov 18, 2026.",
    "Only PA Categories A and B are in the source, so dollar totals and threshold tests are a floor, not full PA.",
    "Threshold = FEMA countywide per capita indicator for the fiscal year x 2020 census population (FY2002 on; FY1999-2001 not tested).",
    "Adjusted $ (columns ending Adj) = nominal x (FY2026 indicator / indicator for the declaration FY). FY1999-2001 have no verified "
    "indicator, so their dollars are carried at nominal value in adjusted totals.",
    "Risk measures exclude COVID-19, Katrina evacuation sheltering (EM-3217) and the 2020 Nashville explosion (EM-3552).",
    "Score = mean percentile of designation rate, expected A+B per resident per year, and share of designations meeting the indicator.",
    "5-yr chance = 1 - exp(-5 x designations per year). $0 A+B excludes declarations under 2 years old.",
    "Join key for county profiles / ArcGIS: county name as spelled in Counties2.",
    "Version: corrected Nov 18, 2026 (adds FY1999-2001 dollars to adjusted totals; replaces the earlier copy).",
]

MONEY = ("net", "gross", "deob", "threshold", "eal", "indicator", "countywide", "perCapita")
PCT = ("Rate", "share", "p5yr", "metRate")

def fmt(col, val):
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        return None
    if any(col.startswith(p) or col.endswith(p) for p in PCT):
        return "0.0%"
    if any(m.lower() in col.lower() for m in MONEY):
        return '"$"#,##0.00' if ("Cap" in col or col in ("indicator", "countywide", "perCapita")) else '"$"#,##0'
    if isinstance(val, float):
        return "#,##0.00"
    if col in ("year", "fy", "disasterNumber", "em", "dr"):
        return "0"
    return "#,##0"

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Read me"
for i, line in enumerate(README, 1):
    ws.cell(i, 1, line).font = Font(bold=(i == 1), size=13 if i == 1 else 11)
ws.column_dimensions["A"].width = 130

head_fill = PatternFill("solid", fgColor="1F3A5F")
for title, data in SHEETS:
    ws = wb.create_sheet(title)
    cols = list(data[0].keys()) if data else []
    for j, c in enumerate(cols, 1):
        cell = ws.cell(1, j, c)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = head_fill
        cell.alignment = Alignment(vertical="center")
    sample = {}
    for i, r in enumerate(data, 2):
        for j, c in enumerate(cols, 1):
            v = r.get(c)
            ws.cell(i, j, v)
            if v is not None and c not in sample:
                sample[c] = v
    for j, c in enumerate(cols, 1):
        f = fmt(c, sample.get(c))
        if f:
            for i in range(2, len(data) + 2):
                ws.cell(i, j).number_format = f
        longest = max([len(str(c))] + [len(str(r.get(c) or "")) for r in data[:200]])
        ws.column_dimensions[get_column_letter(j)].width = min(max(10, longest + 2), 48)
    ws.freeze_panes = "B2"
    if cols:
        ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}{len(data) + 1}"

wb.save(OUT)
print("saved", OUT, [(t, len(d)) for t, d in SHEETS])
