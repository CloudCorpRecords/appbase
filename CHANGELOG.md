# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `appbase <tool-name> [--json '<arguments>']` exposes every MCP
  tool as a subcommand, plus `appbase mcp` and `--version`; the
  Supabase access token is read from `SUPABASE_ACCESS_TOKEN`.
- MCP server (`appbase mcp`, stdio) with 28 tools: database
  (`list_tables`, `list_extensions`, `list_migrations`, `execute_sql`,
  `apply_migration`), debugging (`get_logs`, `get_advisors`),
  development (`get_project_url`, `get_publishable_keys`,
  `generate_typescript_types`), functions (`list_edge_functions`,
  `get_edge_function`, `deploy_edge_function`), storage
  (`list_storage_buckets`, `create_storage_bucket`), branching
  (`list_branches`, `create_branch`, `delete_branch`, `merge_branch`,
  `reset_branch`, `rebase_branch`), and account (`list_projects`,
  `get_project`, `create_project`, `pause_project`, `restore_project`,
  `list_organizations`, `get_organization`).
- All calls go to `https://api.supabase.com/v1` (the Supabase
  Management API) with the token as a Bearer token; SQL runs through
  each project's `database/query` endpoint and passes through as
  given.
- A missing `SUPABASE_ACCESS_TOKEN` fails honestly with an error
  naming the variable, before any request is made.
- All HTTP goes through an injectable fetch function, so the test
  suite runs entirely on hand-written fixtures with no network
  access.
