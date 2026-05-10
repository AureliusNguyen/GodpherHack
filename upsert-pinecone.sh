#!/usr/bin/env bash
# Upsert new writeups from writeups/ to Pinecone Hub RAG database.
# Only uploads files not previously tracked in writeups/.upserted.json.
#
# Usage:
#   ./upsert-pinecone.sh              # upsert new writeups only
#   ./upsert-pinecone.sh --dry-run    # preview without uploading
#   ./upsert-pinecone.sh --force      # re-upsert all writeups
#
# Requires: PINECONE_API_KEY env var

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
npx tsx "$SCRIPT_DIR/scripts/upsert-writeups.ts" "$SCRIPT_DIR/writeups" "$@"
