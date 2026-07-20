import { useEffect, useMemo, useRef, useState } from 'react';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import LinkIcon from '@mui/icons-material/Link';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { api } from '../../api/client';
import { CSV_MAX_SIZE_HELP, csvFileSizeError, readCsvFile } from '../../lib/csvFile';
import type { LookupProposal, LookupRow, LookupTable, ProjectDetail } from '../../types';
import BusyButton from '../common/BusyButton';
import BindLookupDialog from './BindLookupDialog';

const US_STATES_SAMPLE = `AL,Alabama
AK,Alaska
AZ,Arizona
AR,Arkansas
CA,California
CO,Colorado
CT,Connecticut
DE,Delaware
FL,Florida
GA,Georgia`;

interface LookupsPanelProps {
  project: ProjectDetail;
  isAdmin: boolean;
  onChanged: () => void;
}

export default function LookupsPanel({ project, isAdmin, onChanged }: LookupsPanelProps) {
  const [lookups, setLookups] = useState<LookupTable[]>(project.lookups || []);
  const [editorOpen, setEditorOpen] = useState(false);
  const [activeLookup, setActiveLookup] = useState<LookupTable | null>(null);
  const [rows, setRows] = useState<LookupRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProposal, setAiProposal] = useState<LookupProposal | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const newLookupFileRef = useRef<HTMLInputElement>(null);
  const editorFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLookups(project.lookups || []);
  }, [project.lookups]);

  const columns: GridColDef[] = useMemo(() => {
    if (!activeLookup) return [];
    const editable = isAdmin && activeLookup.source !== 'uc_bind';
    return activeLookup.columns.map((col) => ({
      field: col.key,
      headerName: col.label,
      flex: 1,
      editable,
    }));
  }, [activeLookup, isAdmin]);

  const createLookup = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.createLookup(project.project_id, {
        name: newName.trim(),
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Name' },
        ],
      });
      setNewName('');
      onChanged();
    } finally {
      setCreating(false);
    }
  };

  const openEditor = async (lookup: LookupTable) => {
    setActiveLookup(lookup);
    const data = await api.getLookupRows(project.project_id, lookup.lookup_id);
    setRows(data);
    setEditorOpen(true);
  };

  const lookupSourceLabel = (lookup: LookupTable) => {
    if (lookup.source === 'uc_bind' && lookup.source_catalog && lookup.source_schema && lookup.source_table) {
      return `${lookup.source_catalog}.${lookup.source_schema}.${lookup.source_table}`;
    }
    return lookup.source;
  };

  const loadSampleStates = () => {
    const parsed: LookupRow[] = US_STATES_SAMPLE.split('\n').map((line, idx) => {
      const [code, name] = line.split(',');
      return {
        row_id: `sample-${idx}`,
        values: { code: code.trim(), name: name.trim() },
        sort_order: idx,
      };
    });
    setRows(parsed);
  };

  const saveRows = async () => {
    if (!activeLookup) return;
    setSaving(true);
    try {
      const gridRows = rows.map((r, idx) => ({ ...r, sort_order: idx }));
      await api.saveLookupRows(project.project_id, activeLookup.lookup_id, gridRows);
      setEditorOpen(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const deleteLookup = async (lookupId: string) => {
    await api.deleteLookup(project.project_id, lookupId);
    onChanged();
  };

  const generateLookup = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const proposal = await api.generateLookup(project.project_id, aiPrompt.trim());
      setAiProposal(proposal);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI generation failed');
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiLookup = async () => {
    if (!aiProposal) return;
    setAiLoading(true);
    try {
      await api.applyLookupProposal(project.project_id, aiProposal);
      setAiProposal(null);
      setAiPrompt('');
      onChanged();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to apply lookup');
    } finally {
      setAiLoading(false);
    }
  };

  const importNewLookupCsv = async (file: File) => {
    const sizeError = csvFileSizeError(file);
    if (sizeError) {
      setAiError(sizeError);
      if (newLookupFileRef.current) newLookupFileRef.current.value = '';
      return;
    }
    const name =
      newName.trim() || file.name.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported lookup';
    setImporting(true);
    try {
      const csv = await readCsvFile(file);
      await api.importLookupCsv(project.project_id, name, csv);
      setNewName('');
      onChanged();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'CSV import failed');
    } finally {
      setImporting(false);
      if (newLookupFileRef.current) newLookupFileRef.current.value = '';
    }
  };

  const importEditorCsv = async (file: File) => {
    if (!activeLookup) return;
    const sizeError = csvFileSizeError(file);
    if (sizeError) {
      setAiError(sizeError);
      if (editorFileRef.current) editorFileRef.current.value = '';
      return;
    }
    if (!window.confirm('Replace all rows with this CSV? Current rows will be overwritten.')) {
      if (editorFileRef.current) editorFileRef.current.value = '';
      return;
    }
    setImporting(true);
    try {
      const csv = await readCsvFile(file);
      const imported = await api.importLookupRowsCsv(project.project_id, activeLookup.lookup_id, csv);
      setRows(imported);
      onChanged();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'CSV import failed');
    } finally {
      setImporting(false);
      if (editorFileRef.current) editorFileRef.current.value = '';
    }
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Lookup tables
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Reference data for dropdown fields (states, codes, categories). Generate with AI or create manually.
      </Typography>

      {isAdmin && (
        <Paper className="page-card" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <AutoAwesomeIcon fontSize="small" color="primary" />
            Generate lookup with AI
          </Typography>
          {aiLoading && <LinearProgress sx={{ mb: 1 }} />}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <TextField
              size="small"
              fullWidth
              label="Describe the lookup"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="US states with 2-letter abbreviations"
              multiline
              minRows={2}
            />
            <BusyButton
              variant="outlined"
              onClick={generateLookup}
              busy={aiLoading}
              busyLabel="Generating…"
              disabled={!aiPrompt.trim()}
              sx={{ mt: '8px', whiteSpace: 'nowrap' }}
            >
              Generate
            </BusyButton>
          </Box>
          {aiProposal && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>{aiProposal.name}</strong> — {aiProposal.rows.length} rows
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <BusyButton size="small" variant="contained" onClick={applyAiLookup} busy={aiLoading} busyLabel="Applying…">
                  Apply
                </BusyButton>
                <Button size="small" onClick={() => setAiProposal(null)} disabled={aiLoading}>
                  Discard
                </Button>
              </Box>
            </Box>
          )}
          {aiError && (
            <Alert severity="error" sx={{ mt: 1 }} onClose={() => setAiError(null)}>
              {aiError}
            </Alert>
          )}
        </Paper>
      )}

      {isAdmin && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="New lookup name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) void createLookup();
            }}
            placeholder="e.g. US States"
            helperText={newName.trim() ? ' ' : 'Enter a name to enable Create'}
            sx={{ minWidth: 280 }}
          />
          <BusyButton
            variant="contained"
            onClick={createLookup}
            busy={creating}
            busyLabel="Creating…"
            disabled={!newName.trim()}
            sx={{ mt: '8px' }}
          >
            Create lookup
          </BusyButton>
          <BusyButton
            variant="outlined"
            startIcon={<UploadFileIcon />}
            busy={importing}
            busyLabel="Importing…"
            sx={{ mt: '8px' }}
            onClick={() => newLookupFileRef.current?.click()}
          >
            Import CSV
          </BusyButton>
          <Button
            variant="outlined"
            startIcon={<LinkIcon />}
            sx={{ mt: '8px' }}
            onClick={() => setBindOpen(true)}
          >
            Bind UC table
          </Button>
          <input
            ref={newLookupFileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importNewLookupCsv(file);
            }}
          />
        </Box>
      )}

      {isAdmin && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          {CSV_MAX_SIZE_HELP}
        </Typography>
      )}

      <Table size="small" component={Paper} className="page-card">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Slug</TableCell>
            <TableCell>Rows</TableCell>
            <TableCell>Source</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lookups.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>No lookup tables yet.</TableCell>
            </TableRow>
          )}
          {lookups.map((lookup) => (
            <TableRow key={lookup.lookup_id}>
              <TableCell>{lookup.name}</TableCell>
              <TableCell>{lookup.slug}</TableCell>
              <TableCell>{lookup.row_count}</TableCell>
              <TableCell>{lookupSourceLabel(lookup)}</TableCell>
              <TableCell align="right">
                <IconButton size="small" onClick={() => openEditor(lookup)} aria-label="Edit rows">
                  <EditIcon fontSize="small" />
                </IconButton>
                {isAdmin && (
                  <IconButton size="small" color="error" onClick={() => deleteLookup(lookup.lookup_id)} aria-label="Delete">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{activeLookup?.name} — rows</DialogTitle>
        <DialogContent>
          {activeLookup?.source === 'uc_bind' ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Read-only — bound to{' '}
              <strong>
                {activeLookup.source_catalog}.{activeLookup.source_schema}.{activeLookup.source_table}
              </strong>
              . Rows are loaded live from Unity Catalog.
            </Typography>
          ) : (
            isAdmin && (
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <Button size="small" onClick={loadSampleStates}>
                  Load sample US states
                </Button>
                <Button
                  size="small"
                  startIcon={<UploadFileIcon />}
                  onClick={() => editorFileRef.current?.click()}
                  disabled={importing}
                >
                  Import CSV
                </Button>
                <input
                  ref={editorFileRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importEditorCsv(file);
                  }}
                />
              </Box>
            )
          )}
          <Box sx={{ height: 360 }}>
            <DataGrid
              rows={rows.map((r) => ({ id: r.row_id, ...r.values }))}
              columns={columns}
              processRowUpdate={(newRow) => {
                if (activeLookup?.source === 'uc_bind') return newRow;
                setRows((prev) =>
                  prev.map((r) =>
                    r.row_id === newRow.id
                      ? { ...r, values: { ...r.values, ...newRow, id: undefined } }
                      : r,
                  ),
                );
                return newRow;
              }}
              onProcessRowUpdateError={() => {}}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditorOpen(false)}>Close</Button>
          {isAdmin && activeLookup?.source !== 'uc_bind' && (
            <BusyButton variant="contained" onClick={saveRows} busy={saving} busyLabel="Saving…">
              Save rows
            </BusyButton>
          )}
        </DialogActions>
      </Dialog>

      <BindLookupDialog
        open={bindOpen}
        project={project}
        onClose={() => setBindOpen(false)}
        onBound={onChanged}
      />
    </Box>
  );
}
