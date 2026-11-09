import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const concise = (text: string) => Array.from(text.replace(/[\x00-\x1f\x7f]/g, " ")).slice(0, 800).join("");
export const reportedCost = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Read structured scout stderr, not human-oriented terminal output. */
export function scoutError(stderr: string): string | null {
  if (Buffer.byteLength(stderr) > 16384) return null;
  try {
    const parsed: unknown = JSON.parse(stderr);
    return object(parsed) && typeof parsed.error === "string" ? concise(parsed.error) : null;
  } catch { return null; }
}

export type GrokDiagnostics = {
  tracePath: string | null;
  diagnosticError: string | null;
  schemaWarning: string | null;
  stopReason: string | null;
  nativeSearchStarts: number | null;
  modelTurns: number | null;
  usage: unknown;
  reportedCostUsd: number | null;
};

/** The wrapper owns this directory. Never follow a path supplied by provider output.
 * Read only the native end/accounting fields; never expose thought/text events.
 * Missing diagnostics do not turn an otherwise valid search into a failure.
 */
export async function grokDiagnostics(artifactDir: string): Promise<GrokDiagnostics> {
  const result: GrokDiagnostics = {
    tracePath: null, diagnosticError: null, schemaWarning: null, stopReason: null,
    nativeSearchStarts: null, modelTurns: null, usage: null, reportedCostUsd: null,
  };
  try {
    const root = join(artifactDir, "native", "runs");
    const runs = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory());
    if (runs.length !== 1) throw new Error("Expected exactly one native run directory.");
    const path = join(root, runs[0].name, "trace.jsonl");
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error("Native trace is not a bounded regular file.");
    const lines = (await readFile(path, "utf8")).split("\n");
    let end: Record<string, any> | null = null;
    const calls = new Set<string>();
    for (const line of lines) {
      if (!line.trim()) continue;
      const event: unknown = JSON.parse(line);
      if (!object(event)) continue;
      if (event.type === "tool_call" && event.rawInput?.variant === "XSearch"
        && event.rawInput.backend === true && typeof event.toolCallId === "string") calls.add(event.toolCallId);
      if (event.type === "end") end = event;
    }
    result.tracePath = path;
    result.nativeSearchStarts = calls.size;
    if (!end) throw new Error("Native trace has no final accounting event; cost remains unknown.");
    result.schemaWarning = typeof end.structuredOutputError === "string" ? concise(end.structuredOutputError) : null;
    result.stopReason = typeof end.stopReason === "string" ? end.stopReason : null;
    result.modelTurns = Number.isSafeInteger(end.num_turns) && end.num_turns >= 0 ? end.num_turns : null;
    result.usage = object(end.usage) ? end.usage : null;
    result.reportedCostUsd = reportedCost(end.total_cost_usd);
  } catch (error: any) {
    result.diagnosticError = error?.code === "ENOENT"
      ? "No native trace available; cost remains unknown."
      : concise(error instanceof Error ? error.message : "Cannot inspect native trace.");
  }
  return result;
}
