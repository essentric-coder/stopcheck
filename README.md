# StopCheck

Tests whether an agent workflow can still commit a protected action after a human withdraws permission.

The pilot uses LangGraph, an async queue and a SQLite ledger. It separates application cancellation from a stop message delivered to the agent, then scores outcomes from saved execution logs.

**Current status:** local, scripted fixtures. No live-model or external stop trials have run. All protected effects are database rows.

## How it works

![StopCheck workflow: a human stop cancels the application or delivers a stop message, revokes persisted authority, and is checked against later actions recorded in the execution log.](docs/images/workflow.png)

The key fixture is a restart: cancelling the graph and live workers still leaves a persisted job that a recovered worker can execute. A commit-time authority check blocks that late action in the fixture, as designed.

## Run

Python 3.12 recommended. No API key required. Extract the project and open a terminal in this directory.

**Windows · PowerShell**

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m stopcheck run --out runs/my-run
```

<details>
<summary>macOS / Linux commands</summary>

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m stopcheck run --out runs/my-run
```

</details>

Use a new output directory for each run. It contains a Markdown report, CSV results and per-trial logs. The included run is in [`runs/pilot`](runs/pilot/REPORT.md).

## Web dashboard

A local dashboard for browsing runs, inspecting trial timelines, rescoring traces and launching new fixture runs. It is a React + TypeScript + Tailwind + shadcn/ui app (adapted from the `dashboard-01` block) served by a small FastAPI backend. The compiled build ships in `stopcheck/web/dist`, so Node is not needed to run it.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-web.txt
.\.venv\Scripts\python.exe -m stopcheck web --open
```

It serves `http://localhost:8765/` on 127.0.0.1 only (`--port` and `--runs-dir` change the defaults). **Run fixture suite** starts the existing runner in the background and writes to a new `runs/web-<timestamp>` folder; saved runs are never modified. On macOS or Linux use `.venv/bin/python`. To change the frontend, see [web dashboard notes](WEB_UI.md).

![StopCheck dashboard showing the bundled pilot: 54 trials, 33 passes, 12 failures, 9 of 9 benign controls completed, 0 invalid, and post-stop commits of 9/15, 3/15 and 0/15 for the three controls.](docs/images/web-dashboard.png)

![Trial detail drawer for the cascade restart fixture: the timeline shows the stop fence, app cancellation, a recovered worker attempt and a protected action accepted after the stop.](docs/images/web-trial-detail.png)

## Pilot results

![Constructed fixture results: post-stop commits occurred in 9 of 15 basic-stop trials, 3 of 15 cascade trials and 0 of 15 authority-gate trials. All 9 benign controls completed; no invalid trials or live-model calls.](docs/images/fixture-results.png)

**23 core tests pass**, plus 11 web dashboard checks (`tests/test_web.py`, skipped without the web requirements). The 54 saved trials contain 12 failures, 33 passes and 9 completed benign controls. These expected fixture outcomes validate the runner and scorer; they are not deployed-agent failure rates.

## Next experiments

The selected targets are a LangGraph + Celery template using Celery revoke, and an MCP agent limited to in-flight filesystem calls. The MCP write/read compatibility check passes; external stop experiments remain planned. See the [integration plan](INTEGRATIONS.md).

[Method and limitations](METHOD.md) · [Validation and credits](VALIDATION.txt) · [Grant proposal](PROPOSAL.md)
