# Traffic snapshots

This folder is written by [`.github/workflows/traffic.yml`](../.github/workflows/traffic.yml) every Monday. GitHub's built-in Traffic tab only keeps the last 14 days; these files capture that window each run so the history accumulates indefinitely.

| File                  | What it is                                                       |
|-----------------------|------------------------------------------------------------------|
| `views-latest.json`   | Raw API response — daily views for the last 14 days              |
| `clones-latest.json`  | Raw API response — daily clones for the last 14 days             |
| `paths-latest.json`   | Top 10 popular content paths at last poll                        |
| `referrers-latest.json` | Top 10 referrer sources at last poll                           |
| `views-history.csv`   | **Long-term** — appended daily views (`timestamp,count,uniques`) |
| `clones-history.csv`  | **Long-term** — appended daily clones                            |

Trigger a fresh capture on demand from the [Actions tab](../../actions/workflows/traffic.yml) → **Run workflow**.
