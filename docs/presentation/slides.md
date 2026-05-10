# Presentation Talking Points
## System Design

- Two-process architecture: CLI (the user-facing agent loop) and Hub
  (back-end RAG + auth + presence). Communicate over HTTP and a
  WebSocket for real-time events.
- Interface-driven design: one `Provider` interface backs Anthropic +
  Ollama + LiteLLM + Google. One `WriteupRepository` interface backs
  Pinecone + LocalFile + InMemory. Same shape for `ToolAdapter`.
- Adding a new LLM provider or storage backend is "implement the
  interface and register" -- not a refactor.
- Async generator pattern for the agent loop -- yields events to the
  UI and to a collab side-channel without coupling the loop to either.
- Lazy MCP connection with auto-reconnect on timeout. Critical for a
  flaky bridge tool (Ghidra/IDA) not to take down the whole agent.

## Security + Live Collab

- GitHub OAuth + JWT for Hub auth. No password DB, no per-user keys
  to manage. Every CTF team has GitHub accounts already.
- OAuth design: Hub is the OAuth client, CLI owns only the loopback
  redirect; CLI never sees the GitHub access_token. Loopback-only
  redirect URI rejects attacker-controlled hosts; CSRF state token
  blocks cross-site forgery on the OAuth dance.
- Hub refuses to start without explicit `ALLOW_ANONYMOUS_HUB=true`
  when auth env is missing. Fail-closed default removes the "forgot
  to set JWT_SECRET" failure mode.
- `live-collab.png`: two real GitHub-authenticated users on the lab
  Hub, presence strip shows both handles + activity strings rendered
  live from the WebSocket broadcast. Full flow + protocol in
  `06-auth-and-collab.md`.

## Cloud Computing

- Multi-stage Docker build: 1.87 GB builder stage, 408 MB runtime.
  78% size reduction by stripping the dev toolchain after build.
- **Of the 408 MB shipped, 205 kB is application code I authored.**
  That's 0.05% of the image. The other 99.95% is Debian base, Node
  runtime, and well-known npm packages.
- Kubernetes manifests ship production-ready: 2 replicas with
  HorizontalPodAutoscaler 2 - 10, hardened pod spec (non-root,
  read-only FS, dropped caps), Ingress with WebSocket upgrade.
- Observability layered as a separate compose overlay so the base
  Hub stack doesn't pull in Prometheus + Grafana unless asked.
- Scale path documented honestly: in-memory presence works for one
  pod; Redis Pub/Sub is the swap for multi-pod. The interface stays
  the same.
- Walk the Grafana dashboard panel by panel: traffic shape (5:2:1),
  p95 latency under load (`/health` 460microsecs framework floor vs
  `/challenges/analyze` 6ms RAG cost -- 13x gap is real work, not
  noise), zero 5xx, all 200s. Full script in `02-grafana.md`.

## Benchmarking

- Locust harness for the Hub API: read-heavy RAG queries, periodic
  health checks, occasional writes (5:2:1 weight).
- **Stepped ramp 5 -> 50 concurrent users on the lab machine**
  (locust on the same host as the Hub, no network roundtrip per
  request). 30s per plateau, 5 minutes total.
- **Headline: 6,600 requests, 0 failures.** Aggregate p50=1ms,
  p95=1ms, p99=4ms, max=16ms. ~33 RPS sustained at the 50-user
  plateau.
- `chart.png` (top panel): RPS scales **linearly** with user count
  -- no bend, no saturation visible at 50 users.
- `chart.png` (bottom panel): latency starts at p99=9ms (cold JIT
  + caches), drops monotonically through the first 150s, settles at
  p50=p95=1ms / p99=2ms. Standard Node.js startup behavior.
- Honest framing: the system is **not being stressed** at 50 users.
  The bottleneck is Locust's wait_time between requests per user,
  not the server. Real saturation would surface around 500+ users
  with no wait_time -- documented as a follow-up, not blocking.
- `/health` p95 is 460 microseconds: the framework floor (Hono +
  middleware + JSON serialization + container network). The 13x
  gap between `/health` and `/challenges/analyze` (6ms) is the
  actual cost of the RAG search, not measurement noise.
- Why we don't benchmark the agent itself: CTF solve times are too
  noisy run-to-run to compare meaningfully. The infra surface is
  what we can actually measure regression on.
- Cache architecture: two fences -- `indexGeneration` (writeups
  changed) and `analyzerVersion` (logic changed). Either one
  invalidates the 24h retrieval cache.
- Histogram buckets tuned for sub-millisecond resolution: standard
  prom-client defaults bottom out at 5ms, which collapsed all our
  realistic latencies into one bucket. Custom buckets down to 500us
  surface real signal in the Grafana p95 panel.
- Full result analysis + reproduction steps in `07-benchmarking.md`.

## Engineering Rigor

- 164 tests across 18 files. Unit, in-process integration, and a
  live HTTP server end-to-end suite.
- `scripts/smoke.sh` boots the full stack via Docker Compose and
  asserts the whole RAG + observability + WebSocket chain end-to-end.
  Verified passing on the demo machine.
- Code review went through 5 rounds. Each round caught real bugs
  (not stylistic nits). Bugs found and fixed in iteration are stronger
  evidence of engineering process than zero bugs found.

## Challenges and Resolutions

- **MCP poisoned-retry bug.** Caught only by a runtime probe (not
  by tests). The `connecting` map kept rejected promises forever.
  Fix: try/finally so cleanup runs whether connect succeeds or fails.
  Added regression test that goes red against the old code.
- **OAuth open redirect.** Initial implementation accepted any URL
  in `?redirect=`. Code review caught it before deploy. Restricted
  to loopback http URLs only.
- **UI flicker.** A `setInterval` running every 150ms inside every
  message component caused the whole list to redraw 8 times per
  second. Fixed by memoizing `MessageView` and removing per-message
  animation.

## Future Work

- Redis Pub/Sub for multi-pod presence + feed (interface already
  abstract; only the store changes).
- Real benchmark on CTFTiny / NYU CTF Bench for solve-rate numbers.
- LiteLLM cost gating per user (the proxy supports it; the CLI
  just needs to surface budget remaining).
- Wire a Provider into `ChallengeAnalyzer` so categorization is real
  rather than heuristic.
- qemu-system mode for kernel and IoT firmware challenges (current
  qemu wrapper is user-mode only).

## Q&A Anchors

- "What's novel?" -- the combination of team collab + RAG + obs is
  not standard in single-user agent CLIs.
- "Why not just use Claude Code?" -- different category. Claude Code
  is a personal CLI; this is a team platform with shared state.
- "Does it actually solve CTFs?" -- LLM-bottlenecked, not
  architecture-bottlenecked. Use Claude Sonnet for real solving;
  local Ollama is for the self-hostable architecture story.
- "How does it scale?" -- vertically: HPA 2 - 10 with the current
  manifest. Horizontally beyond one pod requires the Redis swap on
  the roadmap.
