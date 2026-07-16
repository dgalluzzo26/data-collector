import { createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { AppBranding } from './types';

export type ColorMode = 'light' | 'dark';

const BRAND_PRIMARY = {
  main: '#FF3621',
  light: '#FF5C4D',
  dark: '#EB1600',
};

const BRAND_PRIMARY_DARK_CONTENT = {
  main: '#FF3621',
  light: '#FF6B5A',
  dark: '#EB1600',
  contrastText: '#FFFFFF',
};

function paletteFromBranding(mode: ColorMode, branding?: AppBranding) {
  const colors = mode === 'dark' ? branding?.dark : branding?.light;
  const isDark = mode === 'dark';
  const fallbackPrimary = isDark ? BRAND_PRIMARY_DARK_CONTENT : BRAND_PRIMARY;
  return {
    primary: colors
      ? { main: colors.primary, light: colors.primary_light, dark: colors.primary_dark }
      : fallbackPrimary,
    secondary: colors
      ? { main: colors.secondary, light: colors.secondary, dark: colors.secondary }
      : { main: '#1B3139', light: '#1B5162', dark: '#0B2026' },
    background: colors
      ? { default: colors.background, paper: colors.paper }
      : isDark
        ? { default: '#0B2026', paper: '#1B3139' }
        : { default: '#F9F7F4', paper: '#FFFFFF' },
    text: colors
      ? { primary: colors.text_primary, secondary: colors.text_secondary }
      : isDark
        ? { primary: '#FFFFFF', secondary: '#90A5B1' }
        : { primary: '#1B3139', secondary: '#90A5B1' },
  };
}

/** MUI theme for the content area — synced with Scorecard content-theme toggle. */
export function getTheme(mode: ColorMode, branding?: AppBranding): Theme {
  const isDark = mode === 'dark';
  const palette = paletteFromBranding(mode, branding);
  return createTheme({
    palette: {
      mode,
      primary: palette.primary,
      secondary: palette.secondary,
      background: palette.background,
      text: palette.text,
      divider: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.10)',
    },
    typography: {
      fontFamily: '"Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h1: { fontFamily: '"Source Serif 4", "Source Sans 3", serif' },
      h2: { fontFamily: '"Source Serif 4", "Source Sans 3", serif' },
      h3: { fontFamily: '"Source Serif 4", "Source Sans 3", serif' },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { fontWeight: 600, textTransform: 'none' },
          containedPrimary: ({ theme }) =>
            theme.palette.mode === 'dark'
              ? {
                  backgroundColor: BRAND_PRIMARY.main,
                  color: '#ffffff',
                  '&:hover': {
                    backgroundColor: BRAND_PRIMARY.light,
                  },
                }
              : {
                  '&:hover': {
                    backgroundColor: BRAND_PRIMARY.dark,
                  },
                },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundImage: 'none',
            border: `1px solid ${theme.palette.divider}`,
          }),
        },
      },
    },
  });
}
