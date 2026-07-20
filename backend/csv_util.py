"""CSV parsing helpers for lookup table import and form schema inference."""

from __future__ import annotations

import csv
import io
import re
from typing import Any

from backend.models import FieldDefinition, LookupColumn
from backend.repository import slugify

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _column_key(header: str, index: int) -> str:
    key = slugify(header.strip()) if header.strip() else f"col_{index}"
    return key[:80] or f"col_{index}"


def parse_lookup_csv(csv_text: str) -> tuple[list[LookupColumn], list[dict[str, Any]]]:
    """Parse CSV text into lookup columns and row value dicts."""
    text = csv_text.strip()
    if not text:
        raise ValueError("CSV is empty")

    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel

    reader = csv.reader(io.StringIO(text), dialect)
    parsed_rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not parsed_rows:
        raise ValueError("CSV has no data rows")

    headers = parsed_rows[0]
    keys = [_column_key(h, i) for i, h in enumerate(headers)]
    columns = [
        LookupColumn(key=key, label=(header.strip() or key))
        for key, header in zip(keys, headers)
    ]

    data_rows: list[dict[str, Any]] = []
    for row in parsed_rows[1:]:
        values = {keys[i]: (row[i].strip() if i < len(row) else "") for i in range(len(keys))}
        if any(str(v) for v in values.values()):
            data_rows.append(values)

    if not data_rows:
        raise ValueError("CSV has headers but no data rows")

    return columns, data_rows


