import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import { readCsvFile, stageCsvForImport } from '../../lib/csvFile';
import type {
  CsvFormPreview,
  DuplicateKeyMode,
  FieldDefinition,
  FieldType,
  InferredColumn,
  StorageType,
  UcTablePreview,
} from '../../types';
import BusyButton from '../common/BusyButton';
import StorageSchemaSelect from '../common/StorageSchemaSelect';
import UcTableSelector from '../common/UcTableSelector';

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

type CreationMode = 'new_table' | 'existing_uc_table' | 'import_csv';

function DuplicateKeyModeField({
  value,
  onChange,
}: {
  value: DuplicateKeyMode;
  onChange: (value: DuplicateKeyMode) => void;
}) {
  return (
    <FormControl component="fieldset" sx={{ mt: 2, width: '100%' }}>
      <Typography variant="subtitle2" gutterBottom>
        Duplicate record keys
      </Typography>
      <RadioGroup value={value} onChange={(e) => onChange(e.target.value as DuplicateKeyMode)}>
        <FormControlLabel
          value="retain"
          control={<Radio />}
          label="Keep existing rows (skip duplicates)"
        />
        <FormControlLabel
          value="overwrite"
          control={<Radio />}
          label="Overwrite existing rows with new values"
        />
      </RadioGroup>
      <FormHelperText>
        Applies when importing CSV data or creating records with an existing primary key.
      </FormHelperText>
    </FormControl>
  );
}

const CSV_FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & time' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'single_select', label: 'Dropdown' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' },
];

function buildSeedFields(
  preview: UcTablePreview,
  selectedKeys: Set<string>,
  recordKeyColumn: string,
): FieldDefinition[] {
  const fields: FieldDefinition[] = [];
  let sortOrder = 0;
  for (const col of preview.columns) {
    if (col.key.startsWith('_')) continue;
    if (!selectedKeys.has(col.key) && col.key !== recordKeyColumn) continue;
    fields.push({
      field_key: col.key,
      label: col.label,
      field_type: col.type ?? 'text',
      sort_order: sortOrder,
      is_required: col.key === recordKeyColumn,
      config_json: col.key === recordKeyColumn ? { is_record_key: true } : undefined,
      schema_version: 0,
      is_published: false,
    });
    sortOrder += 1;
  }
  return fields;
}

function buildCsvSeedFields(
  columns: InferredColumn[],
  selectedKeys: Set<string>,
  recordKeyColumn: string,
): FieldDefinition[] {
  const fields: FieldDefinition[] = [];
  let sortOrder = 0;
  for (const col of columns) {
    if (!selectedKeys.has(col.field_key) && col.field_key !== recordKeyColumn) continue;
    fields.push({
      field_key: col.field_key,
      label: col.label,
      field_type: col.field_type,
      sort_order: sortOrder,
      is_required: col.field_key === recordKeyColumn,
      config_json:
        col.field_key === recordKeyColumn ? { is_record_key: true } : col.config_json ?? undefined,
      schema_version: 0,
      is_published: false,
    });
    sortOrder += 1;
  }
  return fields;
}

function guessRecordKeyColumn(keys: string[]): string {
  const idLike = keys.find((k) => /(^id$|_id$|^.*_key$)/i.test(k));
  return idLike ?? keys[0] ?? '';
}

