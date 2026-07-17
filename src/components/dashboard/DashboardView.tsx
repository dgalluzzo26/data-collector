import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid2';
import StorageIcon from '@mui/icons-material/Storage';
import DesignServicesIcon from '@mui/icons-material/DesignServices';
import TableChartIcon from '@mui/icons-material/TableChart';
import { useEffect, useState } from 'react';
import { useProjects } from '../../hooks/useProjects';

interface HealthResponse {
  status: string;
  app: string;
  catalog: string;
  schema: string;
}

export default function DashboardView() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { projects } = useProjects();

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <Box>
      <Typography variant="h4" component="h1" className="page-title" gutterBottom>
        Welcome to Brick Constructor
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3, maxWidth: '42rem' }}>
        Design SharePoint-style lists and Google Forms-style collectors, then store responses
        directly in Unity Catalog with role-based access and audit columns.
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { icon: <DesignServicesIcon color="primary" />, title: 'Design', desc: 'Build forms with validation and dropdowns' },
          { icon: <TableChartIcon color="primary" />, title: 'Collect', desc: 'Enter and edit records in table or form view' },
          { icon: <StorageIcon color="primary" />, title: 'Store', desc: 'Publish schemas to Delta tables in Unity Catalog' },
        ].map(({ icon, title, desc }) => (
          <Grid key={title} size={{ xs: 12, md: 4 }}>
            <Paper className="page-card" sx={{ p: 2.5, height: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                {icon}
                <Typography variant="h6">{title}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">{desc}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Paper className="page-card" sx={{ p: 2.5, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Your forms
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {projects.length === 0
            ? 'No forms yet — create your first form to start designing fields.'
            : `${projects.length} form${projects.length === 1 ? '' : 's'} available.`}
        </Typography>
        <Button component={RouterLink} to="/collections" variant="contained">
          Open forms
        </Button>
      </Paper>

      <Paper className="page-card" sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          API status
        </Typography>
        {health && (
          <Typography variant="body2" color="text.secondary">
            {health.app} on <strong>{health.catalog}.{health.schema}</strong>: {health.status}
          </Typography>
        )}
        {error && (
          <Typography variant="body2" color="error">
            Backend unreachable — start the API with <code>npm run dev:all</code>. ({error})
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
