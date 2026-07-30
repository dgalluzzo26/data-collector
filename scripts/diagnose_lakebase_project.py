"""Report Lakebase collection config plus staged vs. committed row counts.

Usage: .venv/bin/python scripts/diagnose_lakebase_project.py [name_or_slug_substring]
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

from backend import config, pg_util  # noqa: E402
from backend.sql_util import fetchall  # noqa: E402


def print_schemas() -> None:
    schemas = pg_util.fetchall(
        "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE %s "
        "AND nspname <> 'information_schema' ORDER BY nspname",
        ("pg_%",),
    )
    print("Lakebase schemas:", ", ".join(s["nspname"] for s in schemas) or "(none)")


def main() -> int:
    needle = (sys.argv[1] if len(sys.argv) > 1 else "").lower()

    print_schemas()

    projects = fetchall(
        f"""
        SELECT project_id, name, slug, status, storage_type, storage_mode,
               target_catalog, target_schema, target_table,
               record_sync_mode, record_key_column, duplicate_key_mode
        FROM {config.t('projects')}
        WHERE storage_type = 'lakebase'
        ORDER BY name
        """
    )
    if not projects:
        print("No Lakebase-backed collections found.")
        return 0

    for p in projects:
        if needle and needle not in f"{p['name']} {p['slug']}".lower():
            continue
        print(f"\n=== {p['name']} ({p['slug']}) ===")
        print(f"  project_id:        {p['project_id']}")
        print(f"  status:            {p['status']}")
        print(f"  storage_mode:      {p['storage_mode']}")
        print(f"  target:            {p['target_schema']}.{p['target_table']}")
        print(f"  record_sync_mode:  {p['record_sync_mode']}")
        print(f"  record_key_column: {p['record_key_column']}")
        print(f"  duplicate_key:     {p['duplicate_key_mode']}")

        staged = fetchall(
            f"SELECT COUNT(*) AS cnt FROM {config.t('staged_record_changes')} WHERE project_id = ?",
            (p["project_id"],),
        )
        staged_count = int(staged[0]["cnt"]) if staged else 0
        print(f"  staged (not yet synced to Lakebase): {staged_count}")

        try:
            row = pg_util.fetchone(
                f'SELECT COUNT(*) AS c FROM "{p["target_schema"]}"."{p["target_table"]}"'
            )
            print(f"  rows in Lakebase table:              {row['c']}")
        except Exception as exc:
            print(f"  rows in Lakebase table:              ERROR {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
