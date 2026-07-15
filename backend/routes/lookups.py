from fastapi import APIRouter, HTTPException, Query, Request

from backend import lookup_repository as lookups
from backend import uc_util
from backend.deps import require_role
from backend.models import (
    BindLookupRequest,
    CreateLookupRequest,
    ImportLookupCsvRequest,
    LookupRow,
    LookupTable,
    SaveLookupRowsRequest,
    UcTablePreview,
    UpdateLookupRequest,
)

router = APIRouter(prefix="/projects/{project_id}/lookups", tags=["lookups"])


@router.get("", response_model=list[LookupTable])
def list_lookups(project_id: str, request: Request):
    require_role(project_id, request, "reader")
    return lookups.list_lookups(project_id)


@router.get("/preview-uc-table", response_model=UcTablePreview)
def preview_uc_table(
    project_id: str,
    request: Request,
    catalog: str = Query(min_length=1),
    schema: str = Query(min_length=1),
    table: str = Query(min_length=1),
):
    require_role(project_id, request, "admin")
    try:
        preview = uc_util.preview_uc_table(catalog.strip(), schema.strip(), table.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return UcTablePreview(**preview)


@router.get("/uc-schemas", response_model=list[str])
def list_uc_schemas(
    project_id: str,
    request: Request,
    catalog: str = Query(min_length=1),
):
    require_role(project_id, request, "admin")
    try:
        return uc_util.list_schemas(catalog.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/uc-tables", response_model=list[str])
def list_uc_tables(
    project_id: str,
    request: Request,
    catalog: str = Query(min_length=1),
    schema: str = Query(min_length=1),
):
    require_role(project_id, request, "admin")
    try:
        return uc_util.list_tables(catalog.strip(), schema.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/bind", response_model=LookupTable, status_code=201)
def bind_lookup(project_id: str, body: BindLookupRequest, request: Request):
    user, _ = require_role(project_id, request, "admin")
    try:
        return lookups.create_lookup_from_uc(
            project_id,
            name=body.name.strip(),
            description=body.description,
            source_catalog=body.source_catalog.strip(),
            source_schema=body.source_schema.strip(),
            source_table=body.source_table.strip(),
            columns=body.columns,
            created_by=user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("", response_model=LookupTable, status_code=201)
def create_lookup(project_id: str, body: CreateLookupRequest, request: Request):
    user, _ = require_role(project_id, request, "admin")
    return lookups.create_lookup(
        project_id,
        name=body.name.strip(),
        description=body.description,
        columns=body.columns,
        created_by=user,
    )


@router.post("/import", response_model=LookupTable, status_code=201)
def import_lookup(project_id: str, body: ImportLookupCsvRequest, request: Request):
    user, _ = require_role(project_id, request, "admin")
    if not body.name or not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required when creating a lookup from CSV")
    try:
        return lookups.import_lookup_from_csv(
            project_id,
            name=body.name.strip(),
            csv_text=body.csv,
            created_by=user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{lookup_id}", response_model=LookupTable)
def get_lookup(project_id: str, lookup_id: str, request: Request):
    require_role(project_id, request, "reader")
    lookup = lookups.get_lookup(project_id, lookup_id)
    if not lookup:
        raise HTTPException(status_code=404, detail="Lookup table not found")
    return lookup


@router.patch("/{lookup_id}", response_model=LookupTable)
def update_lookup(project_id: str, lookup_id: str, body: UpdateLookupRequest, request: Request):
    user, _ = require_role(project_id, request, "admin")
    try:
        lookup = lookups.update_lookup(
            project_id,
            lookup_id,
            name=body.name,
            description=body.description,
            columns=body.columns,
            updated_by=user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not lookup:
        raise HTTPException(status_code=404, detail="Lookup table not found")
    return lookup


@router.delete("/{lookup_id}", status_code=204)
def delete_lookup(project_id: str, lookup_id: str, request: Request):
    require_role(project_id, request, "admin")
    if not lookups.get_lookup(project_id, lookup_id):
        raise HTTPException(status_code=404, detail="Lookup table not found")
    lookups.delete_lookup(project_id, lookup_id)


@router.get("/{lookup_id}/rows", response_model=list[LookupRow])
def list_rows(project_id: str, lookup_id: str, request: Request):
    require_role(project_id, request, "reader")
    if not lookups.get_lookup(project_id, lookup_id):
        raise HTTPException(status_code=404, detail="Lookup table not found")
    return lookups.list_lookup_rows(lookup_id)


@router.put("/{lookup_id}/rows", response_model=list[LookupRow])
def save_rows(project_id: str, lookup_id: str, body: SaveLookupRowsRequest, request: Request):
    require_role(project_id, request, "admin")
    if not lookups.get_lookup(project_id, lookup_id):
        raise HTTPException(status_code=404, detail="Lookup table not found")
    try:
        return lookups.replace_lookup_rows(lookup_id, body.rows)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{lookup_id}/import", response_model=list[LookupRow])
def import_lookup_rows(project_id: str, lookup_id: str, body: ImportLookupCsvRequest, request: Request):
    user, _ = require_role(project_id, request, "admin")
    if not lookups.get_lookup(project_id, lookup_id):
        raise HTTPException(status_code=404, detail="Lookup table not found")
    try:
        return lookups.import_rows_from_csv(
            project_id,
            lookup_id,
            csv_text=body.csv,
            updated_by=user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
