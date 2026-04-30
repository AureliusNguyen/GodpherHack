"""
Stepped load profile for the Hub API.

Ramps concurrent users 5 -> MAX in increments of 5, holding each step
for STEP_TIME seconds. Produces a time series in stats_history.csv
that bench/plot-ramp.py turns into a users-vs-latency chart.

Override via env:
  RAMP_MAX        max concurrent users (default 50)
  RAMP_STEP       users added per step (default 5)
  RAMP_STEP_TIME  seconds per step (default 30)

Usage:
  locust -f bench/locustfile-ramp.py --host http://134.84.145.128:3000 \\
    --headless --csv bench/results/ramp/stats
"""
from __future__ import annotations

import os
import random
import uuid

from locust import HttpUser, LoadTestShape, TaskSet, between, task

JWT = os.environ.get("LOCUST_JWT")

CATEGORIES = ["pwn", "rev", "crypto", "web", "forensics", "misc"]

SEARCH_QUERIES = [
    {"name": "buffer overflow ret2libc", "category": "pwn"},
    {"name": "RSA small e attack", "category": "crypto"},
    {"name": "JWT none algorithm", "category": "web"},
    {"name": "PNG steganography zsteg", "category": "forensics"},
    {"name": "ELF stripped main reverse", "category": "rev"},
    {"name": "base64 nested encoding", "category": "misc"},
]


def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {JWT}"} if JWT else {}


class HealthChecker(TaskSet):
    @task
    def health(self) -> None:
        self.client.get("/health", name="GET /health")


class WriteupSearcher(TaskSet):
    @task
    def analyze(self) -> None:
        q = random.choice(SEARCH_QUERIES)
        body = {
            "challenge": {"name": q["name"], "description": f"ramp: {q['name']}", "files": [], "hints": []},
            "topK": 3,
        }
        self.client.post("/challenges/analyze", json=body, headers=auth_headers(), name="POST /challenges/analyze")


class SolveSubmitter(TaskSet):
    @task
    def submit(self) -> None:
        cat = random.choice(CATEGORIES)
        rid = uuid.uuid4().hex[:8]
        body = {
            "challengeName": f"ramp_{cat}_{rid}",
            "category": cat,
            "writeup": "Ramp synthetic writeup for stepped benchmarking.",
            "executionSteps": ["step 1", "step 2"],
            "tools": ["bash"],
            "keyInsights": ["synthetic"],
            "flag": f"flag{{ramp_{rid}}}",
        }
        self.client.post("/solves", json=body, headers=auth_headers(), name="POST /solves")


class HubUser(HttpUser):
    wait_time = between(0.5, 2.0)
    tasks = {WriteupSearcher: 5, HealthChecker: 2, SolveSubmitter: 1}


class StepLoadShape(LoadTestShape):
    """Step up by RAMP_STEP users every RAMP_STEP_TIME seconds, capped at RAMP_MAX."""

    max_users = int(os.environ.get("RAMP_MAX", "50"))
    step_users = int(os.environ.get("RAMP_STEP", "5"))
    step_time = int(os.environ.get("RAMP_STEP_TIME", "30"))
    spawn_rate = step_users  # spawn the new step quickly so the plateau is steady

    def tick(self):
        run_time = self.get_run_time()
        current_step = int(run_time // self.step_time) + 1
        users = current_step * self.step_users
        if users > self.max_users:
            return None
        return (users, self.spawn_rate)
