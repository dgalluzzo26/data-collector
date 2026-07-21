import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import { api } from '../../api/client';
import BusyButton from '../common/BusyButton';

interface RequestTableDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function RequestTableDialog({ open, onClose }: RequestTableDialogProps) {
  const [tableName, setTableName] = useState('');
  const [catalog, setCatalog] = useState('');
  const [schemaName, setSchemaName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reset = () => {
    setTableName('');
    setCatalog('');
    setSchemaName('');
    setDescription('');
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const name = tableName.trim();
    if (!name) {
      setError('Table name is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.requestTableConstruction({
        table_name: name,
        catalog: catalog.trim() || undefined,
        schema_name: schemaName.trim() || undefined,
        description: description.trim() || undefined,
      });

      if (!result.sent && result.mailto_url) {
        window.location.href = result.mailto_url;
      }

      setSuccess(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Request new table construction</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          This sends a request to the Brick Constructor administrators to create a new Unity Catalog
          table for your form data.
        </Alert>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}
        <TextField
          label="Table name"
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          fullWidth
          required
          sx={{ mb: 2 }}
          placeholder="employee_onboarding_data"
        />
        <TextField
          label="Catalog (optional)"
          value={catalog}
          onChange={(e) => setCatalog(e.target.value)}
          fullWidth
          sx={{ mb: 2 }}
        />
        <TextField
          label="Schema (optional)"
          value={schemaName}
          onChange={(e) => setSchemaName(e.target.value)}
          fullWidth
          sx={{ mb: 2 }}
        />
        <TextField
          label="Details for administrator (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          minRows={3}
          placeholder="Describe the purpose, expected columns, or access needs."
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose}>Cancel</Button>
        <BusyButton
          variant="contained"
          startIcon={<EmailOutlinedIcon />}
          onClick={submit}
          busy={submitting}
          busyLabel="Sending…"
          disabled={Boolean(success)}
        >
          Send request
        </BusyButton>
      </DialogActions>
    </Dialog>
  );
}
