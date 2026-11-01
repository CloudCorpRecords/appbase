/**
 * appbase core: Supabase account, database, debugging, development,
 * functions, branching, and storage tools against the Supabase
 * Management API.
 *
 * Every call is a REST request under https://api.supabase.com/v1 with
 * the personal access token from SUPABASE_ACCESS_TOKEN sent as a
 * Bearer token:
 *
 *   account       GET/POST /projects, GET /projects/{ref},
 *                 POST /projects/{ref}/pause|restore,
 *                 GET /organizations, GET /organizations/{id}
 *   database      POST /projects/{ref}/database/query (execute_sql and
 *                 the introspection tools), GET/POST
 *                 /projects/{ref}/database/migrations
 *   debugging     GET /projects/{ref}/analytics/endpoints/logs.<svc>,
 *                 GET /projects/{ref}/advisors/{security|performance}
 *   development   GET /projects/{ref}/types/typescript,
 *                 GET /projects/{ref}/api-keys; the project URL is the
 *                 documented https://<ref>.supabase.co form
 *   functions     GET/POST /projects/{ref}/functions,
 *                 GET /projects/{ref}/functions/{slug}
 *   branching     GET/POST /projects/{ref}/branches, DELETE
 *                 /projects/{ref}/branches/{id}, POST .../merge,
 *                 .../reset, .../rebase
 *   storage       GET/POST /projects/{ref}/storage/buckets
 *
 * list_tables / list_extensions are catalog queries run through the
 * same database/query endpoint the upstream server uses for them, with
 * the SQL built here. All other SQL passes through as given.
 *
 * A missing token is an error before any request is made, and the
 * error names the SUPABASE_ACCESS_TOKEN variable. All HTTP goes
 * through an injected FetchFn so everything is testable offline.
 */
import type {
  ApplyMigrationOptions,
  BranchRef,
  CreateBranchOptions,
  CreateProjectOptions,
  CreateStorageBucketOptions,
  DeployEdgeFunctionOptions,
  ExecuteSqlOptions,
  FetchFn,
  GenerateTypesOptions,
  GetAdvisorsOptions,
  GetEdgeFunctionOptions,
  GetLogsOptions,
  IdRef,
  ListTablesOptions,
  ProjectRef,
  ResetBranchOptions,
} from "./types.js";

export const VERSION = "0.1.0";

export const API_BASE = "https://api.supabase.com/v1";

export const API_KEY_ENV = "SUPABASE_ACCESS_TOKEN";

/** The honest missing-token error. Names the variable, never a value. */
export function requireApiKey(apiKey: string | undefined): string {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN environment variable is required: set SUPABASE_ACCESS_TOKEN to a Supabase personal access token and retry",
    );
  }
  return key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmpty(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new Error(`${field} must be a non-empty string`);
  return v;
}

function ref(options: ProjectRef): string {
  return encodeURIComponent(requireNonEmpty(options.project_id, "project_id"));
}

/** One Management API request; returns the parsed JSON payload. */
export async function apiRequest(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  method: string,
  path: string,
  options: {
    query?: Record<string, string>;
    body?: unknown;
    contentType?: string;
    rawBody?: string;
  } = {},
): Promise<unknown> {
  const key = requireApiKey(apiKey);
  const qs = options.query
    ? `?${new URLSearchParams(options.query).toString()}`
    : "";
  const hasBody = options.body !== undefined || options.rawBody !== undefined;
  let response;
  try {
    response = await fetchFn(`${API_BASE}${path}${qs}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        ...(hasBody
          ? { "Content-Type": options.contentType ?? "application/json" }
          : {}),
      },
      ...(hasBody
        ? {
            body:
              options.rawBody ??
              (JSON.stringify(options.body) as string),
          }
        : {}),
    });
  } catch (err) {
    throw new Error(
      `Supabase Management API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    let detail = "";
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && typeof payload.message === "string") {
        detail = `: ${payload.message}`;
      }
    } catch {
      // keep the status-only error
    }
    throw new Error(
      `Supabase Management API request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail}`,
    );
  }
  if (response.status === 204) return { ok: true, status: 204 };
  const contentType = response.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) return await response.json();
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  } catch {
    return { ok: true, status: response.status };
  }
}

