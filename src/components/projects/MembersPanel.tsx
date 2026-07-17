import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../api/client';
import type { ProjectDetail, WorkspaceUser } from '../../types';
import BusyButton from '../common/BusyButton';

interface MembersPanelProps {
  project: ProjectDetail;
  onChanged: () => void;
}

export default function MembersPanel({ project, onChanged }: MembersPanelProps) {
  const [selectedUser, setSelectedUser] = useState<WorkspaceUser | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [userOptions, setUserOptions] = useState<WorkspaceUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [role, setRole] = useState('reader');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const memberEmails = useMemo(
    () => new Set(project.members.map((member) => member.user_email.toLowerCase())),
    [project.members],
  );

  const loadUsers = useCallback(
    async (query: string) => {
      setSearching(true);
      setSearchError(null);
      try {
        const users = await api.searchWorkspaceUsers(project.project_id, query);
        setUserOptions(
          users.filter((user) => !memberEmails.has(user.email.toLowerCase())),
        );
      } catch (err) {
        setUserOptions([]);
        setSearchError(err instanceof Error ? err.message : 'Could not search workspace users');
      } finally {
        setSearching(false);
      }
    },
    [memberEmails, project.project_id],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadUsers(inputValue.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [inputValue, loadUsers]);

  const add = async () => {
    const email = selectedUser?.email || inputValue.trim().toLowerCase();
    if (!email) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await api.addMember(project.project_id, email, role);
      const notices: string[] = [];
      if (result.app_access_granted && result.app_access_note) {
        notices.push(result.app_access_note);
      } else if (result.app_access_note) {
        notices.push(result.app_access_note);
      }
      if (result.uc_access_granted && result.uc_access_note) {
        notices.push(result.uc_access_note);
      } else if (result.uc_access_note) {
        notices.push(result.uc_access_note);
      }
      if (notices.length) {
        setNotice(notices.join(' '));
      }
      setSelectedUser(null);
      setInputValue('');
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (memberEmail: string) => {
    setRemoving(memberEmail);
    try {
      await api.removeMember(project.project_id, memberEmail);
      onChanged();
    } finally {
      setRemoving(null);
    }
  };

  const canAdd = Boolean(selectedUser?.email || inputValue.trim());

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Members
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Search workspace users to add. New members are automatically granted Can use on this app when
        needed. For Unity Catalog forms, the app may also grant UC table access when hybrid mode
        is enabled.
      </Typography>

      {notice && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {searchError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {searchError} You can still type a full email address manually.
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Autocomplete
          sx={{ flex: 1, minWidth: 280 }}
          size="small"
          options={userOptions}
          value={selectedUser}
          inputValue={inputValue}
          loading={searching}
          onChange={(_, value) => setSelectedUser(value)}
          onInputChange={(_, value) => setInputValue(value)}
          getOptionLabel={(option) =>
            option.display_name ? `${option.display_name} (${option.email})` : option.email
          }
          isOptionEqualToValue={(option, value) => option.email === value.email}
          noOptionsText={searching ? 'Searching…' : 'No matching workspace users'}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Workspace user"
              placeholder="Search by name or email"
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {searching ? <CircularProgress color="inherit" size={18} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
        <TextField
          select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          size="small"
          sx={{ width: 140 }}
        >
          <MenuItem value="admin">Admin</MenuItem>
          <MenuItem value="editor">Editor</MenuItem>
          <MenuItem value="reader">Reader</MenuItem>
        </TextField>
        <BusyButton variant="contained" onClick={add} busy={saving} busyLabel="Adding…" disabled={!canAdd}>
          Add
        </BusyButton>
      </Box>

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Email</TableCell>
            <TableCell>Role</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {project.members.map((member) => (
            <TableRow key={member.user_email}>
              <TableCell>{member.user_email}</TableCell>
              <TableCell>{member.role}</TableCell>
              <TableCell align="right">
                <BusyButton
                  size="small"
                  color="error"
                  onClick={() => remove(member.user_email)}
                  busy={removing === member.user_email}
                  busyLabel="Removing…"
                >
                  Remove
                </BusyButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
