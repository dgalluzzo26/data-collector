import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { applyBrandingToDocument, DEFAULT_BRANDING } from '../lib/branding';
import type { AppBranding } from '../types';

interface BrandingContextValue {
  branding: AppBranding;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateBranding: (patch: Partial<AppBranding> & { clear_logo?: boolean }) => Promise<AppBranding>;
  resetBranding: (preset?: string) => Promise<AppBranding>;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['branding'],
    queryFn: () => api.getBranding(),
    staleTime: 60_000,
  });

  const branding = query.data ?? DEFAULT_BRANDING;

  useEffect(() => {
    applyBrandingToDocument(branding);
  }, [branding]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['branding'] });
  }, [queryClient]);

  const updateBranding = useCallback(
    async (patch: Partial<AppBranding> & { clear_logo?: boolean }) => {
      const updated = await api.updateBranding(patch);
      queryClient.setQueryData(['branding'], updated);
      return updated;
    },
    [queryClient],
  );

  const resetBranding = useCallback(async (preset = 'databricks') => {
    const updated = await api.resetBranding(preset);
    queryClient.setQueryData(['branding'], updated);
    return updated;
  }, [queryClient]);

  const value = useMemo<BrandingContextValue>(
    () => ({
      branding,
      loading: query.isLoading,
      error: query.error instanceof Error ? query.error.message : null,
      refresh,
      updateBranding,
      resetBranding,
    }),
    [branding, query.isLoading, query.error, refresh, updateBranding, resetBranding],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error('useBranding must be used inside BrandingProvider');
  }
  return ctx;
}
