import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { api, ApiValidationError } from '../../api/client';
import { publishedFields as selectPublishedFields } from '../../lib/designerFields';
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
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listRecords(project.project_id);
      setRecords(rows);
    } finally {
      setLoading(false);
    }
  }, [project.project_id]);

  useEffect(() => {
    if (project.status !== 'published') {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await api.listRecords(project.project_id);
        if (!cancelled) setRecords(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.project_id, project.status, project.schema_version]);

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
      records.map((r) => ({
        id: r.record_id,
        created_by: r.created_by ?? '',
        updated_by: r.updated_by ?? '',
        ...r.values,
      })),
    [records],
  );

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
        await refresh();
      } finally {
        setDeleting(false);
      }
    },
    [project.project_id, refresh],
  );

  const columns: GridColDef[] = useMemo(() => {
    const cols: GridColDef[] = publishedFields.map((field) => ({
      field: field.field_key,
      headerName: field.label,
      flex: 1,
      minWidth: 120,
    }));
    cols.push(
      { field: 'created_by', headerName: 'Created by', width: 160 },
      { field: 'updated_by', headerName: 'Updated by', width: 160 },
    );
    if (canEdit) {
      cols.push({
        field: '_actions',
        headerName: '',
        width: 56,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: (params) => (
          <IconButton
            size="small"
            color="error"
            aria-label="Delete record"
            onClick={(e) => {
              e.stopPropagation();
              void removeRecord(String(params.id));
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        ),
      });
    }
    return cols;
  }, [publishedFields, canEdit, removeRecord]);

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
          .map((f) => `row ${f.row}`)
          .join(', ');
        const suffix = failedCount > 3 ? ` (+${failedCount - 3} more)` : '';
        setImportMessage(
          `Imported ${result.created}; ${failedCount} row${failedCount === 1 ? '' : 's'} failed (${detail}${suffix}).`,
        );
      }
      await refresh();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'CSV import failed');
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const buildLookupAllowed = async (): Promise<Record<string, Set<string>>> => {
    const allowed: Record<string, Set<string>> = {};
    for (const field of publishedFields) {
      if (field.field_type !== 'lookup' || !field.config_json?.lookup_id) continue;
      const valueCol = (field.config_json.value_column as string) || 'code';
      const rows = await api.getLookupRows(project.project_id, field.config_json.lookup_id as string);
      allowed[field.field_key] = new Set(
        rows.map((r) => String(r.values[valueCol] ?? '')).filter(Boolean),
      );
    }
    return allowed;
  };

  const save = async () => {
    const lookupAllowed = await buildLookupAllowed();
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
      await refresh();
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
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
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
          loading={loading}
          onRowClick={(params) => {
            const record = records.find((r) => r.record_id === params.id);
            if (record && canEdit) openEdit(record);
          }}
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          sx={{ height: 520, width: '100%' }}
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
