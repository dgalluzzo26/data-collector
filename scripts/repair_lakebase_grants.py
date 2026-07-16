#!/usr/bin/env python3
"""Grant Lakebase schema/table access for prod app and other PG roles.

When collections are published from local dev, Postgres schemas are owned by your
PGUSER (workspace email). The deployed app's service principal uses a different
PGUSER and cannot read records until grants are applied.

Run once from local dev (as the schema owner), with Lakebase vars in .env:

  # Optional: prod app PGUSER from Compute → Apps → data-collector-prod → Environment
  export LAKEBASE_ADDITIONAL_GRANTEES='<prod-app-pguser>'
  .venv/bin/python scripts/repair_lakebase_grants.py

  # Or repair a single collection by id:
  .venv/bin/python scripts/repair_lakebase_grants.py --project-id ceda02fd-...
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

VENV_PYTHON = ROOT / ".venv" / "bin" / "python"


def _reexec_into_venv_if_needed() -> None:
    if VENV_PYTHON.exists() and Path(sys.executable).resolve() != VENV_PYTHON.resolve():
        os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), *sys.argv])


def main() -> int:
    _reexec_into_venv_if_needed()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project-id",
        help="Repair one collection; default repairs all Lakebase collections",
    )
    args = parser.parse_args()

    from backend import config, lakebase_config, lakebase_storage, pg_util
    from backend.sql_util import fetchall

    try:
        lakebase_config.require_configured()
    except RuntimeError as exc:
        print(f"Lakebase not configured: {exc}", file=sys.stderr)
        return 1

    if args.project_id:
        rows = fetchall(
            f"SELECT * FROM {config.t('projects')} WHERE project_id = ? AND storage_type = 'lakebase'",
            (args.project_id,),
        )
    else:
        rows = fetchall(
            f"SELECT * FROM {config.t('projects')} WHERE storage_type = 'lakebase' ORDER BY name",
        )

    if not rows:
        print("No Lakebase collections found.")
        return 0

    grantees = lakebase_storage._lakebase_grantees()
    print(f"Grantees: {', '.join(grantees)}")
    print(f"Repairing {len(rows)} collection(s)...")

    for project in rows:
        schema = project.get("target_schema")
        table = project.get("target_table")
        print(f"  - {project.get('name')} ({schema}.{table})")
        try:
            lakebase_storage.ensure_collection_grants(project)
        except Exception as exc:
            print(f"    FAILED: {exc}", file=sys.stderr)
            return 1

    # Smoke-test connectivity after grants.
    sample = rows[0]
    pg_util.fetchone(f"SELECT 1 FROM {lakebase_storage.table_ref(sample)} LIMIT 1")
    print("Done. Redeploy is not required — retry the prod records view.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
