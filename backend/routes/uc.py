"""Unity Catalog introspection for collection setup (no project required)."""

from fastapi import APIRouter, HTTPException, Query, Request

from backend import auth, uc_util
from backend.models import UcTablePreview
from backend.sql_util import request_connections

router = APIRouter(prefix="/uc", tags=["uc"])


@router.get("/schemas", response_model=list[str])
def list_schemas(request: Request, catalog: str = Query(min_length=1)):
    auth.get_user_email(request)
    try:
        with request_connections(request):
            return uc_util.list_schemas(catalog.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/tables", response_model=list[str])
def list_tables(
    request: Request,
    catalog: str = Query(min_length=1),
    schema: str = Query(min_length=1),
):
    auth.get_user_email(request)
    try:
        with request_connections(request):
            return uc_util.list_tables(catalog.strip(), schema.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/preview", response_model=UcTablePreview)
def preview_table(
    request: Request,
    catalog: str = Query(min_length=1),
    schema: str = Query(min_length=1),
    table: str = Query(min_length=1),
):
    auth.get_user_email(request)
    try:
        with request_connections(request):
            preview = uc_util.preview_uc_table(catalog.strip(), schema.strip(), table.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return UcTablePreview(**preview)
