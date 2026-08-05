import type { FieldDefinition, LookupRow, LookupTable } from '../types';

export type LookupOption = { value: string; label: string };
export type LookupRowsMap = Record<string, LookupRow[]>;

export function resolveLookupColumns(
  field: FieldDefinition,
  lookup: LookupTable | undefined,
): { valueCol: string; displayCol: string } {
  const valueCol =
    (field.config_json?.value_column as string) ||
    lookup?.columns[0]?.key ||
    'code';
  const displayCol =
    (field.config_json?.display_column as string) ||
    valueCol ||
    lookup?.columns[1]?.key ||
    lookup?.columns[0]?.key ||
    'name';
  return { valueCol, displayCol };
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && !value.trim()) return true;
  return false;
}

function cellValue(row: LookupRow, column: string): string {
  return String(row.values[column] ?? '');
}

export interface CascadeGroup {
  lookupId: string;
  fieldKeys: string[];
  fields: FieldDefinition[];
}

/** Build undirected cascade groups from lookup fields that declare cascade_with. */
export function buildCascadeGroups(fields: FieldDefinition[]): CascadeGroup[] {
  const lookupFields = fields.filter(
    (field) => field.field_type === 'lookup' && field.config_json?.lookup_id,
  );
  const byKey = new Map(lookupFields.map((field) => [field.field_key, field]));
  const visited = new Set<string>();
  const groups: CascadeGroup[] = [];

  for (const field of lookupFields) {
    const cascadeWith = (field.config_json?.cascade_with as string[] | undefined) ?? [];
    if (cascadeWith.length === 0) continue;
    if (visited.has(field.field_key)) continue;

    const lookupId = field.config_json?.lookup_id as string;
    const stack = [field.field_key];
    const groupKeys = new Set<string>();

    while (stack.length > 0) {
      const key = stack.pop()!;
      if (visited.has(key) || groupKeys.has(key)) continue;
      const member = byKey.get(key);
      if (!member) continue;
      if ((member.config_json?.lookup_id as string) !== lookupId) continue;
      groupKeys.add(key);
      visited.add(key);
      const linked = (member.config_json?.cascade_with as string[] | undefined) ?? [];
      for (const linkedKey of linked) {
        if (!groupKeys.has(linkedKey)) stack.push(linkedKey);
      }
    }

    if (groupKeys.size > 0) {
      const groupFields = [...groupKeys]
        .map((key) => byKey.get(key)!)
        .filter(Boolean)
        .sort((a, b) => a.sort_order - b.sort_order);
      groups.push({
        lookupId,
        fieldKeys: groupFields.map((f) => f.field_key),
        fields: groupFields,
      });
    }
  }

  return groups;
}

export function getCascadeGroupForField(
  fieldKey: string,
  groups: CascadeGroup[],
): CascadeGroup | undefined {
  return groups.find((group) => group.fieldKeys.includes(fieldKey));
}

/** Rows matching all non-empty sibling values; optionally exclude one field from filtering. */
export function matchingRows(
  rows: LookupRow[],
  groupFields: FieldDefinition[],
  values: Record<string, unknown>,
  excludeFieldKey?: string,
): LookupRow[] {
  return rows.filter((row) =>
    groupFields.every((field) => {
      if (field.field_key === excludeFieldKey) return true;
      const current = values[field.field_key];
      if (isEmpty(current)) return true;
      const { valueCol } = resolveLookupColumns(field, undefined);
      return cellValue(row, valueCol) === String(current);
    }),
  );
}

export function uniqueOptions(
  rows: LookupRow[],
  valueCol: string,
  displayCol: string,
): LookupOption[] {
  const seen = new Set<string>();
  const options: LookupOption[] = [];
  for (const row of rows) {
    const value = cellValue(row, valueCol);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: cellValue(row, displayCol) || value,
    });
  }
  return options;
}

export function optionsForField(
  field: FieldDefinition,
  rows: LookupRow[],
  values: Record<string, unknown>,
  group: CascadeGroup | undefined,
  lookup?: LookupTable,
): LookupOption[] {
  const { valueCol, displayCol } = resolveLookupColumns(field, lookup);
  const sourceRows = group
    ? matchingRows(rows, group.fields, values, field.field_key)
    : rows;
  return uniqueOptions(sourceRows, valueCol, displayCol);
}

export function buildFlatLookupOptions(
  fields: FieldDefinition[],
  rowsByLookupId: Record<string, LookupRow[]>,
  lookups: LookupTable[],
  groups: CascadeGroup[],
): Record<string, LookupOption[]> {
  const options: Record<string, LookupOption[]> = {};
  for (const field of fields) {
    if (field.field_type !== 'lookup' || !field.config_json?.lookup_id) continue;
    const lookupId = field.config_json.lookup_id as string;
    const lookup = lookups.find((item) => item.lookup_id === lookupId);
    const rows = rowsByLookupId[lookupId] ?? [];
    const group = getCascadeGroupForField(field.field_key, groups);
    options[field.field_key] = optionsForField(field, rows, {}, group, lookup);
  }
  return options;
}

