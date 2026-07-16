#!/usr/bin/env python3
"""Re-attach the Lakebase postgres app resource after bundle deploy.

Databricks bundle Terraform manages app resources and replaces them with only
what is declared in resources/data-collector.app.yml. The bundle schema does not
yet support app.resources.postgres, so bundle deploy drops the database resource.

The Apps REST API (via databricks-sdk) does accept postgres resources; this
script restores sql-warehouse + database after each deploy.
"""
from __future__ import annotations

import argparse
import os
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-name", required=True)
    parser.add_argument("--warehouse-id", required=True)
    parser.add_argument(
        "--lakebase-branch",
        default=os.environ.get(
            "LAKEBASE_BRANCH", "projects/data-collector/branches/production"
        ),
    )
    parser.add_argument(
        "--lakebase-database",
        default=os.environ.get(
            "LAKEBASE_DATABASE",
            "projects/data-collector/branches/production/databases/databricks-postgres",
        ),
    )
    parser.add_argument(
        "--database-resource-name",
        default=os.environ.get("LAKEBASE_RESOURCE_NAME", "database"),
        help='App resource key (must match valueFrom in app.yaml). Default: "database".',
    )
    parser.add_argument(
        "--profile",
        default=os.environ.get("DATABRICKS_CONFIG_PROFILE"),
        help="Databricks CLI profile (~/.databrickscfg).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the resource update without calling the API.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        from databricks.sdk import WorkspaceClient
        from databricks.sdk.service.apps import (
            App,
            AppResource,
            AppResourcePostgres,
            AppResourcePostgresPostgresPermission,
            AppResourceSqlWarehouse,
            AppResourceSqlWarehouseSqlWarehousePermission,
        )
    except ImportError:
        print(
            "databricks-sdk is required. Install with: pip install 'databricks-sdk>=0.81.0'",
            file=sys.stderr,
        )
        return 1

    resources = [
        AppResource(
            name="sql-warehouse",
            sql_warehouse=AppResourceSqlWarehouse(
                id=args.warehouse_id,
                permission=AppResourceSqlWarehouseSqlWarehousePermission.CAN_USE,
            ),
        ),
        AppResource(
            name=args.database_resource_name,
            postgres=AppResourcePostgres(
                branch=args.lakebase_branch,
                database=args.lakebase_database,
                permission=AppResourcePostgresPostgresPermission.CAN_CONNECT_AND_CREATE,
            ),
        ),
    ]

    if args.dry_run:
        print(f"Would update app {args.app_name!r} resources:")
        for resource in resources:
            print(f"  - {resource.name}")
        return 0

    client_kwargs = {}
    if args.profile:
        client_kwargs["profile"] = args.profile

    client = WorkspaceClient(**client_kwargs)

    sql_warehouse_only = [
        AppResource(
            name="sql-warehouse",
            sql_warehouse=AppResourceSqlWarehouse(
                id=args.warehouse_id,
                permission=AppResourceSqlWarehouseSqlWarehousePermission.CAN_USE,
            ),
        ),
    ]

    print(
        f"==> Ensuring Lakebase database app resource on {args.app_name!r} "
        f"(branch={args.lakebase_branch!r})..."
    )
    try:
        update = client.apps.create_update_and_wait(
            app_name=args.app_name,
            update_mask="resources",
            app=App(name=args.app_name, resources=resources),
        )
    except Exception as exc:
        err = str(exc)
        lakebase_missing = (
            "does not exist" in err.lower()
            or "not found" in err.lower()
            or "NotFound" in type(exc).__name__
        )
        if not lakebase_missing:
            raise
        print(
            "WARN: Lakebase branch/database not found in this workspace; "
            "attaching sql-warehouse only.",
            file=sys.stderr,
        )
        print(
            "      Create the Lakebase project or set ENSURE_LAKEBASE_APP_RESOURCE=false "
            "in .env to skip. See docs/LAKEBASE.md.",
            file=sys.stderr,
        )
        update = client.apps.create_update_and_wait(
            app_name=args.app_name,
            update_mask="resources",
            app=App(name=args.app_name, resources=sql_warehouse_only),
        )

    state = update.status.state.value if update.status and update.status.state else "UNKNOWN"
    message = update.status.message if update.status else ""
    print(f"==> App resource update: {state} — {message}")
    return 0 if state == "SUCCEEDED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