def map_rows_to_lookup_columns(
    columns: list[LookupColumn],
    raw_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Map parsed CSV rows to an existing lookup's column keys."""
    keys = [c.key for c in columns]
    mapped: list[dict[str, Any]] = []
    for raw in raw_rows:
        row = {key: raw.get(key, "") for key in keys}
        if any(str(v) for v in row.values()):
            mapped.append(row)
    return mapped


def _csv_dialect(sample: str) -> csv.Dialect:
    try:
        return csv.Sniffer().sniff(sample[:2048], delimiters=",;\t")
    except csv.Error:
        return csv.excel


def _read_csv_rows(csv_text: str, *, keep_empty: bool = False) -> list[list[str]]:
    text = csv_text.strip()
    if not text:
        raise ValueError("CSV is empty")
    reader = csv.reader(io.StringIO(text), _csv_dialect(text))
    rows = list(reader)
    if keep_empty:
        return rows
    return [row for row in rows if any(cell.strip() for cell in row)]


def _header_row_index(header_row: int, total_rows: int) -> int:
    if header_row < 1:
        raise ValueError("Header row must be at least 1")
    if header_row > total_rows:
        raise ValueError(
            f"Header row {header_row} is beyond the file ({total_rows} line(s))"
        )
    return header_row - 1


def _map_csv_columns_to_field_keys(
    headers: list[str],
    header_keys: list[str],
    field_keys: list[str],
) -> dict[str, int]:
    """Map form field keys to CSV column indices."""
    key_index: dict[str, int] = {}
    for idx, hk in enumerate(header_keys):
        if hk in field_keys and hk not in key_index:
            key_index[hk] = idx
            continue
        for fk in field_keys:
            if fk in key_index:
                continue
            if slugify(fk) == hk or slugify(headers[idx]) == slugify(fk):
                key_index[fk] = idx
                break
    return key_index


def preview_records_csv(
    csv_text: str,
    fields: list[FieldDefinition],
    *,
    header_row: int = 1,
) -> tuple[list[dict[str, Any]], list[str], list[dict[str, Any]], int]:
    """Preview CSV import against published form fields."""
    parsed_rows = _read_csv_rows(csv_text, keep_empty=True)
    if not parsed_rows:
        raise ValueError("CSV is empty")

    header_idx = _header_row_index(header_row, len(parsed_rows))
    headers = [h.strip() for h in parsed_rows[header_idx]]
    if not any(headers):
        raise ValueError(f"Row {header_row} does not contain column headers")
    header_keys = [_column_key(h, i) for i, h in enumerate(headers)]
    field_keys = [f.field_key for f in fields]
    key_index = _map_csv_columns_to_field_keys(headers, header_keys, field_keys)

    columns: list[dict[str, Any]] = []
    for field in fields:
        matched = field.field_key in key_index
        col_idx = key_index.get(field.field_key)
        columns.append(
            {
                "field_key": field.field_key,
                "label": field.label,
                "csv_header": headers[col_idx] if col_idx is not None else None,
                "matched": matched,
                "included": matched,
            }
        )

    matched_indices = set(key_index.values())
    unmatched_csv_headers = [
        headers[i] for i in range(len(headers)) if i not in matched_indices and headers[i].strip()
    ]

    data_rows = [row for row in parsed_rows[header_idx + 1 :] if any(cell.strip() for cell in row)]
    sample_rows: list[dict[str, Any]] = []
    for row in data_rows[:5]:
        values: dict[str, Any] = {}
        for fk, col_idx in key_index.items():
            values[fk] = row[col_idx].strip() if col_idx < len(row) else ""
        if any(str(v) for v in values.values()):
            sample_rows.append(values)

    return columns, unmatched_csv_headers, sample_rows, len(data_rows)


def parse_records_csv(
    csv_text: str,
    field_keys: list[str],
    *,
    header_row: int = 1,
    included_field_keys: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Parse CSV into record value dicts keyed by field_key."""
    parsed_rows = _read_csv_rows(csv_text, keep_empty=True)
    if not parsed_rows:
        raise ValueError("CSV is empty")

    header_idx = _header_row_index(header_row, len(parsed_rows))
    headers = [h.strip() for h in parsed_rows[header_idx]]
    if not any(headers):
        raise ValueError(f"Row {header_row} does not contain column headers")
    header_keys = [_column_key(h, i) for i, h in enumerate(headers)]

    key_index = _map_csv_columns_to_field_keys(headers, header_keys, field_keys)
    if included_field_keys is not None:
        allowed = set(included_field_keys)
        key_index = {fk: idx for fk, idx in key_index.items() if fk in allowed}

    if not key_index:
        raise ValueError(
            f"CSV headers must match form field keys. Expected one of: {', '.join(field_keys)}"
        )

    records: list[dict[str, Any]] = []
    for row in parsed_rows[header_idx + 1 :]:
        if not any(cell.strip() for cell in row):
            continue
        values: dict[str, Any] = {}
        for fk, col_idx in key_index.items():
            values[fk] = row[col_idx].strip() if col_idx < len(row) else ""
        if any(str(v) for v in values.values()):
            records.append(values)
    if not records:
        raise ValueError("CSV has headers but no data rows")
    return records


_BOOL_VALUES = frozenset({"true", "false", "yes", "no", "0", "1", "y", "n"})
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ISO_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_URL_RE = re.compile(r"^https?://", re.IGNORECASE)
_RECORD_KEY_RE = re.compile(r"(^id$|_id$|^.*_key$)", re.IGNORECASE)
_SAMPLE_LIMIT = 100
MAX_SELECT_OPTIONS = 500


def _guess_record_key_column(keys: list[str]) -> str:
    for key in keys:
        if _RECORD_KEY_RE.match(key):
            return key
    return keys[0] if keys else ""


def _column_samples(rows: list[list[str]], col_index: int, *, limit: int = _SAMPLE_LIMIT) -> list[str]:
    samples: list[str] = []
    for row in rows:
        if col_index >= len(row):
            continue
        value = row[col_index].strip()
        if value:
            samples.append(value)
        if len(samples) >= limit:
            break
    return samples


def _infer_field_type(
    samples: list[str],
    *,
    distinct_values: set[str] | None = None,
    total_value_count: int | None = None,
) -> tuple[str, dict[str, Any] | None]:
    if not samples:
        return "text", None

    if all(s.lower() in _BOOL_VALUES for s in samples):
        return "boolean", None

    if all(_is_number(s) for s in samples):
        return "number", None

    if all(_ISO_DATETIME_RE.match(s) for s in samples):
        return "datetime", None

    if all(_ISO_DATE_RE.match(s) for s in samples):
        return "date", None

    email_hits = sum(1 for s in samples if _EMAIL_RE.match(s))
    if email_hits / len(samples) >= 0.8:
        return "email", None

    url_hits = sum(1 for s in samples if _URL_RE.match(s))
    if url_hits / len(samples) >= 0.8:
        return "url", None

    distinct_set = distinct_values if distinct_values is not None else {s for s in samples}
    if len(distinct_set) > MAX_SELECT_OPTIONS:
        return "text", None
    distinct = sorted(distinct_set)
    value_count = total_value_count if total_value_count is not None else len(samples)
    if len(distinct) >= 2 and len(distinct) <= MAX_SELECT_OPTIONS:
        if len(distinct) / max(value_count, 1) < 0.5:
            return "single_select", {"options": distinct}

    return "text", None


def _is_number(value: str) -> bool:
    try:
        float(value.replace(",", ""))
        return True
    except ValueError:
        return False


def infer_fields_from_csv(
    csv_text: str,
    *,
    header_row: int = 1,
    max_inference_rows: int = 5000,
) -> tuple[list[FieldDefinition], list[dict[str, Any]], int, str]:
    """Infer draft form fields from CSV headers and sample cell values."""
    text = csv_text.strip()
    if not text:
        raise ValueError("CSV is empty")
    if header_row < 1:
        raise ValueError("Header row must be at least 1")

    reader = csv.reader(io.StringIO(text), _csv_dialect(text))
    headers: list[str] | None = None
    data_rows_for_inference: list[list[str]] = []
    column_distinct: list[set[str]] = []
    column_non_empty: list[int] = []
    column_high_cardinality: list[bool] = []
    data_row_count = 0
    logical_row = 0

    for row in reader:
        logical_row += 1
        if logical_row < header_row:
            continue
        if logical_row == header_row:
            headers = row
            if not any(cell.strip() for cell in headers):
                raise ValueError(f"Row {header_row} does not contain column headers")
            num_cols = len(headers)
            column_distinct = [set() for _ in range(num_cols)]
            column_non_empty = [0] * num_cols
            column_high_cardinality = [False] * num_cols
            continue
        if not any(cell.strip() for cell in row):
            continue
        data_row_count += 1
        if len(data_rows_for_inference) < max_inference_rows:
            data_rows_for_inference.append(row)
        for index, cell in enumerate(row):
            if index >= len(column_distinct):
                break
            value = cell.strip()
            if not value:
                continue
            column_non_empty[index] += 1
            if column_high_cardinality[index]:
                continue
            column_distinct[index].add(value)
            if len(column_distinct[index]) > MAX_SELECT_OPTIONS:
                column_high_cardinality[index] = True

    if headers is None:
        raise ValueError(
            f"Header row {header_row} is beyond the file ({logical_row} row(s))"
        )

    keys = [_column_key(h, i) for i, h in enumerate(headers)]
    data_rows = data_rows_for_inference
    row_count = data_row_count

    fields: list[FieldDefinition] = []
    for index, (key, header) in enumerate(zip(keys, headers)):
        samples = _column_samples(data_rows, index)
        if column_high_cardinality[index]:
            field_type, config_json = "text", None
        else:
            field_type, config_json = _infer_field_type(
                samples,
                distinct_values=column_distinct[index],
                total_value_count=column_non_empty[index],
            )
        fields.append(
            FieldDefinition(
                field_key=key,
                label=header.strip() or key,
                field_type=field_type,  # type: ignore[arg-type]
                config_json=config_json,
                sort_order=index,
                is_required=False,
                schema_version=0,
                is_published=False,
            )
        )

    sample_rows: list[dict[str, Any]] = []
    for row in data_rows[:5]:
        values = {keys[i]: (row[i].strip() if i < len(row) else "") for i in range(len(keys))}
        if any(str(v) for v in values.values()):
            sample_rows.append(values)

    suggested_record_key = _guess_record_key_column(keys)
    return fields, sample_rows, row_count, suggested_record_key


def collect_csv_field_values(
    parsed_rows: list[dict[str, Any]],
    fields: list[FieldDefinition],
) -> dict[str, set[str]]:
    """Collect distinct non-empty CSV cell values per field key."""
    select_fields = {
        field.field_key
        for field in fields
        if field.field_type in ("single_select", "multi_select")
    }
    if not select_fields:
        return {}

    values: dict[str, set[str]] = {key: set() for key in select_fields}
    for row in parsed_rows:
        for key in select_fields:
            raw = row.get(key)
            if raw is None or (isinstance(raw, str) and not raw.strip()):
                continue
            if isinstance(raw, list):
                for item in raw:
                    if item is not None and str(item).strip():
                        values[key].add(str(item).strip())
            else:
                values[key].add(str(raw).strip())
    return values


def expand_select_fields_for_import(
    fields: list[FieldDefinition],
    parsed_rows: list[dict[str, Any]],
) -> tuple[list[FieldDefinition], set[str]]:
    """Merge CSV values into select field options. Returns updated fields and keys left lenient."""
    csv_values = collect_csv_field_values(parsed_rows, fields)
    lenient_keys: set[str] = set()
    updated_fields: list[FieldDefinition] = []

    for field in fields:
        if field.field_type not in ("single_select", "multi_select"):
            updated_fields.append(field)
            continue

        config = dict(field.config_json or {})
        options = [str(option) for option in (config.get("options") or [])]
        existing = set(options)
        extra = sorted(
            value
            for value in csv_values.get(field.field_key, set())
            if value and value not in existing
        )
        if not extra:
            updated_fields.append(field)
            continue

        merged = options + extra
        if len(merged) > MAX_SELECT_OPTIONS:
            lenient_keys.add(field.field_key)
            updated_fields.append(field)
            continue

        config["options"] = merged
        updated_fields.append(field.model_copy(update={"config_json": config}))

    return updated_fields, lenient_keys


def records_to_csv(field_keys: list[str], rows: list[dict[str, Any]]) -> str:
    """Serialize records to CSV with a header row of field keys."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(field_keys)
    for row in rows:
        values = row.get("values", row)
        writer.writerow([values.get(k, "") for k in field_keys])
    return buf.getvalue()
