import type { AppBranding } from '../types';
import {
  DATABRICKS_PALETTE,
  paletteToBranding,
} from './brandingPresets';

export {
  BRANDING_PALETTES,
  CUSTOM_PALETTE_ID,
  DATABRICKS_PALETTE,
  DHS_PALETTE,
  SLATE_PALETTE,
  applyPalettePreset,
  detectPaletteId,
  getPalettePreset,
  paletteToBranding,
} from './brandingPresets';
export type { BrandingPalettePreset } from './brandingPresets';

/** Shipped default — Databricks palette. */
export const DATABRICKS_BRANDING: AppBranding = paletteToBranding(DATABRICKS_PALETTE);
export const DEFAULT_BRANDING = DATABRICKS_BRANDING;

export const DEFAULT_BRANDING_CHROME = DATABRICKS_BRANDING.chrome;
export const DEFAULT_BRANDING_LIGHT = DATABRICKS_BRANDING.light;
export const DEFAULT_BRANDING_DARK = DATABRICKS_BRANDING.dark;

const STYLE_ID = 'app-branding-overrides';

function gradient(top: string, bottom: string): string {
  return `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;
}

function sidebarGradient(chrome: AppBranding['chrome']): string {
  return `linear-gradient(165deg, ${chrome.sidebar_background} 0%, ${chrome.sidebar_mid} 48%, ${chrome.sidebar_end} 100%)`;
}

function contentVars(colors: AppBranding['light'], darkMode: boolean): string {
  const border = darkMode ? 'rgba(255, 255, 255, 0.14)' : 'rgba(27, 49, 57, 0.14)';
  const surface200 = darkMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(27, 49, 57, 0.12)';
  return `
    --p-surface-ground: ${colors.background};
    --p-surface-0: ${colors.paper};
    --p-surface-50: ${colors.background};
    --p-surface-100: ${colors.paper};
    --p-surface-200: ${surface200};
    --p-surface-border: ${border};
    --p-text-color: ${colors.text_primary};
    --p-text-muted-color: ${colors.text_secondary};
    --p-primary-color: ${colors.primary};
    --dhs-navy: ${colors.text_primary};
    --dhs-blue: ${colors.primary};
    --dhs-blue-light: ${colors.primary_light};
  `;
}

/** Inject CSS variables for chrome + light/dark content palettes. */
export function applyBrandingToDocument(branding: AppBranding): void {
  const { chrome, light, dark } = branding;
  const css = `
:root {
  --dhs-navy: ${chrome.header_background};
  --dhs-navy-mid: ${chrome.header_mid};
  --dhs-blue: ${light.primary};
  --dhs-blue-light: ${chrome.header_accent};
  --dhs-red: ${light.secondary};
  --dhs-header-bg: ${gradient(chrome.header_background, chrome.header_mid)};
  --dhs-sidebar-bg: ${sidebarGradient(chrome)};
  --dhs-content-hero-bg: linear-gradient(135deg, ${chrome.header_background} 0%, ${light.primary} 55%, ${light.primary_light} 100%);
  --app-chrome-bg: ${light.background};
  --p-content-inner-bg: ${light.background};
  ${contentVars(light, false)}
}

body.content-theme-dark,
.content-theme-dark {
  color-scheme: dark;
  --app-chrome-bg: ${dark.background};
  --p-content-inner-bg: ${gradient(dark.background, chrome.header_mid)};
  ${contentVars(dark, true)}
}

.main-content-inner.content-theme-dark {
  background: var(--p-content-inner-bg);
}

.content-theme-dark .page-title,
body.content-theme-dark .page-title {
  color: var(--p-text-color);
}
`;

  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
  document.title = branding.app_title || 'Brick Constructor';
}
