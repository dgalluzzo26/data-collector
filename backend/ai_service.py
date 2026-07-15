"""AI prompt orchestration and structured output parsing."""

from __future__ import annotations

import json
import re
import uuid
from typing import Any

from backend import ai_client, ai_repository, lookup_repository, repository
from backend.models import (
    ApplyLookupProposalRequest,
    ApplyProjectProposalRequest,
    CreateFromProposalRequest,
    FieldDefinition,
    GenerateLookupRequest,
    GenerateProjectRequest,
    LookupColumn,
    LookupProposal,
    LookupRow,
    LookupTable,
    ProjectBlueprint,
    RefineProjectRequest,
)

_VALID_FIELD_TYPES = {
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
}


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("Model did not return valid JSON")
    return json.loads(cleaned[start : end + 1])


def _slug_key(label: str) -> str:
    return repository.slugify(label).replace("-", "_")


def _normalize_field(raw: dict[str, Any], idx: int) -> FieldDefinition:
    field_type = raw.get("field_type") or "text"
    if field_type not in _VALID_FIELD_TYPES:
        field_type = "text"
    field_key = (raw.get("field_key") or _slug_key(raw.get("label") or f"field_{idx}"))[:80]
    config = raw.get("config_json") or {}
    if field_type == "lookup" and raw.get("lookup_slug"):
        config["lookup_slug"] = raw["lookup_slug"]
    if field_type in ("single_select", "multi_select") and raw.get("options"):
        config["options"] = raw["options"]
    return FieldDefinition(
        field_key=field_key,
        label=(raw.get("label") or field_key.replace("_", " ").title())[:200],
        field_type=field_type,
        config_json=config or None,
        sort_order=int(raw.get("sort_order", idx)),
        is_required=bool(raw.get("is_required", False)),
        schema_version=0,
        is_published=False,
    )


def _normalize_lookup(raw: dict[str, Any]) -> LookupProposal:
    name = (raw.get("name") or "Lookup")[:200]
    slug = raw.get("slug") or repository.slugify(name)
    columns_raw = raw.get("columns") or [
        {"key": "code", "label": "Code"},
        {"key": "name", "label": "Name"},
    ]
    columns = [LookupColumn(key=c["key"], label=c.get("label", c["key"])) for c in columns_raw]
    rows = []
    for idx, row in enumerate(raw.get("rows") or []):
        if isinstance(row, dict):
            rows.append({k: row.get(k) for k in [c.key for c in columns]})
    return LookupProposal(
        name=name,
        slug=slug,
        description=raw.get("description"),
        columns=columns,
        rows=rows,
    )


def _dedupe_lookup_proposals(lookups: list[LookupProposal]) -> list[LookupProposal]:
    """Keep the first lookup per slug — models sometimes repeat tables in one response."""
    seen: set[str] = set()
    deduped: list[LookupProposal] = []
    for proposal in lookups:
        if proposal.slug in seen:
            continue
        seen.add(proposal.slug)
        deduped.append(proposal)
    return deduped


def _normalize_blueprint(data: dict[str, Any]) -> ProjectBlueprint:
    fields = [_normalize_field(f, idx) for idx, f in enumerate(data.get("fields") or [])]
    lookups = _dedupe_lookup_proposals(
        [_normalize_lookup(lk) for lk in data.get("lookups") or []]
    )
    fields = _wire_fields_to_lookups(fields, lookups)
    return ProjectBlueprint(
        name=(data.get("name") or "New collection")[:200],
        description=data.get("description"),
        fields=fields,
        lookups=lookups,
    )


def _wire_fields_to_lookups(
    fields: list[FieldDefinition], lookups: list[LookupProposal]
) -> list[FieldDefinition]:
    """Match select fields to lookup tables by slug/name and wire as lookup fields."""
    by_slug: dict[str, LookupProposal] = {}
    for lk in lookups:
        by_slug[lk.slug] = lk
        by_slug[repository.slugify(lk.name)] = lk

    wired: list[FieldDefinition] = []
    for field in fields:
        key_slug = repository.slugify(field.field_key)
        label_slug = repository.slugify(field.label)
        match = by_slug.get(key_slug) or by_slug.get(label_slug)
        if not match:
            wired.append(field)
            continue

        config = dict(field.config_json or {})
        cols = match.columns
        if cols:
            config.setdefault("value_column", cols[0].key)
            config.setdefault(
                "display_column", cols[1].key if len(cols) > 1 else cols[0].key
            )
        config["lookup_slug"] = match.slug

        should_wire = field.field_type == "lookup" or (
            field.field_type in ("single_select", "multi_select")
            and not config.get("options")
        )
        if should_wire:
            wired.append(
                field.model_copy(update={"field_type": "lookup", "config_json": config})
            )
        else:
            wired.append(field)
    return wired


