"""Pydantic models for Data Collector API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

ProjectRole = Literal["admin", "editor", "reader"]
ProjectStatus = Literal["draft", "published", "archived"]
GenieStatus = Literal["disabled", "pending", "ready", "error"]
StorageType = Literal["uc_delta", "lakebase"]
FieldType = Literal[
    "text",
    "textarea",
    "number",
    "date",
    "datetime",
    "boolean",
    "single_select",
    "multi_select",
    "lookup",
    "email",
    "url",
]


class UserInfo(BaseModel):
    email: str
    display_name: str


class ProjectMember(BaseModel):
    project_id: str
    user_email: str
    role: ProjectRole
    added_at: datetime
    added_by: str


class FieldDefinition(BaseModel):
    field_key: str
    label: str
    field_type: FieldType
    config_json: Optional[dict[str, Any]] = None
    sort_order: int
    is_required: bool = False
    schema_version: int = 0
    is_published: bool = False


class ProjectSummary(BaseModel):
    project_id: str
    name: str
    slug: str
    description: Optional[str] = None
    storage_type: StorageType
    status: ProjectStatus
    schema_version: int
    role: Optional[ProjectRole] = None
    created_at: datetime
    created_by: str
    updated_at: Optional[datetime] = None


class ProjectDetail(ProjectSummary):
    target_catalog: Optional[str] = None
    target_schema: Optional[str] = None
    target_table: Optional[str] = None
    sync_catalog: Optional[str] = None
    sync_schema: Optional[str] = None
    sync_table: Optional[str] = None
    genie_space_id: Optional[str] = None
    genie_status: Optional[GenieStatus] = None
    genie_last_synced_at: Optional[datetime] = None
    genie_error: Optional[str] = None
    members: list[ProjectMember] = Field(default_factory=list)
    fields: list[FieldDefinition] = Field(default_factory=list)
    lookups: list[LookupTable] = Field(default_factory=list)


class GenieStatusResponse(BaseModel):
    enabled: bool
    status: str
    space_id: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    error: Optional[str] = None
    ready: bool


class GenieAskRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    conversation_id: Optional[str] = None


class GenieAskResponse(BaseModel):
    conversation_id: str
    message_id: str
    answer_text: str = ""
    sql: Optional[str] = None
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    suggested_questions: list[str] = Field(default_factory=list)
    status: Optional[str] = None
    error: Optional[str] = None


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    storage_type: StorageType = "uc_delta"
    target_catalog: Optional[str] = None
    target_schema: Optional[str] = None
    target_table: Optional[str] = None


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[ProjectStatus] = None
    storage_type: Optional[StorageType] = None
    target_catalog: Optional[str] = Field(default=None, min_length=1, max_length=128)
    target_schema: Optional[str] = Field(default=None, min_length=1, max_length=128)
    target_table: Optional[str] = Field(default=None, min_length=1, max_length=128)
    sync_catalog: Optional[str] = Field(default=None, max_length=128)
    sync_schema: Optional[str] = Field(default=None, max_length=128)
    sync_table: Optional[str] = Field(default=None, max_length=128)


class WorkspaceUser(BaseModel):
    email: str
    display_name: str


class AddMemberRequest(BaseModel):
    user_email: str
    role: ProjectRole = "reader"


class AddMemberResponse(BaseModel):
    members: list[ProjectMember]
    app_access_granted: bool = False
    app_access_note: Optional[str] = None


class SaveFieldsRequest(BaseModel):
    fields: list[FieldDefinition]


class RecordRow(BaseModel):
    record_id: str
    values: dict[str, Any]
    created_at: Optional[datetime] = None
    created_by: Optional[str] = None
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None


class CreateRecordRequest(BaseModel):
    values: dict[str, Any]


class UpdateRecordRequest(BaseModel):
    values: dict[str, Any]


class RecordAuditEntry(BaseModel):
    field_key: Optional[str] = None
    field_label: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    changed_by: str
    changed_at: datetime


class ImportRecordsCsvRequest(BaseModel):
    csv: str = Field(min_length=1, max_length=2_000_000)


class ImportRecordError(BaseModel):
    row: int
    field_errors: dict[str, str]


class ImportRecordsResult(BaseModel):
    created: int
    failed: list[ImportRecordError] = Field(default_factory=list)


class LookupColumn(BaseModel):
    key: str
    label: str
    type: Literal["text", "number"] = "text"


class LookupTable(BaseModel):
    lookup_id: str
    project_id: str
    name: str
    slug: str
    description: Optional[str] = None
    columns: list[LookupColumn]
    row_count: int = 0
    source: Literal["manual", "ai", "import", "uc_bind"] = "manual"
    source_catalog: Optional[str] = None
    source_schema: Optional[str] = None
    source_table: Optional[str] = None
    created_at: datetime
    created_by: str
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None


class LookupRow(BaseModel):
    row_id: str
    values: dict[str, Any]
    sort_order: int


class CreateLookupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    columns: list[LookupColumn] = Field(
        default_factory=lambda: [
            LookupColumn(key="code", label="Code"),
            LookupColumn(key="name", label="Name"),
        ]
    )


class BindLookupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    source_catalog: str = Field(min_length=1, max_length=128)
    source_schema: str = Field(min_length=1, max_length=128)
    source_table: str = Field(min_length=1, max_length=128)
    columns: Optional[list[LookupColumn]] = None


class UcTablePreview(BaseModel):
    catalog: str
    schema: str
    table: str
    columns: list[LookupColumn]
    row_count: int
    sample_rows: list[dict[str, Any]] = Field(default_factory=list)


class UpdateLookupRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    columns: Optional[list[LookupColumn]] = None


class SaveLookupRowsRequest(BaseModel):
    rows: list[LookupRow]


class ImportLookupCsvRequest(BaseModel):
    csv: str = Field(min_length=1, max_length=2_000_000)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)


class GenerateProjectRequest(BaseModel):
    description: str = Field(min_length=10, max_length=8000)


class LookupProposal(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    columns: list[LookupColumn] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)


class ProjectBlueprint(BaseModel):
    name: str
    description: Optional[str] = None
    fields: list[FieldDefinition] = Field(default_factory=list)
    lookups: list[LookupProposal] = Field(default_factory=list)


class CreateFromProposalRequest(BaseModel):
    proposal: ProjectBlueprint


class ApplyProjectProposalRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    fields: list[FieldDefinition]
    lookups: list[LookupProposal] = Field(default_factory=list)


class GenerateLookupRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)


class ApplyLookupProposalRequest(BaseModel):
    proposal: LookupProposal


class RefineProjectRequest(BaseModel):
    instruction: str = Field(min_length=3, max_length=4000)
    name: str
    description: Optional[str] = None
    fields: list[FieldDefinition] = Field(default_factory=list)
    lookups: list[LookupProposal] = Field(default_factory=list)
