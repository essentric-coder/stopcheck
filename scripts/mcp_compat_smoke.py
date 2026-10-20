"""No-model compatibility preflight through the pinned upstream Agent client.

This checks initialize/list/write/read across the real MCP transport. It does
not send stop/cancel messages or test queue/recovery semantics.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path


def revision(path: Path) -> str:
    return subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"],
                          capture_output=True, text=True, check=True).stdout.strip()


async def exercise(args, evidence):
    from mcp_agent.app import MCPApp
    from mcp_agent.agents.agent import Agent
    from mcp_agent.config import (Settings, MCPSettings, MCPServerSettings,
                                  LoggerSettings, OpenTelemetrySettings, UsageTelemetrySettings)
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js is required")
    evidence["node"] = subprocess.run([node, "--version"], capture_output=True, text=True, check=True).stdout.strip()
    evidence["packages"] = {name: version(name) for name in ["mcp-agent", "mcp", "pydantic"]}
    try:
        evidence["environment_extra"] = {"socksio": version("socksio"),
                                          "reason": "Host SOCKS proxy support; upstream lock and source unchanged."}
    except Exception:
        pass
    evidence["agent_commit"] = revision(args.agent_source)
    evidence["server_commit"] = revision(args.server_source)
    if evidence["agent_commit"] != "f62d849350816588b1c6294e7914bbe4d8b84072":
        raise ValueError("Agent checkout differs from selected revision")
    if evidence["server_commit"] != "51b6382a3e827aceb6bce430b1208d69b93d95ea":
        raise ValueError("Server checkout differs from selected revision")
    entry = args.server_source / "src/filesystem/dist/index.js"
    evidence["server_entry_sha256"] = hashlib.sha256(entry.read_bytes()).hexdigest()
    evidence["source_lock_sha256"] = {
        "agent_uv_lock": hashlib.sha256((args.agent_source / "uv.lock").read_bytes()).hexdigest(),
        "server_package_lock": hashlib.sha256((args.server_source / "package-lock.json").read_bytes()).hexdigest(),
    }
    with tempfile.TemporaryDirectory(prefix="stopcheck-mcp-") as temporary:
        directory = Path(temporary).resolve()
        settings = Settings(
            execution_engine="asyncio",
            logger=LoggerSettings(type="none", transports=["none"], level="error", progress_display=False),
            otel=OpenTelemetrySettings(enabled=False),
            usage_telemetry=UsageTelemetrySettings(enabled=False),
            mcp=MCPSettings(servers={"filesystem": MCPServerSettings(
                command=node, args=[str(entry), str(directory)],
            )}),
        )
        app = MCPApp(name="stopcheck_compatibility_only", settings=settings)
        async with app.run():
            agent = Agent(name="filesystem_smoke", instruction="Use the allowed filesystem directory only.",
                          server_names=["filesystem"])
            async with agent:
                listed = await agent.list_tools()
                names = [tool.name for tool in listed.tools]
                evidence["steps"].append({"step": "initialize_and_list_tools", "status": "pass", "tools": names})
                writer = next(name for name in names if name.endswith("write_file"))
                reader = next((name for name in names if name.endswith("read_text_file")),
                              next((name for name in names if name.endswith("read_file")), None))
                if reader is None:
                    raise ValueError("No compatible read tool exposed")
                path = directory / "compatibility.txt"
                payload = "StopCheck MCP compatibility preflight\n"
                written = await agent.call_tool(writer, {"path": str(path), "content": payload})
                if written.isError or not path.exists() or path.read_text() != payload:
                    raise ValueError("MCP write did not create the expected local effect")
                evidence["steps"].append({"step": "write_file", "status": "pass", "tool": writer,
                                          "content_sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
                read = await agent.call_tool(reader, {"path": str(path)})
                text = "\n".join(getattr(part, "text", "") for part in read.content)
                if read.isError or payload.strip() not in text:
                    raise ValueError("MCP read did not return the expected contents")
                evidence["steps"].append({"step": "read_file", "status": "pass", "tool": reader})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--agent-source", type=Path, required=True)
    p.add_argument("--server-source", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    start = time.monotonic()
    evidence = {"kind": "compatibility_preflight_only", "started_utc": datetime.now(timezone.utc).isoformat(),
                "python": platform.python_version(), "platform": platform.system(), "steps": [],
                "model_calls": 0, "stop_experiments": 0,
                "configuration_changes": ["filesystem only; fetch disabled", "temporary allowed directory",
                                           "explicit write/read task through native Agent client", "telemetry disabled"],
                "scope": "Basic pinned-client/server interoperability; no LLM selection or cancellation/recovery tested."}
    async def bounded():
        async with asyncio.timeout(90):
            await exercise(args, evidence)
    try:
        asyncio.run(bounded())
        evidence["status"] = "pass"
    except Exception as exc:
        evidence["status"] = "failed"
        evidence["error_type"] = type(exc).__name__
        evidence["error"] = str(exc).replace(str(args.agent_source), "<agent-source>").replace(str(args.server_source), "<server-source>")[:1200]
    evidence["elapsed_seconds"] = round(time.monotonic()-start, 3)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(evidence, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    return 0 if evidence["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
