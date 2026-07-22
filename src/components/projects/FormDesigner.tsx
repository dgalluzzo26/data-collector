import { memo, useRef } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import { removeCascadeReferences, syncCascadeLinks } from '../../lib/lookupCascade';
import type { FieldDefinition, FieldType, LookupTable } from '../../types';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & time' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'single_select', label: 'Dropdown (inline options)' },
  { value: 'multi_select', label: 'Multi-select (inline)' },
  { value: 'lookup', label: 'Lookup table' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' },
];

function slugKey(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

function mergeConfig(
  field: FieldDefinition,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(field.config_json ?? {}), ...patch };
}

interface FieldDesignerRowProps {
  field: FieldDefinition;
  lookups: LookupTable[];
  cascadeCandidates: FieldDefinition[];
  linkedKeys: string[];
  readOnly: boolean;
  onPatch: (patch: Partial<FieldDefinition>) => void;
  onCascadeChange: (linkedKeys: string[]) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

const FieldDesignerRow = memo(function FieldDesignerRow({
  field,
  lookups,
  cascadeCandidates,
  linkedKeys,
  readOnly,
  onPatch,
  onCascadeChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  canMoveUp,
  canMoveDown,
}: FieldDesignerRowProps) {
  const lookupId = (field.config_json?.lookup_id as string) || '';
  const selectedLookup = lookups.find((lookup) => lookup.lookup_id === lookupId);
  const lookupColumns = selectedLookup?.columns ?? [];

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      <Box sx={{ flex: 1, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <TextField
          label="Label"
          value={field.label}
          disabled={readOnly}
          onChange={(e) => onPatch({ label: e.target.value })}
        />
        <TextField
          label="Field key"
          value={field.field_key}
          disabled={readOnly}
          onChange={(e) => onPatch({ field_key: e.target.value })}
        />
        <TextField
          select
          label="Type"
          value={field.field_type}
          disabled={readOnly}
          onChange={(e) => onPatch({ field_type: e.target.value as FieldType })}
        >
          {FIELD_TYPES.map((t) => (
            <MenuItem key={t.value} value={t.value}>
              {t.label}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Checkbox
              checked={field.is_required}
              disabled={readOnly}
              onChange={(e) => onPatch({ is_required: e.target.checked })}
            />
          }
          label="Required"
        />
        {(field.field_type === 'single_select' || field.field_type === 'multi_select') && (
          <>
            <TextField
              label="Options (one per line)"
              multiline
              minRows={3}
              sx={{ gridColumn: '1 / -1' }}
              disabled={readOnly}
              value={
                (field.config_json?.options_input as string | undefined) ??
                (field.config_json?.options as string[] | undefined)?.join('\n') ??
                ''
              }
              onChange={(e) => {
                const raw = e.target.value;
                const options = raw
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean);
                onPatch({
                  config_json: mergeConfig(field, { options_input: raw, options }),
                });
              }}
            />
            {!(field.config_json?.options as string[] | undefined)?.length && (
              <Typography variant="caption" color="warning.main" sx={{ gridColumn: '1 / -1' }}>
                No options — add inline options or change type to Lookup table
              </Typography>
            )}
          </>
        )}
        {field.field_type === 'lookup' && (
          <>
            <TextField
              select
              label="Lookup table"
              disabled={readOnly}
              value={lookupId}
              onChange={(e) => {
                const lookup = lookups.find((item) => item.lookup_id === e.target.value);
                const valueCol = lookup?.columns[0]?.key || 'code';
                onPatch({
                  config_json: {
                    lookup_id: e.target.value,
                    value_column: valueCol,
                    display_column: valueCol,
                    lookup_slug: lookup?.slug,
                  },
                });
              }}
            >
              {lookups.map((lookup) => (
                <MenuItem key={lookup.lookup_id} value={lookup.lookup_id}>
                  {lookup.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Value column"
              disabled={readOnly || lookupColumns.length === 0}
              value={(field.config_json?.value_column as string) || lookupColumns[0]?.key || ''}
              onChange={(e) => {
                const valueColumn = e.target.value;
                const displayColumn =
                  (field.config_json?.display_column as string | undefined) ||
                  (field.config_json?.value_column as string | undefined) ||
                  valueColumn;
                onPatch({
                  config_json: mergeConfig(field, {
                    value_column: valueColumn,
                    display_column: displayColumn,
                  }),
                });
              }}
            >
              {lookupColumns.map((column) => (
                <MenuItem key={column.key} value={column.key}>
                  {column.label || column.key}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Display column"
              disabled={readOnly || lookupColumns.length === 0}
              value={(field.config_json?.display_column as string) || lookupColumns[0]?.key || ''}
              onChange={(e) =>
                onPatch({
                  config_json: mergeConfig(field, { display_column: e.target.value }),
                })
              }
            >
              {lookupColumns.map((column) => (
                <MenuItem key={column.key} value={column.key}>
                  {column.label || column.key}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              SelectProps={{ multiple: true }}
              label="Linked fields (mutual filter)"
              disabled={readOnly || !lookupId || cascadeCandidates.length === 0}
              value={linkedKeys}
              sx={{ gridColumn: '1 / -1' }}
              onChange={(e) => {
                const nextLinked = Array.isArray(e.target.value)
                  ? e.target.value
                  : String(e.target.value).split(',');
                onCascadeChange(nextLinked);
              }}
            >
              {cascadeCandidates.map((candidate) => (
                <MenuItem key={candidate.field_key} value={candidate.field_key}>
                  {candidate.label} ({candidate.field_key})
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
              Options stay unique and filter each other. When only one lookup row matches, the
              other linked fields auto-fill.
            </Typography>
          </>
        )}
      </Box>
      {!readOnly && (
        <Box>
          <IconButton size="small" onClick={onMoveUp} disabled={!canMoveUp} aria-label="Move up">
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onMoveDown} disabled={!canMoveDown} aria-label="Move down">
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" color="error" onClick={onRemove} aria-label="Remove">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
});

interface FormDesignerProps {
  fields: FieldDefinition[];
  lookups: LookupTable[];
  onChange: (fields: FieldDefinition[]) => void;
  readOnly?: boolean;
}

export default function FormDesigner({ fields, lookups, onChange, readOnly = false }: FormDesignerProps) {
  const rowKeysRef = useRef<string[]>([]);
  const sorted = [...fields].sort((a, b) => a.sort_order - b.sort_order);

  while (rowKeysRef.current.length < sorted.length) {
    rowKeysRef.current.push(crypto.randomUUID());
  }
  if (rowKeysRef.current.length > sorted.length) {
    rowKeysRef.current.length = sorted.length;
  }

  const updateField = (index: number, patch: Partial<FieldDefinition>) => {
    const next = sorted.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange(next.map((f, i) => ({ ...f, sort_order: i })));
  };

  const updateCascadeLinks = (fieldKey: string, linkedKeys: string[]) => {
    onChange(syncCascadeLinks(sorted, fieldKey, linkedKeys).map((field, index) => ({
      ...field,
      sort_order: index,
    })));
  };

  const addField = () => {
    const label = `Field ${fields.length + 1}`;
    onChange([
      ...sorted,
      {
        field_key: slugKey(label) || `field_${fields.length + 1}`,
        label,
        field_type: 'text',
        sort_order: sorted.length,
        is_required: false,
        schema_version: 0,
        is_published: false,
        config_json: {},
      },
    ]);
  };

  const removeField = (index: number) => {
    rowKeysRef.current.splice(index, 1);
    const removedKey = sorted[index]?.field_key;
    const remaining = sorted.filter((_, i) => i !== index);
    const next = removedKey ? removeCascadeReferences(remaining, removedKey) : remaining;
    onChange(next.map((field, fieldIndex) => ({ ...field, sort_order: fieldIndex })));
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    const keys = rowKeysRef.current;
    [next[index], next[target]] = [next[target], next[index]];
    [keys[index], keys[target]] = [keys[target], keys[index]];
    onChange(next.map((f, i) => ({ ...f, sort_order: i })));
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">Form designer</Typography>
        {!readOnly && (
          <Button variant="outlined" size="small" onClick={addField}>
            Add field
          </Button>
        )}
      </Box>

      {sorted.length === 0 && (
        <Paper className="page-card" sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">No fields yet. Add fields to build your form.</Typography>
        </Paper>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sorted.map((field, index) => {
          const lookupId = (field.config_json?.lookup_id as string) || '';
          const cascadeCandidates = sorted.filter(
            (candidate) =>
              candidate.field_key !== field.field_key &&
              candidate.field_type === 'lookup' &&
              (candidate.config_json?.lookup_id as string) === lookupId &&
              Boolean(lookupId),
          );
          const linkedKeys = (field.config_json?.cascade_with as string[] | undefined) ?? [];

          return (
            <Paper key={rowKeysRef.current[index]} className="page-card" sx={{ p: 2 }}>
              <FieldDesignerRow
                field={field}
                lookups={lookups}
                cascadeCandidates={cascadeCandidates}
                linkedKeys={linkedKeys}
                readOnly={readOnly}
                onPatch={(patch) => updateField(index, patch)}
                onCascadeChange={(keys) => updateCascadeLinks(field.field_key, keys)}
                onMoveUp={() => moveField(index, -1)}
                onMoveDown={() => moveField(index, 1)}
                onRemove={() => removeField(index)}
                canMoveUp={index > 0}
                canMoveDown={index < sorted.length - 1}
              />
            </Paper>
          );
        })}
      </Box>
    </Box>
  );
}
