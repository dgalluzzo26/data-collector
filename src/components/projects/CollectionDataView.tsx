import { useEffect } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import SettingsIcon from '@mui/icons-material/Settings';
import { useProject } from '../../hooks/useProjects';
import { collectionAdminPath } from '../../lib/collectionPaths';
import { showGenieTab } from '../../lib/genie';
import type { CollectionDataTab } from '../../lib/collectionPaths';
import CollectionAccessDenied from '../common/CollectionAccessDenied';
import GenieAskPanel from './GenieAskPanel';
import RecordsPanel from './RecordsPanel';

export default function CollectionDataView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as CollectionDataTab) || 'records';
  const { project, loading, error, accessDenied, refresh } = useProject(projectId);

  useEffect(() => {
    if (projectId) {
      void refresh();
    }
  }, [projectId, refresh]);

  const setTab = (value: CollectionDataTab) => setSearchParams({ tab: value });

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, minHeight: '60vh' }}>
        <CircularProgress size={22} />
        <Typography>Loading form…</Typography>
      </Box>
    );
  }

  if (accessDenied) {
    return (
      <CollectionAccessDenied
        collectionName={accessDenied.collectionName}
        adminEmails={accessDenied.adminEmails}
      />
    );
  }

  if (error || !project) {
    return (
      <Box sx={{ p: 4, maxWidth: 720, mx: 'auto' }}>
        <Typography color="error">{error || 'Form not found'}</Typography>
        <Button component={RouterLink} to="/collections" sx={{ mt: 2 }}>
          Back to forms
        </Button>
      </Box>
    );
  }

  const canEdit = project.role === 'admin' || project.role === 'editor';
  const isAdmin = project.role === 'admin';
  const showGenieTabForProject = showGenieTab(project);
  const roleLabel =
    project.role === 'admin' ? 'Editor (admin)' : project.role === 'editor' ? 'Editor' : 'Viewer';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'var(--app-chrome-bg)' }}>
      <Box
        component="header"
        sx={{
          px: { xs: 2, md: 3 },
          py: 2,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ maxWidth: 1200, mx: 'auto', display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1 }}>
              Data entry
            </Typography>
            <Typography variant="h5" component="h1" fontWeight={700}>
              {project.name}
            </Typography>
            {project.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 560 }}>
                {project.description}
              </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              <Chip size="small" variant="outlined" label={roleLabel} />
              {project.status !== 'published' && <Chip size="small" color="warning" label="Not published" />}
            </Box>
          </Box>
          {isAdmin && (
            <Button
              component={RouterLink}
              to={collectionAdminPath(project.project_id)}
              variant="outlined"
              size="small"
              startIcon={<SettingsIcon />}
              sx={{ alignSelf: 'flex-start' }}
            >
              Form setup
            </Button>
          )}
        </Box>
      </Box>

      <Box component="main" sx={{ px: { xs: 2, md: 3 }, py: 3, maxWidth: 1200, mx: 'auto' }}>
        {project.status !== 'published' && (
          <Alert severity="info" sx={{ mb: 2 }}>
            This form is not published yet. An admin must publish it before records can be collected.
            {isAdmin && (
              <>
                {' '}
                <Link component={RouterLink} to={collectionAdminPath(project.project_id, 'designer')}>
                  Open form setup
                </Link>
              </>
            )}
          </Alert>
        )}

        <Tabs value={tab} onChange={(_, value) => setTab(value as CollectionDataTab)} sx={{ mb: 2 }}>
          <Tab value="records" label="Records" disabled={project.status !== 'published' && !canEdit} />
          {showGenieTabForProject && (
            <Tab value="genie" label="Genie Q&A" disabled={project.status !== 'published'} />
          )}
        </Tabs>

        {tab === 'records' && <RecordsPanel project={project} canEdit={canEdit} onChanged={refresh} />}
        {tab === 'genie' && showGenieTabForProject && (
          <GenieAskPanel project={project} isAdmin={isAdmin} />
        )}
      </Box>
    </Box>
  );
}
