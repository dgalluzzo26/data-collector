import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  buildCascadeGroups,
  buildFlatLookupOptions,
  type LookupOption,
  type LookupRowsMap,
} from '../lib/lookupCascade';
import type { FieldDefinition, LookupTable } from '../types';

export type LookupOptionMap = Record<string, LookupOption[]>;
export type { LookupRowsMap } from '../lib/lookupCascade';

function resolveLookupIds(fields: FieldDefinition[]): string[] {
  const ids = new Set<string>();
  for (const field of fields) {
    if (field.field_type === 'lookup' && field.config_json?.lookup_id) {
      ids.add(field.config_json.lookup_id as string);
    }
  }
  return [...ids].sort();
}

export function lookupRowsQueryKey(projectId: string, lookupIds: string[]) {
  return ['lookupRows', projectId, lookupIds.join(',')] as const;
}

export function lookupOptionsQueryKey(projectId: string, fieldKeys: string[]) {
  return ['lookupOptions', projectId, fieldKeys.join(',')] as const;
}

export function useLookupRows(projectId: string, fields: FieldDefinition[]) {
  const lookupIds = resolveLookupIds(fields);

  return useQuery({
    queryKey: lookupRowsQueryKey(projectId, lookupIds),
    queryFn: async (): Promise<LookupRowsMap> => {
      const next: LookupRowsMap = {};
      await Promise.all(
        lookupIds.map(async (lookupId) => {
          try {
            next[lookupId] = await api.getLookupRows(projectId, lookupId);
          } catch {
            next[lookupId] = [];
          }
        }),
      );
      return next;
    },
    enabled: lookupIds.length > 0,
    staleTime: 5 * 60_000,
  });
}

export function useLookupOptions(
  projectId: string,
  fields: FieldDefinition[],
  lookups: LookupTable[],
) {
  const lookupFields = fields.filter(
    (field) => field.field_type === 'lookup' && field.config_json?.lookup_id,
  );
  const fieldKeys = lookupFields.map((field) => field.field_key);
  const rowsQuery = useLookupRows(projectId, fields);
  const groups = buildCascadeGroups(fields);

  return useQuery({
    queryKey: [...lookupOptionsQueryKey(projectId, fieldKeys), rowsQuery.dataUpdatedAt],
    queryFn: async (): Promise<LookupOptionMap> =>
      buildFlatLookupOptions(fields, rowsQuery.data ?? {}, lookups, groups),
    enabled: lookupFields.length > 0 && rowsQuery.isSuccess,
    staleTime: 5 * 60_000,
  });
}
