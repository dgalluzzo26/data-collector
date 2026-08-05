import type { FieldDefinition } from '../types';
import type { LookupRowsMap } from './lookupCascade';
import { validateCascadeCombinations } from './lookupCascade';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && !value.trim()) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
}

export function validateRecordValues(
  fields: FieldDefinition[],
  values: Record<string, unknown>,
  lookupAllowed: Record<string, Set<string>> = {},
  rowsByLookupId: LookupRowsMap = {},
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const key = field.field_key;
    const value = values[key];
    const label = field.label;
    const config = field.config_json ?? {};

    if (field.is_required) {
      if (field.field_type === 'boolean') {
        if (value !== true) {
          errors[key] = `${label} must be checked`;
          continue;
        }
      } else if (isEmpty(value)) {
        errors[key] = `${label} is required`;
        continue;
      }
    }

    if (isEmpty(value)) continue;

    if (field.field_type === 'email') {
      if (!EMAIL_RE.test(String(value).trim())) {
        errors[key] = 'Enter a valid email address';
      }
    } else if (field.field_type === 'url') {
      if (!isValidUrl(String(value))) {
        errors[key] = 'Enter a valid URL (include https://)';
      }
    } else if (field.field_type === 'number') {
      if (Number.isNaN(Number(value))) {
        errors[key] = 'Enter a valid number';
      }
    } else if (field.field_type === 'single_select') {
      const options = (config.options as string[] | undefined) ?? [];
      if (options.length > 0 && !options.map(String).includes(String(value))) {
        errors[key] = 'Select a valid option';
      }
    } else if (field.field_type === 'lookup') {
      const allowed = lookupAllowed[key];
      if (allowed && !allowed.has(String(value))) {
        errors[key] = 'Select a valid lookup value';
      }
    } else if (field.field_type === 'multi_select') {
      const selected = Array.isArray(value) ? value : [value];
      const options = (config.options as string[] | undefined) ?? [];
      if (options.length > 0) {
        const allowedOpts = new Set(options.map(String));
        if (selected.some((item) => !allowedOpts.has(String(item)))) {
          errors[key] = 'Select valid option(s)';
        }
      }
    }
  }

  const cascadeErrors = validateCascadeCombinations(fields, rowsByLookupId, values);
  for (const [key, message] of Object.entries(cascadeErrors)) {
    if (!errors[key]) errors[key] = message;
  }

  return errors;
}

export function buildLookupAllowedFromOptions(
  fields: FieldDefinition[],
  lookupOptions: Record<string, { value: string; label: string }[]>,
): Record<string, Set<string>> {
  const allowed: Record<string, Set<string>> = {};
  for (const field of fields) {
    if (field.field_type === 'lookup') {
      const opts = lookupOptions[field.field_key] ?? [];
      allowed[field.field_key] = new Set(opts.map((o) => o.value));
    }
  }
  return allowed;
}
