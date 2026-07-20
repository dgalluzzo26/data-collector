export type ProjectRole = 'admin' | 'editor' | 'reader';
export type ProjectStatus = 'draft' | 'published' | 'archived';
export type StorageType = 'uc_delta' | 'lakebase';
export type StorageMode = 'managed' | 'existing_uc';
export type RecordSyncMode = 'immediate' | 'staged';
export type DuplicateKeyMode = 'retain' | 'overwrite';
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'single_select'
  | 'multi_select'
  | 'lookup'
  | 'email'
  | 'url';

export interface LookupColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'datetime' | 'boolean';
}

export interface LookupTable {
  lookup_id: string;
  project_id: string;
  name: string;
  slug: string;
  description?: string | null;
  columns: LookupColumn[];
  row_count: number;
  source: 'manual' | 'ai' | 'import' | 'uc_bind';
  source_catalog?: string | null;
  source_schema?: string | null;
  source_table?: string | null;
  created_at: string;
  created_by: string;
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface LookupRow {
  row_id: string;
  values: Record<string, unknown>;
  sort_order: number;
}

export interface UserInfo {
  email: string;
  display_name: string;
  is_app_admin?: boolean;
}

export interface BrandingColorSet {
  primary: string;
  primary_light: string;
  primary_dark: string;
  secondary: string;
  background: string;
  paper: string;
  text_primary: string;
  text_secondary: string;
}

export interface BrandingChrome {
  header_background: string;
  header_mid: string;
  header_accent: string;
  sidebar_background: string;
  sidebar_mid: string;
  sidebar_end: string;
}

export interface AppBranding {
  app_title: string;
  agency_name: string;
  logo_data_url: string | null;
  chrome: BrandingChrome;
  light: BrandingColorSet;
  dark: BrandingColorSet;
}

export interface WorkspaceUser {
  email: string;
  display_name: string;
}

export interface AddMemberResponse {
  members: ProjectMember[];
  app_access_granted: boolean;
  app_access_note?: string | null;
  uc_access_granted?: boolean;
  uc_access_note?: string | null;
}

export interface ProjectMember {
  project_id: string;
  user_email: string;
  role: ProjectRole;
  added_at: string;
  added_by: string;
}

export interface FieldDefinition {
  field_key: string;
  label: string;
  field_type: FieldType;
  config_json?: Record<string, unknown> | null;
  sort_order: number;
  is_required: boolean;
  schema_version: number;
  is_published: boolean;
}

export interface ProjectSummary {
  project_id: string;
  name: string;
  slug: string;
  description?: string | null;
  storage_type: StorageType;
  status: ProjectStatus;
  schema_version: number;
  role?: ProjectRole | null;
  created_at: string;
  created_by: string;
  updated_at?: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  target_catalog?: string | null;
  target_schema?: string | null;
  target_table?: string | null;
  storage_mode?: StorageMode;
  record_key_column?: string | null;
  record_sync_mode?: RecordSyncMode | null;
  duplicate_key_mode?: DuplicateKeyMode | null;
  staged_change_count?: number;
  sync_catalog?: string | null;
  sync_schema?: string | null;
  sync_table?: string | null;
  genie_space_id?: string | null;
  genie_status?: 'disabled' | 'pending' | 'ready' | 'error' | null;
  genie_last_synced_at?: string | null;
  genie_error?: string | null;
  members: ProjectMember[];
  fields: FieldDefinition[];
  lookups: LookupTable[];
}

export interface GenieStatus {
  enabled: boolean;
  status: string;
  space_id?: string | null;
  last_synced_at?: string | null;
  error?: string | null;
  ready: boolean;
}

export interface GenieAskResponse {
  conversation_id: string;
  message_id: string;
  answer_text: string;
  sql?: string | null;
  columns: string[];
  rows: unknown[][];
  suggested_questions: string[];
  status?: string | null;
  error?: string | null;
}

export interface RecordRow {
  record_id: string;
  values: Record<string, unknown>;
  created_at?: string | null;
  created_by?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface RecordAuditEntry {
  field_key?: string | null;
  field_label?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  changed_by: string;
  changed_at: string;
}

export interface ImportRecordsResult {
  created: number;
  updated?: number;
  skipped?: number;
  failed: Array<{ row: number; field_errors: Record<string, string> }>;
}

export interface RecordCsvColumnMapping {
  field_key: string;
  label: string;
  csv_header?: string | null;
  matched: boolean;
  included: boolean;
}

export interface RecordCsvPreview {
  columns: RecordCsvColumnMapping[];
  unmatched_csv_headers: string[];
  sample_rows: Record<string, unknown>[];
  row_count: number;
  header_row: number;
}

export interface SyncStagedRecordsResult {
  synced: number;
  inserted: number;
  updated: number;
  deleted: number;
}

export interface CreateProjectPayload {
  name: string;
  description?: string;
  storage_type?: StorageType;
  storage_mode?: StorageMode;
  record_key_column?: string;
  record_sync_mode?: RecordSyncMode;
  duplicate_key_mode?: DuplicateKeyMode;
  target_catalog?: string;
  target_schema?: string;
  target_table?: string;
  sync_catalog?: string;
  sync_schema?: string;
  sync_table?: string;
  seed_fields?: FieldDefinition[];
}

export interface LookupProposal {
  name: string;
  slug: string;
  description?: string | null;
  columns: LookupColumn[];
  rows: Record<string, unknown>[];
}

export interface ProjectBlueprint {
  name: string;
  description?: string | null;
  fields: FieldDefinition[];
  lookups: LookupProposal[];
}

export interface ApplyProjectProposalPayload {
  name?: string;
  description?: string;
  fields: FieldDefinition[];
  lookups?: LookupProposal[];
}

export interface AppConfig {
  status: string;
  app: string;
  catalog: string;
  schema: string;
  metadata_fqn: string;
  default_data_catalog: string;
  default_data_schema: string;
  warehouse_id?: string | null;
  warehouse_http_path?: string | null;
  db_status: string;
  db_error?: string | null;
  user_email: string;
  is_app_admin?: boolean;
  runtime: string;
  lakebase_configured?: boolean;
  lakebase_database?: string | null;
  lakebase_default_schema?: string;
  uc_data_access_mode?: 'hybrid' | 'service_principal' | 'user_obo';
}

export interface UcTablePreview {
  catalog: string;
  schema: string;
  table: string;
  columns: LookupColumn[];
  row_count: number;
  sample_rows: Record<string, unknown>[];
}

export interface InferredColumn {
  field_key: string;
  label: string;
  field_type: FieldType;
  config_json?: Record<string, unknown> | null;
  sort_order: number;
  is_required: boolean;
  included: boolean;
}

export interface CsvFormPreview {
  columns: InferredColumn[];
  sample_rows: Record<string, unknown>[];
  row_count: number;
  suggested_record_key: string;
  header_row: number;
}

export interface BindLookupPayload {
  name: string;
  description?: string;
  source_catalog: string;
  source_schema: string;
  source_table: string;
  columns?: LookupColumn[];
}
