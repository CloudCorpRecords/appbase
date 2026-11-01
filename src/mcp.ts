/**
 * appbase MCP server: 28 tools covering Supabase account management,
 * database introspection and SQL, migrations, logs and advisors,
 * development helpers, edge functions, preview branches, and storage
 * buckets.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects keys that are not in
 * this tool's public spec ("$schema" and "additionalProperties"), which
 * breaks exact tool-list/schema parity with the spec. This file serves
 * tools/list with the spec's exact input schemas as explicit literals,
 * while zod still validates every tools/call argument set. Tool names,
 * parameters, and required sets are taken from the public spec.
 *
 * The Supabase access token is read from SUPABASE_ACCESS_TOKEN at call
 * time; a missing token returns an honest isError result naming the
 * variable instead of failing the handshake.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
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
  resetBranch,
  restoreProject,
  VERSION,
} from "./supabase.js";
import type { FetchFn } from "./types.js";

const ProjectRefArgs = z.object({
  project_id: z.string(),
});

const IdArgs = z.object({
  id: z.string(),
});

const NoArgs = z.object({});

const ListTablesArgs = z.object({
  project_id: z.string(),
  schemas: z.array(z.string()).optional(),
});

const ExecuteSqlArgs = z.object({
  project_id: z.string(),
  query: z.string(),
});

const ApplyMigrationArgs = z.object({
  project_id: z.string(),
  name: z.string(),
  query: z.string(),
});

const GetLogsArgs = z.object({
  project_id: z.string(),
  service: z.string(),
});

const GetAdvisorsArgs = z.object({
  project_id: z.string(),
  type: z.string(),
});

const GenerateTypesArgs = z.object({
  project_id: z.string(),
  included_schemas: z.array(z.string()).optional(),
});

const GetEdgeFunctionArgs = z.object({
  project_id: z.string(),
  function_slug: z.string(),
});

const DeployEdgeFunctionArgs = z.object({
  project_id: z.string(),
  name: z.string(),
  files: z.array(z.object({ name: z.string(), content: z.string() })),
  entrypoint_path: z.string().optional(),
  import_map_path: z.string().optional(),
});

const CreateStorageBucketArgs = z.object({
  project_id: z.string(),
  name: z.string(),
  public: z.boolean().optional(),
  file_size_limit: z.number().optional(),
  allowed_mime_types: z.array(z.string()).optional(),
});

const CreateBranchArgs = z.object({
  project_id: z.string(),
  name: z.string(),
  confirm_cost_id: z.string().optional(),
});

const BranchRefArgs = z.object({
  project_id: z.string(),
  branch_id: z.string(),
});

const ResetBranchArgs = z.object({
  project_id: z.string(),
  branch_id: z.string(),
  migration_version: z.string().optional(),
});

const CreateProjectArgs = z.object({
  name: z.string(),
  organization_id: z.string(),
  region: z.string().optional(),
  confirm_cost_id: z.string().optional(),
});

const TOOLS = [
  {
    name: "list_tables",
    description: "Lists all tables within the specified schemas.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project whose tables are listed." },
        schemas: { type: "array", items: { type: "string" }, description: "The database schemas to list tables from, defaulting to public when omitted." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "list_extensions",
    description: "Lists all extensions in the database.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project whose database extensions are listed." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "list_migrations",
    description: "Lists all migrations in the database.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project whose migrations are listed." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "execute_sql",
    description: "Executes raw SQL in the database.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project to run the SQL against." },
        query: { type: "string", description: "The raw SQL query to execute in the project's database." },
      },
      required: ["project_id", "query"],
    },
  },
  {
    name: "apply_migration",
    description: "Applies a SQL migration to the database. SQL passed to this tool will be tracked within the database, so use this for DDL operations (schema changes).",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project to apply the migration to." },
        name: { type: "string", description: "The name of the migration to record in the database." },
        query: { type: "string", description: "The SQL statements of the migration to apply." },
      },
      required: ["project_id", "name", "query"],
    },
  },
  {
    name: "get_logs",
    description: "Gets logs for a Supabase project by service (api, postgres, edge-function, auth, storage, realtime, or branch-action).",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project whose logs are retrieved." },
        service: { type: "string", description: "The service to get logs for, one of api, postgres, edge-function, auth, storage, realtime, or branch-action." },
      },
      required: ["project_id", "service"],
    },
  },
  {
    name: "get_advisors",
    description: "Gets advisory notices for a Supabase project, by type: security or performance.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project whose advisors are retrieved." },
        type: { type: "string", description: "The type of advisory notices to get, either security or performance." },
      },
      required: ["project_id", "type"],
    },
  },
  {
    name: "get_project_url",
    description: "Gets the API URL for a Supabase project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project whose API URL is returned." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "get_publishable_keys",
    description: "Gets the publishable and anon API keys for a Supabase project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project whose publishable and anon API keys are returned." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "generate_typescript_types",
    description: "Generates TypeScript types based on the database schema.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project to generate TypeScript types for." },
        included_schemas: { type: "array", items: { type: "string" }, description: "The database schemas to include when generating the TypeScript types." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "list_edge_functions",
    description: "Lists all Edge Functions in a Supabase project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project whose Edge Functions are listed." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "get_edge_function",
    description: "Gets details for an Edge Function by slug.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project that owns the Edge Function." },
        function_slug: { type: "string", description: "The slug of the Edge Function to retrieve." },
      },
      required: ["project_id", "function_slug"],
    },
  },
  {
    name: "deploy_edge_function",
    description: "Deploys an Edge Function to a Supabase project from inline files.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project to deploy the Edge Function to." },
        name: { type: "string", description: "The name of the Edge Function to deploy." },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "The file name of this Edge Function file." },
              content: { type: "string", description: "The source content of this Edge Function file." },
            },
            required: ["name", "content"],
          },
          description: "The inline files that make up the Edge Function, each with a name and content.",
        },
        entrypoint_path: { type: "string", description: "The path of the entrypoint file for the Edge Function." },
        import_map_path: { type: "string", description: "The path of the import map file for the Edge Function." },
      },
      required: ["project_id", "name", "files"],
    },
  },
  {
    name: "list_storage_buckets",
    description: "Lists all storage buckets in a Supabase project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project whose storage buckets are listed." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "create_storage_bucket",
    description: "Creates a new storage bucket in a Supabase project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project to create the storage bucket in." },
        name: { type: "string", description: "The name of the new storage bucket." },
        public: { type: "boolean", description: "Whether the new storage bucket is publicly accessible." },
        file_size_limit: { type: "number", description: "The maximum file size allowed for uploads to the bucket." },
        allowed_mime_types: { type: "array", items: { type: "string" }, description: "The MIME types allowed for files uploaded to the bucket." },
      },
      required: ["project_id", "name"],
    },
  },
  {
    name: "list_branches",
    description: "Lists all development branches for a Supabase project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project whose development branches are listed." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "create_branch",
    description: "Creates a new development branch for a Supabase project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project to create the development branch in." },
        name: { type: "string", description: "The name of the new development branch." },
        confirm_cost_id: { type: "string", description: "The cost confirmation ID authorizing the branch creation charge, if one was obtained." },
      },
      required: ["project_id", "name"],
    },
  },
  {
    name: "delete_branch",
    description: "Deletes a development branch from a Supabase project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project that owns the development branch." },
        branch_id: { type: "string", description: "The ID of the development branch to delete." },
      },
      required: ["project_id", "branch_id"],
    },
  },
  {
    name: "merge_branch",
    description: "Merges migrations and edge functions from a development branch into production.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project that owns the development branch." },
        branch_id: { type: "string", description: "The ID of the development branch to merge into production." },
      },
      required: ["project_id", "branch_id"],
    },
  },
  {
    name: "reset_branch",
    description: "Resets a development branch to its parent state, optionally at a migration version.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project that owns the development branch." },
        branch_id: { type: "string", description: "The ID of the development branch to reset." },
        migration_version: { type: "string", description: "The optional migration version to reset the branch to." },
      },
      required: ["project_id", "branch_id"],
    },
  },
  {
    name: "rebase_branch",
    description: "Rebases a development branch on its parent, applying newer migrations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project that owns the development branch." },
        branch_id: { type: "string", description: "The ID of the development branch to rebase on its parent." },
      },
      required: ["project_id", "branch_id"],
    },
  },
  {
    name: "list_projects",
    description: "Lists all Supabase projects for the user.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_project",
    description: "Gets details for a project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The ID of the project to retrieve details for." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_project",
    description: "Creates a new Supabase project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "The name of the new Supabase project." },
        organization_id: { type: "string", description: "The ID of the organization to create the new project in." },
        region: { type: "string", description: "The region to create the new project in." },
        confirm_cost_id: { type: "string", description: "The cost confirmation ID authorizing the project creation charge, if one was obtained." },
      },
      required: ["name", "organization_id"],
    },
  },
  {
    name: "pause_project",
    description: "Pauses a project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project to pause." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "restore_project",
    description: "Restores a project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "The reference ID of the Supabase project to restore." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "list_organizations",
    description: "Lists all organizations that the user is a member of.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_organization",
    description: "Gets details for an organization.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The ID of the organization to retrieve details for." },
      },
      required: ["id"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "appbase", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const apiKey = process.env.SUPABASE_ACCESS_TOKEN;
  try {
    let out: unknown;
    switch (name) {
      case "list_tables":
        out = await listTables(fetchFn, apiKey, ListTablesArgs.parse(args ?? {}));
        break;
      case "list_extensions":
        out = await listExtensions(fetchFn, apiKey, ProjectRefArgs.parse(args ?? {}));
        break;
      case "list_migrations":
        out = await listMigrations(fetchFn, apiKey, ProjectRefArgs.parse(args ?? {}));
        break;
      case "execute_sql":
        out = await executeSql(fetchFn, apiKey, ExecuteSqlArgs.parse(args ?? {}));
        break;
      case "apply_migration":
        out = await applyMigration(fetchFn, apiKey, ApplyMigrationArgs.parse(args ?? {}));
        break;
      case "get_logs":
        out = await getLogs(fetchFn, apiKey, GetLogsArgs.parse(args ?? {}));
        break;
      case "get_advisors":
        out = await getAdvisors(fetchFn, apiKey, GetAdvisorsArgs.parse(args ?? {}));
        break;
      case "get_project_url":
        out = await getProjectUrl(fetchFn, apiKey, ProjectRefArgs.parse(args ?? {}));
        break;
      case "get_publishable_keys":
        out = await getPublishableKeys(fetchFn, apiKey, ProjectRefArgs.parse(args ?? {}));
        break;
      case "generate_typescript_types":
        out = await generateTypescriptTypes(fetchFn, apiKey, GenerateTypesArgs.parse(args ?? {}));
        break;
      case "list_edge_functions":
        out = await listEdgeFunctions(fetchFn, apiKey, ProjectRefArgs.parse(args ?? {}));
        break;
      case "get_edge_function":
        out = await getEdgeFunction(fetchFn, apiKey, GetEdgeFunctionArgs.parse(args ?? {}));
        break;
      case "deploy_edge_function":
        out = await deployEdgeFunction(fetchFn, apiKey, DeployEdgeFunctionArgs.parse(args ?? {}));
        break;
      case "list_storage_buckets":
        out = await listStorageBuckets(fetchFn, apiKey, ProjectRefArgs.parse(args ?? {}));
        break;
      case "create_storage_bucket":
        out = await createStorageBucket(fetchFn, apiKey, CreateStorageBucketArgs.parse(args ?? {}));
        break;
      case "list_branches":
        out = await listBranches(fetchFn, apiKey, ProjectRefArgs.parse(args ?? {}));
        break;
      case "create_branch":
        out = await createBranch(fetchFn, apiKey, CreateBranchArgs.parse(args ?? {}));
        break;
      case "delete_branch":
        out = await deleteBranch(fetchFn, apiKey, BranchRefArgs.parse(args ?? {}));
        break;
      case "merge_branch":
        out = await mergeBranch(fetchFn, apiKey, BranchRefArgs.parse(args ?? {}));
        break;
      case "reset_branch":
        out = await resetBranch(fetchFn, apiKey, ResetBranchArgs.parse(args ?? {}));
        break;
      case "rebase_branch":
        out = await rebaseBranch(fetchFn, apiKey, BranchRefArgs.parse(args ?? {}));
        break;
      case "list_projects":
        NoArgs.parse(args ?? {});
        out = await listProjects(fetchFn, apiKey);
        break;
      case "get_project":
        out = await getProject(fetchFn, apiKey, IdArgs.parse(args ?? {}));
        break;
      case "create_project":
        out = await createProject(fetchFn, apiKey, CreateProjectArgs.parse(args ?? {}));
        break;
      case "pause_project":
        out = await pauseProject(fetchFn, apiKey, ProjectRefArgs.parse(args ?? {}));
        break;
      case "restore_project":
        out = await restoreProject(fetchFn, apiKey, ProjectRefArgs.parse(args ?? {}));
        break;
      case "list_organizations":
        NoArgs.parse(args ?? {});
        out = await listOrganizations(fetchFn, apiKey);
        break;
      case "get_organization":
        out = await getOrganization(fetchFn, apiKey, IdArgs.parse(args ?? {}));
        break;
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(out);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
