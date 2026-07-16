import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { FieldDefinition, LookupTable } from '../types';

export type LookupOption = { value: string; label: string };
export type LookupOptionMap = Record<string, LookupOption[]>;

function resolveLookupColumns(
  field: FieldDefinition,
  lookup: LookupTable | undefined,
): { valueCol: string; displayCol: string } {
  const valueCol =
    (field.config_json?.value_column as string) ||
    lookup?.columns[0]?.key ||
    'code';
  const displayCol =
    (field.config_json?.display_column as string) ||
    lookup?.columns[1]?.key ||
    lookup?.columns[0]?.key ||
    'name';
  return { valueCol, displayCol };
}

export function lookupOptionsQueryKey(projectId: string, fieldKeys: string[]) {
  return ['lookupOptions', projectId, fieldKeys.join(',')] as const;
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

  return useQuery({
    queryKey: lookupOptionsQueryKey(projectId, fieldKeys),
    queryFn: async (): Promise<LookupOptionMap> => {
      const next: LookupOptionMap = {};
      await Promise.all(
        lookupFields.map(async (field) => {
          const lookupId = field.config_json?.lookup_id as string;
          const lookupMeta = lookups.find((lookup) => lookup.lookup_id === lookupId);
          const { valueCol, displayCol } = resolveLookupColumns(field, lookupMeta);
          try {
            const rows = await api.getLookupRows(projectId, lookupId);
            next[field.field_key] = rows.map((row) => ({
              value: String(row.values[valueCol] ?? ''),
              label: String(row.values[displayCol] ?? row.values[valueCol] ?? ''),
            }));
          } catch {
            next[field.field_key] = [];
          }
        }),
      );
      return next;
    },
    enabled: lookupFields.length > 0,
    staleTime: 5 * 60_000,
  });
}
