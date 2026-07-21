import { useCallback, useEffect, useMemo, useState } from 'react';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import UploadIcon from '@mui/icons-material/Upload';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import { api, ApiValidationError } from '../../api/client';
import { useLookupOptions, useLookupRows } from '../../hooks/useLookupOptions';
import { useInvalidateRecords, useRecords } from '../../hooks/useRecords';
import { publishedFields as selectPublishedFields } from '../../lib/designerFields';
import { buildRecordGridColumns } from '../../lib/recordGridColumns';
import { formatImportResult } from '../../lib/importRecords';
import type { ProjectDetail, RecordAuditEntry, RecordRow } from '../../types';
import { validateRecordValues } from '../../lib/recordValidation';
import BusyButton from '../common/BusyButton';
import DynamicForm from './DynamicForm';
import RecordCsvImportDialog from './RecordCsvImportDialog';

interface RecordsPanelProps {
  project: ProjectDetail;
  canEdit: boolean;
  onChanged?: () => void;
}

function formatAuditValue(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  return value;
}

function describeAuditEntry(entry: RecordAuditEntry): string {
  const label = entry.field_label ?? entry.field_key ?? 'Record';
  if (entry.old_value == null && entry.new_value != null) {
    return `${label} set to "${formatAuditValue(entry.new_value)}"`;
  }
  if (entry.old_value != null && entry.new_value == null) {
    return `${label} cleared (was "${formatAuditValue(entry.old_value)}")`;
  }
  return `${label} changed from "${formatAuditValue(entry.old_value)}" to "${formatAuditValue(entry.new_value)}"`;
}

function formatAuditTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function RecordsPanel({ project, canEdit, onChanged }: RecordsPanelProps) {
  const recordPageLimit = 500;
  const publishedFields = useMemo(
    () => selectPublishedFields(project).sort((a, b) => a.sort_order - b.sort_order),
    [project.fields, project.schema_version],
  );
  const fieldLabels = useMemo(
    () => Object.fromEntries(publishedFields.map((field) => [field.field_key, field.label])),
    [publishedFields],
  );
  const recordsEnabled = project.status === 'published';
  const isStagedSync =
    project.storage_type === 'uc_delta' && project.record_sync_mode === 'staged';
  const pendingChanges = project.staged_change_count ?? 0;
  const {
    data: records = [],
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useRecords(project.project_id, recordsEnabled, project.schema_version, {
    limit: recordPageLimit,
  });
  const recordsTruncated = records.length >= recordPageLimit;
  const invalidateRecords = useInvalidateRecords();
  const { data: lookupOptions = {} } = useLookupOptions(
    project.project_id,
    publishedFields,
    project.lookups,
  );
  const { data: lookupRowsById = {} } = useLookupRows(project.project_id, publishedFields);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [auditLog, setAuditLog] = useState<RecordAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refreshAll = useCallback(async () => {
    await invalidateRecords(project.project_id, project.schema_version);
    await onChanged?.();
  }, [invalidateRecords, onChanged, project.project_id, project.schema_version]);

  const refreshRecords = useCallback(async () => {
    await refetch();
  }, [refetch]);


  useEffect(() => {
    if (!editing) {
      setAuditLog([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setAuditLoading(true);
      try {
        const log = await api.getRecordAudit(project.project_id, editing.record_id);
        if (!cancelled) setAuditLog(log);
      } finally {
        if (!cancelled) setAuditLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editing, project.project_id]);

  const lockedFields = useMemo(() => {
    if (!editing || !project.record_key_column) return undefined;
    return new Set([project.record_key_column]);
  }, [editing, project.record_key_column]);

  const gridRows = useMemo(
    () =>
      records.map((record) => ({
        id: record.record_id,
        created_by: record.created_by ?? '',
        updated_by: record.updated_by ?? '',
        ...record.values,
      })),
    [records],
  );

  const lookupAllowed = useMemo(() => {
    const allowed: Record<string, Set<string>> = {};
    for (const field of publishedFields) {
      if (field.field_type !== 'lookup' || !field.config_json?.lookup_id) continue;
      const options = lookupOptions[field.field_key] ?? [];
      allowed[field.field_key] = new Set(options.map((option) => option.value).filter(Boolean));
    }
    return allowed;
  }, [publishedFields, lookupOptions]);

  const removeRecord = useCallback(
    async (recordId: string) => {
      if (!window.confirm('Delete this record? This cannot be undone.')) return;
      setDeleting(true);
      try {
        await api.deleteRecord(project.project_id, recordId);
        setEditing((current) => {
          if (current?.record_id === recordId) {
            setDrawerOpen(false);
            return null;
          }
          return current;
        });
        await refreshAll();
      } finally {
        setDeleting(false);
      }
    },
    [project.project_id, refreshAll],
  );

  const columns = useMemo(
    () =>
      buildRecordGridColumns(publishedFields, lookupOptions, {
        canEdit,
        onDelete: (recordId) => void removeRecord(recordId),
      }),
    [publishedFields, lookupOptions, canEdit, removeRecord],
  );

  const openNew = () => {
    setEditing(null);
    setFormValues({});
    setFieldErrors({});
    setDrawerOpen(true);
  };

  const openEdit = (row: RecordRow) => {
    setEditing(row);
    setFormValues(row.values);
    setFieldErrors({});
    setImportMessage(null);
    setDrawerOpen(true);
  };

  const exportCsv = async () => {
    setImportMessage(null);
    await api.exportRecords(project.project_id, `${project.slug}_records.csv`);
  };

  const syncToUc = async () => {
    if (!window.confirm(`Apply ${pendingChanges} staged change(s) to Unity Catalog?`)) return;
    setSyncing(true);
    setImportMessage(null);
    try {
      const result = await api.syncRecordsToUc(project.project_id);
      setImportMessage(
        `Synced ${result.synced} change${result.synced === 1 ? '' : 's'} to Unity Catalog (${result.inserted} inserted, ${result.updated} updated, ${result.deleted} deleted).`,
      );
      await refreshAll();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'Sync to Unity Catalog failed');
    } finally {
      setSyncing(false);
    }
  };

  const save = async () => {
    const errors = validateRecordValues(publishedFields, formValues, lookupAllowed, lookupRowsById);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      if (editing) {
        await api.updateRecord(project.project_id, editing.record_id, formValues);
      } else {
        await api.createRecord(project.project_id, formValues);
      }
      setDrawerOpen(false);
      setFieldErrors({});
      setAuditLog([]);
      await refreshAll();
    } catch (err) {
      if (err instanceof ApiValidationError) {
        setFieldErrors(err.fieldErrors);
      } else if (err instanceof Error) {
        const key = project.record_key_column;
        if (key && !editing) {
          setFieldErrors({ [key]: err.message });
        } else {
          setImportMessage(err.message);
        }
      } else {
        throw err;
      }
    } finally {
      setSaving(false);
    }
  };

  if (project.status !== 'published') {
    return (
      <Box className="page-card" sx={{ p: 3 }}>
        <Typography color="text.secondary">
          Publish the form design before collecting records.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 480 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h6">Records</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Tooltip title="Refresh records">
            <span>
              <IconButton
                size="small"
                aria-label="Refresh records"
                onClick={() => void refreshRecords()}
                disabled={isFetching}
              >
                {isFetching ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={() => void exportCsv()}
          >
            Export CSV
          </Button>
          {canEdit && isStagedSync && (
            <BusyButton
              variant="contained"
              color="secondary"
              size="small"
              onClick={() => void syncToUc()}
              busy={syncing}
              busyLabel="Syncing…"
              disabled={pendingChanges === 0}
            >
              Sync to UC{pendingChanges > 0 ? ` (${pendingChanges})` : ''}
            </BusyButton>
          )}
          {canEdit && (
            <>
              <Button
                variant="outlined"
                size="small"
                startIcon={<UploadIcon />}
                onClick={() => setImportDialogOpen(true)}
              >
                Import CSV
              </Button>
              <Button variant="contained" size="small" onClick={openNew}>
                New record
              </Button>
            </>
          )}
        </Box>
      </Box>

      {isStagedSync && (
        <Alert severity="info">
          Changes are staged locally and are not written to Unity Catalog until you click Sync to UC.
          {pendingChanges > 0
            ? ` ${pendingChanges} pending change${pendingChanges === 1 ? '' : 's'}.`
            : ' No pending changes.'}
        </Alert>
      )}

      {importMessage && (
        <Alert
          severity={importMessage.includes('failed') ? 'warning' : 'success'}
          onClose={() => setImportMessage(null)}
          sx={{ whiteSpace: 'pre-line' }}
        >
          {importMessage}
        </Alert>
      )}

      {isError && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        >
          Failed to load records: {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      )}

      {recordsTruncated && (
        <Typography variant="body2" color="text.secondary">
          Showing the first {recordPageLimit} records. Export CSV for a larger extract (up to 5,000 rows).
        </Typography>
      )}

      <Box sx={{ minHeight: 480 }}>
        <DataGrid
          key={`records-${project.schema_version}-${publishedFields.length}`}
          rows={gridRows}
          columns={columns}
          loading={isLoading}
          onRowClick={(params) => {
            const record = records.find((row) => row.record_id === params.id);
            if (record && canEdit) openEdit(record);
          }}
          disableRowSelectionOnClick
          sortingMode="client"
          filterMode="client"
          slots={{ toolbar: GridToolbar }}
          slotProps={{
            toolbar: {
              showQuickFilter: true,
              quickFilterProps: { debounceMs: 300 },
            },
          }}
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
          sx={{ height: 560, width: '100%' }}
        />
      </Box>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)} PaperProps={{ sx: { width: 420, p: 3 } }}>
        <Typography variant="h6" gutterBottom>
          {editing ? 'Edit record' : 'New record'}
        </Typography>
        <DynamicForm
          projectId={project.project_id}
          fields={publishedFields}
          lookups={project.lookups}
          values={formValues}
          onChange={(values) => {
            setFormValues(values);
            setFieldErrors({});
          }}
          readOnly={!canEdit}
          lockedFields={lockedFields}
          errors={fieldErrors}
        />
        {editing && (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" gutterBottom>
              Change history
            </Typography>
            {auditLoading ? (
              <CircularProgress size={20} />
            ) : auditLog.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No changes recorded yet.
              </Typography>
            ) : (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {auditLog.map((entry, idx) => (
                  <Box component="li" key={`${entry.changed_at}-${entry.field_key ?? 'record'}-${idx}`} sx={{ mb: 1 }}>
                    <Typography variant="body2">{describeAuditEntry(entry)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {entry.changed_by} · {formatAuditTime(entry.changed_at)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}
        <Box sx={{ display: 'flex', gap: 1, mt: 3, justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <BusyButton variant="contained" onClick={save} busy={saving} busyLabel="Saving…" disabled={!canEdit}>
              Save
            </BusyButton>
            <Button onClick={() => setDrawerOpen(false)}>Cancel</Button>
          </Box>
          {editing && canEdit && (
            <BusyButton
              color="error"
              onClick={() => removeRecord(editing.record_id)}
              busy={deleting}
              busyLabel="Deleting…"
            >
              Delete
            </BusyButton>
          )}
        </Box>
      </Drawer>

      <RecordCsvImportDialog
        open={importDialogOpen}
        projectId={project.project_id}
        recordKeyColumn={project.record_key_column}
        onClose={() => setImportDialogOpen(false)}
        onImported={async (result) => {
          setImportMessage(formatImportResult(result, fieldLabels));
          await refreshAll();
        }}
      />
    </Box>
  );
}
