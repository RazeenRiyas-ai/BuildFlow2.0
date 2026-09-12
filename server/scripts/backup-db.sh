#!/usr/bin/env bash
# Phase 3.9: manual/scheduled Postgres backup for BuildFlow.
#
# No production hosting provider is chosen yet (see docs/backup-restore.md) — this script is
# written to be host-agnostic: it only needs a standard Postgres connection string, so it works
# unchanged whether the eventual host is self-managed or a managed provider used alongside its own
# native backups as a cross-check / independent recovery path.
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/dbname ./scripts/backup-db.sh [output-dir]
#
# Produces one timestamped, pg_restore-compatible custom-format dump file per run. Never deletes
# old backups itself — retention/rotation is a deliberate follow-up once real backup volume and a
# storage location are decided (see docs/backup-restore.md).
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "backup-db.sh: DATABASE_URL is not set" >&2
  exit 1
fi

OUTPUT_DIR="${1:-./backups}"
mkdir -p "$OUTPUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="$OUTPUT_DIR/buildflow-backup-${TIMESTAMP}.dump"

echo "backup-db.sh: dumping database to $OUTPUT_FILE ..."

# -Fc: custom format — compressed, and the only format pg_restore can selectively/parallel-restore
# from (unlike plain SQL). This is the format restore-db.sh expects.
pg_dump --format=custom --file="$OUTPUT_FILE" "$DATABASE_URL"

if [[ ! -s "$OUTPUT_FILE" ]]; then
  echo "backup-db.sh: dump file was not created or is empty — treating as a failure" >&2
  exit 1
fi

SIZE="$(du -h "$OUTPUT_FILE" | cut -f1)"
echo "backup-db.sh: backup complete — $OUTPUT_FILE ($SIZE)"
