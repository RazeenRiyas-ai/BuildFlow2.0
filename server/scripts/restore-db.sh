#!/usr/bin/env bash
# Phase 3.9: restores a backup produced by backup-db.sh into a target Postgres database.
#
# Deliberately reads the target from RESTORE_DATABASE_URL, NOT DATABASE_URL — a different env var
# name than every other script/command in this project uses, specifically so a fat-fingered
# `DATABASE_URL=... ./scripts/restore-db.sh` (reusing whatever's already exported in a shell, e.g.
# for running the app or a migration) cannot silently restore over a real database. You must set
# RESTORE_DATABASE_URL explicitly and deliberately every time.
#
# Usage:
#   RESTORE_DATABASE_URL=postgres://user:pass@host:5432/scratch_db ./scripts/restore-db.sh <dump-file> [--yes]
#
# Restoring is destructive to the TARGET database (existing objects that collide with the dump are
# dropped and recreated) — pass --yes to skip the interactive confirmation for scripted/CI use;
# otherwise the script prompts before doing anything.
set -euo pipefail

if [[ -z "${RESTORE_DATABASE_URL:-}" ]]; then
  echo "restore-db.sh: RESTORE_DATABASE_URL is not set" >&2
  exit 1
fi

DUMP_FILE="${1:-}"
if [[ -z "$DUMP_FILE" ]]; then
  echo "restore-db.sh: usage: RESTORE_DATABASE_URL=... ./scripts/restore-db.sh <dump-file> [--yes]" >&2
  exit 1
fi
if [[ ! -f "$DUMP_FILE" ]]; then
  echo "restore-db.sh: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

SKIP_CONFIRM="${2:-}"
if [[ "$SKIP_CONFIRM" != "--yes" ]]; then
  echo "This will restore '$DUMP_FILE' into:"
  echo "  $RESTORE_DATABASE_URL"
  echo "Existing objects in that database that collide with the dump will be dropped and recreated."
  read -r -p "Type 'yes' to continue: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "restore-db.sh: aborted"
    exit 1
  fi
fi

echo "restore-db.sh: restoring $DUMP_FILE into target database ..."

# --clean --if-exists: drops existing objects before recreating them, so a restore into a
# non-empty-but-compatible database (e.g. re-running a rehearsal) doesn't fail on "already exists".
# --no-owner --no-privileges: the dump's original role names almost certainly don't exist on a
# fresh scratch database or a different host — restoring ownership/grants would just fail or
# restore the wrong owner; the schema/data is what matters for a recovery drill or disaster
# recovery, not exactly reproducing role grants from the source environment.
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "$DUMP_FILE"

echo "restore-db.sh: restore complete"
