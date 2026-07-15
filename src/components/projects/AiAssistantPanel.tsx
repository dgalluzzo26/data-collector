import { useMemo, useState } from 'react';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import { designerBaseline } from '../../lib/designerFields';
import type { FieldDefinition, LookupProposal, ProjectDetail } from '../../types';
import BusyButton from '../common/BusyButton';

interface AiAssistantPanelProps {
  project: ProjectDetail;
  draftFields: FieldDefinition[];
  onApplied: () => void;
}

function lookupsToProposals(project: ProjectDetail): LookupProposal[] {
  return (project.lookups || []).map((lookup) => ({
    name: lookup.name,
    slug: lookup.slug,
    description: lookup.description,
    columns: lookup.columns,
    rows: [],
  }));
}

export default function AiAssistantPanel({ project, draftFields, onApplied }: AiAssistantPanelProps) {
  const [open, setOpen] = useState(true);
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    name: string;
    description?: string | null;
    fields: FieldDefinition[];
    lookups: LookupProposal[];
  } | null>(null);

  const currentFields = designerBaseline(project, draftFields);

  const newLookupCount = useMemo(() => {
    if (!preview) return 0;
    const existing = new Set((project.lookups || []).map((l) => l.slug));
    return preview.lookups.filter((l) => !existing.has(l.slug)).length;
  }, [preview, project.lookups]);

  const refine = async () => {
    if (!instruction.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.refineProject(project.project_id, {
        instruction: instruction.trim(),
        name: project.name,
        description: project.description,
        fields: currentFields,
        lookups: lookupsToProposals(project),
      });
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI refinement failed');
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setLoading(true);
    setError(null);
    try {
      await api.applyProjectProposal(project.project_id, {
        name: preview.name,
        description: preview.description || undefined,
        fields: preview.fields,
        lookups: preview.lookups,
      });
      setPreview(null);
      setInstruction('');
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply changes');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper className="page-card" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesomeIcon color="primary" fontSize="small" />
          <Typography variant="subtitle1" fontWeight={600}>
            AI assistant
          </Typography>
        </Box>
        <Button size="small" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      </Box>

      <Collapse in={open}>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          Ask AI to add fields, change labels, or adjust the form. Review before applying — nothing publishes automatically.
        </Typography>

        {loading && <LinearProgress sx={{ mb: 2 }} />}

        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          label="Instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder='e.g. "Add a required phone number field and make department a lookup"'
          sx={{ mb: 1 }}
        />
        <BusyButton
          size="small"
          variant="outlined"
          startIcon={<AutoAwesomeIcon />}
          onClick={refine}
          busy={loading}
          busyLabel="Generating…"
          disabled={!instruction.trim()}
          sx={{ mb: 2 }}
        >
          Generate changes
        </BusyButton>

        {preview && (
          <Box sx={{ bgcolor: 'background.default', borderRadius: 1, p: 2, mb: 1 }}>
            <Typography variant="subtitle2" gutterBottom>
              Proposed changes
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              {preview.fields.map((f) => (
                <Chip key={f.field_key} size="small" label={`${f.label} (${f.field_type})`} />
              ))}
            </Box>
            {newLookupCount > 0 && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                + {newLookupCount} new lookup table(s)
              </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <BusyButton size="small" variant="contained" onClick={apply} busy={loading} busyLabel="Applying…">
                Apply
              </BusyButton>
              <Button size="small" onClick={() => setPreview(null)} disabled={loading}>
                Discard
              </Button>
            </Box>
          </Box>
        )}

        {error && (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        )}
      </Collapse>
    </Paper>
  );
}
