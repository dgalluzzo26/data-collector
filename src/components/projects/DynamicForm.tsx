import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import { api } from '../../api/client';
import type { FieldDefinition, LookupTable } from '../../types';

export type LookupOptionMap = Record<string, { value: string; label: string }[]>;

function resolveLookupColumns(
  field: FieldDefinition,
  lookup: LookupTable | undefined,
): { valueCol: string; displayCol: string } {
  const valueCol =
    (field.config_json?.value_column as string) ||
    lookup?.columns[0]?.key ||
    'code';
  const displayCol =
    (field.config_json?.display_column as string) ||
    lookup?.columns[1]?.key ||
    lookup?.columns[0]?.key ||
    'name';
  return { valueCol, displayCol };
}

interface DynamicFormProps {
  projectId: string;
  fields: FieldDefinition[];
  lookups?: LookupTable[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  readOnly?: boolean;
  lockedFields?: Set<string>;
  errors?: Record<string, string>;
}

export default function DynamicForm({
  projectId,
  fields,
  lookups = [],
  values,
  onChange,
  readOnly = false,
  lockedFields,
  errors = {},
}: DynamicFormProps) {
  const [lookupOptions, setLookupOptions] = useState<LookupOptionMap>({});

  const lookupFields = useMemo(
    () => fields.filter((f) => f.field_type === 'lookup' && f.config_json?.lookup_id),
    [fields],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: LookupOptionMap = {};
      for (const field of lookupFields) {
        const lookupId = field.config_json?.lookup_id as string;
        const lookupMeta = lookups.find((l) => l.lookup_id === lookupId);
        const { valueCol, displayCol } = resolveLookupColumns(field, lookupMeta);
        try {
          const rows = await api.getLookupRows(projectId, lookupId);
          next[field.field_key] = rows.map((r) => ({
            value: String(r.values[valueCol] ?? ''),
            label: String(r.values[displayCol] ?? r.values[valueCol] ?? ''),
          }));
        } catch {
          next[field.field_key] = [];
        }
      }
      if (!cancelled) setLookupOptions(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, lookupFields, lookups]);

  const sorted = useMemo(
    () => [...fields].sort((a, b) => a.sort_order - b.sort_order),
    [fields],
  );

  const setValue = (key: string, value: unknown) => {
    onChange({ ...values, [key]: value });
  };

  const isLocked = (fieldKey: string) => readOnly || Boolean(lockedFields?.has(fieldKey));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {sorted.map((field) => {
        const value = values[field.field_key];
        const error = errors[field.field_key];
        const options = (field.config_json?.options as string[] | undefined) ?? [];

        if (field.field_type === 'boolean') {
          return (
            <FormControl key={field.field_key} error={!!error}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={Boolean(value)}
                    disabled={isLocked(field.field_key)}
                    onChange={(e) => setValue(field.field_key, e.target.checked)}
                  />
                }
                label={`${field.label}${field.is_required ? ' *' : ''}`}
              />
              {error && <FormHelperText>{error}</FormHelperText>}
            </FormControl>
          );
        }

        if (field.field_type === 'lookup' || field.field_type === 'single_select') {
          const selectOptions =
            field.field_type === 'lookup'
              ? lookupOptions[field.field_key] || []
              : options.map((opt) => ({ value: opt, label: opt }));
          const emptyMessage =
            field.field_type === 'lookup'
              ? !field.config_json?.lookup_id
                ? 'No lookup table linked — fix in Form designer'
                : selectOptions.length === 0
                  ? 'Lookup table has no rows'
                  : undefined
              : selectOptions.length === 0
                ? 'No options configured — fix in Form designer'
                : undefined;
          return (
            <FormControl key={field.field_key} fullWidth error={!!error}>
              <InputLabel>{field.label}{field.is_required ? ' *' : ''}</InputLabel>
              <Select
                label={field.label}
                value={(value as string) ?? ''}
                disabled={isLocked(field.field_key)}
                onChange={(e) => setValue(field.field_key, e.target.value)}
                MenuProps={{ disablePortal: false }}
              >
                {selectOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
              {(error || emptyMessage) && (
                <FormHelperText>{error || emptyMessage}</FormHelperText>
              )}
            </FormControl>
          );
        }

        if (field.field_type === 'multi_select') {
          const selectOptions = options.map((opt) => ({ value: opt, label: opt }));
          const emptyMessage =
            selectOptions.length === 0 ? 'No options configured — fix in Form designer' : undefined;
          return (
            <FormControl key={field.field_key} fullWidth error={!!error}>
              <InputLabel>{field.label}{field.is_required ? ' *' : ''}</InputLabel>
              <Select
                multiple
                label={field.label}
                value={(value as string[]) ?? []}
                disabled={isLocked(field.field_key)}
                onChange={(e) => setValue(field.field_key, e.target.value)}
                MenuProps={{ disablePortal: false }}
              >
                {selectOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
              {(error || emptyMessage) && (
                <FormHelperText>{error || emptyMessage}</FormHelperText>
              )}
            </FormControl>
          );
        }

        const inputType =
          field.field_type === 'number'
            ? 'number'
            : field.field_type === 'date'
              ? 'date'
              : field.field_type === 'datetime'
                ? 'datetime-local'
                : field.field_type === 'email'
                  ? 'email'
                  : field.field_type === 'url'
                    ? 'url'
                    : 'text';

        const isDateField = field.field_type === 'date' || field.field_type === 'datetime';

        return (
          <TextField
            key={field.field_key}
            label={`${field.label}${field.is_required ? ' *' : ''}`}
            type={inputType}
            value={(value as string | number | undefined) ?? ''}
            disabled={isLocked(field.field_key)}
            multiline={field.field_type === 'textarea'}
            minRows={field.field_type === 'textarea' ? 3 : undefined}
            fullWidth
            error={!!error}
            helperText={error}
            slotProps={isDateField ? { inputLabel: { shrink: true } } : undefined}
            onChange={(e) =>
              setValue(
                field.field_key,
                field.field_type === 'number' ? Number(e.target.value) : e.target.value,
              )
            }
          />
        );
      })}
    </Box>
  );
}
