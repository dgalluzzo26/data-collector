import { useEffect, useState } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import { api } from '../../api/client';
import type { StorageType } from '../../types';

function withCurrentOption(options: string[], current: string): string[] {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

interface StorageSchemaSelectProps {
  storageType: StorageType;
  catalog: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  helperText?: string;
  label?: string;
}

export default function StorageSchemaSelect({
  storageType,
  catalog,
  value,
  onChange,
  disabled = false,
  helperText,
  label = 'Schema',
}: StorageSchemaSelectProps) {
  const [schemas, setSchemas] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const catalogValue = catalog.trim();
    if (storageType !== 'uc_delta' || !catalogValue || disabled) {
      setSchemas([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .listUcCatalogSchemas(catalogValue)
      .then((result) => {
        if (!cancelled) setSchemas(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setSchemas([]);
          setError(err instanceof Error ? err.message : 'Failed to load schemas');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [storageType, catalog, disabled]);

  if (storageType === 'lakebase') {
    return (
      <TextField
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        helperText={helperText ?? 'Postgres schema (created on publish if missing)'}
        size="small"
      />
    );
  }

  const schemaOptions = withCurrentOption(schemas, value);
  const catalogReady = catalog.trim().length > 0;

  return (
    <FormControl size="small" disabled={disabled || !catalogReady || loading} fullWidth>
      <InputLabel id="storage-schema-label">{label}</InputLabel>
      <Select
        labelId="storage-schema-label"
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        endAdornment={loading ? <CircularProgress size={16} sx={{ mr: 2 }} /> : undefined}
      >
        {schemaOptions.length === 0 && (
          <MenuItem value="" disabled>
            {loading ? 'Loading schemas…' : catalogReady ? 'No schemas found' : 'Enter a catalog first'}
          </MenuItem>
        )}
        {schemaOptions.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </Select>
      {(helperText || error) && (
        <FormHelperText error={Boolean(error)}>{error ?? helperText}</FormHelperText>
      )}
    </FormControl>
  );
}