function StorageFields({
  storageType,
  setStorageType,
  showStorage,
  setShowStorage,
  targetCatalog,
  setTargetCatalog,
  targetSchema,
  setTargetSchema,
  targetTable,
  setTargetTable,
  defaultCatalog,
  defaultSchema,
  name,
  slugTableName,
}: {
  storageType: StorageType;
  setStorageType: (v: StorageType) => void;
  showStorage: boolean;
  setShowStorage: (v: boolean | ((prev: boolean) => boolean)) => void;
  targetCatalog: string;
  setTargetCatalog: (v: string) => void;
  targetSchema: string;
  setTargetSchema: (v: string) => void;
  targetTable: string;
  setTargetTable: (v: string) => void;
  defaultCatalog: string;
  defaultSchema: string;
  name: string;
  slugTableName: (value: string) => string;
}) {
  return (
    <>
      <TextField
        select
        label="Storage"
        value={storageType}
        onChange={(e) => setStorageType(e.target.value as StorageType)}
      >
        <MenuItem value="uc_delta">Unity Catalog (Delta)</MenuItem>
        <MenuItem value="lakebase">Lakebase (Postgres)</MenuItem>
      </TextField>
      <Button size="small" onClick={() => setShowStorage((v) => !v)} sx={{ alignSelf: 'flex-start' }}>
        {showStorage ? 'Hide storage location' : 'Customize storage location'}
      </Button>
      <Collapse in={showStorage}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {storageType === 'lakebase'
              ? `Records are stored in Lakebase Postgres. Defaults: ${defaultCatalog}.${defaultSchema}`
              : `Records are saved outside the app metadata schema. Defaults: ${defaultCatalog}.${defaultSchema}`}
          </Typography>
          <TextField
            label={storageType === 'lakebase' ? 'Database' : 'Catalog'}
            value={targetCatalog}
            onChange={(e) => {
              setTargetCatalog(e.target.value);
              if (storageType === 'uc_delta') {
                setTargetSchema('');
              }
            }}
            size="small"
            disabled={storageType === 'lakebase'}
            helperText={storageType === 'lakebase' ? 'From Lakebase app resource (PGDATABASE)' : undefined}
          />
          <StorageSchemaSelect
            storageType={storageType}
            catalog={targetCatalog}
            value={targetSchema}
            onChange={setTargetSchema}
            helperText={
              storageType === 'lakebase'
                ? undefined
                : `Default for new forms: ${defaultSchema || '…'}`
            }
          />
          <TextField
            label="Table"
            value={targetTable}
            onChange={(e) => setTargetTable(e.target.value)}
            placeholder={name.trim() ? `${slugTableName(name)}_data` : 'auto from name'}
            size="small"
            helperText={
              storageType === 'lakebase'
                ? 'Postgres table created on publish'
                : 'Delta table created on publish'
            }
          />
        </Box>
      </Collapse>
    </>
  );
}

