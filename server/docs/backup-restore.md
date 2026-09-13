# Database Backup & Restore (Phase 3.9)

## 1. Current status

As of Phase 3.9, **no production Postgres hosting provider has been chosen yet**. This doc and the
two scripts it documents (`scripts/backup-db.sh`, `scripts/restore-db.sh`) are deliberately
host-agnostic — they only need a standard `postgres://` connection string, so they work unchanged
regardless of where the database eventually runs.

**Before scheduling anything based on this doc in production, check whether the chosen host
already provides automated backups or point-in-time recovery (PITR).** Railway, Render, Supabase,
Neon, and AWS RDS all typically offer this out of the box, usually with a better recovery point
objective (RPO) than a periodic `pg_dump` can achieve on its own. If the chosen host provides this:

- Treat that provider mechanism as the **primary** recovery path.
- Keep the manual `pg_dump` path in this doc as a **supplementary, independent** recovery option —
  useful for taking an ad-hoc snapshot before a risky manual change, for verifying you can actually
  restore your own data outside the provider's tooling, or as a second copy stored somewhere the
  provider doesn't control.

If the chosen host does *not* provide this (a self-managed VM, or Postgres running somewhere
without a managed backup feature), the manual path below is the **primary** recovery mechanism and
should be scheduled (see §5).

## 2. What's included

- `scripts/backup-db.sh` — dumps a database to a timestamped, `pg_restore`-compatible custom-format
  file.
- `scripts/restore-db.sh` — restores such a file into a target database.

Both are plain bash scripts with no dependencies beyond the `pg_dump`/`pg_restore` client tools
already required to run this project's own `migrate:*`/`seed:*` npm scripts.

## 3. Taking a backup

```bash
DATABASE_URL=postgres://user:pass@host:5432/dbname ./scripts/backup-db.sh [output-dir]
```

`output-dir` defaults to `./backups` (gitignored — see `.gitignore`; a real backup contains real
customer/order data and must never be committed). Each run produces one file:
`buildflow-backup-<UTC timestamp>.dump`. The script exits non-zero if `pg_dump` fails or produces
an empty file — a silent, undetected empty backup is worse than an obviously failed one.

Custom format (`-Fc`, not plain SQL) is used deliberately: it's compressed, and it's the only
format `pg_restore` can do a selective or parallel restore from.

## 4. Restoring a backup

```bash
RESTORE_DATABASE_URL=postgres://user:pass@host:5432/scratch_db ./scripts/restore-db.sh <dump-file> [--yes]
```

Notes:

- **`RESTORE_DATABASE_URL`, not `DATABASE_URL`.** This is deliberate: every other script/command in
  this project reads `DATABASE_URL`, so if it were reused here, a shell that already has
  `DATABASE_URL` exported (to run the app, a migration, anything) could restore over that database
  by accident from a single fat-fingered command. Requiring a distinctly-named variable means you
  have to set it, and think about what you're setting it to, every single time.
- Without `--yes`, the script prints the target and requires typing `yes` to continue — restoring
  is destructive to the target (`--clean --if-exists` drops colliding objects before recreating
  them). Pass `--yes` only for scripted/CI use where the target is already known-disposable (e.g. a
  fresh scratch database created moments earlier).
- `--no-owner --no-privileges` is passed to `pg_restore`: the dump's original role names almost
  certainly don't exist on a different host or a fresh scratch database, and for a recovery drill
  or disaster recovery it's the schema and data that matter, not reproducing the source
  environment's exact ownership/grants.
- `--single-transaction` wraps the whole restore in one `BEGIN`/`COMMIT`: if it fails partway
  through (a truncated/corrupt dump file, a mid-restore error, disk full), everything rolls back
  instead of leaving the target database partially restored and inconsistent. A restore either
  fully succeeds or leaves the target exactly as it was before you ran the command.

## 5. Disaster-recovery procedure

1. Provision or identify the target Postgres instance (a fresh instance, or the repaired original).
2. Locate the most recent known-good backup file.
3. `RESTORE_DATABASE_URL=<target> ./scripts/restore-db.sh <dump-file> --yes` (or interactively,
   without `--yes`, if you want the confirmation prompt).
4. Verify before pointing the application at it — at minimum:
   - Table and index counts match what you expect:
     ```sql
     SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
     SELECT count(*) FROM pg_indexes WHERE schemaname = 'public';
     ```
   - Row counts for the tables you care most about (orders, users, contractors, ...) are
     consistent with the backup's known point in time.
   - Spot-check a handful of real rows for exact content, not just counts.
5. Update `DATABASE_URL` (in whatever config/secret store the running environment uses) to point at
   the restored database, then restart the application.
6. Run the existing migration check (`npm run migrate:up`, which no-ops if nothing new is pending)
   to confirm the restored schema is at the expected migration version before serving real traffic.

## 6. Verified recovery drill (Phase 3.9)

This exact procedure was run end-to-end during Phase 3.9 implementation, against a real local
database, to confirm the scripts actually work rather than just existing:

1. `DATABASE_URL=postgres://localhost:5432/buildflow_test ./scripts/backup-db.sh ./backups` — real
   dump produced (44K, from the seeded test dataset).
2. A fresh scratch database was created (`buildflow_restore_scratch`).
3. `RESTORE_DATABASE_URL=postgres://localhost:5432/buildflow_restore_scratch ./scripts/restore-db.sh
   <dump-file> --yes` — real restore performed.
4. Verified: table count (17 = 17), index count (36 = 36), all 5 enum types present with identical
   values in identical order (including `coordination_type`'s `stale_reminder` value from Phase
   3.7), and row counts for every application table matched exactly between source and restored
   database. A specific `materials` row was also spot-checked for exact field-level content
   (id/name/price/stock_status) and matched byte-for-byte.
5. The scratch database and the test dump file were deleted afterward — this section documents
   that the drill was performed, not a permanent fixture to re-run.

## 7. Scheduling (follow-up, not part of Phase 3.9)

No scheduler exists in this repo to hang a recurring backup on (mirroring the same situation
`docs/idempotency.md`'s own Cleanup section describes for its cleanup query — this project's only
recurring scheduled work today runs as in-process jobs inside the running server, e.g.
`jobs/stale-order-reminder-job.ts` and `jobs/cleanup-job.ts`). `pg_dump` against a live database
from *inside* the same process that's also serving requests is a reasonable pattern for a low-stakes
housekeeping job, but a backup is exactly the kind of thing that should keep running even if the
application process itself is down or crash-looping — so it deliberately is **not** wired up as an
in-process job here. Once a hosting environment is chosen, schedule `scripts/backup-db.sh` via
whatever mechanism that environment provides (a host-level cron job, a scheduled task/job runner,
or — per §1 — skip this entirely if the chosen provider's native backups already cover it).

## 8. Security notes

- Backup files contain the full dataset, including password hashes (`users.password_hash`) and
  refresh token hashes (`refresh_tokens.token_hash`) — not plaintext credentials, but still
  sensitive. Store backup files in an access-controlled location, never a public or shared-read
  path, and never commit one to git (see `.gitignore`).
- `RESTORE_DATABASE_URL` and `DATABASE_URL` should never point at the same database in a real
  recovery scenario unless that database's current contents are already the ones being discarded —
  `--clean` will drop and recreate colliding objects in whatever `RESTORE_DATABASE_URL` names.
