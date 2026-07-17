import { useCallback, useEffect, useState } from 'react';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import type { GenieAskResponse, GenieStatus, ProjectDetail } from '../../types';
import BusyButton from '../common/BusyButton';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  response?: GenieAskResponse;
}

interface GenieAskPanelProps {
  project: ProjectDetail;
  isAdmin: boolean;
}

export default function GenieAskPanel({ project, isAdmin }: GenieAskPanelProps) {
  const [status, setStatus] = useState<GenieStatus | null>(null);
  const [question, setQuestion] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const s = await api.getGenieStatus(project.project_id);
    setStatus(s);
  }, [project.project_id]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, project.genie_status, project.genie_space_id]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    setAsking(true);
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setQuestion('');
    try {
      const response = await api.askGenie(project.project_id, q, conversationId ?? undefined);
      setConversationId(response.conversation_id);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: response.answer_text || 'No text response.', response },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Question failed';
      setError(msg);
      setMessages((prev) => [...prev, { role: 'assistant', text: msg }]);
    } finally {
      setAsking(false);
    }
  };

  const reprovision = async () => {
    setProvisioning(true);
    setError(null);
    try {
      const s = await api.provisionGenie(project.project_id);
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Genie sync failed');
    } finally {
      setProvisioning(false);
    }
  };

  const ready = status?.ready ?? false;
  const suggested = messages.length > 0
    ? messages[messages.length - 1].response?.suggested_questions ?? []
    : ['How many records are in this form?', 'Show all records'];

  return (
    <Paper className="page-card" sx={{ p: 2.5, display: 'flex', flexDirection: 'column', minHeight: 560 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <AutoAwesomeIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600}>
          Ask about data
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Natural-language questions over this form&apos;s published table, powered by Databricks Genie.
      </Typography>

      {!ready && (
        <Alert
          severity={status?.status === 'error' ? 'error' : 'info'}
          sx={{ mb: 2 }}
          action={
            isAdmin ? (
              <BusyButton size="small" onClick={reprovision} busy={provisioning} busyLabel="Syncing…">
                {status?.space_id ? 'Re-sync' : 'Enable'}
              </BusyButton>
            ) : undefined
          }
        >
          {status?.status === 'error'
            ? status.error || 'Genie setup failed.'
            : 'Genie is not ready yet. Publish the form or ask an admin to sync Genie.'}
        </Alert>
      )}

      {error && ready && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', mb: 2, display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 320 }}>
        {messages.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Try a suggested question below or type your own.
          </Typography>
        )}
        {messages.map((msg, idx) => (
          <Box
            key={`${msg.role}-${idx}`}
            sx={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '95%',
              bgcolor: msg.role === 'user' ? 'primary.main' : 'background.default',
              color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
              px: 1.5,
              py: 1,
              borderRadius: 1,
            }}
          >
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {msg.text}
            </Typography>
            {msg.response?.sql && (
              <Typography variant="caption" component="pre" sx={{ mt: 1, opacity: 0.8, overflow: 'auto' }}>
                {msg.response.sql}
              </Typography>
            )}
            {msg.response && msg.response.columns.length > 0 && msg.response.rows.length > 0 && (
              <Box sx={{ mt: 1, overflow: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {msg.response.columns.map((col) => (
                        <TableCell key={col}>{col}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {msg.response.rows.slice(0, 20).map((row, rowIdx) => (
                      <TableRow key={rowIdx}>
                        {row.map((cell, cellIdx) => (
                          <TableCell key={cellIdx}>{String(cell ?? '')}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {ready && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          {suggested.slice(0, 3).map((q) => (
            <Chip
              key={q}
              size="small"
              label={q}
              onClick={() => void ask(q)}
              disabled={asking}
              variant="outlined"
            />
          ))}
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder={ready ? 'Ask a question about your records…' : 'Genie not ready'}
          value={question}
          disabled={!ready || asking}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <BusyButton variant="contained" onClick={() => ask(question)} busy={asking} busyLabel="Asking…" disabled={!ready}>
          Ask
        </BusyButton>
      </Box>
    </Paper>
  );
}
