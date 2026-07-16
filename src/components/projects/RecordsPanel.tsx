import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useLookupOptions } from '../../hooks/useLookupOptions';
import { useInvalidateRecords, useRecords } from '../../hooks/useRecords';
import { publishedFields as selectPublishedFields } from '../../lib/designerFields';
import { buildRecordGridColumns } from '../../lib/recordGridColumns';
import type { ProjectDetail, RecordAuditEntry, RecordRow } from '../../types';
import { validateRecordValues } from '../../lib/recordValidation';
import BusyButton from '../common/BusyButton';
import DynamicForm from './DynamicForm';

interface RecordsPanelProps {
  project: ProjectDetail;
  canEdit: boolean;
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

export default function RecordsPanel({ project, canEdit }: RecordsPanelProps) {
  const publishedFields = useMemo(
    () => selectPublishedFields(project).sort((a, b) => a.sort_order - b.sort_order),
    [project.fields, project.schema_version],
  );
  const recordsEnabled = project.status === 'published';
  const {
    data: records = [],
    isLoading,
    isFetching,
    refetch,
  } = useRecords(project.project_id, recordsEnabled, project.schema_version);
  const invalidateRecords = useInvalidateRecords();
  const { data: lookupOptions = {} } = useLookupOptions(
    project.project_id,
    publishedFields,
    project.lookups,
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [auditLog, setAuditLog] = useState<RecordAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const refreshRecords = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const syncRecords = useCallback(async () => {
    await invalidateRecords(project.project_id, project.schema_version);
  }, [invalidateRecords, project.project_id, project.schema_version]);

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
        await syncRecords();
      } finally {
        setDeleting(false);
      }
    },
    [project.project_id, syncRecords],
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

  const readCsvFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });

  const exportCsv = async () => {
    setImportMessage(null);
    await api.exportRecords(project.project_id, `${project.slug}_records.csv`);
  };

  const importCsv = async (file: File) => {
    setImporting(true);
    setImportMessage(null);
    try {
      const csv = await readCsvFile(file);
      const result = await api.importRecordsCsv(project.project_id, csv);
      const failedCount = result.failed.length;
      if (failedCount === 0) {
        setImportMessage(`Imported ${result.created} record${result.created === 1 ? '' : 's'}.`);
      } else {
        const detail = result.failed
          .slice(0, 3)
          .map((failed) => `row ${failed.row}`)
          .join(', ');
        const suffix = failedCount > 3 ? ` (+${failedCount - 3} more)` : '';
        setImportMessage(
          `Imported ${result.created}; ${failedCount} row${failedCount === 1 ? '' : 's'} failed (${detail}${suffix}).`,
        );
      }
      await syncRecords();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'CSV import failed');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const save = async () => {
    const errors = validateRecordValues(publishedFields, formValues, lookupAllowed);
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
      await syncRecords();
    } catch (err) {
      if (err instanceof ApiValidationError) {
        setFieldErrors(err.fieldErrors);
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
          {canEdit && (
            <>
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importCsv(file);
                }}
              />
              <BusyButton
                variant="outlined"
                size="small"
                startIcon={<UploadIcon />}
                onClick={() => importFileRef.current?.click()}
                busy={importing}
                busyLabel="Importing…"
              >
                Import CSV
              </BusyButton>
              <Button variant="contained" size="small" onClick={openNew}>
                New record
              </Button>
            </>
          )}
        </Box>
      </Box>

      {importMessage && (
        <Alert severity={importMessage.includes('failed') ? 'warning' : 'success'} onClose={() => setImportMessage(null)}>
          {importMessage}
        </Alert>
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
    </Box>
  );
}
