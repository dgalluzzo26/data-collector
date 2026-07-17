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

interface FormDesignerProps {
  fields: FieldDefinition[];
  lookups: LookupTable[];
  onChange: (fields: FieldDefinition[]) => void;
  readOnly?: boolean;
}

export default function FormDesigner({ fields, lookups, onChange, readOnly = false }: FormDesignerProps) {
  const sorted = [...fields].sort((a, b) => a.sort_order - b.sort_order);

  const updateField = (index: number, patch: Partial<FieldDefinition>) => {
    const next = sorted.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange(next.map((f, i) => ({ ...f, sort_order: i })));
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
    onChange(sorted.filter((_, i) => i !== index).map((f, i) => ({ ...f, sort_order: i })));
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    [next[index], next[target]] = [next[target], next[index]];
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
        {sorted.map((field, index) => (
          <Paper key={`${field.field_key}-${index}`} className="page-card" sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
                <TextField
                  label="Label"
                  value={field.label}
                  disabled={readOnly}
                  onChange={(e) => {
                    const label = e.target.value;
                    updateField(index, { label, field_key: slugKey(label) || field.field_key });
                  }}
                />
                <TextField
                  label="Field key"
                  value={field.field_key}
                  disabled={readOnly}
                  onChange={(e) => updateField(index, { field_key: e.target.value })}
                />
                <TextField
                  select
                  label="Type"
                  value={field.field_type}
                  disabled={readOnly}
                  onChange={(e) => updateField(index, { field_type: e.target.value as FieldType })}
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
                      onChange={(e) => updateField(index, { is_required: e.target.checked })}
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
                        updateField(index, {
                          config_json: { ...field.config_json, options_input: raw, options },
                        });
                      }}
                    />
                    {!(field.config_json?.options as string[] | undefined)?.length && (
                      <Typography
                        variant="caption"
                        color="warning.main"
                        sx={{ gridColumn: '1 / -1' }}
                      >
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
                      value={(field.config_json?.lookup_id as string) || ''}
                      onChange={(e) => {
                        const lookup = lookups.find((l) => l.lookup_id === e.target.value);
                        const valueCol = lookup?.columns[0]?.key || 'code';
                        const displayCol =
                          lookup?.columns[1]?.key || lookup?.columns[0]?.key || 'name';
                        updateField(index, {
                          config_json: {
                            ...field.config_json,
                            lookup_id: e.target.value,
                            value_column: valueCol,
                            display_column: displayCol,
                            lookup_slug: lookup?.slug,
                          },
                        });
                      }}
                    >
                      {lookups.map((l) => (
                        <MenuItem key={l.lookup_id} value={l.lookup_id}>
                          {l.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label="Value column"
                      disabled={readOnly}
                      value={(field.config_json?.value_column as string) || 'code'}
                      onChange={(e) =>
                        updateField(index, {
                          config_json: { ...field.config_json, value_column: e.target.value },
                        })
                      }
                    />
                    <TextField
                      label="Display column"
                      disabled={readOnly}
                      value={(field.config_json?.display_column as string) || 'name'}
                      onChange={(e) =>
                        updateField(index, {
                          config_json: { ...field.config_json, display_column: e.target.value },
                        })
                      }
                    />
                  </>
                )}
              </Box>
              {!readOnly && (
                <Box>
                  <IconButton size="small" onClick={() => moveField(index, -1)} aria-label="Move up">
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => moveField(index, 1)} aria-label="Move down">
                    <ArrowDownwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => removeField(index)} aria-label="Remove">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              )}
            </Box>
          </Paper>
        ))}
      </Box>
    </Box>
  );
}