/** When exactly one row matches after a change, fill empty or inconsistent siblings. */
export function autofillPatch(
  fieldKey: string,
  newValue: unknown,
  group: CascadeGroup,
  rows: LookupRow[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const nextValues = { ...values, [fieldKey]: newValue };
  const matches = matchingRows(rows, group.fields, nextValues);
  if (matches.length !== 1) return nextValues;

  const row = matches[0];
  const patch: Record<string, unknown> = { ...nextValues };
  for (const field of group.fields) {
    if (field.field_key === fieldKey) continue;
    const { valueCol } = resolveLookupColumns(field, undefined);
    const rowValue = row.values[valueCol];
    const current = patch[field.field_key];
    if (isEmpty(current) || String(current) !== String(rowValue ?? '')) {
      patch[field.field_key] = rowValue == null ? '' : String(rowValue);
    }
  }
  return patch;
}

/** Clear field values that are no longer valid given sibling filters. */
export function pruneInvalidCascadeValues(
  group: CascadeGroup,
  rows: LookupRow[],
  values: Record<string, unknown>,
  lookups: LookupTable[],
): Record<string, unknown> {
  let next = { ...values };
  let changed = true;
  while (changed) {
    changed = false;
    for (const field of group.fields) {
      const current = next[field.field_key];
      if (isEmpty(current)) continue;
      const lookup = lookups.find((item) => item.lookup_id === group.lookupId);
      const options = optionsForField(field, rows, next, group, lookup);
      if (!options.some((option) => option.value === String(current))) {
        next = { ...next, [field.field_key]: '' };
        changed = true;
      }
    }
  }
  return next;
}

export function applyLookupFieldChange(
  fieldKey: string,
  newValue: unknown,
  fields: FieldDefinition[],
  rowsByLookupId: Record<string, LookupRow[]>,
  lookups: LookupTable[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const groups = buildCascadeGroups(fields);
  const group = getCascadeGroupForField(fieldKey, groups);
  if (!group) return { ...values, [fieldKey]: newValue };

  const rows = rowsByLookupId[group.lookupId] ?? [];
  let next = autofillPatch(fieldKey, newValue, group, rows, values);
  next = pruneInvalidCascadeValues(group, rows, next, lookups);
  const afterPrune = matchingRows(rows, group.fields, next);
  if (afterPrune.length === 1) {
    next = autofillPatch(fieldKey, next[fieldKey], group, rows, next);
  }
  return next;
}

export function combinationValid(
  group: CascadeGroup,
  rows: LookupRow[],
  values: Record<string, unknown>,
): boolean {
  const filled = group.fields.filter((field) => !isEmpty(values[field.field_key]));
  if (filled.length === 0) return true;
  return matchingRows(rows, group.fields, values).length > 0;
}

export function validateCascadeCombinations(
  fields: FieldDefinition[],
  rowsByLookupId: Record<string, LookupRow[]>,
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const groups = buildCascadeGroups(fields);
  const message = "These values don't match the same lookup row";

  for (const group of groups) {
    const rows = rowsByLookupId[group.lookupId] ?? [];
    const filled = group.fields.filter((field) => !isEmpty(values[field.field_key]));
    if (filled.length === 0) continue;
    if (combinationValid(group, rows, values)) continue;
    for (const field of filled) {
      errors[field.field_key] = message;
    }
  }

  return errors;
}

/** Remove a deleted field from all cascade_with links. */
export function removeCascadeReferences(
  fields: FieldDefinition[],
  removedKey: string,
): FieldDefinition[] {
  return fields.map((field) => {
    const cascadeWith = (field.config_json?.cascade_with as string[] | undefined) ?? [];
    if (!cascadeWith.includes(removedKey)) return field;
    const nextCascade = cascadeWith.filter((key) => key !== removedKey);
    const config = { ...(field.config_json ?? {}) };
    if (nextCascade.length > 0) {
      config.cascade_with = nextCascade;
    } else {
      delete config.cascade_with;
    }
    return {
      ...field,
      config_json: Object.keys(config).length > 0 ? config : undefined,
    };
  });
}

/** Keep cascade_with links bidirectional within the same lookup table. */
export function syncCascadeLinks(
  fields: FieldDefinition[],
  fieldKey: string,
  linkedKeys: string[],
): FieldDefinition[] {
  const target = fields.find((field) => field.field_key === fieldKey);
  if (!target?.config_json?.lookup_id) return fields;

  const lookupId = target.config_json.lookup_id as string;
  const desired = new Set(
    linkedKeys.filter((key) => key !== fieldKey && fields.some((field) => field.field_key === key)),
  );

  return fields.map((field) => {
    const config = { ...(field.config_json ?? {}) };
    const fieldLookupId = config.lookup_id as string | undefined;

    if (field.field_key === fieldKey) {
      return {
        ...field,
        config_json: {
          ...config,
          cascade_with: [...desired],
        },
      };
    }

    if (field.field_type !== 'lookup' || fieldLookupId !== lookupId) {
      return field;
    }

    const existing = new Set((config.cascade_with as string[] | undefined) ?? []);
    if (desired.has(field.field_key)) {
      existing.add(fieldKey);
    } else {
      existing.delete(fieldKey);
    }
    const cascadeWith = [...existing].filter((key) => key !== field.field_key);
    return {
      ...field,
      config_json: {
        ...config,
        cascade_with: cascadeWith.length > 0 ? cascadeWith : undefined,
      },
    };
  });
}
