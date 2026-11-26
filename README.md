# category-entry-check

Thinking about building an iOS app in a category you don't know yet? This tool compares a few App Store categories on the same chart so you can see what entering each one looks like before you write code:

- what the apps at **#10, #25 and #50** are estimated to make and download per month (the bar you would have to clear to chart there),
- how much of the summed revenue estimates the **top 3** hold (is the money spread out or locked up),
- how many apps **released in the last 24 months** made the chart, and the best rank one of them reached,
- the median rating count in the top 10 and the **smallest review base** inside the top 25,
- how many developers share the chart and whether one of them holds several slots,
- how many charting apps run **paid ads** (and how many ads started in the last 7 days), get **organic posts**, or rank **top 10 for an App Store search**,
- the chart day's gainers, losers and new entrants.

With two or more categories it adds a few plain side-by-side observations (lowest estimate at #25, least concentrated top, most young apps, least ad pressure…). It does not score categories or pick one for you: it lines up the evidence.

Node 18+, no dependencies, read-only. There is also a [browser version](https://fdarkaou.github.io/category-entry-check/) that renders pasted answers and never sends them anywhere.

```
## Category entry check: grossing chart, US

Chart day 2026-11-24. Top 50 rows read per category. Download and revenue figures are PeekPanda estimates (worldwide, USD), not measured results.

**Side by side**

- Lowest revenue estimate at #25: Food & Drink (#25 revenue mid ~$26.2k/mo).
- Least concentrated at the top: Health & Fitness (top 3 hold 23% of summed revenue mids).
- Most young apps on the chart: Productivity (14 of 50 released in the last 24 months).
- Smallest review base inside the top 25: Productivity (Example Focus Lab 24 at #24 with 117 ratings).
- Least paid-ad pressure: Food & Drink (11 of 47 collected apps running ads).
- Most new chart entrants: Productivity (4 new entrants on the latest chart day).

| | Health & Fitness | Productivity | Food & Drink |
| --- | --- | --- | --- |
| Revenue / mo at #10 | $742k–$3.3M | $252k–$1.1M | $90.7k–$403k |
| Revenue / mo at #25 | no estimate | $52.6k–$234k | $11.8k–$52.4k |
| Revenue / mo at #50 | $24.8k–$110k | $3.5k–$15.4k | < $5k |
| Downloads / mo at #10 | 178k–792k | 98.5k–438k | 46.7k–208k |
| Downloads / mo at #25 | 102k–452k | 23.3k–103k | 2.7k–11.8k |
| Downloads / mo at #50 | 8.8k–39.2k | 788–3.5k | 140–624 |
| Top 3 share of revenue mids | 23% (44 ranged) | 28% (46 ranged) | 32% (35 ranged) |
| Revenue estimates: range / below floor / none | 44 / 0 / 6 | 46 / 0 / 4 | 35 / 13 / 2 |
| Released in last 24 months | 12 (best #6) | 14 (best #4) | 6 (best #3) |
| Median ratings, top 10 | 17.9k | 6.4k | 7.1k |
| Smallest review base, top 25 | 276 (#24) | 117 (#24) | 231 (#20) |
| Distinct developers | 44 (Calorie Studio: 7) | 44 (Notes Studio: 7) | 44 (Recipe Studio: 7) |
| Apps running paid ads | 18/43 | 14/43 | 11/47 |
| Live ads (started 7d) | 568 (94) | 455 (62) | 436 (53) |
| Apps with organic posts | 13/38 | 14/41 | 12/40 |
| Apps top 10 for a search | 30/43 | 21/44 | 24/41 |
| Chart day: gainers / losers / new | 18 / 20 / 3 | 19 / 21 / 4 | 20 / 24 / 3 |

"not collected" means PeekPanda holds no evidence of that kind for those apps yet, not zero. A chart rank says where an app was on that day, not why.
```

(Example data from `examples/run.json`, made up, not real apps.)

## Where the data comes from

The data comes from [PeekPanda](https://peekpanda.com), an iOS competitor catalogue that keeps dated App Store evidence for each app. The tool makes one call per category to [`GET /v1/market/leaderboard`](https://peekpanda.com/docs/market-leaderboard) with `country`, `categoryId` and `chartType` (scope `context:read`). For a category, the answer's `viewChart` holds that category's chart (up to 100 rows, each with rank, release date, rating count and monthly download and revenue estimates), and its `signals` batch holds paid-ad, organic and search signals for the apps shown. For `all` (Overall), `viewChart` is null and the tool reads `charts[chartType]`. Over MCP the same read is the `get_market` tool with action `leaderboard`. It only reads stored evidence and never starts collection.

How to read it:

- Download and revenue figures are PeekPanda **estimates** (worldwide, USD), shown as ranges. "below floor" means under a small ceiling; "no estimate" means no suitable estimate exists, which is not zero. The top-3 share uses the middle of each range and only counts apps that have a range; it is skipped when fewer than five do.
- A grossing rank is a relative position on a stored chart for one day, not a revenue amount, and a rank change does not explain itself.
- "not collected" means PeekPanda has no evidence of that kind for those apps yet, not that they run no ads or have no posts.

You need a PeekPanda account and an API key. Each category is one call against your plan's daily API and MCP allowance (30 a day on Peek, 1,000 on Panda per PeekPanda's plans page).

## Use it

```sh
export PEEKPANDA_TOKEN=...            # Account → API keys. Never commit it.
node cli.js --list                    # the 27 category shelves and their IDs (no call)
node cli.js --categories "Health & Fitness,Productivity,Food & Drink"
node cli.js --categories "6015,6017" --country gb --chart free --top 25
node cli.js --categories "Lifestyle,Travel" --save run.json     # keep the answers (no credentials in them)
node cli.js --file run.json --format csv > entry.csv            # re-render later, no calls
node cli.js --categories "Finance,Business" --webhook "$SLACK_WEBHOOK_URL"
```

| Option | Default | What it does |
| --- | --- | --- |
| `--categories` | | Category names or IDs, comma-separated; `all` adds Overall. Up to 12. |
| `--country` | `us` | Two-letter App Store storefront. |
| `--chart` | `grossing` | `grossing`, `free` or `paid`. Grossing fits a revenue question; free fits a downloads question. |
| `--top` | `50` | Chart rows read per category (1-100). |
| `--young-months` | `24` | An app counts as young when released within this many months of the chart day. |
| `--save` / `--file` | | Save the trimmed answers / re-render a saved run. The browser page reads the same file. |
| `--format` | `md` | `md`, `csv` or `json`. |
| `--webhook` | | Also post a short summary to a Slack or Discord incoming webhook. |
| `--tenancy` | | Send `x-genviral-tenancy`. Leave it out for a key pinned to one workspace. |

Errors: a 429 `rate_limited` is retried once after `Retry-After`; `daily_call_limit` stops the run and keeps what was read; 401/402/403 stop with a hint; a category the API rejects (400) is listed under the table and the others still render.

## Run it monthly on GitHub Actions

`.github/workflows/entry-check.yml` runs on the 1st of each month once you set the repository variable `ENABLE_ENTRY_CHECK=true`, the secret `PEEKPANDA_TOKEN` and the variable `ENTRY_CATEGORIES`. It writes the table to the job summary, uploads the saved answers and a CSV as an artifact, and posts to `ENTRY_CHECK_WEBHOOK_URL` if you set it.

## Ask an assistant instead

If you connected the PeekPanda MCP server to an assistant, the same evidence is one `get_market` call per category, with `request.action` `leaderboard` and `categoryId`, `country` and `chartType` in `request.query`. Ask it to compare the estimate at #25, the top-3 share and the count of young apps, and to say "not collected" rather than zero.

## Tests

`npm test` (node:test): category parsing, the documented example answer from the API reference, the made-up comparison, CSV and chat output, and the CLI against a local mock server (one call per category, no tenancy header unless asked, saved files carry no credentials).

## License

MIT
