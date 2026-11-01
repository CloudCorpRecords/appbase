# appbase — Build Report

MCP Rebuild 100, Tier B. Clean-room rebuild of the Supabase MCP
server (@supabase/mcp-server-supabase), built from the public tool
spec captured in `harness/fixtures/supabase-tools-original.json`
only. The fixture is docs-derived from the original project's public
documentation (the Supabase MCP docs page and the supabase-mcp
README's tool-group listing) and is explicitly labelled a
**core-subset**: the documented Supabase MCP tool set has 33 tools in
8 groups; appbase implements the 28-tool core below, and parity is
scored against that 28-tool subset only. No audited live tool list
exists and no live server was probed. Local build only — nothing
pushed or published, and no live network call was made or claimed at
any point.

Identity: repo `appbase`, npm `@reneturcios/appbase`,
MCP name `io.github.CloudCorpRecords/appbase`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `appbase: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Supabase projects, tables, SQL,
  migrations, and storage from your MCP client." = **77 chars**
  (≤100 ✓); npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/appbase:0.1.0` carries **no** `version`
  field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/appbase"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (every tool as a subcommand taking
  `--json '<arguments>'`, plus `mcp` and `--version`; exit 2 usage /
  1 API error), `src/mcp.ts`, `src/types.ts`, `src/supabase.ts` (core
  logic, `VERSION = "0.1.0"`)
- `test/supabase.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to appbase)

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals, per the fleet standing rule: `McpServer`'s
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys that are absent from the public spec and
  break exact schema parity. Zod still validates every `tools/call`.
- Every tool is a Supabase Management API call under
  `https://api.supabase.com/v1` with the token from
  `SUPABASE_ACCESS_TOKEN` sent as `Authorization: Bearer`:
  - database: `execute_sql` POSTs `{query}` to
    `/projects/{ref}/database/query` (SQL passed through as
    documented); `list_tables` / `list_extensions` are `pg_catalog`
    queries through that same endpoint, as the upstream implements
    them; migrations use GET/POST `/projects/{ref}/database/migrations`.
  - debugging: `get_logs` maps the documented service names to the
    analytics endpoints (`logs.postgres`, `logs.all`, `logs.edge`,
    `logs.auth`, `logs.storage`, `logs.realtime`,
    `logs.branch-action`) and validates the service before any
    request; `get_advisors` GETs `/projects/{ref}/advisors/{type}`
    with the type validated to security/performance.
  - development: `get_project_url` returns the documented
    `https://<ref>.supabase.co` form (no network call, token still
    required); `get_publishable_keys` GETs
    `/projects/{ref}/api-keys`; `generate_typescript_types` GETs
    `/projects/{ref}/types/typescript` with `included_schemas`.
  - functions: list/get under `/projects/{ref}/functions`;
    `deploy_edge_function` builds the multipart/form-data body
    (metadata JSON part naming the entrypoint/import map, one file
    part per inline file) and POSTs with `?slug=<name>`.
  - storage: GET/POST `/projects/{ref}/storage/buckets` (create body
    `{id, name, public?, file_size_limit?, allowed_mime_types?}`).
  - branching: GET/POST `/projects/{ref}/branches` (create body
    `{branch_name, confirm_cost_id?}`), DELETE on the branch, and
    POST `.../merge`, `.../reset` (`migration_version` optional),
    `.../rebase`.
  - account: GET/POST `/projects`, GET `/projects/{id}`,
    POST `/projects/{ref}/pause` and `/restore`,
    GET `/organizations` and `/organizations/{id}`.
- A missing token throws before any request, with an error naming
  `SUPABASE_ACCESS_TOKEN`; over MCP this surfaces as an `isError`
  result (verified live over stdio, see below).
- All HTTP flows through an injectable `FetchFn` (types.ts). The test
  suite uses a fake fetch returning hand-written Management-API-shaped
  JSON fixtures — **no live call was performed during this build**.

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced, including `dist/cli.js` with the
`#!/usr/bin/env node` shebang.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 19
ℹ pass 19
ℹ fail 0
```
Covers: missing/blank token error naming SUPABASE_ACCESS_TOKEN (and
no request made without a token), execute_sql URL + Bearer header +
`{query}` body + empty-query rejection, list_tables schema list
shaping (default `public`, multi-schema, quote handling via the IN
list), list_extensions SQL, apply_migration body shaping,
list_projects path/parsing, create_project body shaping with unset
optionals skipped, pause path, get_project_url's no-network URL plus
its token requirement, api-keys path, included_schemas query param,
log service→endpoint mapping with pre-request rejection of unknown
services, advisor type validation, deploy multipart body (metadata,
entrypoint, file part, slug query param), storage bucket body
shaping, branch create/merge paths, and HTTP 404 surfacing the API
message.

### 3. CLI / MCP smoke
`--version` → `0.1.0`; unknown command exits 2 with Usage. MCP
`initialize` over stdio → `serverInfo: {"name":"appbase",
"version":"0.1.0"}`. A `tools/call` for `list_projects` with
`SUPABASE_ACCESS_TOKEN` unset returned `isError: true` with text
"SUPABASE_ACCESS_TOKEN environment variable is required: set
SUPABASE_ACCESS_TOKEN to a Supabase personal access token and retry".
CLI calls against the live API were **not** run (offline build rule
for this wave).

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
```
$ python3 parity.py --original fixtures/supabase-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/appbase/dist/cli.js mcp" \
    --out .../builds/appbase/parity-out
verdict=PASS parity_pct=100.0 original_tools=28 rebuild_tools=28 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
Parity is scored against the labelled 28-tool core-subset fixture
(see Gaps), not against the full 33-tool documented set. Original
side is tools-file mode, so `fixture_results` records
`SKIPPED-TOOLS-FILE-MODE` — expected harness semantics, not an error.

## Lockfile status

`package-lock.json` was copied from searchport's and edited with the
file edit tool: top-level `name`, root package `name`, and root
package `bin` key changed searchport -> appbase (dependency ranges
are identical, so the tree is unchanged). **Clean lockfile regen
required before publish** (regenerate with no `node_modules`
present); do not publish from this lockfile as-is. `node_modules` here
is a `cp -a` copy of searchport's; `.bin/tsc` / `.bin/tsx` verified
working.

## Gaps / honest notes

- **Core-subset (documented set not fully implemented).** The
  documented Supabase MCP tool set has 33 tools. appbase implements
  28. Omitted documented tools, verbatim:
  - `search_docs`
  - `get_cost`
  - `confirm_cost`
  - `get_storage_config`
  - `update_storage_config`
  The fixture's `_source` records this subset and the omitted list;
  parity above is against the subset only, never claimed as full-set
  parity. Because `confirm_cost` is omitted, `create_project` and
  branch `create_branch` accept an optional `confirm_cost_id` but
  nothing in appbase mints one.
- Naming drift in the upstream docs: newer Supabase documentation
  calls the debugging tool `query_logs` and the keys tool returns
  publishable keys where older docs exposed `get_anon_key`; appbase
  implements the documented `get_logs` name and a
  `get_publishable_keys` tool over the project's api-keys endpoint.
- No live Supabase API call was made (VM egress is blocked and no
  token is available in this environment). Request construction and
  response handling are written against the documented Management API
  paths and payload shapes as captured in the hand-written test
  fixtures; the analytics log-endpoint suffixes and the edge-function
  multipart deploy contract are the least firmly documented pieces
  and are the first checks at publish-wave live smoke.
- `create_project` does not send a database password field; the
  Management API's current project-creation contract (which fields it
  requires vs. generates) must be confirmed at live smoke.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
