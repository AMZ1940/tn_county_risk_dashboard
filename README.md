# Tennessee County Disaster Risk — Historical PA Analysis

A static dashboard of Tennessee county disaster risk, built from FEMA declarations and Public Assistance Category A and B records from January 1999 to November 18, 2026. It has:

- a hazard filter that recalculates every section for the hazard you pick
- a county heat map with a choice of measure; clicking a county (or a scorecard row) loads that county's profile
- statewide KPIs, the county scorecard, region and economic-status comparisons, hazard characteristics, per capita threshold results, Cat A vs. Cat B, trends and gaps

It is plain HTML, CSS and JavaScript with no build step, so it runs on GitHub Pages as-is. Users must sign in with ArcGIS (OAuth 2.0) before the dashboard loads, using the same setup as the county profile site.

## What's in the repo

```
index.html                 page layout, styles and the sign-in screen
oauth-callback.html        receives the ArcGIS sign-in response in the pop-up and hands it back to the page
js/auth.js                 ArcGIS sign-in (client ID and portal URL are at the top)
js/dash-runtime.js         small engine: loads data, runs calculations, redraws on filter changes,
                           keeps filters in the URL (#hazard=Flooding&county=Shelby)
js/rk.js                   formatting, tooltip and bar chart helpers
js/calcs.js                calculations that follow the hazard filter (scores, tiers, regions, trend, gaps)
js/draws.js                map, charts and tables
js/d3.min.js               D3 v7.9.0 (ISC license, js/d3-LICENSE.txt), included so no CDN is needed
js/data-bundle.js          all datasets in one script, loaded after sign-in (generated, do not edit)
data/*.json                the datasets (counties, designations, disasters, hazards, emNotCarried, tnCounties)
downloads/                 TN_County_Disaster_Risk_Tables.xlsx (linked from the page header)
scripts/analyze.py         the analysis: GRRF_PowerQ.xlsx -> out/ds/*.json
scripts/build_xlsx.py      out/ds/*.json -> the Excel tables
scripts/update_data.py     out/ds/*.json -> data/*.json -> js/data-bundle.js
.nojekyll                  tells GitHub Pages to serve files as-is
```

## One-time ArcGIS setup (required)

Sign-in uses the same OAuth 2.0 credentials as the county profile site (client ID `w9VaoRCHch2gIU1d`). That item needs to know this site's addresses.

1. In ArcGIS Online, open the OAuth 2.0 credentials item with client ID `w9VaoRCHch2gIU1d` and go to **Settings → Redirect URLs**.
2. Keep the county profile URLs that are already there, and add these three. Change `tn-county-risk` if you name the repository something else:
   - `https://amz1940.github.io/tn-county-risk/`
   - `https://amz1940.github.io/tn-county-risk/index.html`
   - `https://amz1940.github.io/tn-county-risk/oauth-callback.html` (needed for the pop-up when embedded in Experience Builder)
3. Save.

How sign-in behaves:
- **Opened directly:** the page sends you to the ArcGIS sign-in page and back.
- **Embedded in an iframe** (for example the Experience Builder Embed widget): sign-in opens in a pop-up window, and `oauth-callback.html` passes the result back. If the pop-up is blocked, the page offers a link to open the dashboard in a new tab.

If your organization signs in through its own URL (for example `https://yourorg.maps.arcgis.com`) or through ArcGIS Enterprise, change `PORTAL_URL` at the top of `js/auth.js`.

## Put it on GitHub Pages

1. Create a repository (for example `tn-county-risk`) and upload everything in this folder, including `.nojekyll`.
2. In the repository, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. After a minute or two the site is at `https://amz1940.github.io/tn-county-risk/`, and you should see the sign-in screen.

GitHub Pages works with public repositories on a free account. A private repository needs GitHub Pro, Team or Enterprise. Either way, the published site is public on the internet unless your organization uses GitHub Enterprise Cloud's private Pages, so everything in `data/` and `downloads/` can be seen by anyone with the link.

## Use it in ArcGIS Online

ArcGIS Online doesn't store the files for an outside web app. It points to the URL, so GitHub keeps hosting the files. There are two ways to connect them:

**As an item in your content.** In ArcGIS Online go to **Content → New item → Application**. Choose **Web mapping** (or **Other application**), paste the GitHub Pages URL, then add a title, tags and summary. You can share the item with your organization or groups like any other item.

**Inside an Experience Builder app.** Add an **Embed** widget, choose **Embed by URL**, and paste the GitHub Pages URL. The widget only accepts HTTPS URLs, and it sandboxes sites outside `*.arcgis.com`. This page doesn't fetch any files at run time, so it works inside that sandbox. To open on a county or hazard, add the filters to the URL, for example `.../tn-county-risk/#county=Madison&hazard=Flooding`.

**What the sign-in does and doesn't protect:** it keeps the dashboard from showing until someone signs in with ArcGIS. The files on a GitHub Pages site are still public, though, so anyone who knows the address of `js/data-bundle.js`, `data/` or `downloads/` can open them directly. To truly restrict the data, store it as a secured ArcGIS layer or table and have the page load it with the user's sign-in token.

## Update the data

The page needs the source workbook, `GRRF_PowerQ.xlsx`, only if you're re-running the analysis. Don't commit the workbook unless it's fine for it to be public.

```bash
pip install pandas numpy openpyxl
python scripts/analyze.py path/to/GRRF_PowerQ.xlsx         # writes out/ and out/ds/
python scripts/update_data.py --from out/ds                # refreshes data/ and js/data-bundle.js
python scripts/build_xlsx.py out/ds downloads/TN_County_Disaster_Risk_Tables.xlsx
```

Then commit and push. GitHub Pages republishes automatically.

Two things are fixed in the code and need editing when the window moves:

- the end date of the analysis window (`AS_OF` in `analyze.py`, and `Date.UTC(2026, 10, 18)` in `js/calcs.js`, where JavaScript months start at 0)
- the FEMA countywide per capita indicator table (`COUNTY_IND` in `analyze.py`) when FEMA publishes a new fiscal year's value

To try the page locally, run `python -m http.server` in this folder and open `http://localhost:8000/?preview`. The `?preview` skips sign-in, and it only works on localhost.

## Method notes

- Only PA Categories A and B are in the source, so dollars and threshold tests are a floor, not full PA.
- Threshold = FEMA countywide per capita indicator for the fiscal year × 2020 census population (FY2002 on).
- Adjusted dollars use the ratio of the FY2026 indicator to the declaration year's indicator. FY1999–FY2001 have no verified indicator, so they are kept at nominal value.
- Score = average percentile of designations per year, expected Cat A + B per resident per year, and share of designations meeting the indicator. Tiers are in steps of 20.
- 5-year chance = 1 − e^(−5λ), where λ is designations per year.
- COVID-19, Katrina evacuation sheltering (EM-3217) and the 2020 Nashville explosion (EM-3552) are left out of the risk measures.
- County outlines are U.S. Census boundaries (plotly/datasets GeoJSON).
