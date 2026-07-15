import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import type { UcTablePreview } from '../../types';
import BusyButton from './BusyButton';

function withCurrentOption(options: string[], current: string): string[] {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

interface UcTableSelectorProps {
  catalog: string;
  schema: string;
  table: string;
  onCatalogChange: (value: string) => void;
  onSchemaChange: (value: string) => void;
  onTableChange: (value: string) => void;
  onPreviewLoaded?: (preview: UcTablePreview) => void;
  onPreviewCleared?: () => void;
  disabled?: boolean;
}

export default function UcTableSelector({
  catalog,
  schema,
  table,
  onCatalogChange,
  onSchemaChange,
  onTableChange,
  onPreviewLoaded,
  onPreviewCleared,
  disabled = false,
}: UcTableSelectorProps) {
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<UcTablePreview | null>(null);

  const clearPreview = () => {
    setPreview(null);
    onPreviewCleared?.();
  };

  useEffect(() => {
    const catalogValue = catalog.trim();
    if (!catalogValue || disabled) {
      setSchemas([]);
      return;
    }

    let cancelled = false;
    setLoadingSchemas(true);
    void api
      .listUcCatalogSchemas(catalogValue)
      .then((result) => {
        if (!cancelled) setSchemas(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setSchemas([]);
          setError(err instanceof Error ? err.message : 'Failed to load schemas');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSchemas(false);
      });

    return () => {
      cancelled = true;
    };
  }, [catalog, disabled]);

  useEffect(() => {
    const catalogValue = catalog.trim();
    const schemaValue = schema.trim();
    if (!catalogValue || !schemaValue || disabled) {
      setTables([]);
      return;
    }

    let cancelled = false;
    setLoadingTables(true);
    void api
      .listUcCatalogTables(catalogValue, schemaValue)
      .then((result) => {
        if (!cancelled) setTables(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setTables([]);
          setError(err instanceof Error ? err.message : 'Failed to load tables');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTables(false);
      });

    return () => {
      cancelled = true;
    };
  }, [catalog, schema, disabled]);

  const loadPreview = async () => {
    if (!catalog.trim() || !schema.trim() || !table.trim()) return;
    setPreviewing(true);
    setError(null);
    try {
      const result = await api.previewUcCatalogTable(catalog.trim(), schema.trim(), table.trim());
      setPreview(result);
      onPreviewLoaded?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      clearPreview();
    } finally {
      setPreviewing(false);
    }
  };

  const schemaOptions = withCurrentOption(schemas, schema);
  const tableOptions = withCurrentOption(tables, table);

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2, mb: 2 }}>
        <TextField
          size="small"
          label="Catalog"
          value={catalog}
          disabled={disabled}
          onChange={(e) => {
            onCatalogChange(e.target.value);
            onSchemaChange('');
            onTableChange('');
            clearPreview();
          }}
        />
        <FormControl size="small" disabled={disabled || !catalog.trim() || loadingSchemas}>
          <InputLabel id="uc-table-schema-label">Schema</InputLabel>
          <Select
            labelId="uc-table-schema-label"
            label="Schema"
            value={schema}
            onChange={(e) => {
              onSchemaChange(e.target.value);
              onTableChange('');
              clearPreview();
            }}
          >
            {schemaOptions.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" disabled={disabled || !catalog.trim() || !schema.trim() || loadingTables}>
          <InputLabel id="uc-table-table-label">Table</InputLabel>
          <Select
            labelId="uc-table-table-label"
            label="Table"
            value={table}
            onChange={(e) => {
              onTableChange(e.target.value);
              clearPreview();
            }}
          >
            {tableOptions.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <BusyButton
          size="small"
          variant="outlined"
          onClick={loadPreview}
          busy={previewing}
          busyLabel="Loading…"
          disabled={disabled || !catalog.trim() || !schema.trim() || !table.trim()}
        >
          Preview table
        </BusyButton>
      </Box>
      {preview && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {preview.row_count.toLocaleString()} rows · {preview.columns.length} columns
        </Typography>
      )}
      {error && (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      )}
    </Box>
  );
}
