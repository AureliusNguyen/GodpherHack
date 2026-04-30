#!/bin/bash
# Auto-load env. Prefer .env (gitignored, per-machine overrides);
# fall back to .env.example (committed, shared demo config).
if [ -f .env ]; then
  set -a; . ./.env; set +a
elif [ -f .env.example ]; then
  set -a; . ./.env.example; set +a
fi
npm run build && node dist/cli.js
