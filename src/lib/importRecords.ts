import type { ImportRecordsResult } from '../types';

function formatFieldErrors(
  fieldErrors: Record<string, string>,
  fieldLabels?: Record<string, string>,
): string {
  return Object.entries(fieldErrors)
    .map(([fieldKey, message]) => {
      const label = fieldLabels?.[fieldKey] ?? fieldKey;
      return `${label}: ${message}`;
    })
    .join('; ');
}

export function formatImportFailureDetail(
  failed: ImportRecordsResult['failed'],
  options?: { maxRows?: number; fieldLabels?: Record<string, string> },
): string {
  const maxRows = options?.maxRows ?? 5;
  const shown = failed.slice(0, maxRows);
  const lines = shown.map(
    (failedRow) =>
      `Row ${failedRow.row}: ${formatFieldErrors(failedRow.field_errors, options?.fieldLabels)}`,
  );
  const suffix = failed.length > maxRows ? `\n…and ${failed.length - maxRows} more row(s).` : '';
  return lines.join('\n') + suffix;
}

export function formatImportResult(
  result: ImportRecordsResult,
  fieldLabels?: Record<string, string>,
): string {
  const parts: string[] = [];
  if (result.created > 0) {
    parts.push(`imported ${result.created} record${result.created === 1 ? '' : 's'}`);
  }
  if ((result.updated ?? 0) > 0) {
    parts.push(`updated ${result.updated} record${result.updated === 1 ? '' : 's'}`);
  }
  if ((result.skipped ?? 0) > 0) {
    parts.push(`skipped ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'}`);
  }

  const failedCount = result.failed.length;
  if (failedCount === 0) {
    if (parts.length === 0) {
      return 'No records imported.';
    }
    return `${parts[0]!.charAt(0).toUpperCase()}${parts[0]!.slice(1)}${parts.length > 1 ? `; ${parts.slice(1).join('; ')}` : ''}.`;
  }

  const details = formatImportFailureDetail(result.failed, { fieldLabels });
  const summary = parts.length > 0 ? `${parts.join('; ')}; ` : '';
  return `${summary.charAt(0).toUpperCase()}${summary.slice(1)}${failedCount} row${failedCount === 1 ? '' : 's'} failed:\n${details}`;
}
