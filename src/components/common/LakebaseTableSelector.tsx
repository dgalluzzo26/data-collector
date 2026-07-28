import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import type { UcTablePreview } from '../../types';
import BusyButton from './BusyButton';

function withCurrentOption(options: string[], current: string): string[] {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

interface LakebaseTableSelectorProps {
  database: string;
  schema: string;
  table: string;
  onDatabaseChange: (value: string) => void;
  onSchemaChange: (value: string) => void;
  onTableChange: (value: string) => void;
  onPreviewLoaded?: (preview: UcTablePreview) => void;
  onPreviewCleared?: () => void;
  disabled?: boolean;
}

export default function LakebaseTableSelector({
  database,
  schema,
  table,
  onDatabaseChange,
  onSchemaChange,
  onTableChange,
  onPreviewLoaded,
  onPreviewCleared,
  disabled = false,
}: LakebaseTableSelectorProps) {
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
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
    if (disabled) {
      setDatabases([]);
      return;
    }
    let cancelled = false;
    setLoadingDatabases(true);
    setError(null);
    void api
      .listLakebaseDatabases()
      .then((result) => {
        if (cancelled) return;
        setDatabases(result);
        if (result.length === 1 && !database.trim()) {
          onDatabaseChange(result[0]);
        } else if (result.length === 1 && database.trim() && database.trim() !== result[0]) {
          onDatabaseChange(result[0]);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDatabases([]);
          setError(err instanceof Error ? err.message : 'Failed to load Lakebase databases');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDatabases(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when enabled; avoid re-fetch loops on database change
  }, [disabled]);

  useEffect(() => {
    if (disabled || !database.trim()) {
      setSchemas([]);
      return;
    }
    let cancelled = false;
    setLoadingSchemas(true);
    void api
      .listLakebaseSchemas()
      .then((result) => {
        if (!cancelled) setSchemas(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setSchemas([]);
          setError(err instanceof Error ? err.message : 'Failed to load Lakebase schemas');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSchemas(false);
      });
    return () => {
      cancelled = true;
    };
  }, [database, disabled]);

  useEffect(() => {
    if (disabled || !database.trim() || !schema.trim()) {
      setTables([]);
      return;
    }
    let cancelled = false;
    setLoadingTables(true);
    void api
      .listLakebaseTables(schema.trim())
      .then((result) => {
        if (!cancelled) setTables(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setTables([]);
          setError(err instanceof Error ? err.message : 'Failed to load Lakebase tables');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTables(false);
      });
    return () => {
      cancelled = true;
    };
  }, [database, schema, disabled]);

  const loadPreview = async () => {
    if (!schema.trim() || !table.trim()) return;
    setPreviewing(true);
    setError(null);
    try {
      const result = await api.previewLakebaseTable(schema.trim(), table.trim());
      setPreview(result);
      onPreviewLoaded?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      clearPreview();
    } finally {
      setPreviewing(false);
    }
  };

  const databaseOptions = withCurrentOption(databases, database);
  const schemaOptions = withCurrentOption(schemas, schema);
  const tableOptions = withCurrentOption(tables, table);

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2, mb: 2 }}>
        <FormControl size="small" disabled={disabled || loadingDatabases}>
          <InputLabel id="lakebase-database-label">Database</InputLabel>
          <Select
            labelId="lakebase-database-label"
            label="Database"
            value={database}
            onChange={(e) => {
              onDatabaseChange(e.target.value);
              onSchemaChange('');
              onTableChange('');
              clearPreview();
            }}
          >
            {databaseOptions.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" disabled={disabled || !database.trim() || loadingSchemas}>
          <InputLabel id="lakebase-schema-label">Schema</InputLabel>
          <Select
            labelId="lakebase-schema-label"
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
        <FormControl
          size="small"
          disabled={disabled || !database.trim() || !schema.trim() || loadingTables}
        >
          <InputLabel id="lakebase-table-label">Table</InputLabel>
          <Select
            labelId="lakebase-table-label"
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
          disabled={disabled || !database.trim() || !schema.trim() || !table.trim()}
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
