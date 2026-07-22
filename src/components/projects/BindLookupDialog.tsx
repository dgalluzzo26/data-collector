import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import type { LookupColumn, ProjectDetail } from '../../types';
import BusyButton from '../common/BusyButton';

interface BindLookupDialogProps {
  open: boolean;
  project: ProjectDetail;
  onClose: () => void;
  onBound: () => void;
}

function withCurrentOption(options: string[], current: string): string[] {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

function formatPreviewValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function BindLookupDialog({ open, project, onClose, onBound }: BindLookupDialogProps) {
  const [name, setName] = useState('');
  const [catalog, setCatalog] = useState('');
  const [schema, setSchema] = useState('');
  const [table, setTable] = useState('');
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<LookupColumn[]>([]);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [sampleRows, setSampleRows] = useState<Record<string, unknown>[]>([]);

  const clearPreview = () => {
    setColumns([]);
    setRowCount(null);
    setSampleRows([]);
    setName('');
  };

  useEffect(() => {
    if (!open) return;
    setName('');
    setCatalog('');
    setSchema('');
    setTable('');
    setSchemas([]);
    setTables([]);
    setError(null);
    clearPreview();
    void api.getConfig().then((cfg) => {
      setCatalog(cfg.default_data_catalog);
      setSchema(cfg.default_data_schema);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const catalogValue = catalog.trim();
    if (!catalogValue) {
      setSchemas([]);
      return;
    }

    let cancelled = false;
    setLoadingSchemas(true);
    void api
      .listUcSchemas(project.project_id, catalogValue)
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
  }, [open, catalog, project.project_id]);

  useEffect(() => {
    if (!open) return;
    const catalogValue = catalog.trim();
    const schemaValue = schema.trim();
    if (!catalogValue || !schemaValue) {
      setTables([]);
      return;
    }

    let cancelled = false;
    setLoadingTables(true);
    void api
      .listUcTables(project.project_id, catalogValue, schemaValue)
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
  }, [open, catalog, schema, project.project_id]);

  const preview = async () => {
    if (!catalog.trim() || !schema.trim() || !table.trim()) return;
    setPreviewing(true);
    setError(null);
    try {
      const previewResult = await api.previewUcTable(
        project.project_id,
        catalog.trim(),
        schema.trim(),
        table.trim(),
      );
      setColumns(previewResult.columns);
      setRowCount(previewResult.row_count);
      setSampleRows(previewResult.sample_rows);
      if (!name.trim()) {
        setName(table.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      clearPreview();
    } finally {
      setPreviewing(false);
    }
  };

  const bind = async () => {
    if (!name.trim() || !catalog.trim() || !schema.trim() || !table.trim()) return;
    setBinding(true);
    setError(null);
    try {
      await api.bindLookup(project.project_id, {
        name: name.trim(),
        source_catalog: catalog.trim(),
        source_schema: schema.trim(),
        source_table: table.trim(),
        columns: columns.length > 0 ? columns : undefined,
      });
      onBound();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bind failed');
    } finally {
      setBinding(false);
    }
  };

  const schemaOptions = withCurrentOption(schemas, schema);
  const tableOptions = withCurrentOption(tables, table);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Bind Unity Catalog table</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Link an existing UC table as read-only lookup data. Rows are loaded live from the source table.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2, mb: 2 }}>
          <TextField
            size="small"
            label="Catalog"
            value={catalog}
            onChange={(e) => {
              setCatalog(e.target.value);
              setSchema('');
              setTable('');
              clearPreview();
            }}
          />
          <FormControl size="small" disabled={!catalog.trim() || loadingSchemas}>
            <InputLabel id="bind-lookup-schema-label">Schema</InputLabel>
            <Select
              labelId="bind-lookup-schema-label"
              label="Schema"
              value={schema}
              onChange={(e) => {
                setSchema(e.target.value);
                setTable('');
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
          <FormControl size="small" disabled={!catalog.trim() || !schema.trim() || loadingTables}>
            <InputLabel id="bind-lookup-table-label">Table</InputLabel>
            <Select
              labelId="bind-lookup-table-label"
              label="Table"
              value={table}
              onChange={(e) => {
                clearPreview();
                setTable(e.target.value);
                setName(e.target.value);
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
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <BusyButton
            variant="outlined"
            onClick={preview}
            busy={previewing}
            busyLabel="Loading…"
            disabled={!catalog.trim() || !schema.trim() || !table.trim()}
          >
            Preview table
          </BusyButton>
        </Box>
        {rowCount != null && (
          <Typography variant="body2" sx={{ mb: 2 }}>
            {rowCount.toLocaleString()} rows · {columns.length} columns detected
          </Typography>
        )}
        {columns.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Five rows previewed; full table will be used in forms.
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {columns.map((column) => (
                      <TableCell key={column.key}>{column.label || column.key}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sampleRows.map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {columns.map((column) => (
                        <TableCell key={column.key}>
                          {formatPreviewValue(row[column.key])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {sampleRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={columns.length}>No rows to preview.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Box>
        )}
        <TextField
          fullWidth
          size="small"
          label="Lookup table name"
          value={name}
          disabled={!table.trim()}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1 }}
        />
        {error && (
          <Typography variant="body2" color="error" sx={{ mt: 2 }}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <BusyButton
          variant="contained"
          onClick={bind}
          busy={binding}
          busyLabel="Binding…"
          disabled={!name.trim() || columns.length === 0}
        >
          Bind lookup
        </BusyButton>
      </DialogActions>
    </Dialog>
  );
}
