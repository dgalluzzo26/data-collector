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


def _read_csv_rows(csv_text: str, *, keep_empty: bool = False) -> list[list[str]]:
    text = csv_text.strip()
    if not text:
        raise ValueError("CSV is empty")
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
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


def parse_records_csv(
    csv_text: str,
    field_keys: list[str],
    *,
    header_row: int = 1,
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

    # Map CSV columns to known field keys (match by field_key or slugified header).
    key_index: dict[str, int] = {}
    for idx, hk in enumerate(header_keys):
        if hk in field_keys:
            key_index[hk] = idx
        else:
            for fk in field_keys:
                if slugify(fk) == hk or slugify(headers[idx]) == slugify(fk):
                    key_index[fk] = idx
                    break

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


def _infer_field_type(samples: list[str]) -> tuple[str, dict[str, Any] | None]:
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

    distinct = sorted({s for s in samples})
    if len(distinct) <= 20 and len(distinct) / len(samples) < 0.5:
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
) -> tuple[list[FieldDefinition], list[dict[str, Any]], int, str]:
    """Infer draft form fields from CSV headers and sample cell values."""
    parsed_rows = _read_csv_rows(csv_text, keep_empty=True)
    if not parsed_rows:
        raise ValueError("CSV is empty")

    header_idx = _header_row_index(header_row, len(parsed_rows))
    headers = parsed_rows[header_idx]
    if not any(cell.strip() for cell in headers):
        raise ValueError(f"Row {header_row} does not contain column headers")

    keys = [_column_key(h, i) for i, h in enumerate(headers)]
    data_rows = [row for row in parsed_rows[header_idx + 1 :] if any(cell.strip() for cell in row)]
    row_count = len(data_rows)

    fields: list[FieldDefinition] = []
    for index, (key, header) in enumerate(zip(keys, headers)):
        samples = _column_samples(data_rows, index)
        field_type, config_json = _infer_field_type(samples)
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


def records_to_csv(field_keys: list[str], rows: list[dict[str, Any]]) -> str:
    """Serialize records to CSV with a header row of field keys."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(field_keys)
    for row in rows:
        values = row.get("values", row)
        writer.writerow([values.get(k, "") for k in field_keys])
    return buf.getvalue()
