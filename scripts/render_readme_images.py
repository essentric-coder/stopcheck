"""Rebuild README PNG/SVG assets. Optional authoring dependency: matplotlib.

Run from any directory with: python scripts/render_readme_images.py
The result chart reads the saved pilot summary; this runs no experiments.
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Patch

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "images"
INK = "#172F3D"
MUTED = "#526673"
TEAL = "#177E78"
PALE = "#E4F1EF"
AMBER = "#C55A2A"
LINE = "#BBCBD1"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "text.color": INK,
    "axes.labelcolor": MUTED,
    "xtick.color": MUTED,
    "svg.fonttype": "none",
})


def save(fig, name):
    OUT.mkdir(parents=True, exist_ok=True)
    for ext in ("png", "svg"):
        fig.savefig(OUT / f"{name}.{ext}", dpi=160, facecolor="white")
    plt.close(fig)


def workflow():
    fig = plt.figure(figsize=(11.8, 3.9))
    ax = fig.add_axes((0, 0, 1, 1))
    ax.set(xlim=(0, 1180), ylim=(390, 0))
    ax.axis("off")

    def text(x, y, label, size=14, color=INK, weight="normal", ha="left"):
        ax.text(x, y, label, fontsize=size, color=color, weight=weight,
                ha=ha, va="center")

    def box(x, y, w, h, fill="white", edge=LINE):
        ax.add_patch(FancyBboxPatch((x, y), w, h,
                     boxstyle="round,pad=0,rounding_size=9",
                     facecolor=fill, edgecolor=edge, linewidth=1.2))

    def arrow(start, end, color=MUTED):
        ax.add_patch(FancyArrowPatch(start, end, arrowstyle="-|>",
                     mutation_scale=13, color=color, linewidth=1.4))

    text(40, 32, "Follow the action beyond the stop", 21, weight="bold")
    text(40, 64, "Scripted LangGraph fixture · local effects · separate log scorer", 12, MUTED)

    box(40, 96, 480, 55, PALE, TEAL)
    text(58, 115, "HUMAN STOP", 10, TEAL, "bold")
    text(58, 136, "Hard cancel or agent stop message", 13)
    box(640, 96, 240, 55, PALE, TEAL)
    text(760, 125, "Persisted authority", 13, ha="center")
    arrow((521, 124), (637, 124), TEAL)
    text(580, 108, "revoke", 10, TEAL, ha="center")
    arrow((160, 153), (160, 200), TEAL)
    arrow((760, 153), (760, 200), TEAL)

    nodes = [
        (40, 245, "Agent workflow", "LangGraph parent + child"),
        (350, 225, "Queue / worker", "queued · retry · recovered"),
        (640, 240, "Action acceptance", "optional authority gate*"),
        (945, 195, "Log → score", "SQLite → JSONL"),
    ]
    for x, width, title, subtitle in nodes:
        box(x, 202, width, 90)
        text(x + width / 2, 234, title, 14, weight="bold", ha="center")
        text(x + width / 2, 263, subtitle, 10, MUTED, ha="center")
    for start, end in ((285, 350), (575, 640), (880, 945)):
        arrow((start + 2, 247), (end - 3, 247))

    text(40, 329, "Queued, retried or recovered work may outlive cancellation.", 13, weight="bold")
    text(40, 362, "* Gate enabled only in the revocation_gate reference control. Effects are local database rows.", 10, MUTED)
    save(fig, "workflow")


def results():
    summary = json.loads((ROOT / "runs/pilot/summary.json").read_text(encoding="utf-8"))
    controls = ["cancel_only", "cascade", "revocation_gate"]
    labels = ["Cancel graph /\nscripted compliance", "Also cancel\nactive workers", "Check authority\nat action acceptance"]
    totals, failures = [], []
    for control in controls:
        rows = [r for r in summary["results"]
                if r["control"] == control and r["safety"] != "not_challenged" and r["valid"]]
        totals.append(len(rows))
        failures.append(sum(r["post_stop_commits"] > 0 for r in rows))

    fig = plt.figure(figsize=(11.8, 4.5))
    fig.text(.034, .91, "Fixture results", fontsize=21, weight="bold")
    fig.text(.034, .845, "Stopped trials with a post-stop commit · deliberately constructed controls", fontsize=12, color=MUTED)
    ax = fig.add_axes((.31, .24, .58, .48))
    positions = [2, 1, 0]
    for y, total, failed in zip(positions, totals, failures):
        ax.barh(y, total, height=.5, color=PALE, zorder=2)
        ax.barh(y, failed, height=.5, color=AMBER, zorder=3)
        ax.text(total + .35, y, f"{failed}/{total}", va="center", fontsize=14, weight="bold")
    ax.set_yticks(positions, labels, fontsize=12)
    ax.tick_params(axis="y", length=0, pad=18)
    limit = max(totals)
    ax.set(xlim=(0, limit + 1.4), ylim=(-.6, 2.6), xticks=[0, 5, 10, 15])
    ax.tick_params(axis="x", labelsize=10, length=0, pad=8)
    ax.set_xlabel("Stopped trials", fontsize=11, labelpad=8)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_axisbelow(True)
    ax.grid(axis="x", color="#E3E9EC", linewidth=.8)
    fig.legend(handles=[Patch(color=AMBER, label="Post-stop commit"),
                        Patch(color=PALE, label="No post-stop commit")],
               loc="upper left", bbox_to_anchor=(.31, .80),
               ncol=2, frameon=False, fontsize=10, handlelength=1.2)
    footer = (f"{summary['benign_completed']}/{summary['benign_controls']} benign controls completed"
              f"  ·  {summary['invalid']} invalid  ·  {summary['live_model_calls']} live-model calls")
    fig.text(.034, .065, footer, fontsize=11, color=MUTED)
    save(fig, "fixture-results")


if __name__ == "__main__":
    workflow()
    results()
