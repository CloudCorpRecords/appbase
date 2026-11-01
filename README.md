# appbase

appbase puts a Supabase account within reach of an MCP client or a
terminal. Projects and organizations can be listed, inspected,
created, paused, and restored. Inside a project you can look at the
schema (tables, extensions, migrations), run SQL or apply a tracked
migration, read logs and security/performance advisors, fetch the
project URL and publishable keys, generate TypeScript types from the
live schema, list and deploy Edge Functions, manage storage buckets,
and work with preview branches — create, merge, reset, rebase, and
delete them.

A Supabase personal access token is required. Put it in the
`SUPABASE_ACCESS_TOKEN` environment variable; it is sent to the
Supabase Management API as a Bearer token and never appears in
output. When the variable is missing, every call fails with an error
that names it.

## Install

```bash
npx @reneturcios/appbase list_projects
```

Or run the container image:

```bash
docker run -i -e SUPABASE_ACCESS_TOKEN ghcr.io/cloudcorprecords/appbase
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

Every MCP tool is also a CLI subcommand. Tool arguments are passed as
one JSON object with `--json`; project-scoped tools take the project
reference as `project_id`:

```bash
export SUPABASE_ACCESS_TOKEN=<your Supabase personal access token>

appbase list_projects
appbase list_tables --json '{"project_id": "abcdefghijklmnopqrst"}'
appbase execute_sql --json '{"project_id": "abcdefghijklmnopqrst", "query": "select 1"}'
appbase get_advisors --json '{"project_id": "abcdefghijklmnopqrst", "type": "security"}'
appbase create_branch --json '{"project_id": "abcdefghijklmnopqrst", "name": "feat-x"}'

appbase --version
```

Results print as JSON. Exit codes: `0` on success, `1` when an API
call fails (including a missing `SUPABASE_ACCESS_TOKEN`), `2` for
usage errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/appbase mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "appbase": {
      "command": "npx",
      "args": ["-y", "@reneturcios/appbase", "mcp"],
      "env": { "SUPABASE_ACCESS_TOKEN": "your Supabase personal access token" }
    }
  }
}
```

### Tools

| Tool | Input (required in bold) | What it does |
| --- | --- | --- |
| `list_tables` | **`project_id`**, `schemas` | Lists tables in the given schemas (default `public`). |
| `list_extensions` | **`project_id`** | Lists installed database extensions. |
| `list_migrations` | **`project_id`** | Lists applied migrations. |
| `execute_sql` | **`project_id`**, **`query`** | Runs raw SQL in the project's database. |
| `apply_migration` | **`project_id`**, **`name`**, **`query`** | Applies SQL as a tracked migration (for DDL). |
| `get_logs` | **`project_id`**, **`service`** | Recent logs for one service. |
| `get_advisors` | **`project_id`**, **`type`** | Security or performance advisors. |
| `get_project_url` | **`project_id`** | The project's `https://<ref>.supabase.co` API URL. |
| `get_publishable_keys` | **`project_id`** | Publishable / anon API keys for the project. |
| `generate_typescript_types` | **`project_id`**, `included_schemas` | TypeScript types generated from the schema. |
| `list_edge_functions` | **`project_id`** | Lists Edge Functions. |
| `get_edge_function` | **`project_id`**, **`function_slug`** | One Edge Function's details. |
| `deploy_edge_function` | **`project_id`**, **`name`**, **`files`**, `entrypoint_path`, `import_map_path` | Deploys an Edge Function from inline files. |
| `list_storage_buckets` | **`project_id`** | Lists storage buckets. |
| `create_storage_bucket` | **`project_id`**, **`name`**, `public`, `file_size_limit`, `allowed_mime_types` | Creates a storage bucket. |
| `list_branches` | **`project_id`** | Lists preview branches. |
| `create_branch` | **`project_id`**, **`name`**, `confirm_cost_id` | Creates a preview branch. |
| `delete_branch` | **`project_id`**, **`branch_id`** | Deletes a preview branch. |
| `merge_branch` | **`project_id`**, **`branch_id`** | Merges a branch's migrations and functions into production. |
| `reset_branch` | **`project_id`**, **`branch_id`**, `migration_version` | Resets a branch to its parent state. |
| `rebase_branch` | **`project_id`**, **`branch_id`** | Rebases a branch onto its parent. |
| `list_projects` | — | Lists all projects for the user. |
| `get_project` | **`id`** | One project's details. |
| `create_project` | **`name`**, **`organization_id`**, `region`, `confirm_cost_id` | Creates a project. |
| `pause_project` | **`project_id`** | Pauses a project. |
| `restore_project` | **`project_id`** | Restores a paused project. |
| `list_organizations` | — | Lists the user's organizations. |
| `get_organization` | **`id`** | One organization's details. |

All calls go to `https://api.supabase.com/v1`. SQL tools POST to the
project's `database/query` endpoint; `list_tables` and
`list_extensions` are catalog queries through that same endpoint, and
all other SQL passes through exactly as given.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
