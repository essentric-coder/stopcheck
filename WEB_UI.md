# Web dashboard notes

`python -m stopcheck web` serves a local dashboard over the existing StopCheck components. It adds no runtime dependencies (Python standard library only); `pip install .[web]` is a stable, currently empty extra.

## What it reads and runs

| Dashboard element | Source |
|---|---|
| Run selector | Folders under `runs/` that contain `summary.json` or per-trial `events.jsonl` files |
| Summary cards, chart, table | `summary.json` saved verdicts. For a run still in progress, finished trial logs are scored with `stopcheck.scoring.score` |
| Trial timeline and raw log | The trial's `events.jsonl`, shown in sequence order |
| SQLite ledger evidence | The trial's `events.sqlite3`, opened read-only (`mode=ro`, `immutable=1`) so no journal files are created |
| Rescore trace | `stopcheck.scoring.score` on the saved log, compared field by field with the saved verdict. Nothing is written |
| Run fixture suite | A subprocess running `python -m stopcheck run --out runs/web-<UTC timestamp>[-label] --repeat N` |

Counting rules match `stopcheck/reporting.py`: failures and passes are stopped trials; benign controls have no stop and are excluded from chart denominators; invalid means the scorer rejected the evidence.

Run status (running, completed, completed with invalid trials, execution failed) describes whether the runner executed. It is reported separately from each trial's safety verdict. Progress counts the runner's own per-trial output lines.

## Safety of the local server

- Binds to 127.0.0.1 by default and rejects requests whose `Host` header is not the local address, which blocks DNS-rebinding access.
- POST requests must be JSON and same-origin. Inputs are validated: repeats 1 to 5, labels of lowercase letters, digits and hyphens.
- File access is limited to registered run folders, a fixed list of report files (`REPORT.md`, `results.csv`, `summary.json`, `SHA256SUMS.txt`) and per-trial `events.jsonl`. Names are checked and resolved paths must stay inside the run folder.
- New runs always go to a new folder; the runner itself refuses non-empty output folders. One run executes at a time.
- A strict Content-Security-Policy allows only the dashboard's own scripts and styles, plus the Inter and JetBrains Mono fonts from Google Fonts. Without internet the page falls back to system fonts.

## API

`GET /api/runs`, `GET /api/runs/<run>`, `GET /api/runs/<run>/trials/<trial>`, `POST /api/runs/<run>/trials/<trial>/rescore`, `GET /api/runs/<run>/files/<report file>`, `GET /api/runs/<run>/trials/<trial>/events.jsonl`, `GET /api/runs/<run>/archive.zip`, `POST /api/jobs` (`{"repeat": 1, "label": ""}`), `GET /api/jobs/<id>`.

## Limitations

- Job status lives in server memory. A run interrupted by stopping the server shows as "incomplete" after restart and is not resumed.
- Rescoring uses the scorer in this codebase; it is a consistency check, not independent verification.
- On Windows, trial paths must stay under 260 characters. The server refuses to start a run that would exceed this and says why.
- The dashboard is for one local user. It has no authentication and should not be exposed beyond localhost.
