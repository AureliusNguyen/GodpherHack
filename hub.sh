#!/bin/bash
# Launch the Hub with env auto-loaded.
# Mirrors run.sh: prefer .env, fall back to .env.example.
if [ -f .env ]; then
  set -a; . ./.env; set +a
elif [ -f .env.example ]; then
  set -a; . ./.env.example; set +a
fi
npm run build && node dist/cli.js hub "$@"
