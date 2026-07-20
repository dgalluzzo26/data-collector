import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { api, ApiPublishError } from '../../api/client';
import { useProject } from '../../hooks/useProjects';
import { clearStagedCsvImport, getStagedCsvImport } from '../../lib/csvFile';
import { designerBaseline, draftFieldsOnly, publishedFields as selectPublishedFields } from '../../lib/designerFields';
import { formatImportResult } from '../../lib/importRecords';
import { showGenieTab } from '../../lib/genie';
import type { FieldDefinition } from '../../types';
import BusyButton from '../common/BusyButton';
import FormDesigner from './FormDesigner';
import AiAssistantPanel from './AiAssistantPanel';
import LookupsPanel from './LookupsPanel';
import MembersPanel from './MembersPanel';
import RecordsPanel from './RecordsPanel';
import StorageSettingsPanel from './StorageSettingsPanel';
import GenieAskPanel from './GenieAskPanel';
import DataEntryUrl from '../common/DataEntryUrl';
import CollectionAccessDenied from '../common/CollectionAccessDenied';

type TabKey = 'records' | 'designer' | 'lookups' | 'members' | 'settings' | 'genie';

type WorkspaceMessage = {
  text: string;
  severity: 'success' | 'warning' | 'error' | 'info';
  title?: string;
  grantSql?: string;
};

const PUBLISH_ACTION_TABS: TabKey[] = ['designer', 'lookups', 'records', 'members', 'settings'];

function WorkspaceMessageBanner({ message }: { message: WorkspaceMessage }) {
  if (message.severity === 'error') {
    return (
      <Box
        role="alert"
        sx={{
          mb: 2,
          p: 2,
          borderRadius: 1,
          border: '2px solid',
          borderColor: 'error.main',
          bgcolor: '#fdecea',
          boxShadow: '0 1px 4px rgba(211, 47, 47, 0.15)',
        }}
      >
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 700, color: 'error.main', mb: message.title ? 0.5 : 0 }}
        >
          {message.title ?? 'Something went wrong'}
        </Typography>
        <Typography sx={{ fontWeight: 700, color: 'error.dark', lineHeight: 1.5 }}>
          {message.text}
        </Typography>
        {message.grantSql ? (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'error.dark', mb: 0.5 }}>
              How to fix (verify access, then ask a catalog admin for GRANTs if needed):
            </Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                borderRadius: 1,
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'error.light',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                lineHeight: 1.45,
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {message.grantSql}
            </Box>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Alert
      severity={message.severity === 'success' ? 'success' : message.severity === 'warning' ? 'warning' : 'info'}
      sx={{ mb: 2, whiteSpace: 'pre-line' }}
    >
      {message.text}
    </Alert>
  );
}

