import { useRef, useState } from 'react';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import { CSV_MAX_SIZE_HELP, csvFileSizeError, readCsvFile } from '../../lib/csvFile';
import type {
  ImportRecordsResult,
  RecordCsvColumnMapping,
  RecordCsvPreview,
} from '../../types';
import BusyButton from '../common/BusyButton';

interface RecordCsvImportDialogProps {
  open: boolean;
  projectId: string;
  recordKeyColumn?: string | null;
  onClose: () => void;
  onImported: (result: ImportRecordsResult) => void;
}

export default function RecordCsvImportDialog({
  open,
  projectId,
  recordKeyColumn,
  onClose,
  onImported,
}: RecordCsvImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const lastAnalyzedHeaderRowRef = useRef(1);
  const [csvText, setCsvText] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [preview, setPreview] = useState<RecordCsvPreview | null>(null);
  const [columns, setColumns] = useState<RecordCsvColumnMapping[]>([]);
  const [includedKeys, setIncludedKeys] = useState<Set<string>>(new Set());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCsvText('');
    setHeaderRow(1);
    lastAnalyzedHeaderRowRef.current = 1;
    setPreview(null);
    setColumns([]);
    setIncludedKeys(new Set());
    setPreviewLoading(false);
    setImporting(false);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const applyPreview = (result: RecordCsvPreview, selectAll: boolean) => {
    setPreview(result);
    setColumns(result.columns);
    const matchedKeys = result.columns.filter((col) => col.matched).map((col) => col.field_key);
    if (selectAll) {
      setIncludedKeys(new Set(matchedKeys));
    } else {
      setIncludedKeys((prev) => {
        const matched = new Set(matchedKeys);
        const preserved = new Set([...prev].filter((key) => matched.has(key)));
        if (recordKeyColumn) preserved.add(recordKeyColumn);
        return preserved.size > 0 ? preserved : matched;
      });
    }
    lastAnalyzedHeaderRowRef.current = result.header_row;
  };

  const analyzeCsv = async (csv: string, row: number, selectAll = false) => {
    setPreviewLoading(true);
    setError(null);
    try {
      const result = await api.previewRecordsCsv(projectId, csv, row);
      applyPreview(result, selectAll);
    } catch (err) {
      setPreview(null);
      setColumns([]);
      setError(err instanceof Error ? err.message : 'Failed to analyze CSV');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    setError(null);
    const sizeError = csvFileSizeError(file);
    if (sizeError) {
      setPreview(null);
      setColumns([]);
      setCsvText('');
      setError(sizeError);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    try {
      const csv = await readCsvFile(file);
      setCsvText(csv);
      await analyzeCsv(csv, headerRow, true);
    } catch (err) {
      setPreview(null);
      setColumns([]);
      setCsvText('');
      setError(err instanceof Error ? err.message : 'Failed to read CSV file');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleHeaderRowApply = async () => {
    if (!csvText.trim() || headerRow < 1) return;
    if (headerRow === lastAnalyzedHeaderRowRef.current && preview) return;
    await analyzeCsv(csvText, headerRow);
  };

  const setColumnIncluded = (fieldKey: string, included: boolean) => {
    if (fieldKey === recordKeyColumn) return;
    setIncludedKeys((prev) => {
      const next = new Set(prev);
      if (included) next.add(fieldKey);
      else next.delete(fieldKey);
      return next;
    });
  };

  const includedColumns = columns.filter(
    (col) => col.matched && (includedKeys.has(col.field_key) || col.field_key === recordKeyColumn),
  );

  const canImport =
    preview !== null &&
    csvText.trim().length > 0 &&
    preview.row_count > 0 &&
    includedColumns.some((col) => col.matched);

  const handleImport = async () => {
    if (!canImport) return;
    setImporting(true);
    setError(null);
    try {
      const fieldKeys = columns
        .filter(
          (col) =>
            col.matched &&
            (includedKeys.has(col.field_key) || col.field_key === recordKeyColumn),
        )
        .map((col) => col.field_key);
      const result = await api.importRecordsCsv(projectId, csvText, headerRow, fieldKeys);
      onImported(result);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
      <DialogTitle>Import records from CSV</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Upload a CSV and map columns to your published form fields. Only matched columns with
          checkboxes selected will be imported. {CSV_MAX_SIZE_HELP}
        </Typography>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <TextField
            label="Header row"
            type="number"
            size="small"
            value={headerRow}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10);
              setHeaderRow(Number.isFinite(next) && next > 0 ? next : 1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && csvText.trim()) void handleHeaderRowApply();
            }}
            inputProps={{ min: 1, step: 1 }}
            helperText="Row number where column names appear (row 1 is the first line)"
            sx={{ width: 160 }}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelect(file);
            }}
          />
          <Button
            variant="outlined"
            startIcon={previewLoading ? <CircularProgress size={16} /> : <UploadFileIcon />}
            onClick={() => fileRef.current?.click()}
            disabled={previewLoading}
          >
            {previewLoading ? 'Analyzing CSV…' : 'Choose CSV file'}
          </Button>
          {csvText.trim().length > 0 && (
            <Button
              variant="text"
              onClick={() => void handleHeaderRowApply()}
              disabled={previewLoading || headerRow < 1}
            >
              Re-analyze
            </Button>
          )}
        </Box>

        {preview && (
          <Typography variant="body2" color="text.secondary">
            Headers on row {preview.header_row}: {preview.row_count} data row
            {preview.row_count === 1 ? '' : 's'}
          </Typography>
        )}

        {preview && preview.unmatched_csv_headers.length > 0 && (
          <Alert severity="info">
            CSV columns not matched to form fields: {preview.unmatched_csv_headers.join(', ')}
          </Alert>
        )}

        {columns.length > 0 && (
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Column mapping
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {columns.map((col) => (
                <FormControlLabel
                  key={col.field_key}
                  control={
                    <Checkbox
                      checked={
                        col.field_key === recordKeyColumn ||
                        (col.matched && includedKeys.has(col.field_key))
                      }
                      disabled={!col.matched || col.field_key === recordKeyColumn}
                      onChange={(e) => setColumnIncluded(col.field_key, e.target.checked)}
                    />
                  }
                  label={
                    col.matched
                      ? `${col.label} ← ${col.csv_header ?? col.field_key}${
                          col.field_key === recordKeyColumn ? ' — record key' : ''
                        }`
                      : `${col.label} — not found in CSV`
                  }
                />
              ))}
            </Box>
          </Box>
        )}

        {preview && preview.sample_rows.length > 0 && includedColumns.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Typography variant="subtitle2" gutterBottom>
              Sample data
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {includedColumns.map((col) => (
                    <TableCell key={col.field_key}>{col.label}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.sample_rows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {includedColumns.map((col) => (
                      <TableCell key={col.field_key}>
                        {String(row[col.field_key] ?? '')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <BusyButton
          variant="contained"
          onClick={handleImport}
          busy={importing}
          busyLabel="Importing…"
          disabled={!canImport}
        >
          Import
        </BusyButton>
      </DialogActions>
    </Dialog>
  );
}
