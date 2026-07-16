import DeleteIcon from '@mui/icons-material/Delete';
import IconButton from '@mui/material/IconButton';
import type { GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import type { LookupOptionMap } from '../hooks/useLookupOptions';
import type { FieldDefinition } from '../types';

function parseMultiSelect(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [value];
    }
  }
  return [];
}

function formatBoolean(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '';
}

function formatDateValue(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function formatDateTimeValue(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}
function lookupLabel(lookupOptions: LookupOptionMap, fieldKey: string, value: unknown): string {
  const code = value == null ? '' : String(value);
  if (!code) return '';
  const match = lookupOptions[fieldKey]?.find((option) => option.value === code);
  return match?.label ?? code;
}

function fieldColumnDef(field: FieldDefinition, lookupOptions: LookupOptionMap): GridColDef {
  const base: GridColDef = {
    field: field.field_key,
    headerName: field.label,
    flex: 1,
    minWidth: 120,
    sortable: true,
    filterable: true,
  };

  const selectOptions = (field.config_json?.options as string[] | undefined) ?? [];

  switch (field.field_type) {
    case 'number':
      return {
        ...base,
        type: 'number',
        align: 'right',
        headerAlign: 'right',
        valueGetter: (value) => {
          if (value == null || value === '') return null;
          const num = Number(value);
          return Number.isFinite(num) ? num : null;
        },
      };
    case 'boolean':
      return {
        ...base,
        type: 'singleSelect',
        valueOptions: ['Yes', 'No'],
        valueGetter: (_, row) => formatBoolean(row[field.field_key]),
      };
    case 'date':
      return {
        ...base,
        type: 'date',
        valueGetter: (value) => {
          if (!value) return null;
          const date = new Date(String(value));
          return Number.isNaN(date.getTime()) ? null : date;
        },
        valueFormatter: (value) => formatDateValue(value),
      };
    case 'datetime':
      return {
        ...base,
        type: 'dateTime',
        valueGetter: (value) => {
          if (!value) return null;
          const date = new Date(String(value));
          return Number.isNaN(date.getTime()) ? null : date;
        },
        valueFormatter: (value) => formatDateTimeValue(value),
      };
    case 'single_select':
      return {
        ...base,
        type: 'singleSelect',
        valueOptions: selectOptions,
      };
    case 'lookup':
      return {
        ...base,
        type: 'singleSelect',
        valueOptions: (lookupOptions[field.field_key] ?? []).map((option) => option.label),
        valueGetter: (_, row) => lookupLabel(lookupOptions, field.field_key, row[field.field_key]),
      };
    case 'multi_select':
      return {
        ...base,
        valueGetter: (_, row) => parseMultiSelect(row[field.field_key]).join(', '),
      };
    default:
      return {
        ...base,
        valueGetter: (value) => (value == null ? '' : String(value)),
      };
  }
}

export function buildRecordGridColumns(
  publishedFields: FieldDefinition[],
  lookupOptions: LookupOptionMap,
  options: {
    canEdit: boolean;
    onDelete: (recordId: string) => void;
  },
): GridColDef[] {
  const cols: GridColDef[] = publishedFields.map((field) =>
    fieldColumnDef(field, lookupOptions),
  );

  cols.push(
    { field: 'created_by', headerName: 'Created by', width: 160, sortable: true, filterable: true },
    { field: 'updated_by', headerName: 'Updated by', width: 160, sortable: true, filterable: true },
  );

  if (options.canEdit) {
    cols.push({
      field: '_actions',
      headerName: '',
      width: 56,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: (params: GridRenderCellParams) => (
        <IconButton
          size="small"
          color="error"
          aria-label="Delete record"
          onClick={(event) => {
            event.stopPropagation();
            options.onDelete(String(params.id));
          }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      ),
    });
  }

  return cols;
}
