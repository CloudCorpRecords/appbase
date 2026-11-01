import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyMigration,
  createBranch,
  createProject,
  createStorageBucket,
  deployEdgeFunction,
  executeSql,
  generateTypescriptTypes,
  getAdvisors,
  getLogs,
  getProjectUrl,
  getPublishableKeys,
  listExtensions,
  listProjects,
  listTables,
  mergeBranch,
  pauseProject,
  requireApiKey,
} from "../src/supabase.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

// Hand-written fixtures in the documented shapes of the Supabase
// Management API responses.
function jsonResponse(body: unknown, status = 200, statusText = "OK"): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

interface Call {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

function fakeFetch(calls: Call[]): FetchFn {
  return async (url: string, init) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, headers: init?.headers, body: init?.body });
    if (url.includes("/database/query")) {
      return jsonResponse([{ schema: "public", name: "users", owner: "postgres" }]);
    }
    if (url.includes("/database/migrations")) {
      return jsonResponse(
        method === "POST"
          ? { version: "20261026000000" }
          : [{ version: "20260101000000", name: "init" }],
      );
    }
    if (url.includes("/analytics/endpoints/")) return jsonResponse({ result: [] });
    if (url.includes("/advisors/")) return jsonResponse({ lints: [] });
    if (url.includes("/api-keys")) {
      return jsonResponse([{ name: "anon", api_key: "anon-key" }]);
    }
    if (url.includes("/types/typescript")) {
      return jsonResponse({ types: "export type Json = unknown" });
    }
    if (url.includes("/functions/")) return jsonResponse({ slug: "hello" });
    if (url.includes("/functions")) {
      return jsonResponse(method === "POST" ? { slug: "hello" } : [{ slug: "hello" }]);
    }
    if (url.includes("/storage/buckets")) {
      return jsonResponse(method === "POST" ? { name: "avatars" } : [{ id: "avatars" }]);
    }
    if (url.includes("/branches/")) return jsonResponse({});
    if (url.includes("/branches")) {
      return jsonResponse(method === "POST" ? { id: "branch-2" } : [{ id: "branch-1" }]);
    }
    if (url.endsWith("/pause") || url.endsWith("/restore")) return jsonResponse({});
    if (url.includes("/organizations/")) return jsonResponse({ id: "org-1" });
    if (url.includes("/organizations")) return jsonResponse([{ id: "org-1" }]);
    if (method === "POST" && url.endsWith("/projects")) {
      return jsonResponse({ id: "newref", name: "demo" });
    }
    if (url.includes("/projects/")) return jsonResponse({ id: "ref1", name: "demo" });
    if (url.endsWith("/projects")) return jsonResponse([{ id: "ref1", name: "demo" }]);
    return jsonResponse({ message: "not found" }, 404, "Not Found");
  };
}

const REF = "ref1abcdefghijklm";

describe("requireApiKey", () => {
  it("rejects a missing or blank token with an error naming SUPABASE_ACCESS_TOKEN", () => {
    assert.throws(() => requireApiKey(undefined), /SUPABASE_ACCESS_TOKEN/);
    assert.throws(() => requireApiKey("  "), /SUPABASE_ACCESS_TOKEN/);
    assert.equal(requireApiKey(" sbp_x "), "sbp_x");
  });
});

describe("executeSql", () => {
  it("POSTs the query to /projects/{ref}/database/query with the Bearer token", async () => {
    const calls: Call[] = [];
    const out = (await executeSql(fakeFetch(calls), "sbp_test", {
      project_id: REF,
      query: "select 1",
    })) as unknown[];
    assert.equal(out.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, `/v1/projects/${REF}/database/query`);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers?.Authorization, "Bearer sbp_test");
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), { query: "select 1" });
  });

  it("fails before any request when the token is missing", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    await assert.rejects(
      () => executeSql(spy, undefined, { project_id: REF, query: "select 1" }),
      /SUPABASE_ACCESS_TOKEN/,
    );
    assert.equal(called, false);
  });

  it("rejects an empty query", async () => {
    await assert.rejects(
      () => executeSql(fakeFetch([]), "k", { project_id: REF, query: " " }),
      /non-empty/,
    );
  });
});

describe("listTables / listExtensions", () => {
  it("listTables queries pg_tables for the requested schemas (public by default)", async () => {
    const calls: Call[] = [];
    await listTables(fakeFetch(calls), "k", { project_id: REF });
    let body = JSON.parse(calls[0].body ?? "{}") as { query: string };
    assert.ok(body.query.includes("pg_catalog.pg_tables"));
    assert.ok(body.query.includes("IN ('public')"));
    await listTables(fakeFetch(calls), "k", {
      project_id: REF,
      schemas: ["public", "auth"],
    });
    body = JSON.parse(calls[1].body ?? "{}") as { query: string };
    assert.ok(body.query.includes("IN ('public', 'auth')"));
  });

  it("listExtensions queries pg_available_extensions for installed ones", async () => {
    const calls: Call[] = [];
    await listExtensions(fakeFetch(calls), "k", { project_id: REF });
    const body = JSON.parse(calls[0].body ?? "{}") as { query: string };
    assert.ok(body.query.includes("pg_available_extensions"));
    assert.ok(body.query.includes("installed_version IS NOT NULL"));
  });
});

describe("applyMigration", () => {
  it("POSTs { name, query } to the migrations endpoint", async () => {
    const calls: Call[] = [];
    await applyMigration(fakeFetch(calls), "k", {
      project_id: REF,
      name: "add_users",
      query: "create table users (id int)",
    });
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, `/v1/projects/${REF}/database/migrations`);
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
      name: "add_users",
      query: "create table users (id int)",
    });
  });
});

