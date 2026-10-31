# Persistent record storage

Each database identity has one broker and one FIFO. Business changes append
immutable `put` or `delete` records. Current views select the latest record for
each entity identity. Business requests have no explicit transactions, retries,
coalescing or automatic replay after a failed request.

## No data migration

Production opens `Data/records.db` through `openOverlay`. Old relational databases
and completed `agents.db.v2.db` files are read sources, never migration targets.
Startup creates the new schema and connection-local commands. It does not copy,
import, replay SQL, validate all rows, rebuild old indexes or delete old files.
The older `open` entry remains for legacy-format tests, not application startup.

TEMP views merge new records with old rows. Any new record shadows the old key,
including tombstones, so deleting a conversation cannot resurrect an old row.
TEMP command triggers write only new records. Public SQL forbids qualified writes,
DDL and connection controls; ordinary ATTACH handles are used for reads only.
New sessions use new-only message views and do not scan old message stores.
Legacy index paths are matched without rebuilding indexes. Automatic integer IDs
use a reserved safe-integer namespace with indexed collision checks.

Unavailable old sources generate warnings without blocking the new database.
SQL-only append logs cannot be recovered without replay and are not replayed by
this mode. A readable database is required to restore their history.

## Continuation

Old PI trees remain readable. For histories without PI trees, a bounded temporary
context prefix combines old canonical or legacy messages with new PI entries.
Only continuation linkage is persisted, never copied historical message bodies.
Missing sources, inconsistent parents and oversized contexts fail explicitly.

## Backup and restore

Both backup formats export `Data/record-storage` containing `records.db`, legacy
SQLite snapshots and a relative-path `manifest.json`. Skipping attachments still
includes all database files. Missing sources fail the backup before publication.
Restore validates the suite before replacing storage; original machine paths
are never used to locate restored sources. WAL durability does not depend on exit.
