#!/usr/bin/env node
/**
 * appbase CLI.
 *
 *   appbase <tool-name> [--json '<arguments>']
 *   appbase mcp
 *   appbase --version
 *
 * Every MCP tool is also a subcommand: `appbase list_projects`,
 * `appbase execute_sql --json '{"project_id":"...","query":"select 1"}'`.
 * Results print as JSON. Reads the Supabase access token from
 * SUPABASE_ACCESS_TOKEN.
 * Exit codes: 0 success, 1 API error, 2 usage error.
 */
import {
  API_KEY_ENV,
  applyMigration,
  createBranch,
  createProject,
  createStorageBucket,
  deleteBranch,
  deployEdgeFunction,
  executeSql,
  generateTypescriptTypes,
  getAdvisors,
  getEdgeFunction,
  getLogs,
  getOrganization,
  getProject,
  getProjectUrl,
  getPublishableKeys,
  listBranches,
  listEdgeFunctions,
  listExtensions,
  listMigrations,
  listOrganizations,
  listProjects,
  listStorageBuckets,
  listTables,
  mergeBranch,
  pauseProject,
  rebaseBranch,
  requireApiKey,
  resetBranch,
  restoreProject,
  VERSION,
} from "./supabase.js";
import type { FetchFn } from "./types.js";

const TOOL_NAMES = [
  "list_tables",
  "list_extensions",
  "list_migrations",
  "execute_sql",
  "apply_migration",
  "get_logs",
  "get_advisors",
  "get_project_url",
  "get_publishable_keys",
  "generate_typescript_types",
  "list_edge_functions",
  "get_edge_function",
  "deploy_edge_function",
  "list_storage_buckets",
  "create_storage_bucket",
  "list_branches",
  "create_branch",
  "delete_branch",
  "merge_branch",
  "reset_branch",
  "rebase_branch",
  "list_projects",
  "get_project",
  "create_project",
  "pause_project",
  "restore_project",
  "list_organizations",
  "get_organization",
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

function usage(): never {
  console.error(`Usage:
  appbase <tool-name> [--json '<arguments>']
  appbase mcp
  appbase --version

Tools:
  ${TOOL_NAMES.join("\n  ")}`);
  process.exit(2);
}

function parseArgsJson(rest: string[]): Record<string, unknown> {
  const idx = rest.indexOf("--json");
  if (idx < 0) {
    const positional = rest.join(" ").trim();
    if (!positional) return {};
    try {
      return JSON.parse(positional) as Record<string, unknown>;
    } catch {
      usage();
    }
  }
  const raw = rest[idx + 1];
  if (!raw) usage();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.error("error: --json value is not valid JSON");
    process.exit(2);
  }
}

async function runTool(
  name: ToolName,
  fetchFn: FetchFn,
  apiKey: string | undefined,
  args: Record<string, unknown>,
): Promise<unknown> {
  // The CLI passes raw JSON arguments; the core validates what it needs.
  const a = args as never;
  switch (name) {
    case "list_tables":
      return listTables(fetchFn, apiKey, a);
    case "list_extensions":
      return listExtensions(fetchFn, apiKey, a);
    case "list_migrations":
      return listMigrations(fetchFn, apiKey, a);
    case "execute_sql":
      return executeSql(fetchFn, apiKey, a);
    case "apply_migration":
      return applyMigration(fetchFn, apiKey, a);
    case "get_logs":
      return getLogs(fetchFn, apiKey, a);
    case "get_advisors":
      return getAdvisors(fetchFn, apiKey, a);
    case "get_project_url":
      requireApiKey(apiKey);
      return getProjectUrl(fetchFn, apiKey, a);
    case "get_publishable_keys":
      return getPublishableKeys(fetchFn, apiKey, a);
    case "generate_typescript_types":
      return generateTypescriptTypes(fetchFn, apiKey, a);
    case "list_edge_functions":
      return listEdgeFunctions(fetchFn, apiKey, a);
    case "get_edge_function":
      return getEdgeFunction(fetchFn, apiKey, a);
    case "deploy_edge_function":
      return deployEdgeFunction(fetchFn, apiKey, a);
    case "list_storage_buckets":
      return listStorageBuckets(fetchFn, apiKey, a);
    case "create_storage_bucket":
      return createStorageBucket(fetchFn, apiKey, a);
    case "list_branches":
      return listBranches(fetchFn, apiKey, a);
    case "create_branch":
      return createBranch(fetchFn, apiKey, a);
    case "delete_branch":
      return deleteBranch(fetchFn, apiKey, a);
    case "merge_branch":
      return mergeBranch(fetchFn, apiKey, a);
    case "reset_branch":
      return resetBranch(fetchFn, apiKey, a);
    case "rebase_branch":
      return rebaseBranch(fetchFn, apiKey, a);
    case "list_projects":
      return listProjects(fetchFn, apiKey);
    case "get_project":
      return getProject(fetchFn, apiKey, a);
    case "create_project":
      return createProject(fetchFn, apiKey, a);
    case "pause_project":
      return pauseProject(fetchFn, apiKey, a);
    case "restore_project":
      return restoreProject(fetchFn, apiKey, a);
    case "list_organizations":
      return listOrganizations(fetchFn, apiKey);
    case "get_organization":
      return getOrganization(fetchFn, apiKey, a);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd || !(TOOL_NAMES as readonly string[]).includes(cmd)) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const apiKey = process.env[API_KEY_ENV];
  try {
    const args = parseArgsJson(rest);
    const out = await runTool(cmd as ToolName, fetchFn, apiKey, args);
    console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
