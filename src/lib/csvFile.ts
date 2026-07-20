export function readCsvFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
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
