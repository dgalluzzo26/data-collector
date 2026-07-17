import os

from fastapi import APIRouter, Request

from backend import auth, config
from backend import lakebase_config
from backend.app_admin import is_app_admin
from backend.uc_data_access import get_uc_data_access_mode

router = APIRouter()


@router.get("/health")
def health(request: Request):
    warehouse_id = (os.environ.get("DATABRICKS_WAREHOUSE_ID") or "").strip()
    warehouse_path = ""
    db_status = "unknown"
    db_error: str | None = None

    try:
        from backend.db import resolve_warehouse_http_path
        from backend.sql_util import diagnose_user_data_sql, fetchone

        warehouse_path = resolve_warehouse_http_path()
        fetchone("SELECT 1 AS ok")
        db_status = "ok"
    except Exception as exc:
        db_status = "error"
        db_error = str(exc)

    user_data = diagnose_user_data_sql(request)

    return {
        "status": "ok",
        "app": "data-collector",
        "catalog": config.CATALOG,
        "schema": config.SCHEMA,
        "metadata_fqn": config.SCHEMA_FQN,
        "default_data_catalog": config.DEFAULT_DATA_CATALOG,
        "default_data_schema": config.DEFAULT_DATA_SCHEMA,
        "warehouse_id": warehouse_id or None,
        "warehouse_http_path": warehouse_path or None,
        "db_status": db_status,
        "db_error": db_error,
        "user_email": auth.get_user_email(request),
        "is_app_admin": is_app_admin(auth.get_user_email(request)),
        "runtime": "databricks_app" if os.environ.get("DATABRICKS_CLIENT_ID") else "local",
        "lakebase_configured": lakebase_config.is_configured(),
        "lakebase_database": lakebase_config.database_name() if lakebase_config.is_configured() else None,
        "lakebase_default_schema": lakebase_config.default_schema(),
        "uc_data_access_mode": get_uc_data_access_mode(),
        **user_data,
    }
