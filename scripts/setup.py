#!/usr/bin/env python3
"""Provision Data Collector Unity Catalog metadata tables via SQL warehouse.

Executes DDL directly against your Databricks SQL warehouse — no Databricks CLI
required.

Usage:
  python scripts/setup.py
  python scripts/setup.py --catalog serverless_stable_tgnklq_catalog --schema data_collector
  python scripts/setup.py \\
    --host https://<workspace>.cloud.databricks.com \\
    --token dapi... \\
    --warehouse-id <warehouse-id>

  python scripts/setup.py --emit-sql

Credentials (first match wins):
  1. CLI flags: --host, --token, --warehouse-id / --warehouse-http-path
  2. Environment / .env: DATABRICKS_HOST, DATABRICKS_TOKEN,
     DATABRICKS_WAREHOUSE_ID or DATABRICKS_SQL_WAREHOUSE_HTTP_PATH
  3. Databricks SDK profile (~/.databrickscfg)
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

VENV_PYTHON = ROOT / ".venv" / "bin" / "python3"


def _in_project_venv() -> bool:
    venv_root = (ROOT / ".venv").resolve()
    try:
        return Path(sys.prefix).resolve() == venv_root
    except OSError:
        return False


def _reexec_in_venv_if_needed() -> None:
    """Use project .venv when system python lacks databricks-sql-connector."""
    if not VENV_PYTHON.is_file() or _in_project_venv():
        return
    try:
        import databricks.sql  # noqa: F401
        return
    except ImportError:
        os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]])


_reexec_in_venv_if_needed()

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from backend.schema_ddl import schema_sql  # noqa: E402

DEFAULT_CATALOG = "serverless_stable_tgnklq_catalog"
DEFAULT_SCHEMA = "data_collector"
SQL_FILE = ROOT / "sql" / "schema.sql"


def _check_dependencies() -> None:
    try:
        import databricks.sql  # noqa: F401
    except ImportError:
        print(
            "Missing Python packages. Install into a venv, then re-run:\n"
            "  python3 -m venv .venv\n"
            "  PIP_CONFIG_FILE=pip.conf .venv/bin/pip install -r requirements.txt\n"
            "  ./scripts/setup.sh\n"
            "\n"
            "Or: .venv/bin/python3 scripts/setup.py ...",
            file=sys.stderr,
        )
        sys.exit(1)


def emit_sql(catalog: str, schema: str) -> None:
    SQL_FILE.parent.mkdir(exist_ok=True)
    SQL_FILE.write_text(schema_sql(catalog, schema))
    print(f"Wrote {SQL_FILE}")


def run(
    catalog: str,
    schema: str,
    *,
    host: str | None,
    token: str | None,
    warehouse_id: str | None,
    warehouse_http_path: str | None,
) -> None:
    from backend.db import get_connection, resolve_warehouse_http_path
    from backend.provisioning import provision

    http_path = resolve_warehouse_http_path(
        warehouse_http_path=warehouse_http_path,
        warehouse_id=warehouse_id,
    )
    print(f"Provisioning {catalog}.{schema} via {http_path} ...")

    with get_connection(
        host=host,
        token=token,
        warehouse_http_path=http_path,
        warehouse_id=warehouse_id,
    ) as conn:
        with conn.cursor() as cur:
            provision(cur, catalog, schema)
            print("  schema + metadata tables ready")

    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--catalog",
        default=None,
        help=f"Unity Catalog name (default: {DEFAULT_CATALOG}, or DATABRICKS_CATALOG)",
    )
    parser.add_argument(
        "--schema",
        default=None,
        help=f"Schema name (default: {DEFAULT_SCHEMA}, or DATABRICKS_SCHEMA)",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("DATABRICKS_HOST"),
        help="Workspace URL (or set DATABRICKS_HOST)",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("DATABRICKS_TOKEN"),
        help="Personal access token (or set DATABRICKS_TOKEN)",
    )
    parser.add_argument(
        "--warehouse-id",
        default=os.environ.get("DATABRICKS_WAREHOUSE_ID"),
        help="SQL warehouse id (or set DATABRICKS_WAREHOUSE_ID)",
    )
    parser.add_argument(
        "--warehouse-http-path",
        default=os.environ.get("DATABRICKS_SQL_WAREHOUSE_HTTP_PATH"),
        help="SQL warehouse HTTP path (alternative to --warehouse-id)",
    )
    parser.add_argument(
        "--emit-sql",
        action="store_true",
        help="write sql/schema.sql and exit (no warehouse connection)",
    )
    args = parser.parse_args()

    catalog = args.catalog or os.environ.get("DATABRICKS_CATALOG") or DEFAULT_CATALOG
    schema = args.schema or os.environ.get("DATABRICKS_SCHEMA") or DEFAULT_SCHEMA

    if args.emit_sql:
        emit_sql(catalog, schema)
        return

    _check_dependencies()

    if not args.warehouse_id and not args.warehouse_http_path:
        parser.error(
            "Provide --warehouse-id or --warehouse-http-path "
            "(or set DATABRICKS_WAREHOUSE_ID / DATABRICKS_SQL_WAREHOUSE_HTTP_PATH)"
        )

    run(
        catalog,
        schema,
        host=args.host,
        token=args.token,
        warehouse_id=args.warehouse_id,
        warehouse_http_path=args.warehouse_http_path,
    )


if __name__ == "__main__":
    main()
