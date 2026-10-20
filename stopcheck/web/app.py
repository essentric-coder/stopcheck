"""FastAPI backend for the StopCheck dashboard.

Serves the compiled React build from ``stopcheck/web/dist`` and a small JSON
API over :mod:`stopcheck.web.registry`. Install with ``pip install -r
requirements-web.txt``; the core runner does not need these packages.
"""
from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Body, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from .registry import (
    MAX_REPEAT, NAME, RUN_FILES, TRIALS_PER_REPEAT, ApiError, Registry, default_runs_root,
)

DIST = Path(__file__).resolve().parent / "dist"
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
LOOPBACK = {"127.0.0.1", "localhost", "::1"}


def create_app(runs_root: Path | None = None, allowed_hosts: set[str] | None = None) -> FastAPI:
    registry = Registry(runs_root or default_runs_root())
    hosts = allowed_hosts or set()
    app = FastAPI(title="StopCheck dashboard", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.registry = registry

    @app.middleware("http")
    async def guard(request: Request, call_next):
        # Reject other Host headers (DNS rebinding) and cross-origin writes.
        host = request.headers.get("host", "")
        if hosts and host not in hosts:
            return JSONResponse({"error": "Unexpected Host header"}, 403)
        if request.method == "POST":
            origin = request.headers.get("origin")
            if origin and urlsplit(origin).netloc != host:
                return JSONResponse({"error": "Cross-origin request refused"}, 403)
            if not request.headers.get("content-type", "").startswith("application/json"):
                return JSONResponse({"error": "Expected application/json"}, 415)
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError):
        return JSONResponse({"error": str(exc)}, int(exc.status))

    def download(body: bytes, media_type: str, filename: str) -> Response:
        return Response(body, media_type=media_type,
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    @app.get("/api/meta")
    def meta():
        return {"trials_per_repeat": TRIALS_PER_REPEAT, "max_repeat": MAX_REPEAT,
                "runs_root": registry.display_root(), "python": sys.version.split()[0]}

    @app.get("/api/runs")
    def runs():
        return {"runs": registry.list_runs()}

    @app.get("/api/runs/{run_id}")
    def run(run_id: str):
        return registry.run_detail(run_id)

    @app.get("/api/runs/{run_id}/archive.zip")
    def archive(run_id: str):
        return download(registry.archive(run_id), "application/zip", f"{run_id}.zip")

    @app.get("/api/runs/{run_id}/files/{name}")
    def run_file(run_id: str, name: str):
        if name not in RUN_FILES:
            raise ApiError(404, "Unknown report file")
        path = registry.run_dir(run_id) / name
        if not path.is_file():
            raise ApiError(404, f"This run has no {name} yet")
        return download(path.read_bytes(), RUN_FILES[name], f"{run_id}-{name}")

    @app.get("/api/runs/{run_id}/trials/{trial}")
    def trial(run_id: str, trial: str):
        return registry.trial_detail(run_id, trial)

    @app.get("/api/runs/{run_id}/trials/{trial}/events.jsonl")
    def trial_log(run_id: str, trial: str):
        path = registry.trial_dir(run_id, trial) / "events.jsonl"
        return download(path.read_bytes(), "application/x-ndjson", f"{trial}-events.jsonl")

    @app.post("/api/runs/{run_id}/trials/{trial}/rescore")
    def rescore(run_id: str, trial: str):
        return registry.rescore(run_id, trial)

    @app.get("/api/jobs")
    def jobs():
        with registry.lock:
            items = list(registry.jobs.values())
        return {"jobs": [j.to_dict() for j in items]}

    @app.post("/api/jobs", status_code=202)
    def start_job(body: dict = Body(default_factory=dict)):
        return registry.start_job(body.get("repeat", 1), body.get("label", "")).to_dict()

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str):
        return registry.job(job_id).to_dict()

    @app.api_route("/api/{rest:path}", methods=["GET", "POST"])
    def api_not_found(rest: str):
        raise ApiError(404, "Not found")

    @app.get("/{path:path}")
    def frontend(path: str):
        index = DIST / "index.html"
        if not index.is_file():
            return JSONResponse({"error": "Frontend build missing. Run `npm run build` in frontend/."}, 503)
        if path:
            # Only serve files that really sit inside the build folder.
            parts = path.split("/")
            if all(NAME.match(p) for p in parts):
                candidate = (DIST / path).resolve()
                if DIST.resolve() in candidate.parents and candidate.is_file():
                    return FileResponse(candidate)
            if path.startswith("assets/"):
                raise ApiError(404, "Not found")
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app


def allowed_hosts_for(host: str, port: int) -> set[str]:
    names = {host} | LOOPBACK
    return {f"{n}:{port}" if ":" not in n else f"[{n}]:{port}" for n in names}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="stopcheck web", description="Serve the local StopCheck dashboard")
    p.add_argument("--host", default="127.0.0.1", help="Interface to bind (default: 127.0.0.1)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--runs-dir", type=Path, default=None, help="Directory holding run folders (default: ./runs)")
    p.add_argument("--open", action="store_true", help="Open the dashboard in the default browser")
    args = p.parse_args(argv)
    try:
        import uvicorn
    except ImportError:
        print("The dashboard needs FastAPI and Uvicorn: pip install -r requirements-web.txt", file=sys.stderr)
        return 2
    if args.host not in LOOPBACK:
        print("Warning: binding beyond localhost exposes run controls to your network.", file=sys.stderr)
    app = create_app(args.runs_dir, allowed_hosts_for(args.host, args.port))
    url = f"http://{'localhost' if args.host in LOOPBACK else args.host}:{args.port}/"
    print(f"StopCheck dashboard: {url}  (runs: {app.state.registry.root})  Ctrl+C to stop", flush=True)
    if args.open:
        webbrowser.open(url)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0
