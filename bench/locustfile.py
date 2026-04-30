"""
Locust load test for the GodpherHack Hub API.

Runs three weighted user flows against a running Hub:
  - HealthChecker: GET /health (cheap baseline)
  - WriteupSearcher: POST /challenges/analyze (RAG path)
  - SolveSubmitter: POST /solves (write path)

Auth: if the Hub has GitHub OAuth enabled, get a JWT via the CLI
(`godpherhack auth login`) and export it:
    export LOCUST_JWT=eyJhbGciOi...
The Authorization header is attached automatically when set.

Run:
    locust -f bench/locustfile.py --host http://localhost:3000
    # or headless:
    locust -f bench/locustfile.py --host http://localhost:3000 \\
        --users 20 --spawn-rate 4 --run-time 60s --headless
"""

from __future__ import annotations

import os
import random
import uuid
from typing import Any

from locust import HttpUser, TaskSet, between, task

JWT = os.environ.get("LOCUST_JWT")

CATEGORIES = ["pwn", "rev", "crypto", "web", "forensics", "misc"]

SEARCH_QUERIES: list[dict[str, Any]] = [
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
            "challenge": {
                "name": q["name"],
                "description": f"Locust-driven challenge: {q['name']}",
                "files": [],
                "hints": [],
            },
            "topK": 3,
        }
        self.client.post(
            "/challenges/analyze",
            json=body,
            headers=auth_headers(),
            name="POST /challenges/analyze",
        )


class SolveSubmitter(TaskSet):
    @task
    def submit(self) -> None:
        cat = random.choice(CATEGORIES)
        rid = uuid.uuid4().hex[:8]
        body = {
            "challengeName": f"locust_{cat}_{rid}",
            "category": cat,
            "writeup": "Locust synthetic writeup for benchmarking purposes.",
            "executionSteps": ["step 1", "step 2"],
            "tools": ["bash", "python3"],
            "keyInsights": ["synthetic"],
            "flag": f"flag{{locust_{rid}}}",
        }
        self.client.post(
            "/solves",
            json=body,
            headers=auth_headers(),
            name="POST /solves",
        )


class HubUser(HttpUser):
    wait_time = between(0.5, 2.0)
    tasks = {
        WriteupSearcher: 5,   # 5x weight: most realistic
        HealthChecker: 2,     # 2x weight: keep-alive baseline
        SolveSubmitter: 1,    # 1x weight: write path is slower / heavier
    }
