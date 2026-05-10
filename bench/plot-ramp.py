"""
Read Locust's stats_history.csv from a ramp run and produce two charts:

  Top    : RPS over time + concurrent user count (right axis)
  Bottom : Latency percentiles (p50, p95, p99) over time

Saved as <out_dir>/chart.png.

Usage:
  python bench/plot-ramp.py bench/results/ramp-<timestamp>/
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

import matplotlib.pyplot as plt


def load_history(out_dir: Path) -> list[dict[str, str]]:
    csv_path = out_dir / "stats_stats_history.csv"
    if not csv_path.exists():
        # Older locust versions name it differently
        candidates = list(out_dir.glob("*_stats_history.csv"))
        if not candidates:
            raise FileNotFoundError(f"No stats_history.csv in {out_dir}")
        csv_path = candidates[0]
    with csv_path.open() as f:
        return list(csv.DictReader(f))


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: plot-ramp.py <out_dir>", file=sys.stderr)
        sys.exit(1)
    out_dir = Path(sys.argv[1])

    rows = load_history(out_dir)
    aggregated = [r for r in rows if r.get("Name") == "Aggregated"]
    if not aggregated:
        print("No 'Aggregated' rows in stats_history.csv", file=sys.stderr)
        sys.exit(1)

    t0 = float(aggregated[0]["Timestamp"])
    times = [float(r["Timestamp"]) - t0 for r in aggregated]
    users = [float(r["User Count"]) for r in aggregated]
    rps = [float(r["Requests/s"] or 0) for r in aggregated]

    def col(row: dict[str, str], *names: str) -> float:
        for n in names:
            v = row.get(n)
            if v in (None, "", "N/A"):
                continue
            try:
                return float(v)
            except ValueError:
                continue
        return 0.0

    p50 = [col(r, "50%") for r in aggregated]
    p95 = [col(r, "95%") for r in aggregated]
    p99 = [col(r, "99%") for r in aggregated]

    fig, (ax_top, ax_bot) = plt.subplots(2, 1, figsize=(12, 7), sharex=True)

    # Top: RPS + concurrent users (twin axis)
    ax_top.plot(times, rps, color="#2ca02c", label="RPS", linewidth=2)
    ax_top.set_ylabel("Requests / sec", color="#2ca02c")
    ax_top.tick_params(axis="y", labelcolor="#2ca02c")
    ax_top.grid(True, alpha=0.3)
    ax_top.set_title("Hub API under stepped load")

    ax_top_users = ax_top.twinx()
    ax_top_users.step(times, users, color="#1f77b4", where="post", label="users")
    ax_top_users.set_ylabel("Concurrent users", color="#1f77b4")
    ax_top_users.tick_params(axis="y", labelcolor="#1f77b4")

    # Bottom: latency percentiles
    ax_bot.plot(times, p50, label="p50", color="#ff9f43", linewidth=1.5)
    ax_bot.plot(times, p95, label="p95", color="#ee5253", linewidth=2)
    ax_bot.plot(times, p99, label="p99", color="#a55eea", linewidth=1.5, linestyle="--")
    ax_bot.set_xlabel("Time (s)")
    ax_bot.set_ylabel("Latency (ms)")
    ax_bot.legend(loc="upper left")
    ax_bot.grid(True, alpha=0.3)

    fig.tight_layout()
    chart_path = out_dir / "chart.png"
    fig.savefig(chart_path, dpi=150, bbox_inches="tight")
    print(f"saved {chart_path}")

    # Summary: average p95 + RPS at each plateau (each integer user count)
    by_users: dict[int, list[tuple[float, float]]] = {}
    for u, p, r in zip(users, p95, rps):
        bucket = int(u)
        by_users.setdefault(bucket, []).append((p, r))

    print("\nPer-step summary (median of each plateau):")
    print(f"{'users':>6}  {'p95 (ms)':>10}  {'RPS':>8}")
    for u in sorted(by_users):
        if u == 0:
            continue
        ps = sorted(p for p, _ in by_users[u])
        rs = sorted(r for _, r in by_users[u])
        med_p = ps[len(ps) // 2] if ps else 0.0
        med_r = rs[len(rs) // 2] if rs else 0.0
        print(f"{u:>6}  {med_p:>10.1f}  {med_r:>8.1f}")


if __name__ == "__main__":
    main()
