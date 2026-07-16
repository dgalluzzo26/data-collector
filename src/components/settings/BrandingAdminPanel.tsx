import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useBranding } from '../../branding/BrandingProvider';
import { applyBrandingToDocument } from '../../lib/branding';
import { defaultBrandLogos } from '../../lib/brandingLogos';
import {
  BRANDING_PALETTES,
  CUSTOM_PALETTE_ID,
  applyPalettePreset,
  detectPaletteId,
} from '../../lib/brandingPresets';
import type { AppBranding, BrandingChrome, BrandingColorSet } from '../../types';

const MAX_LOGO_BYTES = 500 * 1024;

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const hex = value.startsWith('#') ? value : '#005288';
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <TextField
        label={label}
        size="small"
        fullWidth
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value.startsWith('#') && (
        <input
          type="color"
          aria-label={`${label} picker`}
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 40, height: 40, border: 'none', background: 'transparent', cursor: 'pointer' }}
        />
      )}
    </Stack>
  );
}

function PaletteSwatch({ colors }: { colors: string[] }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
      {colors.map((color) => (
        <Box
          key={color}
          sx={{
            width: 14,
            height: 14,
            borderRadius: '2px',
            bgcolor: color,
            border: '1px solid rgba(0,0,0,0.12)',
          }}
        />
      ))}
    </Stack>
  );
}

