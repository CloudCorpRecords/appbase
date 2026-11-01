/**
 * appbase types.
 *
 * Project-scoped tools take the Supabase project reference as
 * `project_id`, matching the documented tool schemas; account tools
 * take an `id` for a single project or organization. SQL tools pass
 * their statement through untouched. Edge-function deploys carry the
 * file list inline ({ name, content } per file).
 *
 * HTTP access is described by a minimal response surface so tests can
 * inject a fake fetch and never touch the network.
 */

export interface ProjectRef {
  project_id: string;
}

export interface IdRef {
  id: string;
}

export interface CreateProjectOptions {
  name: string;
  organization_id: string;
  region?: string;
  confirm_cost_id?: string;
}

export interface ListTablesOptions extends ProjectRef {
  schemas?: string[];
}

export interface ExecuteSqlOptions extends ProjectRef {
  query: string;
}

export interface ApplyMigrationOptions extends ProjectRef {
  name: string;
  query: string;
}

export interface GetLogsOptions extends ProjectRef {
  service: string;
}

export interface GetAdvisorsOptions extends ProjectRef {
  type: string;
}

export interface GenerateTypesOptions extends ProjectRef {
  included_schemas?: string[];
}

export interface GetEdgeFunctionOptions extends ProjectRef {
  function_slug: string;
}

export interface EdgeFunctionFile {
  name: string;
  content: string;
}

export interface DeployEdgeFunctionOptions extends ProjectRef {
  name: string;
  files: EdgeFunctionFile[];
  entrypoint_path?: string;
  import_map_path?: string;
}

export interface CreateStorageBucketOptions extends ProjectRef {
  name: string;
  public?: boolean;
  file_size_limit?: number;
  allowed_mime_types?: string[];
}

export interface CreateBranchOptions extends ProjectRef {
  name: string;
  confirm_cost_id?: string;
}

export interface BranchRef extends ProjectRef {
  branch_id: string;
}

export interface ResetBranchOptions extends BranchRef {
  migration_version?: string;
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;
