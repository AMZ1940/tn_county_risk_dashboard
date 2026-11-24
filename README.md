# Tennessee County Disaster Risk — Historical PA Analysis

A dashboard of Tennessee disaster declaration history for building declaration justifications, plus county disaster risk built from FEMA declarations, FEMA Public Assistance (PA) projects in every category, and TEMA damage assessments. It includes:

- **Filters:** hazard, PA categories (A–G and Z, with presets), map measure, and damage assessment mission.
- **County heat map:** clicking a county, or a scorecard row, loads that county's profile.
- **Analysis sections:** statewide KPIs, the county scorecard, region and economic-status comparisons, hazard characteristics, per capita threshold results, PA by category, trends and gaps.
- **Damage assessments:** read live from ArcGIS after sign-in. Training records are removed, and each mission is linked to its FEMA declaration.

**Two tabs:**
- **Declaration justification** (opens first): pick the event type, click a county, and its history opens in a side panel beside its region and the state. Sections:
  - statewide history for the event type
  - a county map
  - region and statewide table
  - cost by year
  - past declarations of the type
  - damage assessment average set costs by event type and dwelling
- **Detailed analysis:** the earlier sections (scorecard, hazard characteristics, threshold dots, economic status, gaps, declaration table and so on).

**Damage assessment missions** (filter bar): each mission has two checkboxes.
- **In history:** uncheck a mission that's still under way. Its assessments, and the PA for any declaration it's linked to, are left out of the averages.
- **Current:** check a mission to open the *Current mission* panel. It shows assessments by county as they come in, estimated cost from the set amounts, PA obligated so far for a linked declaration, each county's threshold today, a total for the counties involved, and the statewide indicator.

The choices are saved in the viewer's browser and in the page address, so a link carries them.

Users sign in with ArcGIS (OAuth 2.0, same setup as the county profile site) before anything loads.

## How updating works

You never edit the dashboard to update it. Replace a file in `source/`. A GitHub Action then:
1. rebuilds the data
2. saves it to the repository
3. republishes the site

| File in `source/` | What it is | How to update it |
|---|---|---|
| `*DisasterDeclarationsSummaries*.csv` | OpenFEMA Disaster Declarations Summaries (v2) | Run the Action with **Download** checked, or upload a new copy |
| `*PublicAssistanceFundedProjectsDetails*.csv` | OpenFEMA PA Funded Projects Details (v1), all categories | Run the Action with **Download** checked, or upload a Tennessee-only copy |
| `Mission_Numbers.xlsx` | TEMA mission number → FEMA disaster number | Upload a new copy with the same column headers |
| `fema_per_capita_indicators.csv` | FEMA countywide (and, where verified, statewide) per capita indicator by fiscal year | Add a row when FEMA publishes a new fiscal year |
| `pda_unit_costs.csv` | Set dollar amount per damage assessment, by dwelling type and damage level | Fill in the amounts; edit when they change |
| `tn_counties.csv` | County FIPS, TEMA region, economic status, 2020 population | Rarely |
| `grrf_deobligations_AB.csv` | Cat A + B deobligations from the GRRF workbook | Static (see notes) |
| `tnCounties.geojson` | County outlines for the map | Static |

The two OpenFEMA files can hold every state; the build keeps Tennessee rows only.

**File sizes:** GitHub's web upload takes files up to 25 MB, and GitHub blocks any file over 100 MB. The nationwide PA file is about 290 MB, so it can't go in the repository. You have two options:
- **Easiest:** go to **Actions → Build and publish dashboard → Run workflow** and check **Download the latest Tennessee data from OpenFEMA first**. The Action pulls only Tennessee rows straight from the OpenFEMA API, about 6 MB for PA and under 1 MB for declarations.
- **Manual:** download Tennessee-only files and upload them to `source/`. When a new file is uploaded, the build uses the newest one whose name matches. Delete the old one to keep things tidy.

If you want automatic weekly refreshes, remove the `#` from the two `schedule` lines in `.github/workflows/build.yml`.

## One-time setup

