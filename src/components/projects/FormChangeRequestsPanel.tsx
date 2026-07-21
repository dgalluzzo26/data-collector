import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import type { FieldDefinition, FormChangeRequest, ProjectDetail } from '../../types';
import BusyButton from '../common/BusyButton';

interface FormChangeRequestsPanelProps {
  project: ProjectDetail;
  proposedFields: FieldDefinition[];
  isAdmin: boolean;
  isEditor: boolean;
  onChanged: () => Promise<void>;
}

function statusLabel(status: FormChangeRequest['status']): string {
  switch (status) {
    case 'pending':
      return 'Pending review';
    case 'draft':
      return 'Approved (in draft)';
    case 'rejected':
      return 'Rejected';
    case 'published':
      return 'Published';
    default:
      return status;
  }
}

function statusColor(status: FormChangeRequest['status']): 'default' | 'warning' | 'success' | 'error' {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'draft':
      return 'success';
    case 'rejected':
      return 'error';
    default:
      return 'default';
  }
}

export default function FormChangeRequestsPanel({
  project,
  proposedFields,
  isAdmin,
  isEditor,
  onChanged,
}: FormChangeRequestsPanelProps) {
  const { user } = useCurrentUser();
  const [requests, setRequests] = useState<FormChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorMessage, setEditorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actingOnId, setActingOnId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.listChangeRequests(project.project_id);
      setRequests(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load change requests');
    } finally {
      setLoading(false);
    }
  }, [project.project_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(() => requests.filter((r) => r.status === 'pending'), [requests]);
  const myPending = useMemo(
    () => pending.find((r) => r.requested_by.toLowerCase() === user?.email.toLowerCase()),
    [pending, user?.email],
  );

  const submitRequest = async () => {
    if (!proposedFields.length) {
      setError('Add at least one field before submitting a change request.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.createChangeRequest(project.project_id, proposedFields, editorMessage || undefined);
      setEditorMessage('');
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit change request');
    } finally {
      setSubmitting(false);
    }
  };

  const approve = async (requestId: string) => {
    setActingOnId(requestId);
    setError(null);
    try {
      await api.approveChangeRequest(project.project_id, requestId, reviewNote || undefined);
      setReviewNote('');
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve change request');
    } finally {
      setActingOnId(null);
    }
  };

  const reject = async (requestId: string) => {
    setActingOnId(requestId);
    setError(null);
    try {
      await api.rejectChangeRequest(project.project_id, requestId, reviewNote || undefined);
      setReviewNote('');
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject change request');
    } finally {
      setActingOnId(null);
    }
  };

  const withdraw = async (requestId: string) => {
    setActingOnId(requestId);
    setError(null);
    try {
      await api.withdrawChangeRequest(project.project_id, requestId);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to withdraw change request');
    } finally {
      setActingOnId(null);
    }
  };

  if (!isAdmin && !isEditor) return null;

  return (
    <Paper className="page-card" sx={{ p: 2, mb: 2 }}>
      <Typography variant="h6" gutterBottom>
        Form change requests
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {isEditor && !isAdmin
          ? 'Propose updates to the form layout. An admin will review and merge approved changes into the draft.'
          : 'Review editor proposals and merge approved changes into the draft form.'}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {isEditor && !isAdmin && (
        <Box sx={{ mb: 2 }}>
          <TextField
            label="Note for admin (optional)"
            value={editorMessage}
            onChange={(e) => setEditorMessage(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 1.5 }}
          />
          <BusyButton
            variant="contained"
            onClick={submitRequest}
            busy={submitting}
            busyLabel="Submitting…"
          >
            Submit change request
          </BusyButton>
          {myPending && (
            <Button
              sx={{ ml: 1 }}
              onClick={() => withdraw(myPending.request_id)}
              disabled={actingOnId === myPending.request_id}
            >
              Withdraw pending request
            </Button>
          )}
        </Box>
      )}

      {isAdmin && pending.length > 0 && (
        <TextField
          label="Review note (optional)"
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          sx={{ mb: 2 }}
        />
      )}

      {loading ? (
        <Typography variant="body2" color="text.secondary">
          Loading change requests…
        </Typography>
      ) : requests.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No change requests yet.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {requests.map((req) => (
            <Paper key={req.request_id} variant="outlined" sx={{ p: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="subtitle2">
                    {req.requested_by} · {new Date(req.requested_at).toLocaleString()}
                  </Typography>
                  {req.message && (
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      {req.message}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    {req.proposed_fields.length} field(s) proposed
                  </Typography>
                </Box>
                <Chip size="small" label={statusLabel(req.status)} color={statusColor(req.status)} />
              </Box>

              {isAdmin && req.status === 'pending' && (
                <Box sx={{ mt: 1.5, display: 'flex', gap: 1 }}>
                  <BusyButton
                    size="small"
                    variant="contained"
                    onClick={() => approve(req.request_id)}
                    busy={actingOnId === req.request_id}
                    busyLabel="Approving…"
                  >
                    Approve
                  </BusyButton>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    onClick={() => reject(req.request_id)}
                    disabled={actingOnId === req.request_id}
                  >
                    Reject
                  </Button>
                </Box>
              )}
            </Paper>
          ))}
        </Box>
      )}
    </Paper>
  );
}
