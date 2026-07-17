import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import type { AppConfig } from '../../types';
import BrandingAdminPanel from './BrandingAdminPanel';

function ConfigRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <TableRow>
      <TableCell sx={{ width: '40%', fontWeight: 600 }}>{label}</TableCell>
      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
        {value || '—'}
      </TableCell>
    </TableRow>
  );
}

export default function SettingsView() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <Box>
      <Typography variant="h4" component="h1" className="page-title" gutterBottom>
        Settings
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Live runtime configuration for this deployment (from <code>app.yaml</code> env vars and
        Databricks App resources).
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load runtime config: {error}
        </Alert>
      )}

      {config?.db_status === 'error' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Database connection failed: {config.db_error}
        </Alert>
      )}

      {config?.is_app_admin && <BrandingAdminPanel />}

      <Paper className="page-card" sx={{ p: 2.5, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Runtime values
        </Typography>
        <Table size="small">
          <TableBody>
            <ConfigRow label="Runtime" value={config?.runtime} />
            <ConfigRow label="Signed-in user" value={config?.user_email} />
            <ConfigRow label="Metadata catalog" value={config?.catalog} />
            <ConfigRow label="Metadata schema" value={config?.schema} />
            <ConfigRow label="Metadata FQN" value={config?.metadata_fqn} />
            <ConfigRow label="Default data catalog" value={config?.default_data_catalog} />
            <ConfigRow label="Default data schema" value={config?.default_data_schema} />
            <ConfigRow label="SQL warehouse id" value={config?.warehouse_id} />
            <ConfigRow label="SQL warehouse HTTP path" value={config?.warehouse_http_path} />
            <ConfigRow label="Database status" value={config?.db_status} />
            <ConfigRow label="Lakebase configured" value={config?.lakebase_configured ? 'yes' : 'no'} />
            <ConfigRow label="Lakebase database" value={config?.lakebase_database} />
            <ConfigRow label="Lakebase default schema" value={config?.lakebase_default_schema} />
          </TableBody>
        </Table>
      </Paper>

      <Paper className="page-card" sx={{ p: 2.5 }}>
        <Typography variant="subtitle2" gutterBottom>
          Local development
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Copy <code>.env.example</code> to <code>.env</code> and set{' '}
          <code>DATABRICKS_HOST</code>, <code>DATABRICKS_TOKEN</code>, and{' '}
          <code>DATABRICKS_WAREHOUSE_ID</code>. Set <code>DEV_USER_EMAIL</code> to your workspace
          email so local forms match the deployed app. Set <code>APP_ADMIN_EMAILS</code> to
          your email (comma-separated) to edit app branding in Settings.
        </Typography>
      </Paper>
    </Box>
  );
}
