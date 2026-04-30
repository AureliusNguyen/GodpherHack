#!/usr/bin/env bash
# Diagnose Ollama from the agent's perspective. Runs each surface
# the OllamaProvider hits in increasing complexity, so the first
# failure tells you where the boundary is.
#
# Default target is the lab machine (134.84.145.128:11434) so
# teammates can just run ./bench/diag-ollama.sh with no env config.
# Override via HOST or OLLAMA_BASE_URL when testing local Ollama.
#
# Usage:
#   ./bench/diag-ollama.sh                              # lab default
#   HOST=http://localhost:11434 ./bench/diag-ollama.sh  # local
#   OLLAMA_BASE_URL=http://other ./bench/diag-ollama.sh # arbitrary
#   MODEL=llama3:latest ./bench/diag-ollama.sh          # override model

set -u

LAB_DEFAULT="http://134.84.145.128:11434"
HOST="${HOST:-${OLLAMA_BASE_URL:-$LAB_DEFAULT}}"
MODEL="${MODEL:-qwen3:14b}"

echo "Target: $HOST   Model: $MODEL"
[ "$HOST" = "$LAB_DEFAULT" ] && echo "(using baked-in lab default; pass HOST=... to override)"

PASS=0; FAIL=0
say() { printf "\n=== %s ===\n" "$*"; }
ok()  { PASS=$((PASS+1));   printf "  [PASS] %s\n" "$*"; }
no()  { FAIL=$((FAIL+1));   printf "  [FAIL] %s\n" "$*"; }

# ---------------------------------------------------------------------
say "Test 1: connectivity (GET /api/tags)"
out=$(curl -sf --max-time 5 "$HOST/api/tags" || true)
if [ -n "$out" ]; then
  ok "Reachable. Models present:"
  echo "$out" | jq -r '.models[].name' | sed 's/^/      /'
else
  no "Cannot reach $HOST/api/tags. Check host/port and remote bind."
  exit 1
fi

# ---------------------------------------------------------------------
say "Test 2: plain chat (no tools, no system prompt)"
body='{"model":"'"$MODEL"'","messages":[{"role":"user","content":"hi"}],"stream":false}'
out=$(curl -sf --max-time 30 -X POST "$HOST/api/chat" \
        -H "Content-Type: application/json" -d "$body" || true)
content=$(echo "$out" | jq -r '.message.content // empty')
if [ -n "$content" ]; then
  ok "Model responded: $(echo "$content" | head -c 80)..."
else
  no "Empty/error response from /api/chat:"
  echo "$out" | head -c 400 | sed 's/^/      /'
fi

# ---------------------------------------------------------------------
say "Test 3: chat with system prompt (mimics buildSystemPrompt scale)"
sys=$(printf 'You are a helpful CTF agent. Respond concisely. %.0s' {1..50})
body=$(jq -nc --arg model "$MODEL" --arg sys "$sys" '{
  model: $model,
  messages: [{role:"system",content:$sys},{role:"user",content:"hi"}],
  stream: false
}')
out=$(curl -sf --max-time 30 -X POST "$HOST/api/chat" \
        -H "Content-Type: application/json" -d "$body" || true)
content=$(echo "$out" | jq -r '.message.content // empty')
if [ -n "$content" ]; then
  ok "System prompt accepted (length ~${#sys} chars)"
else
  no "Failed with a long system prompt:"
  echo "$out" | head -c 400 | sed 's/^/      /'
fi

# ---------------------------------------------------------------------
say "Test 4: chat with one tool definition"
body=$(jq -nc --arg model "$MODEL" '{
  model: $model,
  messages: [{role:"user",content:"hi"}],
  stream: false,
  tools: [{
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"]
      }
    }
  }]
}')
out=$(curl -sf --max-time 30 -X POST "$HOST/api/chat" \
        -H "Content-Type: application/json" -d "$body" || true)
if [ -n "$out" ]; then
  has_calls=$(echo "$out" | jq -r '.message.tool_calls // empty' 2>/dev/null)
  content=$(echo "$out" | jq -r '.message.content // empty')
  if [ -n "$content" ] || [ -n "$has_calls" ]; then
    ok "Tools accepted. Got content=$( [ -n "$content" ] && echo yes || echo no), tool_calls=$( [ -n "$has_calls" ] && echo yes || echo no)"
  else
    no "Tool payload accepted but response empty:"
    echo "$out" | head -c 400 | sed 's/^/      /'
  fi
else
  no "Server rejected tool payload:"
  curl -s --max-time 30 -X POST "$HOST/api/chat" \
       -H "Content-Type: application/json" -d "$body" | head -c 400 | sed 's/^/      /'
fi

# ---------------------------------------------------------------------
say "Test 5: full agent payload (system + tools + tool prompt to provoke a call)"
body=$(jq -nc --arg model "$MODEL" '{
  model: $model,
  messages: [
    {role:"system",content:"You are a CTF agent. Use the bash tool when asked to run commands."},
    {role:"user",content:"run ls"}
  ],
  stream: false,
  options: { temperature: 0, num_predict: 16384 },
  tools: [{
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"]
      }
    }
  }]
}')
out=$(curl -sf --max-time 60 -X POST "$HOST/api/chat" \
        -H "Content-Type: application/json" -d "$body" || true)
if [ -n "$out" ]; then
  tool_calls=$(echo "$out" | jq -r '.message.tool_calls | length // 0')
  content=$(echo "$out" | jq -r '.message.content // ""')
  ok "Full payload accepted. tool_calls returned: $tool_calls. content length: ${#content}"
  if [ "$tool_calls" -gt 0 ]; then
    echo "  First tool call:"
    echo "$out" | jq '.message.tool_calls[0]' | sed 's/^/      /'
  fi
else
  no "Full agent-shape payload failed:"
  curl -s --max-time 60 -X POST "$HOST/api/chat" \
       -H "Content-Type: application/json" -d "$body" | head -c 600 | sed 's/^/      /'
fi

# ---------------------------------------------------------------------
say "Summary"
echo "  $PASS passed, $FAIL failed against $HOST (model=$MODEL)"
[ "$FAIL" -eq 0 ]
