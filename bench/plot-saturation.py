"""
Read per-user-count Locust stats from a saturation sweep and plot:

  Top:    p50, p95, p99 vs concurrent users
  Bottom: RPS + failure rate vs concurrent users

Saved as <out_dir>/saturation.png. Also prints a summary table to
stdout.

Usage:
  python bench/plot-saturation.py bench/results/saturation-<ts>/
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

import matplotlib.pyplot as plt


def num(v: str | None) -> float:
    if v in (None, "", "N/A"):
        return 0.0
    try:
        return float(v)
    except ValueError:
        return 0.0


def load_aggregated(stats_csv: Path) -> dict[str, float] | None:
    if not stats_csv.exists():
        return None
    with stats_csv.open() as f:
        for row in csv.DictReader(f):
            if row.get("Name") == "Aggregated":
                return {k: num(v) for k, v in row.items() if k not in ("Type", "Name")}
    return None


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: plot-saturation.py <out_dir>", file=sys.stderr)
        sys.exit(1)
    out_dir = Path(sys.argv[1])

    runs: list[tuple[int, dict[str, float]]] = []
    for csv_path in sorted(out_dir.glob("run-*u_stats.csv")):
        m = re.search(r"run-(\d+)u_stats\.csv$", csv_path.name)
        if not m:
            continue
        users = int(m.group(1))
        agg = load_aggregated(csv_path)
        if agg is None:
            print(f"  skip {csv_path.name}: no Aggregated row")
            continue
        runs.append((users, agg))

    if len(runs) < 2:
        print("Need at least 2 runs to plot a sweep.", file=sys.stderr)
        sys.exit(1)

    runs.sort()
    users_x = [u for u, _ in runs]
    p50 = [r.get("50%", 0.0) for _, r in runs]
    p95 = [r.get("95%", 0.0) for _, r in runs]
    p99 = [r.get("99%", 0.0) for _, r in runs]
    rps = [r.get("Requests/s", 0.0) for _, r in runs]
    fails = [r.get("Failures/s", 0.0) for _, r in runs]
    fail_rate_pct = [
        100.0 * r.get("Failure Count", 0.0) / max(r.get("Request Count", 1.0), 1.0)
        for _, r in runs
    ]

    print(f"\n{'users':>6}  {'p50':>6}  {'p95':>6}  {'p99':>6}  {'RPS':>8}  {'fail %':>7}")
    for u, p5, p9, p99v, r, f in zip(users_x, p50, p95, p99, rps, fail_rate_pct):
        print(f"{u:>6}  {p5:>6.1f}  {p9:>6.1f}  {p99v:>6.1f}  {r:>8.1f}  {f:>7.2f}")

    fig, (ax_lat, ax_rps) = plt.subplots(2, 1, figsize=(11, 7), sharex=True)

    ax_lat.plot(users_x, p50, marker="o", color="#ff9f43", label="p50", linewidth=1.5)
    ax_lat.plot(users_x, p95, marker="o", color="#ee5253", label="p95", linewidth=2)
    ax_lat.plot(users_x, p99, marker="o", color="#a55eea", label="p99",
                linewidth=1.5, linestyle="--")
    ax_lat.set_ylabel("Latency (ms)")
    ax_lat.set_title("Hub API saturation sweep")
    ax_lat.legend(loc="upper left")
    ax_lat.grid(True, alpha=0.3)

    ax_rps.plot(users_x, rps, marker="o", color="#2ca02c", label="RPS", linewidth=2)
    ax_rps.set_ylabel("Throughput (RPS)", color="#2ca02c")
    ax_rps.tick_params(axis="y", labelcolor="#2ca02c")
    ax_rps.grid(True, alpha=0.3)
    ax_rps.set_xlabel("Concurrent users")

    if any(f > 0 for f in fail_rate_pct):
        ax_rps_fail = ax_rps.twinx()
        ax_rps_fail.plot(users_x, fail_rate_pct, marker="x", color="#e74c3c",
                         label="failure %", linewidth=1.5)
        ax_rps_fail.set_ylabel("Failure rate (%)", color="#e74c3c")
        ax_rps_fail.tick_params(axis="y", labelcolor="#e74c3c")

    fig.tight_layout()
    chart_path = out_dir / "saturation.png"
    fig.savefig(chart_path, dpi=150, bbox_inches="tight")
    print(f"\nsaved {chart_path}")


if __name__ == "__main__":
    main()