1. **Create the repository.** Upload everything in this folder, including the hidden `.github` folder, named `tn_county_risk_dashboard`.
2. **Turn on Pages.** Go to **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. (This replaces "Deploy from a branch".)
3. **Allow the Action to save data.** Go to **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**, and save. If your organization blocks this, the site still publishes, but the rebuilt data isn't saved back to `data/`.
4. **Run it once.** Go to **Actions → Build and publish dashboard → Run workflow**. The site is at `https://amz1940.github.io/tn_county_risk_dashboard/`.
5. **Set up ArcGIS sign-in.** In the OAuth 2.0 credentials item for client ID `SOme9Mv9P4kEIzH9`, under **Settings → Redirect URLs**, add:
   - `https://amz1940.github.io/tn_county_risk_dashboard/`
   - `https://amz1940.github.io/tn_county_risk_dashboard/index.html`
   - `https://amz1940.github.io/tn_county_risk_dashboard/oauth-callback.html`
6. **Connect damage assessments.** Put the damage assessment layer's REST URL in `DA_LAYER_URL` at the top of `js/da.js`. It ends in `/FeatureServer/0` or the right layer number. Fields are found by their aliases, the column headers in `PREDs_Fields.xlsx`, so nothing else needs typing. Sign-in uses the viewer's own ArcGIS account, so they only see the assessments that account is allowed to see.

## Damage assessments

- **Filtering:** these records are removed, both in the layer query and again in the page:
  - records marked **Training**
  - mission **#999** (the training number)
  - records with **Soft Delete = yes**
- **What's requested:** only the fields needed for counts. No names, addresses, parcel details or coordinates. The records stay in the viewer's browser and are never saved to GitHub.
- **Linking to declarations:** `Mission_Numbers.xlsx` links a mission (incident year + mission number) to a FEMA disaster number.
  - A cell listing several numbers ("24, 25, and 26") links each of them.
  - A cell that says "Possibly" is shown as unverified.
  - "N/A" rows are skipped.
  - When a mission has both an EM and a DR, the DR is used.
- **Unlinked missions:** these use the recorded event type for the hazard filter: tornado → severe storms & tornadoes, flood → flooding.

## Files

```
index.html                 layout, styles and the sign-in screen
oauth-callback.html        hands the ArcGIS sign-in result from the pop-up back to the page
js/auth.js                 ArcGIS sign-in (client ID and portal URL at the top)
js/da.js                   damage assessments from ArcGIS (layer URL and field aliases at the top)
js/dash-runtime.js         loads data, runs calculations, redraws on filter changes, keeps filters in the URL
js/calcs.js                calculations for the hazard, category and mission filters
js/draws.js                map, charts and tables
js/rk.js                   formatting, tooltip and bar chart helpers
js/d3.min.js               D3 v7.9.0 (ISC license, js/d3-LICENSE.txt)
js/data-bundle.js          all datasets in one script (generated)
data/*.json                the datasets (generated)
downloads/                 Excel tables (generated, linked from the page)
scripts/build_data.py      source/ -> data/, js/data-bundle.js and the Excel tables
scripts/build_xlsx.py      the Excel tables
scripts/download_openfema.py  Tennessee rows from the OpenFEMA API -> source/
.github/workflows/build.yml   the Action
```

To run locally:

```bash
pip install pandas openpyxl
python scripts/build_data.py
python -m http.server        # then open http://localhost:8000/?preview  (skips sign-in on localhost only)
```

## Method notes

- **Federal share** = federal share obligated. **Total project cost** = FEMA's estimated total project cost (federal + non-federal).
- **Threshold test:** total project cost in the selected categories vs. countywide per capita indicator × 2020 population (FY2002 on). FEMA's indicator measures federal and non-federal cost.
- **Adjusted dollars** use the ratio of the FY2026 indicator to the declaration year's indicator. FY1999–FY2001 stay nominal.
- **Deobligations:** the OpenFEMA project file holds current obligations only, so deobligations still come from the GRRF workbook (Cat A + B). OpenFEMA's *PA Grant Award Activities* dataset lists obligations and deobligations by project version and could replace this later.
- **County assignment:** projects with a blank county are assigned by the applicant ID's county FIPS prefix. Statewide (state agency) projects count toward declaration totals, not county measures.
- **Score** = average percentile of designations per year, expected federal share per resident per year, and share of designations meeting the indicator.
- **Exclusions:** COVID-19, Katrina evacuation sheltering (EM-3217) and the 2020 Nashville explosion (EM-3552) are left out of the risk measures.
- **What sign-in protects:** it hides the dashboard, but files on a GitHub Pages site are public to anyone who knows their address. The OpenFEMA data is public anyway. Damage assessments are never stored on the site.