_PROJECT_SYSTEM = """You design data collection forms for government and enterprise use.
Return ONLY valid JSON (no markdown) matching this schema:
{
  "name": "short collection title",
  "description": "one sentence purpose",
  "fields": [
    {
      "field_key": "snake_case_key",
      "label": "Display label",
      "field_type": "text|textarea|number|date|datetime|boolean|single_select|multi_select|lookup|email|url",
      "is_required": true,
      "lookup_slug": "only for lookup fields — slug of a lookup in lookups array",
      "options": ["only for select fields"]
    }
  ],
  "lookups": [
    {
      "name": "Lookup name",
      "slug": "snake_case_slug",
      "columns": [{"key": "code", "label": "Code"}, {"key": "name", "label": "Name"}],
      "rows": [{"code": "CA", "name": "California"}]
    }
  ]
}
Use lookup fields with matching lookup_slug when dropdown reference data is needed.
Include realistic lookup rows (at least 5) when lookups are used.
field_key and lookup slugs must be lowercase snake_case."""


_LOOKUP_SYSTEM = """You generate lookup/reference table data for form dropdowns.
Return ONLY valid JSON (no markdown):
{
  "name": "Lookup name",
  "slug": "snake_case_slug",
  "description": "optional",
  "columns": [{"key": "code", "label": "Code"}, {"key": "name", "label": "Name"}],
  "rows": [{"code": "X", "name": "Example"}]
}
Include complete, accurate rows for the requested list."""


def generate_project_blueprint(body: GenerateProjectRequest, user_email: str) -> ProjectBlueprint:
    prompt = body.description.strip()
    try:
        text = ai_client.chat_completion(
            [
                {"role": "system", "content": _PROJECT_SYSTEM},
                {"role": "user", "content": prompt},
            ]
        )
        blueprint = _normalize_blueprint(_extract_json(text))
        ai_repository.log_generation(
            user_email=user_email,
            generation_type="generate_project",
            prompt=prompt,
            response_json=blueprint.model_dump(),
            model_endpoint=ai_client.fm_endpoint(),
        )
        return blueprint
    except Exception as exc:
        ai_repository.log_generation(
            user_email=user_email,
            generation_type="generate_project",
            prompt=prompt,
            model_endpoint=ai_client.fm_endpoint(),
            error=str(exc),
        )
        raise


def generate_lookup_proposal(body: GenerateLookupRequest, user_email: str, project_id: str) -> LookupProposal:
    prompt = body.prompt.strip()
    try:
        text = ai_client.chat_completion(
            [
                {"role": "system", "content": _LOOKUP_SYSTEM},
                {"role": "user", "content": prompt},
            ]
        )
        proposal = _normalize_lookup(_extract_json(text))
        ai_repository.log_generation(
            user_email=user_email,
            generation_type="generate_lookup",
            prompt=prompt,
            response_json=proposal.model_dump(),
            project_id=project_id,
            model_endpoint=ai_client.fm_endpoint(),
        )
        return proposal
    except Exception as exc:
        ai_repository.log_generation(
            user_email=user_email,
            generation_type="generate_lookup",
            prompt=prompt,
            project_id=project_id,
            model_endpoint=ai_client.fm_endpoint(),
            error=str(exc),
        )
        raise


def refine_project_fields(body: RefineProjectRequest, user_email: str, project_id: str) -> ProjectBlueprint:
    current = {
        "name": body.name,
        "description": body.description,
        "fields": [f.model_dump() for f in body.fields],
        "lookups": [lk.model_dump() for lk in body.lookups],
    }
    prompt = body.instruction.strip()
    try:
        text = ai_client.chat_completion(
            [
                {"role": "system", "content": _PROJECT_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Current project JSON:\n{json.dumps(current)}\n\n"
                        f"Instruction: {prompt}\n\n"
                        "Return the updated full project JSON."
                    ),
                },
            ]
        )
        blueprint = _normalize_blueprint(_extract_json(text))
        ai_repository.log_generation(
            user_email=user_email,
            generation_type="refine_project",
            prompt=prompt,
            response_json=blueprint.model_dump(),
            project_id=project_id,
            model_endpoint=ai_client.fm_endpoint(),
        )
        return blueprint
    except Exception as exc:
        ai_repository.log_generation(
            user_email=user_email,
            generation_type="refine_project",
            prompt=prompt,
            project_id=project_id,
            model_endpoint=ai_client.fm_endpoint(),
            error=str(exc),
        )
        raise


def _existing_lookup_slug_map(project_id: str) -> tuple[dict[str, LookupTable], dict[str, str]]:
    """Index current project lookups by slug/name and build slug -> lookup_id map."""
    existing_by_slug: dict[str, LookupTable] = {}
    slug_to_id: dict[str, str] = {}
    for lookup in lookup_repository.list_lookups(project_id):
        existing_by_slug[lookup.slug] = lookup
        existing_by_slug[repository.slugify(lookup.name)] = lookup
        slug_to_id[lookup.slug] = lookup.lookup_id
        slug_to_id[repository.slugify(lookup.name)] = lookup.lookup_id
    return existing_by_slug, slug_to_id


