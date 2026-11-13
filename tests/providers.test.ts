import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, chmod, cp, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { search, normalize, providers } from "../src/search.ts";
import { sourceProviders } from "../src/providers/index.ts";
import { search as brave } from "../src/providers/brave/search.mjs";
import { search as perplexity, apiKey } from "../src/providers/perplexity/search.mjs";
import { fetchJson, parseSearchArgs } from "../src/providers/http.mjs";

const query = 'literal $(echo never-execute) "quoted"; text';
const fixtures = resolve("tests/native/fixtures");
const preload = pathToFileURL(resolve("tests/fixtures/http-preload.mjs")).href;

for (const provider of providers) {
  test(`${provider} unit uses a packaged entrypoint and one literal query argument`, async () => {
    const unit = sourceProviders[provider];
    const cmd = unit.command({ provider, query, limit: 2 });
    expect(unit.id).toBe(provider);
    expect(cmd.script.startsWith(resolve("src/providers") + "/")).toBe(true);
    await access(cmd.script);
    expect(cmd.binary).toBe("node");
    expect(cmd.args[1]).toBe(query);
    expect(cmd.args.filter(a => a === query)).toHaveLength(1);
    const help = spawnSync("node", [cmd.script, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/search/i);
  });
}

test("Brave preserves raw envelope and converts exclusive until to API inclusive day", async () => {
  let calls = 0;
  const raw = { query: {}, web: { results: [] }, extra: "preserved" };
  const result = await brave({ query, limit: 2, since: "2026-11-01", until: "2026-11-10" }, {
    env: { BRAVE_API_KEY: "dummy-key" },
    fetchImpl: async (url: string, init: RequestInit) => {
      calls++;
      const u = new URL(url);
      expect(u.origin).toBe("https://api.search.brave.com");
      expect(u.searchParams.get("q")).toBe(query);
      expect(u.searchParams.get("freshness")).toBe("2026-11-01to2026-11-09");
      expect(u.searchParams.get("count")).toBe("2");
      expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("X-Subscription-Token")).toBe("dummy-key");
      return Response.json(raw);
    },
  });
  expect(calls).toBe(1);
  expect(result).toEqual(raw);
});

test("Perplexity uses only search endpoint, existing credentials and one POST", async () => {
  expect(apiKey({ env: {}, home: "/synthetic-home", read: (path: string) => {
    expect(path).toBe("/synthetic-home/.config/perplexity/.env");
    return 'PERPLEXITY_API_KEY="dummy-config-key"\n';
  } })).toBe("dummy-config-key");
  let calls = 0;
  const result = await perplexity({ query, limit: 3 }, {
    env: { PERPLEXITY_API_KEY: "dummy-key" }, read: () => { throw Error("must not read config"); },
    fetchImpl: async (url: string, init: RequestInit) => {
      calls++;
      expect(url).toBe("https://api.perplexity.ai/search");
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("error");
      expect(JSON.parse(init.body as string)).toEqual({ query, max_results: 3 });
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer dummy-key");
      return Response.json({ results: [] });
    },
  });
  expect(calls).toBe(1);
  expect(result).toEqual({ results: [] });
});

test("provider-specific date contracts remain separate", () => {
  const input = { query: "q", since: "2026-11-01", until: "2026-11-10" };
  expect(sourceProviders.perplexity.command({ ...input, provider: "perplexity" }).args[1]).toContain("publication window:");
  expect(sourceProviders.agy.command({ ...input, provider: "agy" }).args[1]).toBe("q after:2026-11-01 before:2026-11-10");
  expect(sourceProviders.grok.command({ ...input, provider: "grok" }).args).toContain("90");
  expect(sourceProviders.grok.command({ ...input, provider: "grok" }).timeoutMs).toBe(100_000);
});