export default function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as TabKey) || 'designer';
  const { project, loading, error, accessDenied, refresh } = useProject(projectId);
  const [draftFields, setDraftFields] = useState<FieldDefinition[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<WorkspaceMessage | null>(null);

  const isAdmin = project?.role === 'admin';
  const canEdit = project?.role === 'admin' || project?.role === 'editor';

  const designerFields = useMemo(() => {
    if (!project) return [];
    return designerBaseline(project, draftFields);
  }, [project, draftFields]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4 }}>
        <CircularProgress size={22} />
        <Typography>Loading project…</Typography>
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
  if (error || !project) return <Typography color="error">{error || 'Project not found'}</Typography>;

  const showGenieTabForProject = showGenieTab(project);
  const setTab = (value: TabKey) => setSearchParams({ tab: value });

  const saveDesign = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api.saveFields(project.project_id, designerFields);
      setDraftFields([]);
      await refresh();
      setMessage({ text: 'Draft saved.', severity: 'success' });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Save failed',
        severity: 'error',
        title: 'Save failed',
      });
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (project.storage_type === 'uc_delta' && !project.record_sync_mode) {
      setMessage({
        title: 'Cannot publish yet',
        text: 'Choose how record changes sync to Unity Catalog in Settings before publishing.',
        severity: 'error',
      });
      setTab('settings');
      return;
    }
    setPublishing(true);
    setMessage(null);
    const shouldImportCsv = searchParams.get('importCsv') === '1';
    const stagedImport = projectId ? getStagedCsvImport(projectId) : null;
    try {
      if (designerFields.length > 0) {
        await api.saveFields(project.project_id, designerFields);
      }
      await api.publishProject(project.project_id);
      setDraftFields([]);
      await refresh();
      setTab('records');
      const storageLabel =
        project.storage_type === 'lakebase' ? 'Lakebase Postgres' : 'Unity Catalog';
      let publishText = `Published to ${storageLabel}.`;
      let publishSeverity: WorkspaceMessage['severity'] = 'success';

      if (shouldImportCsv && stagedImport && projectId) {
        const fieldsForLabels =
          designerFields.length > 0 ? designerFields : selectPublishedFields(project);
        const fieldLabels = Object.fromEntries(
          fieldsForLabels.map((field) => [field.field_key, field.label]),
        );
        try {
          const result = await api.importRecordsCsv(
            project.project_id,
            stagedImport.csv,
            stagedImport.headerRow,
          );
          clearStagedCsvImport(projectId);
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete('importCsv');
          setSearchParams(nextParams);
          if (result.failed.length > 0) {
            publishText = `Published to ${storageLabel}.\n${formatImportResult(result, fieldLabels)}`;
            publishSeverity = 'warning';
          } else {
            publishText = `Published to ${storageLabel} and ${formatImportResult(result, fieldLabels).replace(/^\w/, (c) => c.toLowerCase())}`;
          }
        } catch (importErr) {
          publishText = `Published to ${storageLabel}, but CSV import failed: ${
            importErr instanceof Error ? importErr.message : 'unknown error'
          }`;
          publishSeverity = 'warning';
        }
      }

      setMessage({
        text: publishText,
        severity: publishSeverity,
      });
    } catch (err) {
      const timedOut =
        err instanceof Error && err.message.toLowerCase().includes('timed out');
      if (timedOut && projectId) {
        try {
          const latest = await api.getProject(projectId);
          if (latest.status === 'published') {
            setDraftFields([]);
            setTab('records');
            await refresh();
            setMessage({
              text: 'Publish completed (the request took longer than expected).',
              severity: 'success',
            });
            return;
          }
        } catch {
          // fall through to error message
        }
      }
      setMessage({
        title: 'Publish failed',
        text: err instanceof Error ? err.message : 'Publish failed',
        grantSql: err instanceof ApiPublishError ? err.grantSql : undefined,
        severity: 'error',
      });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link component={RouterLink} to="/collections" underline="hover">
          Forms
        </Link>
        <Typography color="text.primary">{project.name}</Typography>
      </Breadcrumbs>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
        <Box>
          <Typography variant="h4" className="page-title" gutterBottom>
            {project.name}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip size="small" label={project.status} />
            <Chip size="small" variant="outlined" label={`Role: ${project.role}`} />
            <Typography variant="body2" color="text.secondary">
              {project.target_catalog}.{project.target_schema}.{project.target_table}
            </Typography>
          </Box>
          {project.status === 'published' && (
            <Box sx={{ mt: 1.5, maxWidth: 720 }}>
              <DataEntryUrl projectId={project.project_id} variant="full" />
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isAdmin && PUBLISH_ACTION_TABS.includes(tab) && (
            <>
              <BusyButton variant="outlined" onClick={saveDesign} busy={saving} busyLabel="Saving…">
                Save draft
              </BusyButton>
              <BusyButton variant="contained" onClick={publish} busy={publishing} busyLabel="Publishing…">
                Publish
              </BusyButton>
            </>
          )}
          <Button variant="outlined" onClick={() => navigate('/collections')}>
            Back
          </Button>
        </Box>
      </Box>

      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
        <Tab value="designer" label="Form designer" />
        <Tab value="lookups" label="Lookup tables" />
        <Tab value="records" label="Records" disabled={project.status !== 'published' && !canEdit} />
        {showGenieTabForProject && (
          <Tab value="genie" label="Genie Q&A" disabled={project.status !== 'published'} />
        )}
        <Tab value="members" label="Members" disabled={!isAdmin} />
        <Tab value="settings" label="Settings" disabled={!isAdmin} />
      </Tabs>

      {message && <WorkspaceMessageBanner message={message} />}

      {tab === 'designer' && (
        <Box>
          {project.status === 'published' && draftFieldsOnly(project).length === 0 && draftFields.length === 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Showing the published form. Edits are saved as a draft — click Publish when ready.
            </Alert>
          )}
          {isAdmin && (
            <AiAssistantPanel
              project={project}
              draftFields={designerFields}
              onApplied={async () => {
                setDraftFields([]);
                await refresh();
                setMessage({ text: 'AI changes applied to draft.', severity: 'info' });
              }}
            />
          )}
          <FormDesigner
            fields={designerFields}
            lookups={project.lookups || []}
            onChange={setDraftFields}
            readOnly={!isAdmin}
          />
        </Box>
      )}

      {tab === 'lookups' && (
        <LookupsPanel project={project} isAdmin={!!isAdmin} onChanged={refresh} />
      )}

      {tab === 'records' && (
        <RecordsPanel project={project} canEdit={!!canEdit} onChanged={refresh} />
      )}
      {tab === 'genie' && showGenieTabForProject && (
        <GenieAskPanel project={project} isAdmin={!!isAdmin} />
      )}
      {tab === 'members' && isAdmin && <MembersPanel project={project} onChanged={refresh} />}
      {tab === 'settings' && isAdmin && (
        <StorageSettingsPanel project={project} onSaved={refresh} />
      )}
    </Box>
  );
}
