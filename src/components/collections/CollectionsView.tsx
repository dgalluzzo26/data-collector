import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import { api } from '../../api/client';
import { useProjects } from '../../hooks/useProjects';
import type { ProjectSummary } from '../../types';
import CreateProjectWizard from './CreateProjectWizard';
import RequestTableDialog from './RequestTableDialog';
import DataEntryUrl from '../common/DataEntryUrl';

export default function CollectionsView() {
  const { projects, loading, error, refresh } = useProjects();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requestTableOpen, setRequestTableOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async (project: ProjectSummary) => {
    if (project.role !== 'admin') return;
    const confirmed = window.confirm(
      `Delete "${project.name}"?\n\nThis removes the form definition, field design, and access settings. Data in the backing table is not deleted.`,
    );
    if (!confirmed) return;

    setDeletingId(project.project_id);
    setDeleteError(null);
    try {
      await api.deleteProject(project.project_id);
      await refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete form');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <div>
          <Typography variant="h4" component="h1" className="page-title" gutterBottom>
            Forms
          </Typography>
          <Typography color="text.secondary">
            Define forms, manage access, and collect data into Unity Catalog.
          </Typography>
        </div>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<EmailOutlinedIcon />}
            onClick={() => setRequestTableOpen(true)}
          >
            Request new table
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
            New form
          </Button>
        </Box>
      </Box>

      {error && (
        <Paper className="page-card" sx={{ p: 2, mb: 2 }}>
          <Typography color="error">{error}</Typography>
        </Paper>
      )}

      {deleteError && (
        <Paper className="page-card" sx={{ p: 2, mb: 2 }}>
          <Typography color="error">{deleteError}</Typography>
        </Paper>
      )}

      <TableContainer component={Paper} className="page-card">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Data entry URL</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Your role</TableCell>
              <TableCell>Storage</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <CircularProgress size={18} />
                    Loading forms…
                  </Box>
                </TableCell>
              </TableRow>
            )}
            {!loading && projects.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  No forms yet. Create one to design fields and start collecting data.
                </TableCell>
              </TableRow>
            )}
            {projects.map((project) => (
              <TableRow key={project.project_id} hover>
                <TableCell>
                  <RouterLink to={`/collections/${project.project_id}`} style={{ fontWeight: 600 }}>
                    {project.name}
                  </RouterLink>
                  {project.description && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      {project.description}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {project.status === 'published' ? (
                    <DataEntryUrl projectId={project.project_id} />
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      Publish first
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Chip size="small" label={project.status} color={project.status === 'published' ? 'success' : 'default'} />
                </TableCell>
                <TableCell>{project.role}</TableCell>
                <TableCell>{project.storage_type}</TableCell>
                <TableCell>
                  {project.updated_at
                    ? new Date(project.updated_at).toLocaleDateString()
                    : new Date(project.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell align="right">
                  {project.role === 'admin' && (
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={`Delete ${project.name}`}
                      disabled={deletingId === project.project_id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(project);
                      }}
                    >
                      {deletingId === project.project_id ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <DeleteIcon fontSize="small" />
                      )}
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <CreateProjectWizard
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={refresh}
      />

      <RequestTableDialog open={requestTableOpen} onClose={() => setRequestTableOpen(false)} />
    </Box>
  );
}