test("HTTP failures are bounded, not retried, and do not echo response secrets", async () => {
  let calls = 0;
  await expect(fetchJson("https://example.org", {}, { fetchImpl: async () => {
    calls++;
    return new Response("secret-error-body", { status: 429 });
  } })).rejects.toThrow("Provider HTTP 429; no retry.");
  expect(calls).toBe(1);
  await expect(fetchJson("https://example.org", {}, { maxBytes: 4, fetchImpl: async () => new Response("12345") })).rejects.toThrow(/exceeded/);
  await expect(fetchJson("https://example.org", {}, { fetchImpl: async () => new Response("invalid") })).rejects.toThrow(/valid JSON/);
  await expect(fetchJson("https://example.org", {}, { signal: AbortSignal.abort(), fetchImpl: () => { throw Error("must not fetch"); } })).rejects.toThrow();
});

test("HTTP adapter rejects malformed options before invoking transport", () => {
  for (const argv of [[], ["--query"], ["q", "--deep-research"], ["q", "-n", "6"], ["q", "--since", "2026-02-30"]]) {
    expect(() => parseSearchArgs(argv)).toThrow();
  }
});

// Real orchestrator + real packaged adapters, fake transport at the outside edge.
// Environment is process-global: do not mark this suite concurrent.
describe("packaged source orchestration", () => {
  let cwd: string;
  const keys = ["PI_RESEARCH_ARTIFACT_DIR", "PI_RESEARCH_BUDGET_DIR", "BRAVE_API_KEY", "PERPLEXITY_API_KEY", "GROK_X_BIN", "AGY_SEARCH_BIN", "FAKE_GROK_MODE", "FAKE_AGY_MODE", "FAKE_HTTP_MODE", "FAKE_HTTP_READY", "NODE_OPTIONS"];
  let original: Record<string, string | undefined>;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "research-provider-test-"));
    original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    Object.assign(process.env, {
      PI_RESEARCH_ARTIFACT_DIR: join(cwd, "searches"), PI_RESEARCH_BUDGET_DIR: join(cwd, "allowance"),
      BRAVE_API_KEY: "dummy-key", PERPLEXITY_API_KEY: "dummy-key",
      GROK_X_BIN: join(fixtures, "fake-grok.mjs"), AGY_SEARCH_BIN: join(fixtures, "fake-agy.mjs"),
      FAKE_GROK_MODE: "success", FAKE_AGY_MODE: "success", FAKE_HTTP_MODE: "success",
      FAKE_HTTP_READY: join(cwd, "ready"), NODE_OPTIONS: `--import=${preload}`,
    });
    await chmod(process.env.GROK_X_BIN!, 0o755);
    await chmod(process.env.AGY_SEARCH_BIN!, 0o755);
  });
  afterEach(async () => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    }
    await rm(cwd, { recursive: true, force: true });
  });

  for (const provider of providers) {
    test(`${provider}: wrapper → packaged adapter → normalized lead → durable artifacts`, async () => {
      const result = await search({ provider, query, limit: 1 }, { cwd });
      expect(result.status).toBe("completed");
      expect(result.kind).toBe("leads");
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].verified).toBe(false);
      expect(result.sources[0].rawRef).toContain(result.rawPath!);
      expect(result.sources[0].kind).toBe(sourceProviders[provider].kind);
      const raw = JSON.parse(await readFile(result.rawPath!, "utf8"));
      expect(normalize(provider, raw, result.rawPath!, 1, result.sources[0].id.slice(0, -2)).sources).toEqual(result.sources);
      const saved = JSON.parse(await readFile(join(result.artifactDir, "result.json"), "utf8"));
      expect(saved).toEqual(result);
      const request = await readFile(join(result.artifactDir, "request.json"), "utf8");
      expect(request).not.toContain("dummy-key");
      expect(request).not.toContain(".pi/agent/skills");
      const repeat = await search({ provider, query, limit: 1 }, { cwd });
      expect(repeat.status).toBe("failed");
      expect(repeat.kind).toBe("leads");
      expect(repeat.error).toContain("allowance already consumed");
      expect((await readdir(repeat.artifactDir)).sort()).toEqual(["request.json", "result.json"]);
    });
  }

  for (const provider of providers) {
    test(`${provider}: recognized empty response stays empty, not failed`, async () => {
      process.env.FAKE_HTTP_MODE = "empty";
      process.env.FAKE_GROK_MODE = "empty";
      process.env.FAKE_AGY_MODE = "empty";
      const result = await search({ provider, query }, { cwd });
      expect(result.status).toBe("empty");
      expect(result.kind).toBe("leads");
      expect(result.sources).toEqual([]);
      expect(result.rawPath).not.toBeNull();
    });
  }

  test("malformed HTTP JSON never becomes an empty successful search", async () => {
    process.env.FAKE_HTTP_MODE = "malformed";
    const result = await search({ provider: "perplexity", query }, { cwd });
    expect(result.status).toBe("failed");
    expect(result.sources).toEqual([]);
    expect(result.rawPath).toBeNull();
  });

  test("concurrent calls share one atomic provider claim", async () => {
    const results = await Promise.all([1, 2].map(() => search({ provider: "brave", query }, { cwd })));
    expect(results.map(r => r.status).sort()).toEqual(["completed", "failed"]);
    expect(results.find(r => r.status === "failed")!.error).toContain("allowance already consumed");
  });

  test("HTTP failure consumes allowance without retry or promoted leads", async () => {
    process.env.FAKE_HTTP_MODE = "error";
    const result = await search({ provider: "brave", query }, { cwd });
    expect(result.status).toBe("failed");
    expect(result.sources).toEqual([]);
    expect(result.rawPath).toBeNull();
    const stderr = await readFile(join(result.artifactDir, "stderr.log"), "utf8");
    expect(stderr).toContain("HTTP 429");
    expect(stderr).not.toContain("private error body");
    expect((await search({ provider: "brave", query }, { cwd })).error).toContain("allowance already consumed");
  });

  test("cancellation during HTTP work terminates the adapter and preserves failure", async () => {
    process.env.FAKE_HTTP_MODE = "hang";
    const controller = new AbortController();
    const pending = search({ provider: "brave", query }, { cwd, signal: controller.signal });
    try {
      const deadline = Date.now() + 3000;
      let ready = false;
      while (Date.now() < deadline) {
        try { await access(process.env.FAKE_HTTP_READY!); ready = true; break; } catch { await Bun.sleep(10); }
      }
      expect(ready).toBe(true);
    } finally { controller.abort(); }
    const result = await pending;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Cancelled locally");
    expect(result.sources).toEqual([]);
  });

  test("all packaged entrypoints run from a relocated package without skill installs", async () => {
    const target = join(cwd, "relocated package");
    await cp(resolve("src/providers"), target, { recursive: true });
    const registryUrl = pathToFileURL(join(target, "index.ts")).href;
    const probe = spawnSync(process.execPath, ["--eval", `const { sourceProviders } = await import(${JSON.stringify(registryUrl)}); console.log(JSON.stringify(Object.values(sourceProviders).map(unit => unit.command({ provider: unit.id, query: 'q' }).script)));`], {
      cwd, env: { ...process.env, HOME: join(cwd, "empty-home") }, encoding: "utf8",
    });
    expect(probe.status).toBe(0);
    const relocatedPaths: string[] = JSON.parse(probe.stdout);
    expect(relocatedPaths).toHaveLength(4);
    const canonicalTarget = await realpath(target);
    expect(relocatedPaths.every(path => path.startsWith(canonicalTarget + "/"))).toBe(true);
    for (const provider of providers) {
      const path = sourceProviders[provider].command({ provider, query }).script;
      const relative = path.slice(resolve("src/providers").length + 1);
      const result = spawnSync("node", [join(target, relative), "--help"], {
        cwd, env: { ...process.env, HOME: join(cwd, "empty-home") }, encoding: "utf8",
      });
      expect(result.status).toBe(0);
    }
  });
});
