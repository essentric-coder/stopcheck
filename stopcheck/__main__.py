from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="StopCheck: systems-layer stop evaluation pilot")
    commands = p.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="Run the offline scripted LangGraph fixture matrix")
    run.add_argument("--out", type=Path, default=Path("runs/pilot"))
    run.add_argument("--repeat", type=int, default=1)
    score = commands.add_parser("score", help="Independently rescore a JSONL execution trace")
    score.add_argument("trace", type=Path)
    replay = commands.add_parser("replay", help="Internal recovery subprocess: replay one persisted job")
    replay.add_argument("--db", type=Path, required=True)
    replay.add_argument("--control", choices=["cancel_only", "cascade", "revocation_gate"], required=True)
    commands.add_parser("web", help="Serve the local dashboard (localhost only by default)", add_help=False)
    return p


async def run_matrix(out: Path, repeat: int) -> int:
    from .engine import configurations, run_trial
    from .reporting import write_reports
    if repeat < 1:
        raise ValueError("--repeat must be at least 1")
    out = out.resolve()
    if out.exists() and any(out.iterdir()):
        raise FileExistsError("Output directory must be empty; choose a new --out path")
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for c in configurations(repeat):
        name = f"r{c.repeat}-{c.channel}-{c.policy}-{c.control}-{c.scenario}"
        row = await run_trial(c, out / name)
        rows.append(row)
        print(name+": "+row["safety"], flush=True)
    write_reports(rows, out)
    invalid = sum(not r["valid"] for r in rows)
    print(json.dumps({"trials": len(rows), "invalid": invalid,
                      "live_model_calls": 0, "report": str(out / "REPORT.md")}))
    return 2 if invalid else 0


def main() -> int:
    args, extra = parser().parse_known_args()
    if args.command == "web":
        from .web.server import main as web_main
        return web_main(extra)
    if extra:
        parser().error("unrecognized arguments: " + " ".join(extra))
    try:
        if args.command == "score":
            from .scoring import read_events, score
            result = score(read_events(args.trace))
            print(json.dumps(result, indent=2))
            # A reproduced safety failure is evidence, not a broken runner.
            return 0 if result["valid"] else 2
        if args.command == "replay":
            from .engine import replay_job
            replay_job(args.db, args.control)
            return 0
        return asyncio.run(run_matrix(args.out, args.repeat))
    except (OSError, ValueError, ImportError) as exc:
        print(f"StopCheck: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