function ColorSetFields({
  title,
  colors,
  onChange,
}: {
  title: string;
  colors: BrandingColorSet;
  onChange: (next: BrandingColorSet) => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (key: keyof BrandingColorSet, value: string) =>
    onChange({ ...colors, [key]: value });

  return (
    <Box>
      <Button
        size="small"
        endIcon={
          <ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : undefined, transition: '0.2s' }} />
        }
        onClick={() => setOpen((v) => !v)}
        sx={{ mb: 1 }}
      >
        {title}
      </Button>
      <Collapse in={open}>
        <Stack spacing={1.5}>
          {(Object.keys(colors) as (keyof BrandingColorSet)[]).map((key) => (
            <ColorField
              key={key}
              label={key.replace(/_/g, ' ')}
              value={colors[key]}
              onChange={(v) => set(key, v)}
            />
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

function ChromeFields({
  chrome,
  onChange,
}: {
  chrome: BrandingChrome;
  onChange: (next: BrandingChrome) => void;
}) {
  const [open, setOpen] = useState(true);
  const set = (key: keyof BrandingChrome, value: string) =>
    onChange({ ...chrome, [key]: value });

  return (
    <Box>
      <Button
        size="small"
        endIcon={
          <ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : undefined, transition: '0.2s' }} />
        }
        onClick={() => setOpen((v) => !v)}
        sx={{ mb: 1 }}
      >
        Header & sidebar (chrome)
      </Button>
      <Collapse in={open}>
        <Stack spacing={1.5}>
          {(Object.keys(chrome) as (keyof BrandingChrome)[]).map((key) => (
            <ColorField
              key={key}
              label={key.replace(/_/g, ' ')}
              value={chrome[key]}
              onChange={(v) => set(key, v)}
            />
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

export default function BrandingAdminPanel() {
  const { branding, updateBranding, resetBranding } = useBranding();
  const [draft, setDraft] = useState<AppBranding>(branding);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedBrandingRef = useRef(branding);

  const activePaletteId = detectPaletteId(draft);
  const defaultLogos = defaultBrandLogos(draft.agency_name);

  useEffect(() => {
    setDraft(branding);
    savedBrandingRef.current = branding;
  }, [branding]);

  useEffect(() => {
    applyBrandingToDocument(draft);
    return () => {
      applyBrandingToDocument(savedBrandingRef.current);
    };
  }, [draft]);

  const updateDraftColors = (patch: Partial<Pick<AppBranding, 'chrome' | 'light' | 'dark'>>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const onPaletteSelect = (presetId: string) => {
    if (presetId === CUSTOM_PALETTE_ID) return;
    setDraft((prev) => applyPalettePreset(prev, presetId));
  };

  const onLogoPick = (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo must be 500 KB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setDraft((prev) => ({ ...prev, logo_data_url: dataUrl }));
      setError(null);
    };
    reader.onerror = () => setError('Could not read logo file.');
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateBranding({
        app_title: draft.app_title,
        agency_name: draft.agency_name,
        logo_data_url: draft.logo_data_url,
        clear_logo: !draft.logo_data_url,
        chrome: draft.chrome,
        light: draft.light,
        dark: draft.dark,
      });
      savedBrandingRef.current = updated;
      setMessage('Branding saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const applyAndSavePreset = async (presetId: string) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const restored = await resetBranding(presetId);
      setDraft(restored);
      savedBrandingRef.current = restored;
      const label = BRANDING_PALETTES.find((p) => p.id === presetId)?.label ?? presetId;
      setMessage(`Saved ${label} palette colors.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply palette');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper className="page-card" sx={{ p: 2.5, mb: 2 }}>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        App branding
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Pick a predefined color palette or fine-tune colors manually. Title, agency name, and logo
        are configured separately and are not changed when you switch palettes.
      </Typography>

      {message && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={2}>
        <Box>
          <FormControl fullWidth size="small">
            <InputLabel id="branding-palette-label">Color palette</InputLabel>
            <Select
              labelId="branding-palette-label"
              label="Color palette"
              value={activePaletteId}
              renderValue={(value) => {
                if (value === CUSTOM_PALETTE_ID) return 'Custom';
                return BRANDING_PALETTES.find((p) => p.id === value)?.label ?? value;
              }}
              onChange={(e) => onPaletteSelect(String(e.target.value))}
            >
              {BRANDING_PALETTES.map((preset) => (
                <MenuItem key={preset.id} value={preset.id}>
                  <Box>
                    <Typography variant="body2">{preset.label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {preset.description}
                    </Typography>
                    <PaletteSwatch
                      colors={[
                        preset.light.primary,
                        preset.light.background,
                        preset.dark.background,
                        preset.chrome.header_accent,
                      ]}
                    />
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {activePaletteId === CUSTOM_PALETTE_ID && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
              You are using custom colors. Select a preset above to start from a known palette.
            </Typography>
          )}
          {activePaletteId !== CUSTOM_PALETTE_ID && (
            <Button
              size="small"
              sx={{ mt: 1 }}
              disabled={saving}
              onClick={() => applyAndSavePreset(activePaletteId)}
            >
              Apply &amp; save {BRANDING_PALETTES.find((p) => p.id === activePaletteId)?.label} colors
            </Button>
          )}
        </Box>

        <TextField
          label="Application title"
          value={draft.app_title}
          onChange={(e) => setDraft((p) => ({ ...p, app_title: e.target.value }))}
          fullWidth
        />
        <TextField
          label="Agency / organization name"
          value={draft.agency_name}
          onChange={(e) => setDraft((p) => ({ ...p, agency_name: e.target.value }))}
          fullWidth
        />

        <Box>
          <Typography variant="body2" fontWeight={600} gutterBottom>
            Logo
          </Typography>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            {draft.logo_data_url ? (
              <img
                src={draft.logo_data_url}
                alt="Current logo"
                style={{ maxHeight: 48, maxWidth: 200, objectFit: 'contain' }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                Using {defaultLogos.label}
              </Typography>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              hidden
              onChange={(e) => onLogoPick(e.target.files?.[0] ?? null)}
            />
            <Button variant="outlined" size="small" onClick={() => fileRef.current?.click()}>
              Upload logo
            </Button>
            {draft.logo_data_url && (
              <Button
                variant="text"
                size="small"
                color="secondary"
                onClick={() => setDraft((p) => ({ ...p, logo_data_url: null }))}
              >
                Remove logo
              </Button>
            )}
          </Stack>
        </Box>

        <ChromeFields chrome={draft.chrome} onChange={(chrome) => updateDraftColors({ chrome })} />
        <ColorSetFields
          title="Light mode colors"
          colors={draft.light}
          onChange={(light) => updateDraftColors({ light })}
        />
        <ColorSetFields
          title="Dark mode colors"
          colors={draft.dark}
          onChange={(dark) => updateDraftColors({ dark })}
        />

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="contained" disabled={saving} onClick={save}>
            Save branding
          </Button>
          <Button variant="outlined" disabled={saving} onClick={() => setDraft(branding)}>
            Revert draft
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