def _apply_lookups(project_id: str, lookups: list[LookupProposal], user_email: str) -> dict[str, str]:
    """Create new lookups or reuse existing ones by slug; update rows when provided."""
    existing_by_slug, slug_to_id = _existing_lookup_slug_map(project_id)

    for proposal in _dedupe_lookup_proposals(lookups):
        existing = existing_by_slug.get(proposal.slug) or existing_by_slug.get(
            repository.slugify(proposal.name)
        )
        if existing:
            lookup_id = existing.lookup_id
            if proposal.rows:
                rows = [
                    LookupRow(row_id=str(uuid.uuid4()), values=row, sort_order=idx)
                    for idx, row in enumerate(proposal.rows)
                ]
                lookup_repository.replace_lookup_rows(lookup_id, rows)
        else:
            created = lookup_repository.create_lookup(
                project_id,
                name=proposal.name,
                description=proposal.description,
                columns=proposal.columns,
                created_by=user_email,
                source="ai",
            )
            lookup_id = created.lookup_id
            existing_by_slug[proposal.slug] = created
            existing_by_slug[repository.slugify(proposal.name)] = created
            if proposal.rows:
                rows = [
                    LookupRow(row_id=str(uuid.uuid4()), values=row, sort_order=idx)
                    for idx, row in enumerate(proposal.rows)
                ]
                lookup_repository.replace_lookup_rows(lookup_id, rows)

        slug_to_id[proposal.slug] = lookup_id
        slug_to_id[repository.slugify(proposal.name)] = lookup_id

    return slug_to_id


def _resolve_field_lookups(
    fields: list[FieldDefinition],
    slug_to_id: dict[str, str],
    *,
    proposals: list[LookupProposal] | None = None,
    project_id: str | None = None,
) -> list[FieldDefinition]:
    resolved: list[FieldDefinition] = []
    proposal_by_slug = {p.slug: p for p in (proposals or [])}
    for field in fields:
        if field.field_type != "lookup" or not field.config_json:
            resolved.append(field)
            continue
        config = dict(field.config_json)
        lookup_slug = config.get("lookup_slug")
        lookup_id = slug_to_id.get(str(lookup_slug)) if lookup_slug else None
        if lookup_id:
            config["lookup_id"] = lookup_id
            proposal = proposal_by_slug.get(str(lookup_slug)) if lookup_slug else None
            if proposal and proposal.columns:
                config.setdefault("value_column", proposal.columns[0].key)
                config.setdefault(
                    "display_column",
                    proposal.columns[1].key if len(proposal.columns) > 1 else proposal.columns[0].key,
                )
            elif project_id:
                lk = lookup_repository.get_lookup(project_id, lookup_id)
                if lk and lk.columns:
                    config.setdefault("value_column", lk.columns[0].key)
                    config.setdefault(
                        "display_column",
                        lk.columns[1].key if len(lk.columns) > 1 else lk.columns[0].key,
                    )
        resolved.append(field.model_copy(update={"config_json": config}))
    return resolved


def create_project_from_proposal(body: CreateFromProposalRequest, user_email: str) -> dict[str, Any]:
    from backend import config

    project = repository.create_project(
        name=body.proposal.name.strip(),
        description=body.proposal.description,
        storage_type="uc_delta",
        target_catalog=config.DEFAULT_DATA_CATALOG,
        target_schema=config.DEFAULT_DATA_SCHEMA,
        target_table=f"{repository.slugify(body.proposal.name)}_data",
        created_by=user_email,
    )
    project_id = project["project_id"]
    slug_to_id = _apply_lookups(project_id, body.proposal.lookups, user_email)
    fields = _resolve_field_lookups(
        body.proposal.fields, slug_to_id, proposals=body.proposal.lookups
    )
    if fields:
        repository.replace_draft_fields(project_id, fields, user_email)
    return project


def apply_project_proposal(
    project_id: str,
    body: ApplyProjectProposalRequest,
    user_email: str,
) -> None:
    _, slug_to_id = _existing_lookup_slug_map(project_id)
    if body.lookups:
        slug_to_id = _apply_lookups(project_id, body.lookups, user_email)
    fields = _resolve_field_lookups(
        body.fields, slug_to_id, proposals=body.lookups, project_id=project_id
    )
    repository.replace_draft_fields(project_id, fields, user_email)
    if body.name or body.description is not None:
        updates: dict[str, Any] = {}
        if body.name:
            updates["name"] = body.name
        if body.description is not None:
            updates["description"] = body.description
        if updates:
            repository.update_project(project_id, updates, user_email)


def apply_lookup_proposal(
    project_id: str,
    body: ApplyLookupProposalRequest,
    user_email: str,
) -> LookupTable:
    created = lookup_repository.create_lookup(
        project_id,
        name=body.proposal.name,
        description=body.proposal.description,
        columns=body.proposal.columns,
        created_by=user_email,
        source="ai",
    )
    rows = [
        LookupRow(row_id=str(uuid.uuid4()), values=row, sort_order=idx)
        for idx, row in enumerate(body.proposal.rows)
    ]
    lookup_repository.replace_lookup_rows(created.lookup_id, rows)
    return created
