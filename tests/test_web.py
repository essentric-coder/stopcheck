"""Focused checks for the dashboard backend (stopcheck.web.app).

Skipped when the optional web dependencies (requirements-web.txt) are absent.
"""
from __future__ import annotations

import hashlib
import json
import tempfile
import time
import unittest
from pathlib import Path

try:
    from fastapi.testclient import TestClient

    from stopcheck.web.app import DIST, allowed_hosts_for, create_app
except ImportError:  # pragma: no cover - exercised only without web extras
    TestClient = None

ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / "runs" / "pilot"
BASE = "http://127.0.0.1:8765"


def client(runs_root: Path) -> "TestClient":
    return TestClient(create_app(runs_root, allowed_hosts_for("127.0.0.1", 8765)), base_url=BASE)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@unittest.skipIf(TestClient is None, "web dependencies not installed")
class PilotDashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = {p: digest(p) for p in PILOT.rglob("*") if p.is_file()}
        cls.client = client(ROOT / "runs")

    def test_bundled_pilot_summary_matches_saved_counts(self):
        r = self.client.get("/api/runs/pilot")
        self.assertEqual(r.status_code, 200)
        s = r.json()["summary"]
        self.assertEqual((s["trials"], s["failures"], s["passes"], s["benign_completed"], s["invalid"]),
                         (54, 12, 33, 9, 0))
        chart = {c["control"]: (c["trials_with_post_stop_commit"], c["valid_stopped_trials"]) for c in s["controls"]}
        self.assertEqual(chart, {"cancel_only": (9, 15), "cascade": (3, 15), "revocation_gate": (0, 15)})
        self.assertEqual(r.json()["meta"]["live_model_calls"], 0)

    def test_run_list_shows_pilot_first(self):
        runs = self.client.get("/api/runs").json()["runs"]
        self.assertEqual(runs[0]["id"], "pilot")
        self.assertEqual(runs[0]["status"], "complete")

    def test_trial_detail_matches_log_and_ledger(self):
        trial = "r1-hard_cancel-not_delivered-cascade-restart"
        data = self.client.get(f"/api/runs/pilot/trials/{trial}").json()
        lines = (PILOT / trial / "events.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(data["events"], [json.loads(line) for line in lines])
        commits = {(e["data"]["job_id"], e["seq"]) for e in data["events"] if e["event"] == "action_committed"}
        self.assertEqual(commits, {(r["job_id"], r["accepted_seq"]) for r in data["sqlite"]["effects"]})
        self.assertEqual(data["verdict"]["safety"], "fail")

    def test_rescore_reproduces_saved_verdict(self):
        r = self.client.post("/api/runs/pilot/trials/r1-agent_message-continue-revocation_gate-in_flight/rescore", json={})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["matches_saved"], r.json()["differences"])
        self.assertEqual(r.json()["rescored"]["safety"], "pass")

    def test_report_and_log_downloads(self):
        r = self.client.get("/api/runs/pilot/files/REPORT.md")
        self.assertEqual(r.status_code, 200)
        self.assertIn("attachment", r.headers["content-disposition"])
        self.assertEqual(r.content, (PILOT / "REPORT.md").read_bytes())
        trial = "r1-hard_cancel-not_delivered-cancel_only-queued"
        r = self.client.get(f"/api/runs/pilot/trials/{trial}/events.jsonl")
        self.assertEqual(r.content, (PILOT / trial / "events.jsonl").read_bytes())

    def test_file_access_is_restricted(self):
        for path in ["/api/runs/..%2F..%2Fstopcheck/files/REPORT.md", "/api/runs/pilot/files/..%2F..%2FREADME.md",
                     "/api/runs/pilot/files/events.sqlite3", "/api/runs/pilot/trials/..%2F..%2Fstopcheck",
                     "/api/runs/pilot/trials/r1-x%2F..%2F..%2F..%2FREADME.md/events.jsonl",
                     "/api/runs/does-not-exist", "/api/unknown"]:
            with self.subTest(path=path):
                self.assertIn(self.client.get(path).status_code, {400, 404})
        # Paths outside the build folder never return source files.
        for path in ["/assets/..%2F..%2Fapp.py", "/..%2Fapp.py", "/..%2F..%2Fregistry.py"]:
            with self.subTest(path=path):
                self.assertNotIn(b"create_app", self.client.get(path).content)

    def test_unexpected_host_and_cross_origin_refused(self):
        self.assertEqual(self.client.get("/api/runs", headers={"host": "attacker.example"}).status_code, 403)
        r = self.client.post("/api/jobs", json={"repeat": 1}, headers={"origin": "http://attacker.example"})
        self.assertEqual(r.status_code, 403)
        r = self.client.post("/api/jobs", content="repeat=1", headers={"content-type": "text/plain"})
        self.assertEqual(r.status_code, 415)

    def test_job_input_validation(self):
        for body in [{"repeat": 0}, {"repeat": 6}, {"repeat": "1"}, {"repeat": 1.5},
                     {"repeat": 1, "label": "../x"}, {"repeat": 1, "label": "UPPER"}]:
            with self.subTest(body=body):
                self.assertEqual(self.client.post("/api/jobs", json=body).status_code, 400)

    def test_security_headers_and_frontend(self):
        r = self.client.get("/api/runs")
        self.assertIn("default-src 'self'", r.headers["content-security-policy"])
        self.assertEqual(r.headers["cache-control"], "no-store")
        if (DIST / "index.html").is_file():
            page = self.client.get("/")
            self.assertEqual(page.status_code, 200)
            self.assertIn(b'<div id="root">', page.content)
            self.assertIn(b'<div id="root">', self.client.get("/runs/deep-link").content)

    def test_saved_evidence_unchanged(self):
        self.client.get("/api/runs/pilot")
        self.client.get("/api/runs/pilot/trials/r1-hard_cancel-not_delivered-cancel_only-queued")
        self.client.post("/api/runs/pilot/trials/r1-hard_cancel-not_delivered-cancel_only-queued/rescore", json={})
        after = {p: digest(p) for p in PILOT.rglob("*") if p.is_file()}
        self.assertEqual(after, self.before)


@unittest.skipIf(TestClient is None, "web dependencies not installed")
class LaunchRunTests(unittest.TestCase):
    def test_launched_run_completes_in_new_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            runs = Path(tmp)
            (runs / "not-a-run").mkdir()  # Unregistered folders are never exposed.
            c = client(runs)
            r = c.post("/api/jobs", json={"repeat": 1, "label": "test"})
            self.assertEqual(r.status_code, 202, r.text)
            job = r.json()
            self.assertTrue(job["run_id"].startswith("web-") and job["run_id"].endswith("-test"))
            self.assertEqual(c.post("/api/jobs", json={"repeat": 1}).status_code, 409)
            deadline = time.monotonic() + 180
            seen = set()
            while time.monotonic() < deadline:
                job = c.get(f"/api/jobs/{job['id']}").json()
                seen.add(job["completed"])
                if job["state"] != "running":
                    break
                time.sleep(0.5)
            self.assertEqual(job["state"], "completed", job)
            self.assertEqual(job["completed"], 54)
            self.assertGreater(len(seen), 1)
            self.assertEqual([x["id"] for x in c.get("/api/runs").json()["runs"]], [job["run_id"]])
            s = c.get(f"/api/runs/{job['run_id']}").json()["summary"]
            self.assertEqual((s["trials"], s["failures"], s["passes"], s["benign_completed"], s["invalid"]),
                             (54, 12, 33, 9, 0))
            self.assertEqual(c.get("/api/runs/not-a-run").status_code, 404)


if __name__ == "__main__":
    unittest.main()