describe("account tools", () => {
  it("listProjects GETs /v1/projects and parses the array", async () => {
    const calls: Call[] = [];
    const out = (await listProjects(fakeFetch(calls), "k")) as unknown[];
    assert.equal(out.length, 1);
    assert.equal(new URL(calls[0].url).pathname, "/v1/projects");
  });

  it("createProject shapes the body and skips unset optional fields", async () => {
    const calls: Call[] = [];
    await createProject(fakeFetch(calls), "k", {
      name: "demo",
      organization_id: "org-1",
      region: "us-east-1",
    });
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
      name: "demo",
      organization_id: "org-1",
      region: "us-east-1",
    });
  });

  it("pauseProject POSTs to the pause endpoint", async () => {
    const calls: Call[] = [];
    await pauseProject(fakeFetch(calls), "k", { project_id: REF });
    assert.equal(calls[0].method, "POST");
    assert.ok(calls[0].url.endsWith(`/projects/${REF}/pause`));
  });
});

describe("development tools", () => {
  it("getProjectUrl returns the documented URL without a network call", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    const out = await getProjectUrl(spy, "k", { project_id: REF });
    assert.equal(out, `https://${REF}.supabase.co`);
    assert.equal(called, false);
    await assert.rejects(() => getProjectUrl(spy, undefined, { project_id: REF }), /SUPABASE_ACCESS_TOKEN/);
  });

  it("getPublishableKeys GETs the api-keys endpoint", async () => {
    const calls: Call[] = [];
    const out = (await getPublishableKeys(fakeFetch(calls), "k", {
      project_id: REF,
    })) as { name: string }[];
    assert.equal(out[0].name, "anon");
    assert.ok(calls[0].url.endsWith(`/projects/${REF}/api-keys`));
  });

  it("generateTypescriptTypes passes included_schemas as one query param", async () => {
    const calls: Call[] = [];
    await generateTypescriptTypes(fakeFetch(calls), "k", {
      project_id: REF,
      included_schemas: ["public", "auth"],
    });
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, `/v1/projects/${REF}/types/typescript`);
    assert.equal(url.searchParams.get("included_schemas"), "public,auth");
  });
});

describe("debugging tools", () => {
  it("getLogs maps the service to its analytics endpoint and rejects bad services first", async () => {
    const calls: Call[] = [];
    await getLogs(fakeFetch(calls), "k", { project_id: REF, service: "postgres" });
    assert.ok(calls[0].url.includes("/analytics/endpoints/logs.postgres"));
    const count = calls.length;
    await assert.rejects(
      () => getLogs(fakeFetch(calls), "k", { project_id: REF, service: "nope" }),
      /service must be one of/,
    );
    assert.equal(calls.length, count);
  });

  it("getAdvisors hits the advisors/{type} path and validates the type", async () => {
    const calls: Call[] = [];
    await getAdvisors(fakeFetch(calls), "k", { project_id: REF, type: "security" });
    assert.ok(calls[0].url.endsWith(`/projects/${REF}/advisors/security`));
    await assert.rejects(
      () => getAdvisors(fakeFetch(calls), "k", { project_id: REF, type: "other" }),
      /must be "security" or "performance"/,
    );
  });
});

describe("functions / storage / branching", () => {
  it("deployEdgeFunction sends a multipart body with metadata and file parts", async () => {
    const calls: Call[] = [];
    await deployEdgeFunction(fakeFetch(calls), "k", {
      project_id: REF,
      name: "hello",
      files: [{ name: "index.ts", content: "Deno.serve(() => new Response('hi'))" }],
    });
    const call = calls[0];
    assert.equal(call.method, "POST");
    assert.ok((call.headers?.["Content-Type"] ?? "").startsWith("multipart/form-data; boundary="));
    assert.ok(new URL(call.url).searchParams.get("slug") === "hello");
    assert.ok((call.body ?? "").includes('"entrypoint_path":"index.ts"'));
    assert.ok((call.body ?? "").includes("Deno.serve"));
    assert.ok((call.body ?? "").includes('filename="index.ts"'));
  });

  it("createStorageBucket shapes { id, name, public } and skips unset fields", async () => {
    const calls: Call[] = [];
    await createStorageBucket(fakeFetch(calls), "k", {
      project_id: REF,
      name: "avatars",
      public: true,
    });
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), {
      id: "avatars",
      name: "avatars",
      public: true,
    });
    assert.ok(calls[0].url.endsWith(`/projects/${REF}/storage/buckets`));
  });

  it("createBranch sends branch_name; mergeBranch POSTs to the /merge path", async () => {
    const calls: Call[] = [];
    await createBranch(fakeFetch(calls), "k", { project_id: REF, name: "feat-x" });
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), { branch_name: "feat-x" });
    await mergeBranch(fakeFetch(calls), "k", { project_id: REF, branch_id: "branch-1" });
    assert.ok(calls[1].url.endsWith(`/projects/${REF}/branches/branch-1/merge`));
    assert.equal(calls[1].method, "POST");
  });
});

describe("HTTP errors", () => {
  it("surface status and the API message", async () => {
    const failing: FetchFn = async () =>
      jsonResponse({ message: "Project not found" }, 404, "Not Found");
    await assert.rejects(() => listProjects(failing, "k"), /HTTP 404.*Project not found/);
  });
});
