import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import type { LakebaseSettings } from '../../types';

type LakebaseDataApiPanelProps = {
  onSaved?: () => void;
};

export default function LakebaseDataApiPanel({ onSaved }: LakebaseDataApiPanelProps) {
  const [settings, setSettings] = useState<LakebaseSettings | null>(null);
  const [dataApiUrl, setDataApiUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLakebaseSettings()
      .then((loaded) => {
        setSettings(loaded);
        setDataApiUrl(loaded.data_api_url ?? '');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await api.updateLakebaseSettings({ data_api_url: dataApiUrl });
      setSettings(saved);
      setDataApiUrl(saved.data_api_url ?? '');
      setMessage('Lakebase Data API URL saved.');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Lakebase settings');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await api.updateLakebaseSettings({ clear_data_api_url: true });
      setSettings(saved);
      setDataApiUrl('');
      setMessage('Lakebase Data API link cleared.');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear Lakebase settings');
    } finally {
      setSaving(false);
    }
  };

  const isDirty = (settings?.data_api_url ?? '') !== dataApiUrl.trim();

  return (
    <Paper className="page-card" sx={{ p: 2.5, mb: 2 }}>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        Lakebase Data API
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Paste the Data API base URL from your Lakebase project (Data API → API tab). The app uses
        Databricks OAuth for requests — no token is stored here. Ensure the schema used by
        collections (for example <code>data_collector</code>) is exposed in Data API advanced
        settings if you use HTTP access later.
      </Typography>

      {message && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={2}>
        <TextField
          label="Data API URL"
          size="small"
          fullWidth
          value={dataApiUrl}
          onChange={(e) => setDataApiUrl(e.target.value)}
          disabled={loading || saving}
          placeholder="https://…"
          helperText="Copy from Lakebase → Data API → API tab"
          slotProps={{
            input: {
              sx: { fontFamily: 'monospace', fontSize: '0.85rem' },
            },
          }}
        />
        <Stack direction="row" spacing={1}>
          <Button variant="contained" disabled={loading || saving || !isDirty} onClick={handleSave}>
            Save
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            disabled={loading || saving || !settings?.data_api_url}
            onClick={handleClear}
          >
            Clear
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
