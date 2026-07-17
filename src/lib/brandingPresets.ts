import type { AppBranding, BrandingChrome, BrandingColorSet } from '../types';

export interface BrandingPalettePreset {
  id: string;
  label: string;
  description: string;
  chrome: BrandingChrome;
  light: BrandingColorSet;
  dark: BrandingColorSet;
}

export const DATABRICKS_PALETTE: BrandingPalettePreset = {
  id: 'databricks',
  label: 'Databricks',
  description: 'Lava red, teal, navy, and warm oat neutrals (databricks.com).',
  chrome: {
    header_background: '#0B2026',
    header_mid: '#1B3139',
    header_accent: '#FF3621',
    sidebar_background: '#0B2026',
    sidebar_mid: '#1B3139',
    sidebar_end: '#0B2026',
  },
  light: {
    primary: '#FF3621',
    primary_light: '#FF5C4D',
    primary_dark: '#EB1600',
    secondary: '#1B3139',
    background: '#F9F7F4',
    paper: '#FFFFFF',
    text_primary: '#1B3139',
    text_secondary: '#90A5B1',
  },
  dark: {
    primary: '#FF3621',
    primary_light: '#FF6B5A',
    primary_dark: '#EB1600',
    secondary: '#1B5162',
    background: '#0B2026',
    paper: '#1B3139',
    text_primary: '#FFFFFF',
    text_secondary: '#90A5B1',
  },
};

export const DHS_PALETTE: BrandingPalettePreset = {
  id: 'dhs',
  label: 'DHS Government',
  description: 'Navy blues and official red accents (U.S. Department of Homeland Security).',
  chrome: {
    header_background: '#0C2340',
    header_mid: '#112E51',
    header_accent: '#0078AE',
    sidebar_background: '#0C2340',
    sidebar_mid: '#112E51',
    sidebar_end: '#0C2A46',
  },
  light: {
    primary: '#005288',
    primary_light: '#0078AE',
    primary_dark: '#0C2340',
    secondary: '#C41230',
    background: '#F8F9FB',
    paper: '#FFFFFF',
    text_primary: '#1B1B1B',
    text_secondary: '#5C5C5C',
  },
  dark: {
    primary: '#7DD3FC',
    primary_light: '#BAE6FD',
    primary_dark: '#005288',
    secondary: '#E03A52',
    background: '#0C2340',
    paper: '#112E51',
    text_primary: '#FFFFFF',
    text_secondary: '#B8C5CE',
  },
};

export const SLATE_PALETTE: BrandingPalettePreset = {
  id: 'slate',
  label: 'Slate Neutral',
  description: 'Cool grays and charcoal — a minimal enterprise look.',
  chrome: {
    header_background: '#0F172A',
    header_mid: '#1E293B',
    header_accent: '#64748B',
    sidebar_background: '#0F172A',
    sidebar_mid: '#1E293B',
    sidebar_end: '#0F172A',
  },
  light: {
    primary: '#475569',
    primary_light: '#64748B',
    primary_dark: '#334155',
    secondary: '#0F172A',
    background: '#F8FAFC',
    paper: '#FFFFFF',
    text_primary: '#0F172A',
    text_secondary: '#64748B',
  },
  dark: {
    primary: '#94A3B8',
    primary_light: '#CBD5E1',
    primary_dark: '#64748B',
    secondary: '#334155',
    background: '#0F172A',
    paper: '#1E293B',
    text_primary: '#F8FAFC',
    text_secondary: '#94A3B8',
  },
};

export const BRANDING_PALETTES: BrandingPalettePreset[] = [
  DATABRICKS_PALETTE,
  DHS_PALETTE,
  SLATE_PALETTE,
];

export const CUSTOM_PALETTE_ID = 'custom';

function normalizeColor(value: string): string {
  return value.trim().toLowerCase();
}

function colorSetsEqual(a: BrandingColorSet, b: BrandingColorSet): boolean {
  return (Object.keys(a) as (keyof BrandingColorSet)[]).every(
    (key) => normalizeColor(a[key]) === normalizeColor(b[key]),
  );
}

function chromeEqual(a: BrandingChrome, b: BrandingChrome): boolean {
  return (Object.keys(a) as (keyof BrandingChrome)[]).every(
    (key) => normalizeColor(a[key]) === normalizeColor(b[key]),
  );
}

export function brandingMatchesPalette(
  branding: Pick<AppBranding, 'chrome' | 'light' | 'dark'>,
  preset: BrandingPalettePreset,
): boolean {
  return (
    chromeEqual(branding.chrome, preset.chrome) &&
    colorSetsEqual(branding.light, preset.light) &&
    colorSetsEqual(branding.dark, preset.dark)
  );
}

export function detectPaletteId(
  branding: Pick<AppBranding, 'chrome' | 'light' | 'dark'>,
): string {
  const match = BRANDING_PALETTES.find((preset) => brandingMatchesPalette(branding, preset));
  return match?.id ?? CUSTOM_PALETTE_ID;
}

export function getPalettePreset(presetId: string): BrandingPalettePreset | undefined {
  return BRANDING_PALETTES.find((preset) => preset.id === presetId);
}

/** Apply a palette preset to branding, keeping title, agency, and logo. */
export function applyPalettePreset(branding: AppBranding, presetId: string): AppBranding {
  const preset = getPalettePreset(presetId);
  if (!preset) return branding;
  return {
    ...branding,
    chrome: { ...preset.chrome },
    light: { ...preset.light },
    dark: { ...preset.dark },
  };
}

export function paletteToBranding(preset: BrandingPalettePreset): AppBranding {
  return {
    app_title: 'Brick Constructor',
    agency_name: preset.id === 'dhs' ? 'U.S. Department of Homeland Security' : 'Databricks',
    logo_data_url: null,
    chrome: { ...preset.chrome },
    light: { ...preset.light },
    dark: { ...preset.dark },
  };
}
