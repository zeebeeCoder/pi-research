import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const providers = ["brave", "perplexity", "grok", "agy"] as const;
export type Provider = (typeof providers)[number];
export type SearchInput = { provider: Provider; query: string; limit?: number; since?: string; until?: string };
export type Source = {
  id: string; title: string; url: string; text: string; date: string | null;
  kind: "search-result" | "model-extracted-lead"; verified: false;
  truncated: boolean; rawRef: string;
};
export type SearchResult = {
  provider: Provider; query: string; status: "completed" | "empty" | "failed";
  sources: Source[]; omitted: number; elapsedMs: number;
  artifactDir: string; rawPath: string | null; partialOutput: boolean;
  usage: unknown; reportedCostUsd: number | null; providerMeta: unknown;
  dateSemantics: string; error: string | null;
};

const scripts: Record<Provider, [string, string]> = {
  brave: ["bun", "brave-search/scripts/brave-search.ts"],
  perplexity: ["bun", "perplexity-search/scripts/pplx.ts"],
  grok: ["node", "grok-x/scripts/grok-x.js"],
  agy: ["node", "agy-search/scripts/agy-search.js"],
};
const dateSemantics: Record<Provider, string> = {
  brave: "Brave freshness range; dates are provider metadata, not independently verified.",
  perplexity: "Date window appended to query as a hint, NOT an enforced publication-date filter.",
  grok: "Native since-inclusive/until-exclusive filter, with wrapper filtering on Grok-extracted dates.",
  agy: "Google after/before query hints, NOT verified publication-date filters.",
};
const save = (path: string, data: unknown) => writeFile(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const clean = (value: string) => value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();

function validate(input: SearchInput) {
  if (!providers.includes(input.provider)) throw new Error("Unknown provider.");
  if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 1800
    || /^\s*-/.test(input.query) || /[\x00-\x1f\x7f]/.test(input.query)) {
    throw new Error("Query must be 1–1800 printable characters and cannot begin with '-'.");
  }
  if (!Number.isInteger(input.limit ?? 5) || (input.limit ?? 5) < 1 || (input.limit ?? 5) > 5) {
    throw new Error("Spike result limit must be 1–5.");
  }
  for (const date of [input.since, input.until]) {
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
      || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error("Dates must be real YYYY-MM-DD values.");
  }
  if (input.since && input.until && input.since >= input.until) throw new Error("since must precede exclusive until.");
}

function command(input: SearchInput) {
  const [binary, relative] = scripts[input.provider];
  const script = join(homedir(), ".pi/agent/skills", relative);
  let query = input.query.trim();
  const args = [script];
  if (input.provider === "perplexity") {
    args.push("search");
    if (input.since || input.until) query += ` (publication window: ${input.since ?? "any start"} inclusive to ${input.until ?? "present"} exclusive)`;
  }
  if (input.provider === "agy") {
    if (input.since) query += ` after:${input.since}`;
    if (input.until) query += ` before:${input.until}`;
  }
  // Each query is ONE argument. Never run through a shell or accept extra CLI flags.
  args.push(query, "-n", String(input.limit ?? 5), "--json");
  if (input.provider === "brave") {
    if (input.since) args.push("--after", input.since);
    if (input.until) args.push("--before", new Date(Date.parse(input.until) - 86400000).toISOString().slice(0, 10));
  }
  if (input.provider === "grok") {
    if (input.since) args.push("--since", input.since);
    if (input.until) args.push("--until", input.until);
  }
  return { binary, script, args };
}

/** Captures bounded stdout/stderr; existing scout CLIs retain their own stream audits. */
async function execute(binary: string, args: string[], cwd: string, signal?: AbortSignal) {
  return await new Promise<{ stdout: string; stderr: string; code: number | null; failure: string | null }>((resolveRun) => {
    const child = spawn(binary, args, {
      cwd, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GROK_X_STATE_DIR: join(cwd, "native"), AGY_SEARCH_STATE_DIR: join(cwd, "native") },
    });
    const chunks: Buffer[] = [], errors: Buffer[] = [];
    let outSize = 0, errSize = 0, failure: string | null = null;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const send = (sig: NodeJS.Signals) => {
      try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, sig); else child.kill(sig); } catch { /* exited */ }
    };
    const stop = (reason: string) => {
      if (failure) return;
      failure = reason;
      // Grok/AGY wrappers receive SIGTERM and cancel their own detached subprocesses.
      send("SIGTERM");
      escalation = setTimeout(() => send("SIGKILL"), 1500);
    };
    const abort = () => stop("Cancelled locally; remote work/billing may continue.");
    const deadline = setTimeout(() => stop("55s local deadline exceeded; remote work/billing may continue."), 55000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      outSize += chunk.length;
      if (outSize <= 2 * 1024 * 1024) chunks.push(chunk); else stop("Provider stdout exceeded 2 MiB.");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errSize += chunk.length;
      if (errSize <= 256 * 1024) errors.push(chunk); else stop("Provider stderr exceeded 256 KiB.");
    });
    child.on("error", (error: NodeJS.ErrnoException) => { failure = `Cannot start provider CLI (${error.code ?? "unknown"}).`; });
    child.on("close", (code) => {
      clearTimeout(deadline);
      if (!failure) clearTimeout(escalation);
      signal?.removeEventListener("abort", abort);
      resolveRun({ stdout: Buffer.concat(chunks).toString("utf8"), stderr: Buffer.concat(errors).toString("utf8"), code, failure });
    });
  });
}

