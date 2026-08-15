#!/usr/bin/env bash
# Runs once when the Codespace is created. Builds .env from .env.example;
# the DB passwords are fine at their placeholder defaults for a throwaway
# demo box, but ANTHROPIC_API_KEY is real money and real auth, so it's
# pulled from a Codespaces secret (set via scripts/setup-codespaces-secret.sh
# or the repo/account Codespaces secrets settings) instead of ever being
# written into the repo.
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f .env ]] || cp .env.example .env

if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  grep -vE '^ANTHROPIC_API_KEY=' .env > .env.tmp
  echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" >> .env.tmp
  mv .env.tmp .env
  echo "[setup-env] ANTHROPIC_API_KEY pulled from the Codespaces secret."
else
  echo "[setup-env] No ANTHROPIC_API_KEY Codespaces secret found — the agent"
  echo "  investigation loop won't work until you set one (see"
  echo "  scripts/setup-codespaces-secret.sh) or edit .env by hand."
fi

echo "[setup-env] Ready. Run: docker compose up --build"
echo "[setup-env] Then open the forwarded port-80 preview for the app."
