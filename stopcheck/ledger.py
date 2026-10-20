"""Trusted simulated sink, durable authority, and ordered execution evidence.

All actions affect SQLite rows only. The guard and effect acceptance share a
BEGIN IMMEDIATE transaction: there is no await/check-then-execute gap.
"""
from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class Ledger:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, isolation_level=None, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS authority (
                root_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, active INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY, root_id TEXT NOT NULL, epoch INTEGER NOT NULL,
                state TEXT NOT NULL, action TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, utc TEXT NOT NULL,
                monotonic_ns INTEGER NOT NULL, event TEXT NOT NULL,
                actor TEXT NOT NULL, data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS effects (
                job_id TEXT PRIMARY KEY, accepted_seq INTEGER NOT NULL,
                settled_seq INTEGER
            );
        """)

    def emit(self, event: str, actor: str = "harness", **data: Any) -> int:
        cur = self.db.execute(
            "INSERT INTO events(utc,monotonic_ns,event,actor,data) VALUES(?,?,?,?,?)",
            (datetime.now(timezone.utc).isoformat(), time.monotonic_ns(), event,
             actor, json.dumps(data, sort_keys=True)),
        )
        return int(cur.lastrowid)

    def start(self, config: dict[str, Any]) -> None:
        self.db.execute("INSERT INTO authority VALUES('root-1',1,1)")
        self.emit("run_started", config=config, root_id="root-1",
                  evidence_kind="scripted_systems_fixture")

    def queue(self, job_id: str = "job-1") -> None:
        # Issuance captures the current epoch; recovery must preserve it.
        row = self.db.execute("SELECT epoch FROM authority WHERE root_id='root-1'").fetchone()
        self.db.execute("INSERT INTO jobs VALUES(?, 'root-1', ?, 'queued', 'fake_email')",
                        (job_id, row["epoch"]))
        self.emit("job_queued", "subgraph", job_id=job_id, root_id="root-1", epoch=row["epoch"])

    def revoke(self) -> int:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("UPDATE authority SET active=0,epoch=epoch+1 WHERE root_id='root-1'")
            epoch = self.db.execute("SELECT epoch FROM authority WHERE root_id='root-1'").fetchone()[0]
            seq = self.emit("stop_fence", root_id="root-1", current_epoch=epoch)
            self.db.execute("COMMIT")
            return seq
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def attempt(self, job_id: str = "job-1", actor: str = "worker") -> None:
        self.emit("tool_attempt", actor, job_id=job_id, root_id="root-1")

    def commit(self, enforce: bool, job_id: str = "job-1", actor: str = "sink") -> bool:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            job = self.db.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            if job is None:
                raise ValueError("Unknown job")
            root = self.db.execute("SELECT * FROM authority WHERE root_id=?", (job["root_id"],)).fetchone()
            if self.db.execute("SELECT 1 FROM effects WHERE job_id=?", (job_id,)).fetchone():
                self.emit("duplicate_suppressed", actor, job_id=job_id)
                self.db.execute("COMMIT")
                return False
            authorized = root is not None and bool(root["active"]) and root["epoch"] == job["epoch"]
            data = dict(job_id=job_id, root_id=job["root_id"], job_epoch=job["epoch"],
                        current_epoch=root["epoch"] if root else None)
            if enforce and not authorized:
                self.emit("action_blocked", actor, reason="revoked_or_stale_epoch", **data)
                self.db.execute("UPDATE jobs SET state='blocked' WHERE job_id=?", (job_id,))
                accepted = False
            else:
                seq = self.emit("action_committed", actor, **data)
                self.db.execute("INSERT INTO effects(job_id,accepted_seq) VALUES(?,?)", (job_id, seq))
                self.db.execute("UPDATE jobs SET state='accepted' WHERE job_id=?", (job_id,))
                accepted = True
            self.db.execute("COMMIT")
            return accepted
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def settle(self, job_id: str = "job-1") -> None:
        row = self.db.execute("SELECT * FROM effects WHERE job_id=?", (job_id,)).fetchone()
        if row is not None and row["settled_seq"] is None:
            seq = self.emit("effect_settled", "provider", job_id=job_id, accepted_seq=row["accepted_seq"])
            self.db.execute("UPDATE effects SET settled_seq=? WHERE job_id=?", (seq, job_id))

    def events(self) -> list[dict[str, Any]]:
        return [dict(seq=r["seq"], utc=r["utc"], monotonic_ns=r["monotonic_ns"],
                     event=r["event"], actor=r["actor"], data=json.loads(r["data"]))
                for r in self.db.execute("SELECT * FROM events ORDER BY seq")]

    def export(self, path: Path) -> list[dict[str, Any]]:
        events = self.events()
        Path(path).write_text("".join(json.dumps(e, sort_keys=True)+"\n" for e in events), encoding="utf-8")
        return events

    def close(self) -> None:
        self.db.close()
