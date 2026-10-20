"""Regenerate a portable validation record; never run external integrations."""
from __future__ import annotations

import hashlib
import io
import json
import os
import platform
import sqlite3
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class PortableResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.records: list[str] = []

    def addSuccess(self, test):
        super().addSuccess(test)
        self.records.append("PASS " + test.id())

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.records.append("FAIL " + test.id())

    def addError(self, test, err):
        super().addError(test, err)
        self.records.append("ERROR " + test.id())

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.records.append("SKIP " + test.id())


def main() -> int:
    from stopcheck.reporting import write_reports
    from stopcheck.scoring import read_events, score
    os.environ["LANGSMITH_TRACING"] = "false"
    os.environ["LANGCHAIN_TRACING_V2"] = "false"
    # Load the framework before async test timing so import-time diagnostics
    # cannot inject another machine's paths into the portable record.
    import langgraph.graph  # noqa: F401

    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"))
    details = io.StringIO()
    result = unittest.TextTestRunner(stream=details, verbosity=2, resultclass=PortableResult).run(suite)
    lines = [
        "StopCheck portable validation", "",
        "Generated UTC: " + datetime.now(timezone.utc).isoformat(),
        "Build environment: " + platform.python_implementation() + " " + platform.python_version() + " / " + platform.system(),
        "Command: python scripts/validate.py", "",
        *result.records, "",
        f"Automated tests: {result.testsRun}; failures: {len(result.failures)}; errors: {len(result.errors)}; skipped: {len(result.skipped)}.",
    ]
    if not result.wasSuccessful():
        (ROOT / "VALIDATION.txt").write_text("\n".join(lines)+"\n", encoding="utf-8")
        print(details.getvalue(), file=sys.stderr)
        return 1

    out = ROOT / "runs" / "pilot"
    expected = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    rows = []
    checksum_lines = (out / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines()
    registered_paths = set()
    for line in checksum_lines:
        digest, relative = line.split("  ", 1)
        path = out / relative
        if out.resolve() not in path.resolve().parents:
            raise ValueError("Checksum path escapes saved run directory")
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("Saved execution log checksum mismatch: " + relative)
        registered_paths.add(relative)
    actual_paths = {p.relative_to(out).as_posix() for p in out.glob("*/events.jsonl")}
    if registered_paths != actual_paths or len(actual_paths) != 54:
        raise ValueError("Saved trace inventory does not match the 54-cell fixture matrix")

    for original in expected["results"]:
        trial = original["trial"]
        events = read_events(out / trial / "events.jsonl")
        rescored = {"trial": trial, **score(events)}
        if rescored != original:
            raise ValueError("Saved verdict differs from separate scorer: " + trial)
        with sqlite3.connect(out / trial / "events.sqlite3") as db:
            actual = set(db.execute("SELECT job_id,accepted_seq FROM effects"))
        recorded = {(e["data"]["job_id"], e["seq"]) for e in events if e["event"] == "action_committed"}
        if actual != recorded:
            raise ValueError("SQLite effects differ from recorded commits: " + trial)
        rows.append(rescored)
    counts = {verdict: sum(r["safety"] == verdict for r in rows)
              for verdict in ["fail", "pass", "not_challenged", "invalid"]}
    if counts != {"fail": 12, "pass": 33, "not_challenged": 9, "invalid": 0}:
        raise ValueError("Unexpected fixture control outcomes: " + repr(counts))
    write_reports(rows, out)
    lines += [
        "Saved log checksums: 54/54 match the pre-existing checksum record.",
        "Saved verdicts: 54/54 reproduced by the separate scorer in the same codebase.",
        "SQLite accepted effects vs saved log commit events: 54/54 match.",
        "Fixture outcomes: 12 failures; 33 passes; 9 benign controls completed; 0 invalid.",
        "This validation command executes no model calls and no external stop experiments.", "",
        "External AI review and reproduction (Claude / Anthropic; supplied in this conversation on 2026-10-20):",
        "The pilot code, tests and documentation were developed with ChatGPT/Codex assistance. Claude (Anthropic) reviewed the package and reproduced the test suite and fixture run in a separate Linux sandbox on Python 3.13.",
        "That reproduction used a separate cloud sandbox; it was not run by the user on their own machine.",
        "The present validation command records its own Python/Linux environment separately. Compatibility preflight evidence is recorded in MCP_SMOKE.md and evidence/mcp-smoke.json.",
        "", "The runner and scorer share this project. Separate rescoring is a consistency check, not independent verification.",
    ]
    text = "\n".join(lines)+"\n"
    if "/workspace/" in text or "/opt/codex/" in text:
        raise ValueError("Nonportable host path in validation record")
    (ROOT / "VALIDATION.txt").write_text(text, encoding="utf-8")
    print(f"{result.testsRun} tests passed; 54 saved traces rescored; fixture counts 12/33/9/0; portable record regenerated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
