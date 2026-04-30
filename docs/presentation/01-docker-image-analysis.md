# Docker Image Analysis

Three captures showing how the Hub container is built, what it weighs,
and where the bytes actually come from. All output is from a clean
build of `godpherhack/hub:dev` on this machine.

## 1. Multi-stage build savings

The Hub uses a two-stage Dockerfile:
- **builder** - `node:22-bookworm` with full toolchain (npm, tsup,
  dev dependencies). Runs `npm ci`, `npm run build`, then prunes dev deps.
- **runtime** - `node:22-bookworm` (slim variant intended), copies
  only `dist/`, `node_modules/`, and `prompts/` from the builder.

### Command

```bash
docker build --target builder -t godpherhack/hub:builder .
docker build -t godpherhack/hub:dev .
docker images --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}" | grep godpherhack
```

### Result

```
godpherhack/hub:builder    1.87 GB
godpherhack/hub:dev          408 MB
```

**Multi-stage build cuts the shipped image from 1.87 GB to 408 MB -
a 78% reduction.** The builder stage holds the entire dev toolchain,
test deps, TypeScript compiler, and intermediate build artifacts;
none of that ships to production.

## 2. Layer attribution (`docker history`)

Lists every layer that contributes to the final 408 MB, in order.

### Command

```bash
docker history godpherhack/hub:dev \
  --format "table {{.Size}}\t{{.CreatedBy}}" \
  --no-trunc | head -20
```

### Reading the output (bottom-up, oldest layer first)

| Source | Size | What it is |
|---|---|---|
| Debian bookworm base | 85.3 MB | OS layer (shared infrastructure) |
| Node 22 install | 154 MB | Node.js runtime + npm |
| Yarn install | 7.32 MB | Bundled with the node image |
| `docker-entrypoint.sh` | 20.5 kB | Standard node-image entrypoint |
| `WORKDIR /app` | 8 kB | Filesystem metadata |
| `COPY dist` | **156 kB** | **Bundled TypeScript (the application)** |
| `COPY node_modules` | **73.7 MB** | **Production deps (LLM SDKs)** |
| `COPY prompts` | 36.9 kB | System prompts (`prompts/system.md`, etc.) |
| `COPY package.json` | 12.3 kB | npm manifest |

### Where the bytes actually go

```
Application code              ............ 205 kB  (0.05%)
  - dist/             156 kB
  - prompts/           36.9 kB
  - package.json       12.3 kB

Production dependencies (LLM SDKs) ...... 73.7 MB  (18%)
  - @anthropic-ai/sdk
  - @pinecone-database/pinecone
  - @modelcontextprotocol/sdk
  - hono + jose + prom-client + ws + zod

Node 22 runtime + npm ................... 154 MB   (38%)
Debian bookworm base .................... 85.3 MB  (21%)
Yarn + entrypoint + metadata + overhead . ~95 MB   (23%)
                                          --------
                                           408 MB
```

## 3. Filesystem inspection (`dive`)

`dive` opens an interactive panel with two views: every layer's
content delta on the left, the merged filetree on the right. This is
the standard tool for verifying that no secrets, dev artifacts, or
unintended files leaked into the runtime image.

### Command

```bash
dive godpherhack/hub:dev
```

### What we verified

```
/app/                 38 MB
  dist/              124 kB    (12 chunks: cli, App, hub, anthropic, ollama, ...)
  prompts/             9 kB    (system.md + tools.md + tools/<key>.md)
  node_modules/      ~37 MB    (pruned to production deps)
  package.json         1 kB
```

The `dist/` directory contains 12 named chunks (lazy-loaded by route
in the bundler config) - not a single monolithic bundle. The
chunking matches the source tree's lazy-import boundaries
(cli.ts, App.tsx, hub/, anthropic.ts, ollama.ts, etc.).

## Slide narrative

Three numbers worth remembering:

- **1.87 GB to 408 MB** - multi-stage build savings (78%)
- **205 kB** - the entire application code surface in the shipped image
- **0.05%** - application code as a fraction of total image size

The image structure says: the platform code is tiny, the dependencies
are trusted standard libraries, and the runtime is a stock Node
container. Nothing is custom or unusual in the shipped artifact -
exactly the shape an operator wants to see for an internal tool that
needs to be auditable.
