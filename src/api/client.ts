import { beginBusy, endBusy } from '../statusBus';
import type {
  ApplyProjectProposalPayload,
  AddMemberResponse,
  AppConfig,
  AppBranding,
  BindLookupPayload,
  CreateProjectPayload,
  FieldDefinition,
  GenieAskResponse,
  GenieStatus,
  LookupColumn,
  LookupProposal,
  LookupRow,
  LookupTable,
  ProjectBlueprint,
  ProjectDetail,
  ProjectMember,
  ProjectSummary,
  RecordAuditEntry,
  RecordRow,
  ImportRecordsResult,
  SyncStagedRecordsResult,
  UcTablePreview,
  UserInfo,
  WorkspaceUser,
} from '../types';

const BASE = '/api';

export class ApiValidationError extends Error {
  fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super('Validation failed');
    this.name = 'ApiValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class ApiAccessDeniedError extends Error {
  collectionName?: string;
  adminEmails: string[];

  constructor(message: string, collectionName?: string, adminEmails: string[] = []) {
    super(message);
    this.name = 'ApiAccessDeniedError';
    this.collectionName = collectionName;
    this.adminEmails = adminEmails;
  }
}

export class ApiPublishError extends Error {
  grantSql?: string;

  constructor(message: string, grantSql?: string) {
    super(message);
    this.name = 'ApiPublishError';
    this.grantSql = grantSql;
  }
}

type ApiErrorDetail =
  | string
  | {
      message?: string;
      field_errors?: Record<string, string>;
      collection_name?: string;
      admin_emails?: string[];
      grant_sql?: string;
    };

function parseApiError(status: number, text: string): Error {
  try {
    const json = JSON.parse(text) as { detail?: ApiErrorDetail };
    const detail = json.detail;
    if (detail && typeof detail === 'object') {
      if (detail.field_errors) {
        return new ApiValidationError(detail.field_errors);
      }
      if (status === 403 && detail.admin_emails) {
        return new ApiAccessDeniedError(
          detail.message || 'Not a member of this project',
          detail.collection_name,
          detail.admin_emails,
        );
      }
      if (detail.message) {
        if (detail.grant_sql) {
          return new ApiPublishError(detail.message, detail.grant_sql);
        }
        return new Error(detail.message);
      }
    }
    if (typeof detail === 'string') {
      return new Error(detail);
    }
  } catch (err) {
    if (
      err instanceof ApiValidationError ||
      err instanceof ApiAccessDeniedError ||
      err instanceof ApiPublishError
    ) {
      throw err;
    }
  }
  return new Error(text || `API ${status}`);
}

async function request<T>(
  path: string,
  init?: RequestInit,
  statusMessage = 'Loading…',
  timeoutMs = 30_000,
): Promise<T> {
  beginBusy(statusMessage);
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    timeoutMs,
  );
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw parseApiError(res.status, text);
    }
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return undefined as T;
    }
    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
    endBusy();
  }
}

