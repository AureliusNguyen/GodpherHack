# Ollama on the Lab Machine

End-to-end setup for the local-LLM story: agent CLI on a laptop
talking to Ollama running on the lab machine over the campus network.

Screenshot: `docs/presentation/screenshots/Ollama.png` -- the agent
running with Qwen 3 14B on the lab.

## Why Ollama in this project

Ollama is one of the four `Provider` implementations behind the same
interface (Anthropic + Ollama + LiteLLM + Google-stub). The point is
not that local Qwen 3 14B beats Claude on hard CTFs -- it doesn't --
it's that the architecture works against any LLM, including a fully
self-hosted one. That's the credibility argument for a team that
wants the agent without sending writeups to a third party.

## Lab machine setup

### Confirm the install

Snap-installed Ollama 0.18.0 already on `Slade201289-3`:

```bash
ollama list
# NAME             ID              SIZE      MODIFIED
# qwen3:14b        ...             9.3 GB    ...
# llama3:latest    ...             4.7 GB    ...
```

### Bind on all interfaces

Default snap install listens on `127.0.0.1:11434` only. To accept
remote connections from the agent host:

```bash
sudo snap set ollama host=0.0.0.0:11434
sudo snap restart ollama
ss -tlnp | grep 11434
# LISTEN 0 4096 *:11434  *:*
```

`*:11434` confirms it accepts connections from anywhere reachable.

### Pull the model

```bash
ollama pull qwen3:14b
```

This is the model the agent defaults to (`DEFAULT_MODEL` in
`src/providers/ollama.ts`). Other usable models on the lab:
`qwen2.5-coder:7b`, `llama3:latest`.

## Laptop side

```bash
# IP of the lab machine (134.84.145.128 in our setup)
export OLLAMA_BASE_URL=http://134.84.145.128:11434

# Verify the laptop can reach it
curl -sf $OLLAMA_BASE_URL/api/tags | jq -r '.models[].name'
# qwen3:14b
# llama3:latest

# Launch the agent
./run.sh
# Pick "Ollama (local)" from the provider menu.
# Bottom-right of the UI confirms the active model: "Qwen 3 14B (local)"
```

The agent's `OllamaProvider` reads `OLLAMA_BASE_URL` and points its
`/api/chat` calls at the lab. No code change between local and
lab-hosted Ollama -- only the env var differs.

## Diagnostic script

`bench/test-ollama.sh` runs five connectivity / payload tests in
increasing complexity. First failure tells you exactly what's broken.

```bash
./bench/test-ollama.sh                              # default: lab
HOST=http://localhost:11434 ./bench/test-ollama.sh  # local override
MODEL=llama3:latest ./bench/test-ollama.sh          # different model
```

Tests in order:
1. `GET /api/tags` -- network reachability
2. Plain chat (no tools, no system prompt) -- model alive
3. Chat with a long system prompt -- context handling
4. Chat with a tool definition -- tool-call protocol works
5. Full agent-shape payload (system + tools + options) -- end-to-end

Lab run on 2026-04-30:

```
=== Test 1: connectivity (GET /api/tags) ===
  [PASS] Reachable. Models present: qwen3:14b, llama3:latest

=== Test 2: plain chat ===
  [PASS] Model responded: Hello! How can I assist you today?

=== Test 3: chat with system prompt ===
  [PASS] System prompt accepted (length ~2400 chars)

=== Test 4: chat with one tool definition ===
  [PASS] Tools accepted

=== Test 5: full agent payload ===
  [PASS] tool_calls returned: 1   (Qwen 3 chose to call bash with `ls`)

  5 passed, 0 failed
```

Test 5 is the meaningful one: Qwen 3 14B handed back a structured
tool call, not just text. That's the behavior the agent loop
depends on -- if a model can't tool-call, the whole agentic flow
collapses to plain chat.

## Slide talking points

- Ollama is one of four providers behind the same `Provider`
  interface. Adding Ollama was a single file: `src/providers/ollama.ts`,
  ~140 lines.
- Lab machine runs Ollama on a snap install; one config line
  (`snap set ollama host=0.0.0.0:11434`) makes it network-accessible.
- The agent reads `OLLAMA_BASE_URL` and points `/api/chat` calls at
  whatever host is set. Local laptop or remote lab -- no code change.
- Qwen 3 14B handles tool calls cleanly (verified by
  `bench/test-ollama.sh`). That's the prerequisite for the agent
  loop to work -- without structured tool calls, the agent reduces
  to a chatbot.
- The honest framing: local LLMs are for the architecture story,
  not for solving hard CTFs. Qwen 3 14B replies, follows the system
  prompt, and emits tool calls -- but Anthropic Sonnet still wins
  on actual challenge-solving.
- Diagnostic script documents the full integration. Teammates can
  run `./bench/test-ollama.sh` with no config to confirm the lab
  Ollama is alive before any demo.

## Failure modes seen during prep

Two real problems hit during setup, both fixed:

1. **Snap install bound to localhost.** Default config; fixed via
   `snap set ollama host=...`. Symptom: `ss -tlnp | grep 11434`
   showed `127.0.0.1:11434` instead of `*:11434`.

2. **Stale dist build.** After pulling Qwen 3 and verifying the API,
   the agent CLI still failed with a generic "fetch failed". The
   dist bundle was from before recent provider changes; clean
   rebuild (`rm -rf dist && npm run build`) resolved it. Lesson:
   run.sh's `npm run build` is incremental; trust nothing without
   `rm -rf dist` first when behavior diverges from what the source
   says.
