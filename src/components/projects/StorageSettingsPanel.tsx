import { useEffect, useRef, useState } from 'react';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import {
  canStageCsvInBrowser,
  clearStagedCsvImport,
  CSV_MAX_SIZE_HELP,
  formatCsvSize,
  getStagedCsvImport,
  stageCsvForImport,
} from '../../lib/csvFile';
import { showGenieTab } from '../../lib/genie';
import { formatImportResult, stagedImportNote } from '../../lib/importRecords';
import {
  detectSpreadsheetKind,
  listXlsxSheetNames,
  readSpreadsheetAsCsv,
  SPREADSHEET_ACCEPT,
  spreadsheetFileSizeError,
  type SpreadsheetKind,
  xlsxSheetToCsv,
} from '../../lib/spreadsheetFile';
import type { AppConfig, DuplicateKeyMode, ProjectDetail, RecordSyncMode, StorageType } from '../../types';
import BusyButton from '../common/BusyButton';
import StorageSchemaSelect from '../common/StorageSchemaSelect';
import RecordCsvImportDialog from './RecordCsvImportDialog';

interface StorageSettingsPanelProps {
  project: ProjectDetail;
  onSaved: () => void;
}

export default function StorageSettingsPanel({ project, onSaved }: StorageSettingsPanelProps) {
  const importFileRef = useRef<HTMLInputElement>(null);
  const [storageType, setStorageType] = useState<StorageType>(project.storage_type);
  const [catalog, setCatalog] = useState(project.target_catalog ?? '');
  const [schema, setSchema] = useState(project.target_schema ?? '');
  const [table, setTable] = useState(project.target_table ?? '');
  const [recordSyncMode, setRecordSyncMode] = useState<RecordSyncMode | ''>(
    project.record_sync_mode ?? '',
  );
  const [duplicateKeyMode, setDuplicateKeyMode] = useState<DuplicateKeyMode>(
    project.duplicate_key_mode ?? 'retain',
  );
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [lakebaseConfigured, setLakebaseConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingSyncMode, setSavingSyncMode] = useState(false);
  const [savingDuplicateKeyMode, setSavingDuplicateKeyMode] = useState(false);
  const [genieSyncing, setGenieSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importCsvText, setImportCsvText] = useState('');
  const [importHeaderRow, setImportHeaderRow] = useState(1);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [spreadsheetKind, setSpreadsheetKind] = useState<SpreadsheetKind | null>(null);
  const [xlsxSheetNames, setXlsxSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [hasStagedImport, setHasStagedImport] = useState(false);

  const isDraft = project.status === 'draft';
  const isPublished = project.status === 'published';
  const isLakebase = storageType === 'lakebase';
  const isUc = (isDraft ? storageType : project.storage_type) === 'uc_delta';
  const ucAccessMode = appConfig?.uc_data_access_mode ?? 'hybrid';
  const ucAccessModeLabel =
    ucAccessMode === 'hybrid'
      ? 'Hybrid (app SP for managed tables; user token for existing UC tables)'
      : ucAccessMode === 'service_principal'
        ? 'Service principal (app runs all UC data SQL)'
        : 'User on-behalf-of (all UC data SQL as signed-in user)';
  const canStageImport =
    importCsvText.length > 0 && canStageCsvInBrowser(importCsvText);
  const syncTargetLabel = project.storage_type === 'lakebase' ? 'Lakebase' : 'Unity Catalog';
  const isStagedSyncMode = project.record_sync_mode === 'staged';
  const fieldLabels = Object.fromEntries(
    (project.fields ?? []).map((field) => [field.field_key, field.label]),
  );

  useEffect(() => {
    setStorageType(project.storage_type);
    setCatalog(project.target_catalog ?? '');
    setSchema(project.target_schema ?? '');
    setTable(project.target_table ?? '');
    setRecordSyncMode(project.record_sync_mode ?? '');
    setDuplicateKeyMode(project.duplicate_key_mode ?? 'retain');
  }, [
    project.storage_type,
    project.target_catalog,
    project.target_schema,
    project.target_table,
    project.record_sync_mode,
    project.duplicate_key_mode,
  ]);

  useEffect(() => {
    void api.getConfig().then((cfg) => {
      setAppConfig(cfg);
      setLakebaseConfigured(Boolean(cfg.lakebase_configured));
    });
  }, []);

  useEffect(() => {
    setHasStagedImport(Boolean(getStagedCsvImport(project.project_id)));
  }, [project.project_id]);

  const handleStorageTypeChange = (nextType: StorageType) => {
    setStorageType(nextType);
    if (!appConfig) return;
    if (nextType === 'lakebase') {
      setCatalog(appConfig.lakebase_database ?? '');
      setSchema(appConfig.lakebase_default_schema ?? appConfig.default_data_schema);
    } else {
      setCatalog(appConfig.default_data_catalog);
      setSchema(appConfig.default_data_schema);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await api.updateProject(project.project_id, {
        storage_type: storageType,
        target_catalog: catalog.trim(),
        target_schema: schema.trim(),
        target_table: table.trim(),
      });
      setMessage('Storage location saved.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveRecordSyncMode = async () => {
    if (!recordSyncMode) return;
    setSavingSyncMode(true);
    setMessage(null);
    setError(null);
    try {
      await api.updateProject(project.project_id, { record_sync_mode: recordSyncMode });
      setMessage('Record sync mode saved.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingSyncMode(false);
    }
  };

  const saveDuplicateKeyMode = async () => {
    setSavingDuplicateKeyMode(true);
    setMessage(null);
    setError(null);
    try {
      await api.updateProject(project.project_id, { duplicate_key_mode: duplicateKeyMode });
      setMessage('Duplicate key handling saved.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingDuplicateKeyMode(false);
    }
  };

  const resetDraftImportFile = () => {
    setImportCsvText('');
    setUploadedFile(null);
    setSpreadsheetKind(null);
    setXlsxSheetNames([]);
    setSelectedSheet('');
    if (importFileRef.current) importFileRef.current.value = '';
  };

  const handleDraftImportFileSelect = async (file: File) => {
    setError(null);
    setMessage(null);
    const sizeError = spreadsheetFileSizeError(file);
    if (sizeError) {
      resetDraftImportFile();
      setError(sizeError);
      return;
    }
    setImportLoading(true);
    try {
      const kind = detectSpreadsheetKind(file);
      setUploadedFile(file);
      setSpreadsheetKind(kind);
      let csv: string;
      if (kind === 'xlsx') {
        const sheets = await listXlsxSheetNames(file);
        const sheet = sheets[0];
        setXlsxSheetNames(sheets);
        setSelectedSheet(sheet);
        csv = await xlsxSheetToCsv(file, sheet);
      } else {
        setXlsxSheetNames([]);
        setSelectedSheet('');
        csv = await readSpreadsheetAsCsv(file);
      }
      setImportCsvText(csv);
    } catch (err) {
      resetDraftImportFile();
      setError(err instanceof Error ? err.message : 'Failed to read spreadsheet file');
    } finally {
      setImportLoading(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const handleDraftSheetChange = async (sheet: string) => {
    if (!uploadedFile || spreadsheetKind !== 'xlsx') return;
    setSelectedSheet(sheet);
    setImportLoading(true);
    setError(null);
    try {
      const csv = await xlsxSheetToCsv(uploadedFile, sheet);
      setImportCsvText(csv);
    } catch (err) {
      setImportCsvText('');
      setError(err instanceof Error ? err.message : 'Failed to read worksheet');
    } finally {
      setImportLoading(false);
    }
  };

  const queueDraftImport = () => {
    setError(null);
    setMessage(null);
    if (!importCsvText.trim()) {
      setError('Choose a spreadsheet file first.');
      return;
    }
    if (!canStageImport) {
      setError(
        `This file is ${formatCsvSize(importCsvText.length)} — too large to queue in the browser. ` +
          'Publish the form first, then import from Settings or Records.',
      );
      return;
    }
    try {
      stageCsvForImport(project.project_id, {
        csv: importCsvText,
        headerRow: importHeaderRow > 0 ? importHeaderRow : 1,
      });
      setHasStagedImport(true);
      setMessage('Spreadsheet rows queued. They will import automatically when you publish.');
      resetDraftImportFile();
      setImportHeaderRow(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue import');
    }
  };

  const clearQueuedImport = () => {
    clearStagedCsvImport(project.project_id);
    setHasStagedImport(false);
    setMessage('Queued import cleared.');
  };

  const lakebaseProject = (appConfig?.lakebase_project || '').trim();
  const lakebaseDatabase = (catalog || appConfig?.lakebase_database || '').trim();
  const lakebaseSchema = (schema || appConfig?.lakebase_default_schema || '').trim();
  const lakebaseTable = table.trim();
  const storageLabel = isLakebase
    ? [lakebaseDatabase || '…', lakebaseSchema || '…', lakebaseTable || '…'].join('.')
    : `${project.target_catalog}.${project.target_schema}.${project.target_table}`;

  const genieEnabled = showGenieTab(project);

  return (
    <Paper className="page-card" sx={{ p: 3, maxWidth: 720 }}>
      <Typography variant="h6" gutterBottom>
        Storage location
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {isLakebase ? (
          <>
            Collection records are stored in a <strong>Lakebase Postgres</strong> table. App metadata
            (forms, lookups, members) stays in <strong>{appConfig?.catalog || '…'}.{appConfig?.schema || '…'}</strong>.
          </>
        ) : (
          <>
            Collection records are stored in a Unity Catalog Delta table. App metadata (forms, lookups,
            members) stays in <strong>{appConfig?.catalog || '…'}.{appConfig?.schema || '…'}</strong>.
          </>
        )}
      </Typography>

      {isUc && appConfig && (
        <Alert severity="info" sx={{ mb: 2 }}>
          UC data access mode: <strong>{ucAccessModeLabel}</strong>
          {ucAccessMode === 'hybrid' && (
            <>
              {' '}
              Members on app-created tables get UC grants automatically on publish or when added.
              Existing UC tables still require the user&apos;s own UC access (or SP MANAGE on the
              table for auto-grant).
            </>
          )}
        </Alert>
      )}

      {isDraft && (
        <TextField
          select
          label="Storage"
          value={storageType}
          onChange={(e) => handleStorageTypeChange(e.target.value as StorageType)}
          size="small"
          fullWidth
          sx={{ mb: 2 }}
          disabled={!appConfig}
          helperText="Choose where form records are stored. You can change this until you publish."
        >
          <MenuItem value="uc_delta">Unity Catalog (Delta)</MenuItem>
          <MenuItem value="lakebase" disabled={!lakebaseConfigured}>
            Lakebase (Postgres){!lakebaseConfigured ? ' — not configured' : ''}
          </MenuItem>
        </TextField>
      )}

      {isLakebase && !lakebaseConfigured && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Lakebase connection is not configured on this deployment. Add a postgres database resource to
          the Databricks App and set PGHOST / ENDPOINT_NAME.
        </Alert>
      )}

      {isLakebase && lakebaseConfigured && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Project records upload to this Lakebase location:
          </Typography>
          <Box
            component="code"
            sx={{
              display: 'block',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '0.9rem',
              wordBreak: 'break-all',
            }}
          >
            {storageLabel}
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              columnGap: 1.5,
              rowGap: 0.25,
              mt: 1.5,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Project
            </Typography>
            <Typography variant="body2">{lakebaseProject || '—'}</Typography>
            <Typography variant="body2" color="text.secondary">
              Database
            </Typography>
            <Typography variant="body2">{lakebaseDatabase || '—'}</Typography>
            <Typography variant="body2" color="text.secondary">
              Schema
            </Typography>
            <Typography variant="body2">{lakebaseSchema || '—'}</Typography>
            <Typography variant="body2" color="text.secondary">
              Table
            </Typography>
            <Typography variant="body2">{lakebaseTable || '—'}</Typography>
          </Box>
          {!isDraft && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              Storage location is locked after publish.
            </Typography>
          )}
        </Alert>
      )}

      {!isDraft && !isLakebase && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Storage location is locked after publish. Current table: <strong>{storageLabel}</strong>
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label={isLakebase ? 'Database' : 'Catalog'}
          value={catalog}
          onChange={(e) => {
            setCatalog(e.target.value);
            if (!isLakebase) {
              setSchema('');
            }
          }}
          disabled={!isDraft || isLakebase}
          helperText={
            isLakebase
              ? 'Lakebase database (from app resource)'
              : isDraft
                ? `Default for new forms: ${appConfig?.default_data_catalog || '…'}`
                : undefined
          }
          size="small"
        />
        <StorageSchemaSelect
          storageType={isLakebase ? 'lakebase' : 'uc_delta'}
          catalog={catalog}
          value={schema}
          onChange={setSchema}
          disabled={!isDraft}
          helperText={
            isDraft
              ? isLakebase
                ? undefined
                : `Default for new forms: ${appConfig?.default_data_schema || '…'}`
              : undefined
          }
        />
        <TextField
          label="Table"
          value={table}
          onChange={(e) => setTable(e.target.value)}
          disabled={!isDraft}
          helperText={isLakebase ? 'Postgres table created on publish' : 'Delta table created on publish'}
          size="small"
        />
      </Box>

      {message && (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          {message}
        </Typography>
      )}
      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          {error}
        </Typography>
      )}

      {isDraft && (
        <Box sx={{ mt: 3 }}>
          <BusyButton variant="contained" onClick={save} busy={saving} busyLabel="Saving…">
            Save storage location
          </BusyButton>
        </Box>
      )}

      {(isUc || isLakebase) && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" gutterBottom>
            {isLakebase ? 'Lakebase record updates' : 'Unity Catalog record updates'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose how editor changes are written to the backing{' '}
            {isLakebase ? 'Lakebase' : 'UC'} table. This is required before you can publish.
          </Typography>
          {!isDraft && project.record_sync_mode && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Mode locked after publish:{' '}
              <strong>
                {project.record_sync_mode === 'immediate'
                  ? `Write directly to ${isLakebase ? 'Lakebase' : 'Unity Catalog'}`
                  : `Stage locally, then bulk sync to ${isLakebase ? 'Lakebase' : 'UC'}`}
              </strong>
              {project.staged_change_count ? ` (${project.staged_change_count} pending)` : ''}
            </Alert>
          )}
          {isDraft && !recordSyncMode && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Select a record update mode and save before publishing.
            </Alert>
          )}
          <FormControl component="fieldset" disabled={!isDraft} sx={{ width: '100%' }}>
            <RadioGroup
              value={recordSyncMode}
              onChange={(e) => setRecordSyncMode(e.target.value as RecordSyncMode)}
            >
              <FormControlLabel
                value="immediate"
                control={<Radio />}
                label={
                  isLakebase
                    ? 'Write changes directly to Lakebase'
                    : 'Write changes directly to Unity Catalog'
                }
              />
              <FormHelperText sx={{ mt: -1, mb: 1, ml: 4 }}>
                Each create, edit, or delete updates the {isLakebase ? 'Lakebase' : 'UC'} table
                immediately.
              </FormHelperText>
              <FormControlLabel
                value="staged"
                control={<Radio />}
                label={
                  isLakebase
                    ? 'Stage changes locally, then bulk sync to Lakebase'
                    : 'Stage changes locally, then bulk sync to UC'
                }
              />
              <FormHelperText sx={{ mt: -1, mb: 1, ml: 4 }}>
                Editors work against local staged changes. An admin or editor syncs them to{' '}
                {isLakebase ? 'Lakebase' : 'UC'} in one batch from the Records tab.
              </FormHelperText>
            </RadioGroup>
          </FormControl>
          {isDraft && (
            <Box sx={{ mt: 2 }}>
              <BusyButton
                variant="contained"
                onClick={saveRecordSyncMode}
                busy={savingSyncMode}
                busyLabel="Saving…"
                disabled={!recordSyncMode}
              >
                Save record sync mode
              </BusyButton>
            </Box>
          )}
        </Box>
      )}

      {project.record_key_column && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" gutterBottom>
            Duplicate record keys
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            When a new or imported row uses the same primary key as an existing record (
            <strong>{project.record_key_column}</strong>), choose whether to keep the existing row
            or replace it.
          </Typography>
          {!isDraft && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Mode locked after publish:{' '}
              <strong>
                {project.duplicate_key_mode === 'overwrite'
                  ? 'Overwrite existing rows'
                  : 'Keep existing rows (skip duplicates)'}
              </strong>
            </Alert>
          )}
          <FormControl component="fieldset" disabled={!isDraft} sx={{ width: '100%' }}>
            <RadioGroup
              value={duplicateKeyMode}
              onChange={(e) => setDuplicateKeyMode(e.target.value as DuplicateKeyMode)}
            >
              <FormControlLabel
                value="retain"
                control={<Radio />}
                label="Keep existing rows (skip duplicates)"
              />
              <FormHelperText sx={{ mt: -1, mb: 1, ml: 4 }}>
                Spreadsheet import and manual entry leave the existing record unchanged.
              </FormHelperText>
              <FormControlLabel
                value="overwrite"
                control={<Radio />}
                label="Overwrite existing rows with new values"
              />
              <FormHelperText sx={{ mt: -1, mb: 1, ml: 4 }}>
                Matching keys update the existing record with the incoming values.
              </FormHelperText>
            </RadioGroup>
          </FormControl>
          {isDraft && (
            <Box sx={{ mt: 2 }}>
              <BusyButton
                variant="contained"
                onClick={saveDuplicateKeyMode}
                busy={savingDuplicateKeyMode}
                busyLabel="Saving…"
              >
                Save duplicate key handling
              </BusyButton>
            </Box>
          )}
        </Box>
      )}

      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" gutterBottom>
          Import existing rows
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Upload a CSV or Excel (.xlsx) file to load existing data into this form.{' '}
          {CSV_MAX_SIZE_HELP}
        </Typography>
        {isLakebase && lakebaseConfigured && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Imported rows are written to Lakebase project{' '}
            <strong>{lakebaseProject || '—'}</strong> at{' '}
            <Box
              component="strong"
              sx={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontWeight: 600,
              }}
            >
              {storageLabel}
            </Box>
            {' '}
            (database <strong>{lakebaseDatabase || '—'}</strong>, schema{' '}
            <strong>{lakebaseSchema || '—'}</strong>, table <strong>{lakebaseTable || '—'}</strong>).
          </Alert>
        )}

        {isPublished ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Map spreadsheet columns to published form fields, then import. Duplicate key handling
              above controls whether matching keys are skipped or overwritten.
            </Typography>
            {isStagedSyncMode && (
              <Alert severity="info" sx={{ mb: 2 }}>
                This collection stages record changes. Imported rows are held locally until you
                click <strong>Sync to {syncTargetLabel}</strong> on the Records tab.
                {project.staged_change_count
                  ? ` ${project.staged_change_count} change(s) are pending now.`
                  : ''}
              </Alert>
            )}
            <Button
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={() => setImportDialogOpen(true)}
            >
              Import spreadsheet
            </Button>
            <RecordCsvImportDialog
              open={importDialogOpen}
              projectId={project.project_id}
              recordKeyColumn={project.record_key_column}
              onClose={() => setImportDialogOpen(false)}
              onImported={(result) => {
                const summary = formatImportResult(result, fieldLabels);
                setMessage(
                  isStagedSyncMode ? `${summary} ${stagedImportNote(syncTargetLabel)}` : summary,
                );
                setError(null);
                onSaved();
              }}
            />
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              While the form is still a draft, queue a spreadsheet to import automatically when you
              publish. After publish, use this section or the Records tab for additional imports.
            </Typography>
            {hasStagedImport && (
              <Alert
                severity="info"
                sx={{ mb: 2 }}
                action={
                  <Button color="inherit" size="small" onClick={clearQueuedImport}>
                    Clear
                  </Button>
                }
              >
                Spreadsheet rows are queued and will import when you publish.
              </Alert>
            )}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap', mb: 2 }}>
              <TextField
                label="Header row"
                type="number"
                size="small"
                value={importHeaderRow}
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  setImportHeaderRow(Number.isFinite(next) && next > 0 ? next : 1);
                }}
                inputProps={{ min: 1, step: 1 }}
                helperText="Row where column names appear"
                sx={{ width: 160 }}
              />
              {spreadsheetKind === 'xlsx' && xlsxSheetNames.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <InputLabel id="settings-xlsx-sheet-label">Sheet</InputLabel>
                  <Select
                    labelId="settings-xlsx-sheet-label"
                    label="Sheet"
                    value={selectedSheet}
                    onChange={(e) => void handleDraftSheetChange(e.target.value)}
                    disabled={importLoading}
                  >
                    {xlsxSheetNames.map((sheet) => (
                      <MenuItem key={sheet} value={sheet}>
                        {sheet}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <input
                ref={importFileRef}
                type="file"
                accept={SPREADSHEET_ACCEPT}
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleDraftImportFileSelect(file);
                }}
              />
              <Button
                variant="outlined"
                startIcon={importLoading ? <CircularProgress size={16} /> : <UploadFileIcon />}
                onClick={() => importFileRef.current?.click()}
                disabled={importLoading}
              >
                {importLoading ? 'Reading…' : 'Choose spreadsheet file'}
              </Button>
            </Box>
            {importCsvText.trim().length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  File ready ({formatCsvSize(importCsvText.length)}
                  {spreadsheetKind === 'xlsx' && selectedSheet ? `, sheet “${selectedSheet}”` : ''}).
                </Typography>
                {!canStageImport && (
                  <Alert severity="warning" sx={{ mb: 1 }}>
                    This file is too large to queue in the browser. Publish first, then import from
                    Settings or Records.
                  </Alert>
                )}
                <BusyButton
                  variant="contained"
                  onClick={queueDraftImport}
                  disabled={!canStageImport}
                >
                  Queue import for publish
                </BusyButton>
              </Box>
            )}
          </>
        )}
      </Box>

      {project.status === 'published' && genieEnabled && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" gutterBottom>
            Genie Q&amp;A
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Status: {project.genie_status ?? 'not configured'}
            {project.genie_error ? ` — ${project.genie_error}` : ''}
          </Typography>
          <BusyButton variant="outlined" onClick={async () => {
            setGenieSyncing(true);
            try {
              await api.provisionGenie(project.project_id);
              setMessage('Genie space synced.');
              onSaved();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Genie sync failed');
            } finally {
              setGenieSyncing(false);
            }
          }} busy={genieSyncing} busyLabel="Syncing…">
            Re-sync Genie space
          </BusyButton>
        </Box>
      )}
    </Paper>
  );
}
