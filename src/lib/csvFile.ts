/** Keep in sync with backend.models.CSV_MAX_CHARS */
export const CSV_MAX_CHARS = 35_000_000;

/** sessionStorage staging for post-publish import (browser quota ~5 MB). */
export const CSV_BROWSER_STAGE_MAX_CHARS = 4_000_000;

export const CSV_MAX_SIZE_LABEL = formatCsvSize(CSV_MAX_CHARS);

export const CSV_MAX_SIZE_HELP = `Maximum CSV file size: ${CSV_MAX_SIZE_LABEL}.`;

export function canStageCsvInBrowser(csv: string): boolean {
  return csv.length <= CSV_BROWSER_STAGE_MAX_CHARS;
}

export function formatCsvSize(chars: number): string {
  if (chars < 1024) return `${chars} characters`;
  const kb = chars / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function csvTooLargeMessage(size: number, fileName?: string): string {
  const label = fileName ? `"${fileName}"` : 'This CSV file';
  return (
    `${label} is ${formatCsvSize(size)}, which exceeds the ${CSV_MAX_SIZE_LABEL} limit. ` +
    'Use a smaller file to create the form, or create the form first and import records from the Records tab.'
  );
}

/** Returns a user-facing error message when the file is too large, otherwise null. */
export function csvFileSizeError(file: File): string | null {
  if (file.size <= CSV_MAX_CHARS) return null;
  return csvTooLargeMessage(file.size, file.name);
}

export function assertCsvWithinLimit(csv: string, fileName?: string): void {
  if (csv.length <= CSV_MAX_CHARS) return;
  throw new Error(csvTooLargeMessage(csv.length, fileName));
}

export function readCsvFile(file: File): Promise<string> {
  const sizeError = csvFileSizeError(file);
  if (sizeError) {
    return Promise.reject(new Error(sizeError));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      try {
        assertCsvWithinLimit(text, file.name);
      } catch (err) {
        reject(err);
        return;
      }
      resolve(text);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export const CSV_IMPORT_STORAGE_PREFIX = 'csv-import:';

export interface StagedCsvImport {
  csv: string;
  headerRow: number;
}

export function stageCsvForImport(projectId: string, payload: StagedCsvImport): void {
  try {
    sessionStorage.setItem(`${CSV_IMPORT_STORAGE_PREFIX}${projectId}`, JSON.stringify(payload));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to stage CSV';
    throw new Error(
      `${message}. The CSV may be too large to import automatically after publish — publish first, then use Records → Import CSV.`,
    );
  }
}

export function getStagedCsvImport(projectId: string): StagedCsvImport | null {
  const raw = sessionStorage.getItem(`${CSV_IMPORT_STORAGE_PREFIX}${projectId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StagedCsvImport;
    if (parsed?.csv) {
      return { csv: parsed.csv, headerRow: parsed.headerRow > 0 ? parsed.headerRow : 1 };
    }
  } catch {
    return { csv: raw, headerRow: 1 };
  }
  return null;
}

export function clearStagedCsvImport(projectId: string): void {
  sessionStorage.removeItem(`${CSV_IMPORT_STORAGE_PREFIX}${projectId}`);
}
