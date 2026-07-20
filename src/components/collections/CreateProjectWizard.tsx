import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/Step';
import Stepper from '@mui/material/Stepper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import type { ProjectBlueprint } from '../../types';
import BusyButton from '../common/BusyButton';
import CreateProjectDialog from './CreateProjectDialog';

interface CreateProjectWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const STEPS = ['Describe', 'Review draft', 'Create'];

export default function CreateProjectWizard({ open, onClose, onCreated }: CreateProjectWizardProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [description, setDescription] = useState('');
  const [proposal, setProposal] = useState<ProjectBlueprint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const reset = () => {
    setStep(0);
    setDescription('');
    setProposal(null);
    setError(null);
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const generate = async () => {
    if (description.trim().length < 10) return;
    setLoading(true);
    setError(null);
    try {
      const draft = await api.generateProject(description.trim());
      setProposal(draft);
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI generation failed');
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!proposal) return;
    setLoading(true);
    setError(null);
    try {
      const project = await api.createFromProposal(proposal);
      onCreated();
      handleClose();
      navigate(`/collections/${project.project_id}?tab=designer`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create form');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesomeIcon color="primary" />
          New form with AI
        </DialogTitle>
        <DialogContent>
          <Stepper activeStep={step} sx={{ mb: 3, mt: 1 }}>
            {STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {loading && <LinearProgress sx={{ mb: 2 }} />}

          {step === 0 && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Describe what you want to collect. AI will draft the form fields and lookup tables.
              </Typography>
              <TextField
                label="What do you want to collect?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                multiline
                minRows={5}
                fullWidth
                autoFocus
                placeholder="Example: Employee onboarding form with full name, work email, start date, department dropdown, and US state lookup."
                helperText={
                  description.trim().length < 10
                    ? 'Enter at least 10 characters to generate a draft'
                    : 'Press Generate draft when ready'
                }
              />
            </Box>
          )}

          {step === 1 && proposal && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {proposal.name}
              </Typography>
              {proposal.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {proposal.description}
                </Typography>
              )}

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Fields ({proposal.fields.length})
              </Typography>
              <List dense sx={{ bgcolor: 'background.paper', borderRadius: 1, mb: 2 }}>
                {proposal.fields.map((field) => (
                  <ListItem key={field.field_key}>
                    <ListItemText
                      primary={field.label}
                      secondary={`${field.field_type}${field.is_required ? ' · required' : ''}`}
                    />
                  </ListItem>
                ))}
              </List>

              {proposal.lookups.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Lookup tables ({proposal.lookups.length})
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                    {proposal.lookups.map((lookup) => (
                      <Chip
                        key={lookup.slug}
                        label={`${lookup.name} (${lookup.rows.length} rows)`}
                        size="small"
                      />
                    ))}
                  </Box>
                </>
              )}

              <Typography variant="caption" color="text.secondary">
                You can edit everything after creating the form. Nothing is published until you click Publish.
              </Typography>
            </Box>
          )}

          {error && (
            <Typography color="error" sx={{ mt: 2 }}>
              {error}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
          <Button
            size="small"
            onClick={() => {
              handleClose();
              setManualOpen(true);
            }}
          >
            Create manually instead
          </Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button onClick={handleClose}>Cancel</Button>
            {step === 0 && (
              <BusyButton
                variant="contained"
                onClick={generate}
                busy={loading}
                busyLabel="Generating…"
                disabled={description.trim().length < 10}
                startIcon={<AutoAwesomeIcon />}
              >
                Generate draft
              </BusyButton>
            )}
            {step === 1 && (
              <>
                <Button onClick={() => setStep(0)} disabled={loading}>
                  Back
                </Button>
                <BusyButton variant="contained" onClick={create} busy={loading} busyLabel="Creating…">
                  Create form
                </BusyButton>
              </>
            )}
          </Box>
        </DialogActions>
      </Dialog>

      <CreateProjectDialog
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onCreated={() => {
          setManualOpen(false);
          onCreated();
        }}
      />
    </>
  );
}
