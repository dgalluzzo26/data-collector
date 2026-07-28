"""Lakebase database introspection for collection setup."""

from fastapi import APIRouter, HTTPException, Query, Request

from backend import auth, lakebase_util
from backend.models import UcTablePreview

router = APIRouter(prefix="/lakebase", tags=["lakebase"])


def _lakebase_error(exc: Exception) -> HTTPException:
    if isinstance(exc, RuntimeError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    raise exc


@router.get("/databases", response_model=list[str])
def list_databases(request: Request):
    auth.get_user_email(request)
    try:
        return lakebase_util.list_databases()
    except (RuntimeError, ValueError) as exc:
        raise _lakebase_error(exc) from exc


@router.get("/schemas", response_model=list[str])
def list_schemas(request: Request):
    auth.get_user_email(request)
    try:
        return lakebase_util.list_schemas()
    except (RuntimeError, ValueError) as exc:
        raise _lakebase_error(exc) from exc


@router.get("/tables", response_model=list[str])
def list_tables(request: Request, schema: str = Query(min_length=1)):
    auth.get_user_email(request)
    try:
        return lakebase_util.list_tables(schema.strip())
    except (RuntimeError, ValueError) as exc:
        raise _lakebase_error(exc) from exc


@router.get("/preview", response_model=UcTablePreview)
def preview_table(
    request: Request,
    schema: str = Query(min_length=1),
    table: str = Query(min_length=1),
):
    auth.get_user_email(request)
    try:
        preview = lakebase_util.preview_table(schema.strip(), table.strip())
    except (RuntimeError, ValueError) as exc:
        raise _lakebase_error(exc) from exc
    return UcTablePreview(**preview)
