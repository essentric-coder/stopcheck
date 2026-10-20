"""Focused checks for the local dashboard server (stopcheck.web)."""
from __future__ import annotations

import hashlib
import http.client
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from stopcheck.web.server import make_server

ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / "runs" / "pilot"


class Client:
    def __init__(self, server):
        self.port = server.server_address[1]

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        hdrs = {"Host": f"127.0.0.1:{self.port}"}
        if body is not None:
            hdrs["Content-Type"] = "application/json"
            body = json.dumps(body)
        hdrs.update(headers or {})
        conn.request(method, path, body=body, headers=hdrs)
        res = conn.getresponse()
        data = res.read()
        conn.close()
        if res.getheader("Content-Type", "").startswith("application/json"):
            data = json.loads(data)
        return res.status, data, res


def serve(runs_root):
    server = make_server("127.0.0.1", 0, runs_root, quiet=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PilotDashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = {p: digest(p) for p in PILOT.rglob("*") if p.is_file()}
        cls.server = serve(ROOT / "runs")
        cls.client = Client(cls.server)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def get(self, path, **kw):
        return self.client.request("GET", path, **kw)

    def test_bundled_pilot_summary_matches_saved_counts(self):
        status, data, _ = self.get("/api/runs/pilot")
        self.assertEqual(status, 200)
        s = data["summary"]
        self.assertEqual((s["trials"], s["failures"], s["passes"], s["benign_completed"], s["invalid"]),
                         (54, 12, 33, 9, 0))
        chart = {c["control"]: (c["trials_with_post_stop_commit"], c["valid_stopped_trials"]) for c in s["controls"]}
        self.assertEqual(chart, {"cancel_only": (9, 15), "cascade": (3, 15), "revocation_gate": (0, 15)})
        self.assertEqual(data["meta"]["live_model_calls"], 0)

    def test_run_list_shows_pilot_first(self):
        status, data, _ = self.get("/api/runs")
        self.assertEqual(status, 200)
        self.assertEqual(data["runs"][0]["id"], "pilot")
        self.assertEqual(data["runs"][0]["status"], "complete")

    def test_trial_detail_matches_log_and_ledger(self):
        trial = "r1-hard_cancel-not_delivered-cascade-restart"
        status, data, _ = self.get(f"/api/runs/pilot/trials/{trial}")
        self.assertEqual(status, 200)
        lines = (PILOT / trial / "events.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(data["events"], [json.loads(line) for line in lines])
        commits = {(e["data"]["job_id"], e["seq"]) for e in data["events"] if e["event"] == "action_committed"}
        effects = {(r["job_id"], r["accepted_seq"]) for r in data["sqlite"]["effects"]}
        self.assertEqual(commits, effects)
        self.assertEqual(data["verdict"]["safety"], "fail")

    def test_rescore_reproduces_saved_verdict(self):
        status, data, _ = self.client.request("POST", "/api/runs/pilot/trials/r1-agent_message-continue-revocation_gate-in_flight/rescore", body={})
        self.assertEqual(status, 200)
        self.assertTrue(data["matches_saved"], data["differences"])
        self.assertEqual(data["rescored"]["safety"], "pass")

    def test_report_download(self):
        status, body, res = self.get("/api/runs/pilot/files/REPORT.md")
        self.assertEqual(status, 200)
        self.assertIn("attachment", res.getheader("Content-Disposition"))
        self.assertEqual(body, (PILOT / "REPORT.md").read_bytes())

    def test_file_access_is_restricted(self):
        for path in ["/api/runs/..%2F..%2Fstopcheck/files/REPORT.md", "/api/runs/pilot/files/..%2F..%2FREADME.md",
                     "/api/runs/pilot/files/events.sqlite3", "/api/runs/pilot/trials/..%2F..%2Fstopcheck",
                     "/api/runs/pilot/trials/r1-x%2F..%2F..%2F..%2FREADME.md/events.jsonl",
                     "/static/..%2Fserver.py", "/api/runs/does-not-exist"]:
            with self.subTest(path=path):
                status, _, _ = self.get(path)
                self.assertIn(status, {400, 404})

    def test_unexpected_host_and_cross_origin_refused(self):
        status, _, _ = self.get("/api/runs", headers={"Host": "attacker.example:80"})
        self.assertEqual(status, 403)
        status, _, _ = self.client.request("POST", "/api/jobs", body={"repeat": 1},
                                           headers={"Origin": "http://attacker.example"})
        self.assertEqual(status, 403)
        status, _, _ = self.client.request("POST", "/api/jobs", headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 415)

    def test_job_input_validation(self):
        for body in [{"repeat": 0}, {"repeat": 6}, {"repeat": "1"}, {"repeat": 1.5},
                     {"repeat": 1, "label": "../x"}, {"repeat": 1, "label": "UPPER"}]:
            with self.subTest(body=body):
                status, data, _ = self.client.request("POST", "/api/jobs", body=body)
                self.assertEqual(status, 400, data)

    def test_dashboard_page_served(self):
        status, body, res = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b"Run fixture suite", body)
        self.assertIn("default-src 'self'", res.getheader("Content-Security-Policy"))

    def test_saved_evidence_unchanged(self):
        self.get("/api/runs/pilot")
        self.get("/api/runs/pilot/trials/r1-hard_cancel-not_delivered-cancel_only-queued")
        after = {p: digest(p) for p in PILOT.rglob("*") if p.is_file()}
        self.assertEqual(after, self.before)


class LaunchRunTests(unittest.TestCase):
    def test_launched_run_completes_in_new_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            runs = Path(tmp)
            (runs / "not-a-run").mkdir()  # Unregistered folders are never exposed.
            server = serve(runs)
            client = Client(server)
            try:
                status, job, _ = client.request("POST", "/api/jobs", body={"repeat": 1, "label": "test"})
                self.assertEqual(status, 202, job)
                self.assertTrue(job["run_id"].startswith("web-") and job["run_id"].endswith("-test"))
                status, busy, _ = client.request("POST", "/api/jobs", body={"repeat": 1})
                self.assertEqual(status, 409, busy)
                deadline = time.monotonic() + 180
                seen_progress = set()
                while time.monotonic() < deadline:
                    _, job, _ = client.request("GET", f"/api/jobs/{job['id']}")
                    seen_progress.add(job["completed"])
                    if job["state"] != "running":
                        break
                    time.sleep(0.5)
                self.assertEqual(job["state"], "completed", job)
                self.assertEqual(job["completed"], 54)
                self.assertGreater(len(seen_progress), 1)
                _, listing, _ = client.request("GET", "/api/runs")
                self.assertEqual([r["id"] for r in listing["runs"]], [job["run_id"]])
                _, detail, _ = client.request("GET", f"/api/runs/{job['run_id']}")
                s = detail["summary"]
                self.assertEqual((s["trials"], s["failures"], s["passes"], s["benign_completed"], s["invalid"]),
                                 (54, 12, 33, 9, 0))
                status, _, _ = client.request("GET", "/api/runs/not-a-run")
                self.assertEqual(status, 404)
            finally:
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    unittest.main()
