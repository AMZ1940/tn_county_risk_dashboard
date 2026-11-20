"""Download the latest Tennessee rows of the two OpenFEMA datasets into source/.

    python scripts/download_openfema.py

Uses the OpenFEMA API ($filter + $format=csv + $allrecords=true), then checks the row count
against the API's own count so a partial download is never used."""
import csv
import io
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://www.fema.gov/api/open"
SETS = [
    ("v2/DisasterDeclarationsSummaries", "state eq 'TN'", "DisasterDeclarationsSummaries_TN.csv"),
    ("v1/PublicAssistanceFundedProjectsDetails", "stateAbbreviation eq 'TN'", "PublicAssistanceFundedProjectsDetails_TN.csv"),
]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tn-county-risk-dashboard"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


def url(entity, params):
    return f"{BASE}/{entity}?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote, safe="$=,'")


for entity, flt, out in SETS:
    meta = json.loads(get(url(entity, {"$filter": flt, "$top": 1, "$count": "true"})))
    expected = meta.get("metadata", {}).get("count")
    body = get(url(entity, {"$filter": flt, "$format": "csv", "$allrecords": "true"}))
    rows = sum(1 for _ in csv.reader(io.StringIO(body.decode("utf-8-sig")))) - 1
    print(f"{entity}: {rows} rows (API count {expected})")
    if not rows or (expected and rows != expected):
        sys.exit(f"Download of {entity} looks incomplete ({rows} of {expected} rows); keeping the existing file.")
    for old in (ROOT / "source").glob(f"*{entity.split('/')[1]}*.csv"):
        old.unlink()
    (ROOT / "source" / out).write_bytes(body)