export default function CreateProjectDialog({ open, onClose, onCreated }: CreateProjectDialogProps) {
  const navigate = useNavigate();
  const csvFileRef = useRef<HTMLInputElement>(null);
  const lastAnalyzedHeaderRowRef = useRef(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creationMode, setCreationMode] = useState<CreationMode>('new_table');
  const [storageType, setStorageType] = useState<StorageType>('uc_delta');
  const [showStorage, setShowStorage] = useState(false);
  const [targetCatalog, setTargetCatalog] = useState('');
  const [targetSchema, setTargetSchema] = useState('');
  const [targetTable, setTargetTable] = useState('');
  const [defaultCatalog, setDefaultCatalog] = useState('');
  const [defaultSchema, setDefaultSchema] = useState('');
  const [tablePreview, setTablePreview] = useState<UcTablePreview | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvFormPreview | null>(null);
  const [csvColumns, setCsvColumns] = useState<InferredColumn[]>([]);
  const [csvText, setCsvText] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [csvPreviewLoading, setCsvPreviewLoading] = useState(false);
  const [importRowsAfterPublish, setImportRowsAfterPublish] = useState(false);
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<Set<string>>(new Set());
  const [recordKeyColumn, setRecordKeyColumn] = useState('');
  const [duplicateKeyMode, setDuplicateKeyMode] = useState<DuplicateKeyMode>('retain');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectableColumns = useMemo(
    () => (tablePreview?.columns ?? []).filter((col) => !col.key.startsWith('_')),
    [tablePreview],
  );

  const csvSelectableColumns = useMemo(() => csvColumns, [csvColumns]);

  useEffect(() => {
    if (!open) return;
    void api.getConfig().then((cfg) => {
      setDefaultCatalog(cfg.default_data_catalog);
      setDefaultSchema(cfg.default_data_schema);
      if (storageType === 'lakebase' && cfg.lakebase_configured) {
        setTargetCatalog(cfg.lakebase_database ?? '');
        setTargetSchema(cfg.lakebase_default_schema ?? cfg.default_data_schema);
      } else {
        setTargetCatalog(cfg.default_data_catalog);
        setTargetSchema(cfg.default_data_schema);
      }
    });
  }, [open, storageType]);

  const reset = () => {
    setName('');
    setDescription('');
    setCreationMode('new_table');
    setStorageType('uc_delta');
    setShowStorage(false);
    setTargetTable('');
    setTablePreview(null);
    setCsvPreview(null);
    setCsvColumns([]);
    setCsvText('');
    setHeaderRow(1);
    lastAnalyzedHeaderRowRef.current = 1;
    setCsvPreviewLoading(false);
    setImportRowsAfterPublish(false);
    setSelectedColumnKeys(new Set());
    setRecordKeyColumn('');
    setDuplicateKeyMode('retain');
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const slugTableName = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'collection';

  const handlePreviewLoaded = (preview: UcTablePreview) => {
    setTablePreview(preview);
    const keys = preview.columns.filter((col) => !col.key.startsWith('_')).map((col) => col.key);
    setSelectedColumnKeys(new Set(keys));
    setRecordKeyColumn(guessRecordKeyColumn(keys));
    if (!name.trim()) {
      setName(preview.table.replace(/_/g, ' '));
    }
    setTargetCatalog(preview.catalog);
    setTargetSchema(preview.schema);
    setTargetTable(preview.table);
  };

  const analyzeCsv = async (csv: string, row: number, options?: { selectAll?: boolean }) => {
    setCsvPreviewLoading(true);
    setError(null);
    try {
      const preview = await api.previewCsv(csv, row);
      setCsvPreview(preview);
      setCsvColumns(preview.columns);
      const availableKeys = preview.columns.map((col) => col.field_key);
      if (options?.selectAll) {
        setSelectedColumnKeys(new Set(availableKeys));
      } else {
        setSelectedColumnKeys((prev) => {
          if (prev.size === 0) {
            return new Set(availableKeys);
          }
          const available = new Set(availableKeys);
          const preserved = new Set([...prev].filter((key) => available.has(key)));
          if (preview.suggested_record_key) {
            preserved.add(preview.suggested_record_key);
          }
          return preserved.size > 0 ? preserved : new Set(availableKeys);
        });
      }
      setRecordKeyColumn(preview.suggested_record_key);
      lastAnalyzedHeaderRowRef.current = row;
    } catch (err) {
      setCsvPreview(null);
      setCsvColumns([]);
      setError(err instanceof Error ? err.message : 'Failed to analyze CSV');
    } finally {
      setCsvPreviewLoading(false);
    }
  };

  const handleCsvFileSelect = async (file: File) => {
    setError(null);
    try {
      const csv = await readCsvFile(file);
      setCsvText(csv);
      if (!name.trim()) {
        const baseName = file.name.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').trim();
        if (baseName) setName(baseName);
      }
      await analyzeCsv(csv, headerRow, { selectAll: true });
    } catch (err) {
      setCsvPreview(null);
      setCsvColumns([]);
      setCsvText('');
      setError(err instanceof Error ? err.message : 'Failed to read CSV file');
    } finally {
      if (csvFileRef.current) csvFileRef.current.value = '';
    }
  };

  const handleHeaderRowApply = async () => {
    if (!csvText.trim() || headerRow < 1) return;
    if (headerRow === lastAnalyzedHeaderRowRef.current && csvPreview) return;
    await analyzeCsv(csvText, headerRow);
  };

  const updateCsvColumn = (fieldKey: string, patch: Partial<InferredColumn>) => {
    setCsvColumns((prev) =>
      prev.map((col) => (col.field_key === fieldKey ? { ...col, ...patch } : col)),
    );
  };

  const setCsvColumnIncluded = (key: string, included: boolean) => {
    if (key === recordKeyColumn) return;
    setSelectedColumnKeys((prev) => {
      const next = new Set(prev);
      if (included) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleColumn = (key: string) => {
    if (key === recordKeyColumn) return;
    setSelectedColumnKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    if (creationMode === 'existing_uc_table') {
      if (!tablePreview || selectedColumnKeys.size === 0) {
        setError('Preview a table and select at least one column.');
        return;
      }
      if (!recordKeyColumn) {
        setError('Choose a record key column.');
        return;
      }
    }
    if (creationMode === 'import_csv') {
      if (!csvPreview || csvColumns.length === 0) {
        setError('Upload a CSV file to infer form fields.');
        return;
      }
      if (
        !csvColumns.some(
          (col) => col.field_key === recordKeyColumn || selectedColumnKeys.has(col.field_key),
        )
      ) {
        setError('Select at least one column for the form.');
        return;
      }
      if (!recordKeyColumn) {
        setError('Choose a record key column.');
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      let seedFields: FieldDefinition[] | undefined;
      if (creationMode === 'existing_uc_table' && tablePreview) {
        seedFields = buildSeedFields(tablePreview, selectedColumnKeys, recordKeyColumn);
      } else if (creationMode === 'import_csv') {
        seedFields = buildCsvSeedFields(csvColumns, selectedColumnKeys, recordKeyColumn);
      }

      const project = await api.createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        storage_type: creationMode === 'existing_uc_table' ? 'uc_delta' : storageType,
        storage_mode: creationMode === 'existing_uc_table' ? 'existing_uc' : 'managed',
        record_key_column:
          creationMode === 'existing_uc_table' || creationMode === 'import_csv'
            ? recordKeyColumn
            : undefined,
        duplicate_key_mode:
          creationMode === 'existing_uc_table' || creationMode === 'import_csv'
            ? duplicateKeyMode
            : undefined,
        target_catalog:
          creationMode === 'existing_uc_table'
            ? tablePreview?.catalog
            : showStorage
              ? targetCatalog.trim() || undefined
              : undefined,
        target_schema:
          creationMode === 'existing_uc_table'
            ? tablePreview?.schema
            : showStorage
              ? targetSchema.trim() || undefined
              : undefined,
        target_table:
          creationMode === 'existing_uc_table'
            ? tablePreview?.table
            : showStorage
              ? targetTable.trim() || `${slugTableName(name)}_data`
              : undefined,
        seed_fields: seedFields,
      });

      const projectId = project.project_id;
      const wasImportCsv = creationMode === 'import_csv';
      const stagedCsvText = csvText;
      const stagedHeaderRow = headerRow;
      const shouldStageImport = importRowsAfterPublish && stagedCsvText.trim().length > 0;
      reset();
      onCreated();
      onClose();

      if (wasImportCsv) {
        if (shouldStageImport) {
          stageCsvForImport(projectId, { csv: stagedCsvText, headerRow: stagedHeaderRow });
          navigate(`/collections/${projectId}?tab=designer&importCsv=1`);
        } else {
          navigate(`/collections/${projectId}?tab=designer`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setSaving(false);
    }
  };

  const canCreate =
    name.trim().length > 0 &&
    (creationMode === 'new_table' ||
      (creationMode === 'existing_uc_table' &&
        tablePreview !== null &&
        selectedColumnKeys.size > 0 &&
        recordKeyColumn.length > 0) ||
      (creationMode === 'import_csv' &&
        csvPreview !== null &&
        csvColumns.length > 0 &&
        recordKeyColumn.length > 0 &&
        csvColumns.some(
          (col) => col.field_key === recordKeyColumn || selectedColumnKeys.has(col.field_key),
        )));

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
      <DialogTitle>New form</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          minRows={2}
        />

        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Data source
          </Typography>
          <RadioGroup
            value={creationMode}
            onChange={(e) => {
              const mode = e.target.value as CreationMode;
              setCreationMode(mode);
              setTablePreview(null);
              setCsvPreview(null);
              setCsvColumns([]);
              setCsvText('');
              setHeaderRow(1);
              setSelectedColumnKeys(new Set());
              setRecordKeyColumn('');
              setError(null);
              if (mode === 'existing_uc_table') {
                setStorageType('uc_delta');
              }
            }}
          >
            <FormControlLabel
              value="new_table"
              control={<Radio />}
              label="Create a new table on publish"
            />
            <FormControlLabel
              value="existing_uc_table"
              control={<Radio />}
              label="Use an existing Unity Catalog table"
            />
            <FormControlLabel value="import_csv" control={<Radio />} label="Import from CSV" />
          </RadioGroup>
        </Box>

        {creationMode === 'existing_uc_table' ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Pick a UC table to build your form from. Existing rows can be viewed and updated after
              you publish.
            </Typography>
            <UcTableSelector
              catalog={targetCatalog}
              schema={targetSchema}
              table={targetTable}
              onCatalogChange={setTargetCatalog}
              onSchemaChange={setTargetSchema}
              onTableChange={setTargetTable}
              onPreviewLoaded={handlePreviewLoaded}
              onPreviewCleared={() => {
                setTablePreview(null);
                setSelectedColumnKeys(new Set());
              }}
            />
            {selectableColumns.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                  <InputLabel id="record-key-label">Record key column</InputLabel>
                  <Select
                    labelId="record-key-label"
                    label="Record key column"
                    value={recordKeyColumn}
                    onChange={(e) => setRecordKeyColumn(e.target.value)}
                  >
                    {selectableColumns.map((col) => (
                      <MenuItem key={col.key} value={col.key}>
                        {col.label} ({col.key})
                      </MenuItem>
                    ))}
                  </Select>
                  <FormHelperText>
                    Unique business key used to identify rows when editing existing data.
                  </FormHelperText>
                </FormControl>
                <Typography variant="subtitle2" gutterBottom>
                  Form columns
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {selectableColumns.map((col) => (
                    <FormControlLabel
                      key={col.key}
                      control={
                        <Checkbox
                          checked={selectedColumnKeys.has(col.key) || col.key === recordKeyColumn}
                          disabled={col.key === recordKeyColumn}
                          onChange={() => toggleColumn(col.key)}
                        />
                      }
                      label={`${col.label} (${col.type ?? 'text'})${
                        col.key === recordKeyColumn ? ' — record key' : ''
                      }`}
                    />
                  ))}
                </Box>
                <DuplicateKeyModeField value={duplicateKeyMode} onChange={setDuplicateKeyMode} />
              </Box>
            )}
          </Box>
        ) : creationMode === 'import_csv' ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Upload a CSV to infer form fields from column headers and sample values. Review the
              schema before creating the collection.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap', mb: 2 }}>
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
              ref={csvFileRef}
              type="file"
              accept=".csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleCsvFileSelect(file);
              }}
            />
            <Button
              variant="outlined"
              startIcon={csvPreviewLoading ? <CircularProgress size={16} /> : <UploadFileIcon />}
              onClick={() => csvFileRef.current?.click()}
              disabled={csvPreviewLoading}
            >
              {csvPreviewLoading ? 'Analyzing CSV…' : 'Choose CSV file'}
            </Button>
            {csvText.trim().length > 0 && (
              <Button
                variant="text"
                onClick={() => void handleHeaderRowApply()}
                disabled={csvPreviewLoading || headerRow < 1}
              >
                Re-analyze
              </Button>
            )}
            </Box>
            {csvPreview && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Headers on row {csvPreview.header_row}: {csvPreview.row_count} data row
                {csvPreview.row_count === 1 ? '' : 's'},{' '}
                {csvColumns.length} column{csvColumns.length === 1 ? '' : 's'}
              </Typography>
            )}
            {csvSelectableColumns.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                  <InputLabel id="csv-record-key-label">Record key column</InputLabel>
                  <Select
                    labelId="csv-record-key-label"
                    label="Record key column"
                    value={recordKeyColumn}
                    onChange={(e) => {
                      const key = e.target.value;
                      setRecordKeyColumn(key);
                      setSelectedColumnKeys((prev) => new Set(prev).add(key));
                    }}
                  >
                    {csvSelectableColumns.map((col) => (
                      <MenuItem key={col.field_key} value={col.field_key}>
                        {col.label} ({col.field_key})
                      </MenuItem>
                    ))}
                  </Select>
                  <FormHelperText>
                    Unique business key used to identify rows when editing existing data.
                  </FormHelperText>
                </FormControl>
                <DuplicateKeyModeField value={duplicateKeyMode} onChange={setDuplicateKeyMode} />
                <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
                  Form columns
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {csvSelectableColumns.map((col) => (
                    <Box
                      key={col.field_key}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        flexWrap: 'wrap',
                      }}
                    >
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={
                              col.field_key === recordKeyColumn ||
                              selectedColumnKeys.has(col.field_key)
                            }
                            disabled={col.field_key === recordKeyColumn}
                            onChange={(e) => setCsvColumnIncluded(col.field_key, e.target.checked)}
                          />
                        }
                        label={`${col.label}${col.field_key === recordKeyColumn ? ' — record key' : ''}`}
                        sx={{ minWidth: 160, mr: 0 }}
                      />
                      <TextField
                        select
                        size="small"
                        label="Type"
                        value={col.field_type}
                        onChange={(e) =>
                          updateCsvColumn(col.field_key, {
                            field_type: e.target.value as FieldType,
                          })
                        }
                        sx={{ minWidth: 160 }}
                      >
                        {CSV_FIELD_TYPES.map((t) => (
                          <MenuItem key={t.value} value={t.value}>
                            {t.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Box>
                  ))}
                </Box>
                {csvPreview && csvPreview.sample_rows.length > 0 && (
                  <Box sx={{ mt: 2, overflowX: 'auto' }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Sample data
                    </Typography>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          {csvSelectableColumns
                            .filter(
                              (col) =>
                                selectedColumnKeys.has(col.field_key) ||
                                col.field_key === recordKeyColumn,
                            )
                            .map((col) => (
                              <TableCell key={col.field_key}>{col.label}</TableCell>
                            ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {csvPreview.sample_rows.map((row, rowIndex) => (
                          <TableRow key={rowIndex}>
                            {csvSelectableColumns
                              .filter(
                                (col) =>
                                  selectedColumnKeys.has(col.field_key) ||
                                  col.field_key === recordKeyColumn,
                              )
                              .map((col) => (
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
                <FormControlLabel
                  sx={{ mt: 2 }}
                  control={
                    <Checkbox
                      checked={importRowsAfterPublish}
                      onChange={(e) => setImportRowsAfterPublish(e.target.checked)}
                      disabled={!csvPreview || csvPreview.row_count === 0}
                    />
                  }
                  label="Import CSV rows after I publish"
                />
              </Box>
            )}
            <StorageFields
              storageType={storageType}
              setStorageType={setStorageType}
              showStorage={showStorage}
              setShowStorage={setShowStorage}
              targetCatalog={targetCatalog}
              setTargetCatalog={setTargetCatalog}
              targetSchema={targetSchema}
              setTargetSchema={setTargetSchema}
              targetTable={targetTable}
              setTargetTable={setTargetTable}
              defaultCatalog={defaultCatalog}
              defaultSchema={defaultSchema}
              name={name}
              slugTableName={slugTableName}
            />
          </Box>
        ) : (
          <StorageFields
            storageType={storageType}
            setStorageType={setStorageType}
            showStorage={showStorage}
            setShowStorage={setShowStorage}
            targetCatalog={targetCatalog}
            setTargetCatalog={setTargetCatalog}
            targetSchema={targetSchema}
            setTargetSchema={setTargetSchema}
            targetTable={targetTable}
            setTargetTable={setTargetTable}
            defaultCatalog={defaultCatalog}
            defaultSchema={defaultSchema}
            name={name}
            slugTableName={slugTableName}
          />
        )}

        {error && <span style={{ color: '#c41230', fontSize: '0.875rem' }}>{error}</span>}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <BusyButton
          variant="contained"
          onClick={handleCreate}
          busy={saving}
          busyLabel="Creating…"
          disabled={!canCreate}
        >
          Create
        </BusyButton>
      </DialogActions>
    </Dialog>
  );
}
