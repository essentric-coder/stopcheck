"""Local dashboard for StopCheck runs, built on the standard library only.

The server reads saved evidence (summary.json, per-trial JSONL logs and SQLite
ledgers), rescores traces with stopcheck.scoring and launches the existing CLI
runner in a subprocess. It never edits a saved trial or run report.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import uuid
import webbrowser
import zipfile
from collections import deque
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from ..engine import configurations
from ..scoring import read_events, score

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
STATIC = Path(__file__).resolve().parent / "static"
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")
LABEL = re.compile(r"^[a-z0-9-]{0,24}$")
PROGRESS = re.compile(r"^(r\d+-[A-Za-z0-9_-]+): (pass|fail|not_challenged|invalid)$")
RUN_FILES = {
    "REPORT.md": "text/markdown; charset=utf-8",
    "results.csv": "text/csv; charset=utf-8",
    "summary.json": "application/json",
    "SHA256SUMS.txt": "text/plain; charset=utf-8",
}
STATIC_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml"}
TRIALS_PER_REPEAT = len(list(configurations(1)))
MAX_REPEAT = 5
MAX_BODY = 4096


class ApiError(Exception):
    def __init__(self, status: HTTPStatus, message: str):
        super().__init__(message)
        self.status = status


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def summarize(rows: list[dict]) -> dict:
    """Same counting rules as stopcheck.reporting.write_reports."""
    stopped = [r for r in rows if r.get("safety") in {"pass", "fail"}]
    controls = []
    for control in ("cancel_only", "cascade", "revocation_gate"):
        group = [r for r in stopped if r.get("control") == control]
        controls.append({
            "control": control,
            "trials_with_post_stop_commit": sum((r.get("post_stop_commits") or 0) > 0 for r in group),
            "post_stop_commits": sum(r.get("post_stop_commits") or 0 for r in group),
            "valid_stopped_trials": len(group),
            "by_channel": [
                {"channel": ch, "policy": po,
                 "trials_with_post_stop_commit": sum((r.get("post_stop_commits") or 0) > 0 for r in sub),
                 "valid_stopped_trials": len(sub)}
                for ch, po in (("hard_cancel", "not_delivered"), ("agent_message", "comply"), ("agent_message", "continue"))
                for sub in [[r for r in group if r.get("channel") == ch and r.get("policy") == po]] if sub
            ],
        })
    return {
        "trials": len(rows),
        "passes": sum(r.get("safety") == "pass" for r in rows),
        "failures": sum(r.get("safety") == "fail" for r in rows),
        "benign_controls": sum(r.get("benign_task_completed") is not None for r in rows),
        "benign_completed": sum(r.get("benign_task_completed") is True for r in rows),
        "invalid": sum(not r.get("valid") for r in rows),
        "stopped_trials": len(stopped),
        "controls": controls,
    }


def sqlite_evidence(path: Path) -> dict | None:
    """Read the trial ledger without creating journal files or changing it."""
    if not path.is_file():
        return None
    query = "?mode=ro" if path.with_name(path.name + "-wal").exists() else "?mode=ro&immutable=1"
    db = sqlite3.connect(path.resolve().as_uri() + query, uri=True)
    db.row_factory = sqlite3.Row
    try:
        tables = {}
        for table, order in (("authority", "root_id"), ("jobs", "job_id"), ("effects", "accepted_seq")):
            tables[table] = [dict(r) for r in db.execute(f"SELECT * FROM {table} ORDER BY {order}")]
        return tables
    finally:
        db.close()


class Job:
    def __init__(self, run_id: str, out: Path, repeat: int):
        self.id = uuid.uuid4().hex[:12]
        self.run_id, self.out, self.repeat = run_id, out, repeat
        self.total = repeat * TRIALS_PER_REPEAT
        self.state = "running"
        self.completed = 0
        self.verdicts: dict[str, int] = {}
        self.last_trial: str | None = None
        self.started_utc, self.finished_utc = utc_now(), None
        self.returncode: int | None = None
        self.error: str | None = None
        self.output: deque[str] = deque(maxlen=200)
        self.lock = threading.Lock()

    def to_dict(self) -> dict:
        with self.lock:
            return {"id": self.id, "run_id": self.run_id, "state": self.state, "repeat": self.repeat,
                    "total": self.total, "completed": self.completed, "verdicts": dict(self.verdicts),
                    "last_trial": self.last_trial, "started_utc": self.started_utc,
                    "finished_utc": self.finished_utc, "returncode": self.returncode,
                    "error": self.error, "output_tail": list(self.output)[-20:]}


class Registry:
    """Registered run directories are the only filesystem the API exposes."""

    def __init__(self, runs_root: Path, project_root: Path = PACKAGE_ROOT):
        self.root = Path(runs_root).resolve()
        self.project_root = project_root
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()

    def display_root(self) -> str:
        try:
            return self.root.relative_to(self.project_root.resolve()).as_posix() + "/"
        except ValueError:
            return str(self.root)

    # -- runs -------------------------------------------------------------
    def job_for_run(self, run_id: str) -> Job | None:
        with self.lock:
            matches = [j for j in self.jobs.values() if j.run_id == run_id]
        return matches[-1] if matches else None

    def run_dir(self, run_id: str) -> Path:
        if not isinstance(run_id, str) or not NAME.match(run_id):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid run name")
        path = (self.root / run_id).resolve()
        if path.parent != self.root or not path.is_dir():
            raise ApiError(HTTPStatus.NOT_FOUND, "Unknown run")
        if not ((path / "summary.json").is_file() or any(path.glob("*/events.jsonl"))
                or self.job_for_run(run_id)):
            raise ApiError(HTTPStatus.NOT_FOUND, "Not a registered StopCheck run")
        return path

    def trial_dir(self, run_id: str, trial: str) -> Path:
        run = self.run_dir(run_id)
        if not isinstance(trial, str) or not NAME.match(trial):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid trial name")
        path = (run / trial).resolve()
        if path.parent != run or not (path / "events.jsonl").is_file():
            raise ApiError(HTTPStatus.NOT_FOUND, "Unknown trial")
        return path

    def run_info(self, run_id: str, path: Path) -> dict:
        job = self.job_for_run(run_id)
        summary_path = path / "summary.json"
        info = {"id": run_id, "bundled": run_id == "pilot", "has_summary": summary_path.is_file(),
                "trial_dirs": len(list(path.glob("*/events.jsonl"))), "generated_utc": None,
                "job": job.to_dict() if job else None}
        if job and job.state == "running":
            info["status"] = "running"
        elif info["has_summary"]:
            info["status"] = "complete"
            try:
                info["generated_utc"] = json.loads(summary_path.read_text(encoding="utf-8")).get("generated_utc")
            except (OSError, ValueError):
                info["status"] = "unreadable"
        else:
            info["status"] = "failed" if job else "incomplete"
        return info

    def list_runs(self) -> list[dict]:
        runs = []
        if self.root.is_dir():
            for path in self.root.iterdir():
                try:
                    self.run_dir(path.name)
                except ApiError:
                    continue
                runs.append(self.run_info(path.name, path))
        # Bundled pilot first, then newest first.
        bundled = [r for r in runs if r["bundled"]]
        others = sorted((r for r in runs if not r["bundled"]),
                        key=lambda r: r["generated_utc"] or (r["job"] or {}).get("started_utc") or r["id"],
                        reverse=True)
        return bundled + others

    def run_detail(self, run_id: str) -> dict:
        path = self.run_dir(run_id)
        info = self.run_info(run_id, path)
        meta = {}
        if info["status"] == "complete":
            data = json.loads((path / "summary.json").read_text(encoding="utf-8"))
            rows = data["results"]
            meta = {k: data.get(k) for k in ("generated_utc", "python", "evidence_kind", "live_model_calls")}
            source = "summary.json (saved verdicts)"
        else:
            rows = [{"trial": d.parent.name, **score(read_events(d))}
                    for d in sorted(path.glob("*/events.jsonl"))]
            source = "scored from finished trial logs (run has no summary.json yet)"
        return {"run": info, "meta": meta, "source": source, "summary": summarize(rows), "trials": rows}

    def saved_row(self, run_id: str, trial: str) -> dict | None:
        summary = self.run_dir(run_id) / "summary.json"
        if not summary.is_file():
            return None
        rows = json.loads(summary.read_text(encoding="utf-8"))["results"]
        return next((r for r in rows if r.get("trial") == trial), None)

    def trial_detail(self, run_id: str, trial: str) -> dict:
        path = self.trial_dir(run_id, trial)
        events = read_events(path / "events.jsonl")
        saved = self.saved_row(run_id, trial)
        return {"run_id": run_id, "trial": trial, "verdict": saved or {"trial": trial, **score(events)},
                "verdict_source": "summary.json" if saved else "scored from log",
                "events": events, "sqlite": sqlite_evidence(path / "events.sqlite3")}

    def rescore(self, run_id: str, trial: str) -> dict:
        path = self.trial_dir(run_id, trial)
        rescored = {"trial": trial, **score(read_events(path / "events.jsonl"))}
        saved = self.saved_row(run_id, trial)
        differences = []
        if saved is not None:
            differences = [{"field": k, "saved": saved.get(k), "rescored": rescored.get(k)}
                           for k in sorted(set(saved) | set(rescored)) if saved.get(k) != rescored.get(k)]
        return {"trial": trial, "rescored": rescored, "saved_available": saved is not None,
                "matches_saved": None if saved is None else not differences, "differences": differences,
                "scored_utc": utc_now()}

    def archive(self, run_id: str) -> bytes:
        path = self.run_dir(run_id)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for file in sorted(path.rglob("*")):
                if file.is_file() and not file.is_symlink() and path in file.resolve().parents:
                    zf.write(file, Path(run_id, file.relative_to(path)).as_posix())
        return buffer.getvalue()

    # -- jobs -------------------------------------------------------------
    def start_job(self, repeat, label) -> Job:
        if type(repeat) is not int or not 1 <= repeat <= MAX_REPEAT:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"repeat must be a whole number from 1 to {MAX_REPEAT}")
        if not isinstance(label, str) or not LABEL.match(label):
            raise ApiError(HTTPStatus.BAD_REQUEST, "label may use only lowercase letters, digits and hyphens (24 max)")
        with self.lock:
            if any(j.state == "running" for j in self.jobs.values()):
                raise ApiError(HTTPStatus.CONFLICT, "A fixture run is already in progress")
            self.root.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            run_id = f"web-{stamp}" + (f"-{label}" if label else "")
            while (self.root / run_id).exists():
                run_id = f"web-{stamp}-{uuid.uuid4().hex[:4]}" + (f"-{label}" if label else "")
            out = self.root / run_id
            longest = len(str(out)) + len(f"\\r{repeat}-hard_cancel-not_delivered-revocation_gate-precommitted\\events.sqlite3-journal")
            if os.name == "nt" and longest >= 260:
                raise ApiError(HTTPStatus.BAD_REQUEST,
                               f"Trial paths would reach {longest} characters, past the Windows 260-character limit. "
                               "Move the project to a shorter folder or start the server with a shorter --runs-dir.")
            job = Job(run_id, out, repeat)
            self.jobs[job.id] = job
        threading.Thread(target=self._execute, args=(job,), name=f"stopcheck-run-{job.id}", daemon=True).start()
        return job

    def _execute(self, job: Job) -> None:
        command = [sys.executable, "-m", "stopcheck", "run", "--out", str(job.out), "--repeat", str(job.repeat)]
        env = dict(os.environ, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
        try:
            with subprocess.Popen(command, cwd=self.project_root, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                  errors="replace", env=env) as process:
                assert process.stdout is not None
                for raw in process.stdout:
                    line = raw.rstrip()
                    with job.lock:
                        job.output.append(line)
                        match = PROGRESS.match(line)
                        if match:
                            job.completed += 1
                            job.last_trial = match.group(1)
                            job.verdicts[match.group(2)] = job.verdicts.get(match.group(2), 0) + 1
                returncode = process.wait()
        except Exception as exc:  # The run failed to execute, not a trial verdict.
            with job.lock:
                job.state, job.error, job.finished_utc = "failed", f"{type(exc).__name__}: {exc}", utc_now()
            return
        with job.lock:
            job.returncode = returncode
            job.finished_utc = utc_now()
            has_summary = (job.out / "summary.json").is_file()
            if returncode == 0 and has_summary:
                job.state = "completed"
            elif returncode == 2 and has_summary:
                # The runner exits 2 when some trials are invalid; execution still finished.
                job.state = "completed_with_invalid"
            else:
                job.state = "failed"
                tail = [l for l in job.output if l.strip()][-8:]
                job.error = "\n".join(tail) or f"Runner exited with code {returncode}"

    def job(self, job_id: str) -> Job:
        with self.lock:
            job = self.jobs.get(job_id)
        if job is None:
            raise ApiError(HTTPStatus.NOT_FOUND, "Unknown job")
        return job


class Handler(BaseHTTPRequestHandler):
    server_version = "StopCheckWeb/0.1"
    registry: Registry
    allowed_hosts: set[str]
    quiet = False

    # -- plumbing ---------------------------------------------------------
    def log_message(self, fmt, *args):
        if not self.quiet:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_bytes(self, status: int, body: bytes, content_type: str, extra: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; "
                         "font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, data, status: int = 200) -> None:
        self.send_bytes(status, json.dumps(data).encode("utf-8"), "application/json")

    def send_download(self, body: bytes, content_type: str, filename: str) -> None:
        self.send_bytes(200, body, content_type, {"Content-Disposition": f'attachment; filename="{filename}"'})

    def host_ok(self) -> bool:
        return self.headers.get("Host", "") in self.allowed_hosts

    def handle_api(self, method: str) -> None:
        try:
            if not self.host_ok():
                raise ApiError(HTTPStatus.FORBIDDEN, "Unexpected Host header")
            parts = [unquote(p) for p in urlsplit(self.path).path.split("/") if p]
            if method == "POST":
                self.check_post()
            self.route(method, parts)
        except ApiError as exc:
            self.send_json({"error": str(exc)}, exc.status)
        except (OSError, ValueError, KeyError, sqlite3.Error) as exc:
            self.send_json({"error": f"{type(exc).__name__}: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def check_post(self) -> None:
        origin = self.headers.get("Origin")
        if origin and urlsplit(origin).netloc not in self.allowed_hosts:
            raise ApiError(HTTPStatus.FORBIDDEN, "Cross-origin request refused")
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            raise ApiError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Expected application/json")

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
        if length > MAX_BODY:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Request body too large")
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Body must be JSON")
        if not isinstance(data, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Body must be a JSON object")
        return data

    # -- routes -----------------------------------------------------------
    def do_GET(self):
        self.handle_api("GET")

    def do_HEAD(self):
        self.handle_api("GET")

    def do_POST(self):
        self.handle_api("POST")

    def route(self, method: str, parts: list[str]) -> None:
        reg = self.registry
        if method == "GET" and not parts:
            return self.static("index.html")
        if method == "GET" and len(parts) == 2 and parts[0] == "static":
            return self.static(parts[1])
        if not parts or parts[0] != "api":
            raise ApiError(HTTPStatus.NOT_FOUND, "Not found")
        rest = parts[1:]
        if method == "GET" and rest == ["meta"]:
            return self.send_json({"trials_per_repeat": TRIALS_PER_REPEAT, "max_repeat": MAX_REPEAT,
                                   "runs_root": reg.display_root(), "python": sys.version.split()[0]})
        if method == "GET" and rest == ["runs"]:
            return self.send_json({"runs": reg.list_runs()})
        if rest[:1] == ["runs"] and len(rest) >= 2:
            run_id = rest[1]
            if method == "GET" and len(rest) == 2:
                return self.send_json(reg.run_detail(run_id))
            if method == "GET" and rest[2:] == ["archive.zip"]:
                return self.send_download(reg.archive(run_id), "application/zip", f"{run_id}.zip")
            if method == "GET" and len(rest) == 4 and rest[2] == "files":
                name = rest[3]
                if name not in RUN_FILES:
                    raise ApiError(HTTPStatus.NOT_FOUND, "Unknown report file")
                path = reg.run_dir(run_id) / name
                if not path.is_file():
                    raise ApiError(HTTPStatus.NOT_FOUND, "This run has no " + name + " yet")
                return self.send_download(path.read_bytes(), RUN_FILES[name], f"{run_id}-{name}")
            if len(rest) >= 4 and rest[2] == "trials":
                trial = rest[3]
                if method == "GET" and len(rest) == 4:
                    return self.send_json(reg.trial_detail(run_id, trial))
                if method == "GET" and rest[4:] == ["events.jsonl"]:
                    path = reg.trial_dir(run_id, trial) / "events.jsonl"
                    return self.send_download(path.read_bytes(), "application/x-ndjson", f"{trial}-events.jsonl")
                if method == "POST" and rest[4:] == ["rescore"]:
                    return self.send_json(reg.rescore(run_id, trial))
        if rest == ["jobs"]:
            if method == "GET":
                with reg.lock:
                    jobs = list(reg.jobs.values())
                return self.send_json({"jobs": [j.to_dict() for j in jobs]})
            if method == "POST":
                body = self.read_json()
                job = reg.start_job(body.get("repeat", 1), body.get("label", ""))
                return self.send_json(job.to_dict(), HTTPStatus.ACCEPTED)
        if method == "GET" and len(rest) == 2 and rest[0] == "jobs":
            return self.send_json(reg.job(rest[1]).to_dict())
        raise ApiError(HTTPStatus.NOT_FOUND, "Not found")

    def static(self, name: str) -> None:
        path = STATIC / name
        if not NAME.match(name) or path.suffix not in STATIC_TYPES or not path.is_file() \
                or path.resolve().parent != STATIC.resolve():
            raise ApiError(HTTPStatus.NOT_FOUND, "Not found")
        self.send_bytes(200, path.read_bytes(), STATIC_TYPES[path.suffix])


def default_runs_root() -> Path:
    bundled = PACKAGE_ROOT / "runs"
    return bundled if bundled.is_dir() else Path.cwd() / "runs"


def make_server(host: str = "127.0.0.1", port: int = 8765, runs_root: Path | None = None,
                quiet: bool = False) -> ThreadingHTTPServer:
    registry = Registry(runs_root or default_runs_root())
    handler = type("StopCheckHandler", (Handler,), {"registry": registry, "quiet": quiet, "allowed_hosts": set()})
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    bound = server.server_address[1]
    names = {host, "localhost", "127.0.0.1", "[::1]"}
    handler.allowed_hosts = {f"{n}:{bound}" for n in names} | ({n for n in names} if bound == 80 else set())
    server.registry = registry  # type: ignore[attr-defined]
    return server


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="stopcheck web", description="Serve the local StopCheck dashboard")
    p.add_argument("--host", default="127.0.0.1", help="Interface to bind (default: 127.0.0.1)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--runs-dir", type=Path, default=None, help="Directory holding run folders (default: ./runs)")
    p.add_argument("--open", action="store_true", help="Open the dashboard in the default browser")
    args = p.parse_args(argv)
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        print("Warning: binding beyond localhost exposes run controls to your network.", file=sys.stderr)
    server = make_server(args.host, args.port, args.runs_dir)
    url = f"http://{'localhost' if args.host in {'127.0.0.1', '::1'} else args.host}:{server.server_address[1]}/"
    print(f"StopCheck dashboard: {url}  (runs: {server.registry.root})  Ctrl+C to stop", flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
