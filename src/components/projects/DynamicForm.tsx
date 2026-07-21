import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import { useLookupRows } from '../../hooks/useLookupOptions';
import {
  applyLookupFieldChange,
  buildCascadeGroups,
  getCascadeGroupForField,
  optionsForField,
} from '../../lib/lookupCascade';
import type { FieldDefinition, LookupTable } from '../../types';

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
  const { data: rowsByLookupId = {} } = useLookupRows(projectId, fields);
  const cascadeGroups = useMemo(() => buildCascadeGroups(fields), [fields]);

  const sorted = useMemo(
    () => [...fields].sort((a, b) => a.sort_order - b.sort_order),
    [fields],
  );

  const setValue = (key: string, value: unknown) => {
    onChange({ ...values, [key]: value });
  };

  const setLookupValue = (field: FieldDefinition, value: unknown) => {
    onChange(applyLookupFieldChange(field.field_key, value, fields, rowsByLookupId, lookups, values));
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
          const lookupId = field.config_json?.lookup_id as string | undefined;
          const lookupMeta = lookupId ? lookups.find((item) => item.lookup_id === lookupId) : undefined;
          const cascadeGroup = getCascadeGroupForField(field.field_key, cascadeGroups);
          const selectOptions =
            field.field_type === 'lookup'
              ? optionsForField(
                  field,
                  lookupId ? rowsByLookupId[lookupId] ?? [] : [],
                  values,
                  cascadeGroup,
                  lookupMeta,
                )
              : options.map((opt) => ({ value: opt, label: opt }));
          const emptyMessage =
            field.field_type === 'lookup'
              ? !lookupId
                ? 'No lookup table linked — fix in Form designer'
                : selectOptions.length === 0
                  ? 'No matching lookup values for the current filters'
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
                onChange={(e) =>
                  field.field_type === 'lookup'
                    ? setLookupValue(field, e.target.value)
                    : setValue(field.field_key, e.target.value)
                }
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
