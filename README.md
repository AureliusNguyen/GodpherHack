# GodpherHack

CLI agentic platform for CTF solving. Higher-layer wrapper around LLM providers (Claude, GPT, Gemini) that orchestrates the full workflow from challenge ingestion to flag verification with tool execution, shared memory, and MCP integration.

## Quick Start

```bash
# Install dependencies
npm install

# Build and run
./run.sh

# Or build separately
./build.sh
godpherhack
```

### Environment Variables

Set at least one provider API key:

```bash
export ANTHROPIC_API_KEY="..."       # Claude (implemented)
export OPENAI_API_KEY="..."          # GPT (planned)
export GOOGLE_API_KEY="..."          # Gemini (planned)
```

## Usage

### Solve a challenge

```bash
# Point at a challenge directory
godpherhack -d challenges/my-goofy-challenge

# Or from within the challenge directory
cd challenges/my-goofy-challenge && godpherhack
```

The agent will examine files, identify the category, run tools, and iterate until it finds the flag.


### Hub API (stub right now, waiting for DB implemetation)

```bash
# Start the Hub server (default port 3000)
godpherhack hub
godpherhack hub -p 8080
```

Endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/challenges/analyze` | Submit challenge for category + keyword analysis |
| `POST` | `/challenges/retry` | Re-query with feedback after failed attempt |
| `POST` | `/solves` | Submit solve writeup to storage |
| `GET` | `/health` | Server status |

### In-app Commands

| Command | Description |
|---------|-------------|
| `/model` | Switch LLM model for the active provider |
| `Ctrl+O` | Expand/collapse truncated messages |
| `Ctrl+C` × 2 | Exit |


### Prompt Architecture

```
prompts/
  system.md             # Core agent instructions
  tools.md              # Lightweight manifest (XML tags listing available packs)
  tools/
    ghidra.md           # Setup, error recovery, common RE patterns
    pwntools.md         # Binary exploitation patterns
```

`buildSystemPrompt()` assembles: `system.md` + `tools.md` manifest + per-tool `tools/<key>.md` for each active pack.

## Development

```bash
./build.sh              # Build with tsup
./test.sh               # Run vitest suite
./run.sh                # Build + launch CLI
npx tsc --noEmit        # Type-check (separate from build)
```
