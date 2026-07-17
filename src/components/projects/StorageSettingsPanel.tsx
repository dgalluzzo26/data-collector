import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import { hasSyncLocation, showGenieTab } from '../../lib/genie';
import type { AppConfig, ProjectDetail, RecordSyncMode, StorageType } from '../../types';
import BusyButton from '../common/BusyButton';

interface StorageSettingsPanelProps {
  project: ProjectDetail;
  onSaved: () => void;
}

export default function StorageSettingsPanel({ project, onSaved }: StorageSettingsPanelProps) {
  const [storageType, setStorageType] = useState<StorageType>(project.storage_type);
  const [catalog, setCatalog] = useState(project.target_catalog ?? '');
  const [schema, setSchema] = useState(project.target_schema ?? '');
  const [table, setTable] = useState(project.target_table ?? '');
  const [syncCatalog, setSyncCatalog] = useState(project.sync_catalog ?? '');
  const [syncSchema, setSyncSchema] = useState(project.sync_schema ?? '');
  const [syncTable, setSyncTable] = useState(project.sync_table ?? '');
  const [recordSyncMode, setRecordSyncMode] = useState<RecordSyncMode | ''>(
    project.record_sync_mode ?? '',
  );
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [lakebaseConfigured, setLakebaseConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingSync, setSavingSync] = useState(false);
  const [savingSyncMode, setSavingSyncMode] = useState(false);
  const [genieSyncing, setGenieSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDraft = project.status === 'draft';
  const isLakebase = storageType === 'lakebase';
  const isUc = (isDraft ? storageType : project.storage_type) === 'uc_delta';
  const ucAccessMode = appConfig?.uc_data_access_mode ?? 'hybrid';
  const ucAccessModeLabel =
    ucAccessMode === 'hybrid'
      ? 'Hybrid (app SP for managed tables; user token for existing UC tables)'
      : ucAccessMode === 'service_principal'
        ? 'Service principal (app runs all UC data SQL)'
        : 'User on-behalf-of (all UC data SQL as signed-in user)';

  useEffect(() => {
    setStorageType(project.storage_type);
    setCatalog(project.target_catalog ?? '');
    setSchema(project.target_schema ?? '');
    setTable(project.target_table ?? '');
    setSyncCatalog(project.sync_catalog ?? '');
    setSyncSchema(project.sync_schema ?? '');
    setSyncTable(project.sync_table ?? '');
    setRecordSyncMode(project.record_sync_mode ?? '');
  }, [
    project.storage_type,
    project.target_catalog,
    project.target_schema,
    project.target_table,
    project.sync_catalog,
    project.sync_schema,
    project.sync_table,
    project.record_sync_mode,
  ]);

  useEffect(() => {
    void api.getConfig().then((cfg) => {
      setAppConfig(cfg);
      setLakebaseConfigured(Boolean(cfg.lakebase_configured));
    });
  }, []);

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

  const saveSyncLocation = async () => {
    setSavingSync(true);
    setMessage(null);
    setError(null);
    try {
      await api.updateProject(project.project_id, {
        sync_catalog: syncCatalog.trim(),
        sync_schema: syncSchema.trim(),
        sync_table: syncTable.trim(),
      });
      setMessage('UC sync location saved.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingSync(false);
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

  const storageLabel = isLakebase
    ? `${catalog}.${schema}.${table}`
    : `${project.target_catalog}.${project.target_schema}.${project.target_table}`;

  const syncLabel = hasSyncLocation(project)
    ? `${project.sync_catalog}.${project.sync_schema}.${project.sync_table}`
    : null;
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

      {!isDraft && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Storage location is locked after publish. Current table: <strong>{storageLabel}</strong>
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label={isLakebase ? 'Database' : 'Catalog'}
          value={catalog}
          onChange={(e) => setCatalog(e.target.value)}
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
        <TextField
          label="Schema"
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
          disabled={!isDraft}
          helperText={
            isDraft
              ? isLakebase
                ? 'Postgres schema (created on publish if missing)'
                : `Default for new forms: ${appConfig?.default_data_schema || '…'}`
              : undefined
          }
          size="small"
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

      {isUc && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" gutterBottom>
            Unity Catalog record updates
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose how editor changes are written to the backing UC table. This is required before
            you can publish.
          </Typography>
          {!isDraft && project.record_sync_mode && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Mode locked after publish:{' '}
              <strong>
                {project.record_sync_mode === 'immediate'
                  ? 'Write directly to Unity Catalog'
                  : 'Stage locally, then bulk sync'}
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
                label="Write changes directly to Unity Catalog"
              />
              <FormHelperText sx={{ mt: -1, mb: 1, ml: 4 }}>
                Each create, edit, or delete updates the UC table immediately.
              </FormHelperText>
              <FormControlLabel
                value="staged"
                control={<Radio />}
                label="Stage changes locally, then bulk sync to UC"
              />
              <FormHelperText sx={{ mt: -1, mb: 1, ml: 4 }}>
                Editors work against local staged changes. An admin or editor syncs them to UC in one
                batch from the Records tab.
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

      {isLakebase && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" gutterBottom>
            Unity Catalog sync location
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Configure Lakebase → Unity Catalog sync outside this app (Lakehouse Sync or UC registration).
            Enter the UC catalog, schema, and table where synced data appears to enable Genie Q&amp;A.
          </Typography>
          {!isDraft && syncLabel && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Current sync location: <strong>{syncLabel}</strong>
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Sync catalog"
              value={syncCatalog}
              onChange={(e) => setSyncCatalog(e.target.value)}
              size="small"
              helperText={`Default data catalog: ${appConfig?.default_data_catalog || '…'}`}
            />
            <TextField
              label="Sync schema"
              value={syncSchema}
              onChange={(e) => setSyncSchema(e.target.value)}
              size="small"
            />
            <TextField
              label="Sync table"
              value={syncTable}
              onChange={(e) => setSyncTable(e.target.value)}
              size="small"
              helperText="UC table name after sync (may differ from the Postgres table name)"
            />
          </Box>
          <Box sx={{ mt: 2 }}>
            <BusyButton variant="outlined" onClick={saveSyncLocation} busy={savingSync} busyLabel="Saving…">
              Save sync location
            </BusyButton>
          </Box>
        </Box>
      )}

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
