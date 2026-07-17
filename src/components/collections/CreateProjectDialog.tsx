import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
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
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import type { FieldDefinition, StorageType, UcTablePreview } from '../../types';
import BusyButton from '../common/BusyButton';
import UcTableSelector from '../common/UcTableSelector';

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

type CreationMode = 'new_table' | 'existing_uc_table';

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

function guessRecordKeyColumn(keys: string[]): string {
  const idLike = keys.find((k) => /(^id$|_id$|^.*_key$)/i.test(k));
  return idLike ?? keys[0] ?? '';
}

export default function CreateProjectDialog({ open, onClose, onCreated }: CreateProjectDialogProps) {
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
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<Set<string>>(new Set());
  const [recordKeyColumn, setRecordKeyColumn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectableColumns = useMemo(
    () => (tablePreview?.columns ?? []).filter((col) => !col.key.startsWith('_')),
    [tablePreview],
  );

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
    setSelectedColumnKeys(new Set());
    setRecordKeyColumn('');
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

    setSaving(true);
    setError(null);
    try {
      const seedFields =
        creationMode === 'existing_uc_table' && tablePreview
          ? buildSeedFields(tablePreview, selectedColumnKeys, recordKeyColumn)
          : undefined;

      await api.createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        storage_type: creationMode === 'existing_uc_table' ? 'uc_delta' : storageType,
        storage_mode: creationMode === 'existing_uc_table' ? 'existing_uc' : 'managed',
        record_key_column: creationMode === 'existing_uc_table' ? recordKeyColumn : undefined,
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
      reset();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setSaving(false);
    }
  };

  const canCreate =
    name.trim().length > 0 &&
    (creationMode === 'new_table' ||
      (tablePreview !== null && selectedColumnKeys.size > 0 && recordKeyColumn.length > 0));

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
              setSelectedColumnKeys(new Set());
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
              </Box>
            )}
          </Box>
        ) : (
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
                  onChange={(e) => setTargetCatalog(e.target.value)}
                  size="small"
                  disabled={storageType === 'lakebase'}
                  helperText={storageType === 'lakebase' ? 'From Lakebase app resource (PGDATABASE)' : undefined}
                />
                <TextField
                  label="Schema"
                  value={targetSchema}
                  onChange={(e) => setTargetSchema(e.target.value)}
                  size="small"
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