export const api = {
  getMe: () => request<UserInfo>('/me', undefined, 'Loading profile…'),
  getConfig: () => request<AppConfig>('/health', undefined, 'Loading config…'),
  getBranding: () => request<AppBranding>('/branding', undefined, 'Loading branding…'),
  updateBranding: (body: Partial<AppBranding> & { clear_logo?: boolean }) =>
    request<AppBranding>(
      '/branding',
      { method: 'PUT', body: JSON.stringify(body) },
      'Saving branding…',
    ),
  resetBranding: (preset = 'databricks') =>
    request<AppBranding>(
      `/branding/reset?preset=${encodeURIComponent(preset)}`,
      { method: 'POST' },
      'Applying palette…',
    ),

  listUcCatalogSchemas: (catalog: string) =>
    request<string[]>(`/uc/schemas?catalog=${encodeURIComponent(catalog)}`, undefined, 'Loading schemas…'),
  listUcCatalogTables: (catalog: string, schema: string) =>
    request<string[]>(
      `/uc/tables?catalog=${encodeURIComponent(catalog)}&schema=${encodeURIComponent(schema)}`,
      undefined,
      'Loading tables…',
    ),
  previewUcCatalogTable: (catalog: string, schema: string, table: string) =>
    request<UcTablePreview>(
      `/uc/preview?catalog=${encodeURIComponent(catalog)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`,
      undefined,
      'Loading table preview…',
      120_000,
    ),

  listProjects: () => request<ProjectSummary[]>('/projects', undefined, 'Loading forms…'),
  createProject: (body: CreateProjectPayload) =>
    request<ProjectDetail>(
      '/projects',
      { method: 'POST', body: JSON.stringify(body) },
      'Creating form…',
      120_000,
    ),
  getProject: (id: string) =>
    request<ProjectDetail>(`/projects/${id}`, undefined, 'Loading project…', 60_000),
  updateProject: (id: string, body: Partial<CreateProjectPayload>) =>
    request<ProjectDetail>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, 'Saving…'),
  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }, 'Deleting form…'),

  listMembers: (id: string) => request<ProjectMember[]>(`/projects/${id}/members`, undefined, 'Loading members…'),
  searchWorkspaceUsers: (id: string, q: string) =>
    request<WorkspaceUser[]>(
      `/projects/${id}/workspace-users?q=${encodeURIComponent(q)}`,
      undefined,
      'Searching workspace users…',
    ),
  addMember: (id: string, user_email: string, role: string) =>
    request<AddMemberResponse>(
      `/projects/${id}/members`,
      { method: 'POST', body: JSON.stringify({ user_email, role }) },
      'Adding member…',
    ),
  removeMember: (id: string, email: string) =>
    request<ProjectMember[]>(
      `/projects/${id}/members/${encodeURIComponent(email)}`,
      { method: 'DELETE' },
      'Removing member…',
    ),

  saveFields: (id: string, fields: FieldDefinition[]) =>
    request<FieldDefinition[]>(
      `/projects/${id}/fields`,
      { method: 'PUT', body: JSON.stringify({ fields }) },
      'Saving draft…',
    ),
  listPublishedFields: (id: string) =>
    request<FieldDefinition[]>(`/projects/${id}/fields?published_only=true`, undefined, 'Loading fields…'),
  publishProject: (id: string) =>
    request<ProjectDetail>(`/projects/${id}/publish`, { method: 'POST' }, 'Publishing…', 120_000),

  listRecords: (id: string, params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return request<RecordRow[]>(
      `/projects/${id}/records${query ? `?${query}` : ''}`,
      undefined,
      'Loading records…',
      120_000,
    );
  },
  createRecord: (id: string, values: Record<string, unknown>) =>
    request<RecordRow>(
      `/projects/${id}/records`,
      { method: 'POST', body: JSON.stringify({ values }) },
      'Saving record…',
      60_000,
    ),
  updateRecord: (id: string, recordId: string, values: Record<string, unknown>) =>
    request<RecordRow>(
      `/projects/${id}/records/${recordId}`,
      { method: 'PATCH', body: JSON.stringify({ values }) },
      'Saving record…',
    ),
  deleteRecord: (id: string, recordId: string) =>
    request<void>(`/projects/${id}/records/${recordId}`, { method: 'DELETE' }, 'Deleting record…'),
  syncRecordsToUc: (id: string) =>
    request<SyncStagedRecordsResult>(
      `/projects/${id}/records/sync-to-uc`,
      { method: 'POST' },
      'Syncing to Unity Catalog…',
      120_000,
    ),
  getRecordAudit: (id: string, recordId: string) =>
    request<RecordAuditEntry[]>(
      `/projects/${id}/records/${recordId}/audit`,
      undefined,
      'Loading history…',
    ),
  exportRecords: async (id: string, filename: string) => {
    beginBusy('Exporting records…');
    try {
      const res = await fetch(`${BASE}/projects/${id}/records/export`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `API ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      endBusy();
    }
  },
  importRecordsCsv: (id: string, csv: string) =>
    request<ImportRecordsResult>(
      `/projects/${id}/records/import`,
      { method: 'POST', body: JSON.stringify({ csv }) },
      'Importing records…',
    ),

  getGenieStatus: (projectId: string) =>
    request<GenieStatus>(`/projects/${projectId}/genie/status`, undefined, 'Loading Genie status…'),
  provisionGenie: (projectId: string) =>
    request<GenieStatus>(
      `/projects/${projectId}/genie/provision`,
      { method: 'POST' },
      'Syncing Genie…',
    ),
  askGenie: (projectId: string, content: string, conversationId?: string) =>
    request<GenieAskResponse>(
      `/projects/${projectId}/genie/ask`,
      { method: 'POST', body: JSON.stringify({ content, conversation_id: conversationId }) },
      'Asking Genie…',
    ),

  listLookups: (projectId: string) =>
    request<LookupTable[]>(`/projects/${projectId}/lookups`, undefined, 'Loading lookups…'),
  previewUcTable: (projectId: string, catalog: string, schema: string, table: string) =>
    request<UcTablePreview>(
      `/projects/${projectId}/lookups/preview-uc-table?catalog=${encodeURIComponent(catalog)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`,
      undefined,
      'Loading table preview…',
    ),
  listUcSchemas: (projectId: string, catalog: string) =>
    request<string[]>(
      `/projects/${projectId}/lookups/uc-schemas?catalog=${encodeURIComponent(catalog)}`,
      undefined,
      'Loading schemas…',
    ),
  listUcTables: (projectId: string, catalog: string, schema: string) =>
    request<string[]>(
      `/projects/${projectId}/lookups/uc-tables?catalog=${encodeURIComponent(catalog)}&schema=${encodeURIComponent(schema)}`,
      undefined,
      'Loading tables…',
    ),
  bindLookup: (projectId: string, body: BindLookupPayload) =>
    request<LookupTable>(
      `/projects/${projectId}/lookups/bind`,
      { method: 'POST', body: JSON.stringify(body) },
      'Binding lookup…',
    ),
  createLookup: (projectId: string, body: { name: string; description?: string; columns?: LookupColumn[] }) =>
    request<LookupTable>(
      `/projects/${projectId}/lookups`,
      { method: 'POST', body: JSON.stringify(body) },
      'Creating lookup…',
    ),
  deleteLookup: (projectId: string, lookupId: string) =>
    request<void>(`/projects/${projectId}/lookups/${lookupId}`, { method: 'DELETE' }, 'Deleting lookup…'),
  importLookupCsv: (projectId: string, name: string, csv: string) =>
    request<LookupTable>(
      `/projects/${projectId}/lookups/import`,
      { method: 'POST', body: JSON.stringify({ name, csv }) },
      'Importing lookup…',
    ),
  importLookupRowsCsv: (projectId: string, lookupId: string, csv: string) =>
    request<LookupRow[]>(
      `/projects/${projectId}/lookups/${lookupId}/import`,
      { method: 'POST', body: JSON.stringify({ csv }) },
      'Importing rows…',
    ),
  getLookupRows: (projectId: string, lookupId: string) =>
    request<LookupRow[]>(`/projects/${projectId}/lookups/${lookupId}/rows`, undefined, 'Loading lookup rows…'),
  saveLookupRows: (projectId: string, lookupId: string, rows: LookupRow[]) =>
    request<LookupRow[]>(
      `/projects/${projectId}/lookups/${lookupId}/rows`,
      { method: 'PUT', body: JSON.stringify({ rows }) },
      'Saving lookup rows…',
    ),

  generateProject: (description: string) =>
    request<ProjectBlueprint>(
      '/ai/generate-project',
      { method: 'POST', body: JSON.stringify({ description }) },
      'Generating draft with AI…',
      120_000,
    ),
  createFromProposal: (proposal: ProjectBlueprint) =>
    request<ProjectDetail>(
      '/ai/create-from-proposal',
      { method: 'POST', body: JSON.stringify({ proposal }) },
      'Creating form…',
      120_000,
    ),
  generateLookup: (projectId: string, prompt: string) =>
    request<LookupProposal>(
      `/ai/projects/${projectId}/generate-lookup`,
      { method: 'POST', body: JSON.stringify({ prompt }) },
      'Generating lookup with AI…',
      120_000,
    ),
  applyLookupProposal: (projectId: string, proposal: LookupProposal) =>
    request<LookupTable>(
      `/ai/projects/${projectId}/apply-lookup`,
      { method: 'POST', body: JSON.stringify({ proposal }) },
      'Applying lookup…',
    ),
  refineProject: (
    projectId: string,
    body: {
      instruction: string;
      name: string;
      description?: string | null;
      fields: FieldDefinition[];
      lookups: LookupProposal[];
    },
  ) =>
    request<ProjectBlueprint>(
      `/ai/projects/${projectId}/refine`,
      { method: 'POST', body: JSON.stringify(body) },
      'Refining with AI…',
      120_000,
    ),
  applyProjectProposal: (projectId: string, body: ApplyProjectProposalPayload) =>
    request<ProjectDetail>(
      `/ai/projects/${projectId}/apply-proposal`,
      { method: 'POST', body: JSON.stringify(body) },
      'Applying changes…',
      120_000,
    ),
};