/** Run SQL through the project's database/query endpoint. */
export async function executeSql(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ExecuteSqlOptions,
): Promise<unknown> {
  const query = requireNonEmpty(options.query, "query");
  return apiRequest(
    fetchFn,
    apiKey,
    "POST",
    `/projects/${ref(options)}/database/query`,
    { body: { query } },
  );
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** List tables in the given schemas (a pg_catalog query, as upstream). */
export async function listTables(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ListTablesOptions,
): Promise<unknown> {
  const schemas =
    options.schemas && options.schemas.length > 0
      ? options.schemas
      : ["public"];
  const inList = schemas.map(quoteLiteral).join(", ");
  const query =
    "SELECT schemaname AS schema, tablename AS name, tableowner AS owner " +
    `FROM pg_catalog.pg_tables WHERE schemaname IN (${inList}) ORDER BY schemaname, tablename`;
  return executeSql(fetchFn, apiKey, { project_id: options.project_id, query });
}

/** List installed extensions (a pg_extension query, as upstream). */
export async function listExtensions(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ProjectRef,
): Promise<unknown> {
  const query =
    "SELECT name, default_version, installed_version, comment FROM pg_catalog.pg_available_extensions WHERE installed_version IS NOT NULL ORDER BY name";
  return executeSql(fetchFn, apiKey, { project_id: options.project_id, query });
}

/** List applied migrations from the Management API. */
export async function listMigrations(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ProjectRef,
): Promise<unknown> {
  return apiRequest(
    fetchFn,
    apiKey,
    "GET",
    `/projects/${ref(options)}/database/migrations`,
  );
}

/** Apply a named migration; its SQL is tracked as a migration. */
export async function applyMigration(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ApplyMigrationOptions,
): Promise<unknown> {
  const name = requireNonEmpty(options.name, "name");
  const query = requireNonEmpty(options.query, "query");
  return apiRequest(
    fetchFn,
    apiKey,
    "POST",
    `/projects/${ref(options)}/database/migrations`,
    { body: { name, query } },
  );
}

const LOG_ENDPOINT: Record<string, string> = {
  api: "logs.all",
  postgres: "logs.postgres",
  "edge-function": "logs.edge",
  auth: "logs.auth",
  storage: "logs.storage",
  realtime: "logs.realtime",
  "branch-action": "logs.branch-action",
};

/** Recent logs for one project service (analytics endpoint). */
export async function getLogs(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: GetLogsOptions,
): Promise<unknown> {
  const service = requireNonEmpty(options.service, "service");
  const endpoint = LOG_ENDPOINT[service];
  if (!endpoint) {
    throw new Error(
      `service must be one of: ${Object.keys(LOG_ENDPOINT).join(", ")}`,
    );
  }
  return apiRequest(
    fetchFn,
    apiKey,
    "GET",
    `/projects/${ref(options)}/analytics/endpoints/${endpoint}`,
  );
}

/** Security or performance advisors for a project. */
export async function getAdvisors(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: GetAdvisorsOptions,
): Promise<unknown> {
  const type = requireNonEmpty(options.type, "type");
  if (type !== "security" && type !== "performance") {
    throw new Error('type must be "security" or "performance"');
  }
  return apiRequest(
    fetchFn,
    apiKey,
    "GET",
    `/projects/${ref(options)}/advisors/${type}`,
  );
}

/** The project's API URL, in its documented https://<ref>.supabase.co form. */
export async function getProjectUrl(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ProjectRef,
): Promise<unknown> {
  requireApiKey(apiKey);
  const projectId = requireNonEmpty(options.project_id, "project_id");
  return `https://${projectId}.supabase.co`;
}

/** The project's publishable / anon API keys. */
export async function getPublishableKeys(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ProjectRef,
): Promise<unknown> {
  return apiRequest(fetchFn, apiKey, "GET", `/projects/${ref(options)}/api-keys`);
}

/** Generate TypeScript types from the live database schema. */
export async function generateTypescriptTypes(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: GenerateTypesOptions,
): Promise<unknown> {
  const query: Record<string, string> = {};
  if (options.included_schemas && options.included_schemas.length > 0) {
    query.included_schemas = options.included_schemas.join(",");
  }
  return apiRequest(
    fetchFn,
    apiKey,
    "GET",
    `/projects/${ref(options)}/types/typescript`,
    { query },
  );
}

/** List a project's edge functions. */
export async function listEdgeFunctions(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ProjectRef,
): Promise<unknown> {
  return apiRequest(fetchFn, apiKey, "GET", `/projects/${ref(options)}/functions`);
}

/** Get one edge function by slug. */
export async function getEdgeFunction(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: GetEdgeFunctionOptions,
): Promise<unknown> {
  const slug = requireNonEmpty(options.function_slug, "function_slug");
  return apiRequest(
    fetchFn,
    apiKey,
    "GET",
    `/projects/${ref(options)}/functions/${encodeURIComponent(slug)}`,
  );
}

/**
 * Deploy an edge function: a multipart/form-data POST whose metadata
 * part names the entrypoint (and import map) and whose file parts
 * carry each file's content, per the Management API deploy contract.
 */
export async function deployEdgeFunction(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: DeployEdgeFunctionOptions,
): Promise<unknown> {
  const name = requireNonEmpty(options.name, "name");
  if (!Array.isArray(options.files) || options.files.length === 0) {
    throw new Error("files must be a non-empty array of { name, content }");
  }
  const entrypoint = options.entrypoint_path ?? "index.ts";
  const metadata: Record<string, unknown> = {
    name,
    entrypoint_path: entrypoint,
    verify_jwt: true,
  };
  if (options.import_map_path) metadata.import_map_path = options.import_map_path;
  const boundary = `appbase-${Math.random().toString(36).slice(2)}`;
  const parts: string[] = [
    `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}`,
  ];
  for (const file of options.files) {
    const fileName = requireNonEmpty(file.name, "files[].name");
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/typescript\r\n\r\n${file.content}`,
    );
  }
  const rawBody = `${parts.join("\r\n")}\r\n--${boundary}--\r\n`;
  return apiRequest(
    fetchFn,
    apiKey,
    "POST",
    `/projects/${ref(options)}/functions`,
    {
      query: { slug: name },
      rawBody,
      contentType: `multipart/form-data; boundary=${boundary}`,
    },
  );
}

/** List storage buckets in a project. */
export async function listStorageBuckets(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ProjectRef,
): Promise<unknown> {
  return apiRequest(
    fetchFn,
    apiKey,
    "GET",
    `/projects/${ref(options)}/storage/buckets`,
  );
}

/** Create a storage bucket. */
export async function createStorageBucket(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CreateStorageBucketOptions,
): Promise<unknown> {
  const name = requireNonEmpty(options.name, "name");
  const body: Record<string, unknown> = { id: name, name };
  if (options.public !== undefined) body.public = options.public;
  if (options.file_size_limit !== undefined) {
    body.file_size_limit = options.file_size_limit;
  }
  if (options.allowed_mime_types !== undefined) {
    body.allowed_mime_types = options.allowed_mime_types;
  }
  return apiRequest(
    fetchFn,
    apiKey,
    "POST",
    `/projects/${ref(options)}/storage/buckets`,
    { body },
  );
}

/** List a project's preview branches. */
export async function listBranches(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ProjectRef,
): Promise<unknown> {
  return apiRequest(fetchFn, apiKey, "GET", `/projects/${ref(options)}/branches`);
}

/** Create a preview branch. */
export async function createBranch(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CreateBranchOptions,
): Promise<unknown> {
  const name = requireNonEmpty(options.name, "name");
  const body: Record<string, unknown> = { branch_name: name };
  if (options.confirm_cost_id) body.confirm_cost_id = options.confirm_cost_id;
  return apiRequest(
    fetchFn,
    apiKey,
    "POST",
    `/projects/${ref(options)}/branches`,
    { body },
  );
}

function branchPath(options: BranchRef): string {
  const branchId = requireNonEmpty(options.branch_id, "branch_id");
  return `/projects/${ref(options)}/branches/${encodeURIComponent(branchId)}`;
}

/** Delete a preview branch. */
export async function deleteBranch(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: BranchRef,
): Promise<unknown> {
  return apiRequest(fetchFn, apiKey, "DELETE", branchPath(options));
}

/** Merge a preview branch into production. */
export async function mergeBranch(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: BranchRef,
): Promise<unknown> {
  return apiRequest(fetchFn, apiKey, "POST", `${branchPath(options)}/merge`, {
    body: {},
  });
}

/** Reset a preview branch to its parent's state. */
export async function resetBranch(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ResetBranchOptions,
): Promise<unknown> {
  const body: Record<string, unknown> = {};
  if (options.migration_version) body.migration_version = options.migration_version;
  return apiRequest(fetchFn, apiKey, "POST", `${branchPath(options)}/reset`, {
    body,
  });
}

/** Rebase a preview branch onto its parent's latest state. */
export async function rebaseBranch(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: BranchRef,
): Promise<unknown> {
  return apiRequest(fetchFn, apiKey, "POST", `${branchPath(options)}/rebase`, {
    body: {},
  });
}

/** List all projects for the user. */
export async function listProjects(
  fetchFn: FetchFn,
  apiKey: string | undefined,
): Promise<unknown> {
  return apiRequest(fetchFn, apiKey, "GET", "/projects");
}

/** Get details for one project. */
export async function getProject(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: IdRef,
): Promise<unknown> {
  const id = requireNonEmpty(options.id, "id");
  return apiRequest(fetchFn, apiKey, "GET", `/projects/${encodeURIComponent(id)}`);
}

/** Create a new project in an organization. */
export async function createProject(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CreateProjectOptions,
): Promise<unknown> {
  const name = requireNonEmpty(options.name, "name");
  const organizationId = requireNonEmpty(options.organization_id, "organization_id");
  const body: Record<string, unknown> = {
    name,
    organization_id: organizationId,
  };
  if (options.region) body.region = options.region;
  if (options.confirm_cost_id) body.confirm_cost_id = options.confirm_cost_id;
  return apiRequest(fetchFn, apiKey, "POST", "/projects", { body });
}

/** Pause a project. */
export async function pauseProject(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ProjectRef,
): Promise<unknown> {
  return apiRequest(fetchFn, apiKey, "POST", `/projects/${ref(options)}/pause`, {
    body: {},
  });
}

/** Restore a paused project. */
export async function restoreProject(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ProjectRef,
): Promise<unknown> {
  return apiRequest(fetchFn, apiKey, "POST", `/projects/${ref(options)}/restore`, {
    body: {},
  });
}

/** List organizations the user is a member of. */
export async function listOrganizations(
  fetchFn: FetchFn,
  apiKey: string | undefined,
): Promise<unknown> {
  return apiRequest(fetchFn, apiKey, "GET", "/organizations");
}

/** Get details for one organization. */
export async function getOrganization(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: IdRef,
): Promise<unknown> {
  const id = requireNonEmpty(options.id, "id");
  return apiRequest(
    fetchFn,
    apiKey,
    "GET",
    `/organizations/${encodeURIComponent(id)}`,
  );
}