function normalize(provider: Provider, data: unknown, rawPath: string, limit: number, runId: string) {
  if (!object(data)) throw new Error("Provider JSON must be an object.");
  let records: unknown, pointer: string;
  if (provider === "brave") {
    // Brave may omit web entirely on a valid empty response, but require its query envelope.
    if (!object(data.query)) throw new Error("Missing Brave query envelope.");
    if (data.web !== undefined && (!object(data.web) || !Array.isArray(data.web.results))) throw new Error("Malformed Brave web results.");
    records = data.web?.results ?? []; pointer = "/web/results";
  } else if (provider === "perplexity") { records = data.results; pointer = "/results"; }
  else if (provider === "grok") { records = data.posts; pointer = "/posts"; }
  else { records = data.sources; pointer = "/sources"; }
  if (!Array.isArray(records)) throw new Error("Missing provider result array; not a successful empty search.");
  if ((provider === "grok" || provider === "agy") && !object(data.meta)) throw new Error("Missing scout provenance metadata.");
  const sources: Source[] = records.slice(0, limit).map((item, index) => {
    if (!object(item) || typeof item.url !== "string") throw new Error("Malformed source URL.");
    const url = new URL(item.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Non-HTTP or credential-bearing source URL.");
    const title = provider === "grok" ? item.author ?? "Unknown X author" : item.title;
    const text = provider === "brave" ? item.description : provider === "grok" ? item.excerpt : item.snippet;
    if (typeof title !== "string" || typeof text !== "string") throw new Error("Malformed source title/text.");
    const cleaned = clean(text);
    return {
      id: `${runId}:${index + 1}`, title: clean(title).slice(0, 240), url: item.url,
      text: cleaned.slice(0, 1000), date: typeof item.date === "string" ? item.date : null,
      kind: provider === "grok" || provider === "agy" ? "model-extracted-lead" : "search-result",
      verified: false, truncated: item.truncated === true || cleaned.length > 1000,
      rawRef: `${rawPath}#${pointer}/${index}`,
    };
  });
  return { sources, omitted: records.length - sources.length, meta: data.meta ?? null };
}

export async function search(input: SearchInput, options: { cwd: string; signal?: AbortSignal }): Promise<SearchResult> {
  validate(input);
  if (options.signal?.aborted) throw new Error("Cancelled before invocation; no budget consumed.");
  const cmd = command(input);
  await access(cmd.script);
  const root = resolve(process.env.PI_RESEARCH_ARTIFACT_DIR || join(options.cwd, ".artifacts", "searches"));
  const runId = `${input.provider}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const artifactDir = join(root, runId);
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  const started = performance.now();
  const result: SearchResult = {
    provider: input.provider, query: input.query, status: "failed", sources: [], omitted: 0,
    elapsedMs: 0, artifactDir, rawPath: null, partialOutput: false,
    usage: null, reportedCostUsd: null, providerMeta: null, dateSemantics: dateSemantics[input.provider], error: null,
  };
  await save(join(artifactDir, "request.json"), { ...input, limit: input.limit ?? 5, ...cmd, startedAt: new Date().toISOString() });
  try {
    // Optional persistent per-experiment allowance. Atomic claim prevents races/reloads
    // from spending twice. Failed invocations also consume the allowance; never retry.
    if (process.env.PI_RESEARCH_BUDGET_DIR) {
      const budgetDir = resolve(process.env.PI_RESEARCH_BUDGET_DIR);
      await mkdir(budgetDir, { recursive: true, mode: 0o700 });
      try { await writeFile(join(budgetDir, `${input.provider}.claim`), artifactDir + "\n", { flag: "wx", mode: 0o600 }); }
      catch (error: any) {
        if (error.code === "EEXIST") throw new Error(`Local ${input.provider} allowance already consumed. No CLI launched.`);
        throw error;
      }
    }
    const proc = await execute(cmd.binary, cmd.args, artifactDir, options.signal);
    await writeFile(join(artifactDir, "stdout.txt"), proc.stdout, { mode: 0o600 });
    await writeFile(join(artifactDir, "stderr.log"), proc.stderr, { mode: 0o600 });
    result.partialOutput = !!proc.stdout.trim();
    if (proc.failure) throw new Error(proc.failure);
    if (proc.code !== 0) throw new Error(`Provider CLI exited ${proc.code}; inspect stderr.log and native trace. No retry.`);
    let data: unknown;
    try { data = JSON.parse(proc.stdout); } catch { throw new Error("Provider stdout is not valid JSON."); }
    result.rawPath = join(artifactDir, "raw.json");
    await save(result.rawPath, data);
    const normalized = normalize(input.provider, data, result.rawPath, input.limit ?? 5, runId);
    result.sources = normalized.sources;
    result.omitted = normalized.omitted;
    result.providerMeta = normalized.meta;
    result.usage = normalized.meta?.usage ?? null;
    const cost = normalized.meta?.reported_cost_usd;
    result.reportedCostUsd = typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null;
    result.status = result.sources.length ? "completed" : "empty";
    result.partialOutput = false;
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Unknown adapter failure.";
  }
  result.elapsedMs = Math.round(performance.now() - started);
  await save(join(artifactDir, "result.json"), result);
  return result;
}
