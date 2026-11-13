// Opt-in contact with the installed Pi loader/executor. No model calls.
// --offline uses a fake SC executable; --live URL... allows SC coordinated on-demand service acquisition.
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, access, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [mode, ...urls] = process.argv.slice(2);
if (!["--offline", "--live"].includes(mode) || (mode === "--live" && !urls.length) || (mode === "--offline" && urls.length)) {
  throw new Error("Usage: PI_RESEARCH_PI_PACKAGE=/installed/pi-coding-agent node tests/live/pages-contact.mjs --offline | --live URL...");
}
if (!process.env.PI_RESEARCH_PI_PACKAGE) throw new Error("Set PI_RESEARCH_PI_PACKAGE to the installed @earendil-works/pi-coding-agent directory.");
const piPackage = resolve(process.env.PI_RESEARCH_PI_PACKAGE);
const require = createRequire(join(piPackage, "package.json"));
const schemaEntry = require.resolve.paths("@earendil-works/pi-schema").map(dir => join(dir, "@earendil-works/pi-schema/dist/index.js")).find(existsSync);
if (!schemaEntry) throw new Error("Installed Pi schema validator not found.");
const { compile } = await import(pathToFileURL(schemaEntry));
const { loadExtensions } = await import(pathToFileURL(join(piPackage, "dist/core/extensions/loader.js")));
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const offline = mode === "--offline";
const cwd = offline ? await mkdtemp(join(tmpdir(), "pi-pages-contact-")) : repo;
try {
  if (offline) {
    for (const key of ["PI_RESEARCH_PAGES_DIR", "PI_RESEARCH_REDUCTION_DIR", "PI_RESEARCH_SC_SOCKET"]) delete process.env[key];
    const script = join(cwd, "fake-sc");
    await writeFile(script, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(join(cwd, "calls.jsonl"))}, JSON.stringify(process.argv.slice(2))+'\\n');
const urls=process.argv.slice(process.argv.indexOf('--')+1);
for(const url of urls.reverse()) console.log(JSON.stringify({sessionId:'s',jobId:url,url,
  outcome:url.endsWith('/b')?{kind:'failed',error:'ACCESS_CHALLENGE'}:{kind:'completed',value:{mode:'raw',format:'text',requestedUrl:url,url,title:'Fixture',content:'Fixture article text',readiness:{stable:true,attempts:2},warnings:[]}}
}));
process.exitCode=1;
`);
    await chmod(script, 0o700);
    process.env.PI_RESEARCH_SC_BIN = script;
  }
  const loaded = await loadExtensions([join(repo, "extensions/research.ts")], cwd);
  assert.deepEqual(loaded.errors, []);
  const tools = loaded.extensions.flatMap(e => [...e.tools.values()].map(t => t.definition));
  assert.deepEqual(tools.map(t => t.name).sort(), ["research_search", "research_reduce", "research_sources", "research_prepare", "research_review", "research_read_pages"].sort());
  const tool = tools.find(t => t.name === "research_read_pages");
  const ctx = { cwd, modelRegistry: new Proxy({}, { get() { throw Error("No classifier/model access allowed in this contact"); } }) };
  if (offline) {
    let classifierStubs = 0;
    const discoveryCtx = { cwd, modelRegistry: {
      getAvailableOfType: async () => [{ provider: "typesafe", id: "jev-latest" }],
      classify: async () => { classifierStubs++; return { provider: "typesafe", model: "jev-latest", stopReason: "error", errorMessage: "Offline stub: no provider call" }; },
    } };
    const lead = { id: "fixture-source", title: "Fixture lead", url: "https://example.org/a", text: "Fixture snippet", date: null, kind: "search-result", verified: false, truncated: false, rawRef: "fixture.json" };
    const reduction = await tools.find(t => t.name === "research_reduce").execute("discovery", {
      question: "Offline spine check", since: "2026-11-01", until: "2026-11-12", outcomes: [{ status: "fulfilled", value: {
        provider: "brave", query: "fixture", status: "completed", sources: [lead], omitted: 0, elapsedMs: 0,
        artifactDir: cwd, rawPath: null, partialOutput: false, usage: null, reportedCostUsd: null,
        providerMeta: null, dateSemantics: "synthetic", error: null,
      } }],
    }, undefined, undefined, discoveryCtx);
    assert.equal(classifierStubs, 2);
    const sources = await tools.find(t => t.name === "research_sources").execute("snippets", { reductionId: reduction.structuredContent.reductionId }, undefined, undefined, ctx);
    assert.equal(sources.structuredContent.records[0].excerpt, "Fixture snippet");
    await assert.rejects(access(join(cwd, "calls.jsonl"))); // registration/discovery did not launch SC
  }
  const input = { pages: (offline ? ["https://example.org/a", "https://example.org/b"] : urls).map(url => ({ url })) };
  const inputSchema = compile(tool.parameters);
  assert.equal(inputSchema.check(input), true, JSON.stringify(inputSchema.errors(input)));
  const result = await tool.execute("page-contact", input, undefined, undefined, ctx);
  const output = result.structuredContent;
  const outputSchema = compile(tool.outputSchema);
  assert.equal(outputSchema.check(output), true, JSON.stringify(outputSchema.errors(output)));
  assert.deepEqual(JSON.parse(result.content[0].text), output);
  assert.deepEqual(result.details, output);
  assert.ok(JSON.stringify(output).length <= 24_000);
  if (offline) {
    assert.equal(output.status, "partial");
    assert.equal(result.isError, false);
    assert.equal(output.records[0].excerpt, "Fixture article text");
    assert.equal(output.records[1].error, "ACCESS_CHALLENGE");
    const calls = (await readFile(join(cwd, "calls.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["control", "capture", "--raw", "--format", "text", "--timeout", "120000", "--", "https://example.org/a", "https://example.org/b"]);
    console.log(JSON.stringify({ mode, registered: tools.length, discoveryPageCalls: 0, pageCalls: 1, schemas: "valid", partialResult: "preserved" }));
  } else {
    console.log(JSON.stringify(output, null, 2));
    if (output.status !== "completed") process.exitCode = 1; // warnings/failures are visible, never retried
  }
} finally {
  if (offline) await rm(cwd, { recursive: true, force: true });
}
