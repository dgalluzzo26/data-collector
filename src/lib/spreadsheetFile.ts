import * as XLSX from 'xlsx';
import { assertCsvWithinLimit, csvFileSizeError, readCsvFile } from './csvFile';

export type SpreadsheetKind = 'csv' | 'xlsx';

export const SPREADSHEET_ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function detectSpreadsheetKind(file: File): SpreadsheetKind {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || file.type === XLSX_MIME) {
    return 'xlsx';
  }
  if (
    name.endsWith('.csv') ||
    file.type === 'text/csv' ||
    file.type === 'application/csv' ||
    file.type === 'application/vnd.ms-excel'
  ) {
    return 'csv';
  }
  throw new Error('Unsupported file type. Choose a .csv or .xlsx file.');
}

/** Returns a user-facing error when the file exceeds the size limit, otherwise null. */
export function spreadsheetFileSizeError(file: File): string | null {
  return csvFileSizeError(file);
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

async function readXlsxWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buffer = await readFileAsArrayBuffer(file);
  return XLSX.read(buffer, { type: 'array' });
}

export async function listXlsxSheetNames(file: File): Promise<string[]> {
  const workbook = await readXlsxWorkbook(file);
  if (!workbook.SheetNames.length) {
    throw new Error('Excel file has no worksheets.');
  }
  return workbook.SheetNames;
}

export async function xlsxSheetToCsv(file: File, sheetName: string): Promise<string> {
  const workbook = await readXlsxWorkbook(file);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Worksheet "${sheetName}" was not found.`);
  }
  const csv = XLSX.utils.sheet_to_csv(sheet);
  assertCsvWithinLimit(csv, file.name);
  if (!csv.trim()) {
    throw new Error(`Worksheet "${sheetName}" is empty.`);
  }
  return csv;
}

export async function readSpreadsheetAsCsv(file: File, sheetName?: string): Promise<string> {
  const sizeError = spreadsheetFileSizeError(file);
  if (sizeError) {
    throw new Error(sizeError);
  }

  const kind = detectSpreadsheetKind(file);
  if (kind === 'csv') {
    return readCsvFile(file);
  }

  const names = await listXlsxSheetNames(file);
  const sheet = sheetName ?? names[0];
  if (!names.includes(sheet)) {
    throw new Error(`Worksheet "${sheet}" was not found.`);
  }
  return xlsxSheetToCsv(file, sheet);
}

export function baseNameFromSpreadsheetFile(fileName: string): string {
  return fileName.replace(/\.(csv|xlsx)$/i, '').replace(/[_-]+/g, ' ').trim();
}
