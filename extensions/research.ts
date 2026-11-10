import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { search } from "../src/search.ts";
import { prepare, review } from "../src/qualification.ts";

const nullableString = Type.Union([Type.String(), Type.Null()]);
const sourceSchema = Type.Object({
  id: Type.String(), title: Type.String(), url: Type.String(), text: Type.String(),
  date: nullableString,
  kind: Type.Union([Type.Literal("search-result"), Type.Literal("model-extracted-lead")]),
  verified: Type.Literal(false), truncated: Type.Boolean(), rawRef: Type.String(),
});

const researchSearch = defineTool({
  name: "research_search",
  label: "Research search",
  description: "One paid/live search via an existing provider script. Select brave/perplexity for web search results, grok for X commentary leads, agy for Google-backed model-extracted leads. No synthesis, page reading, deep research, retries or fallback. All sources remain unverified. Dates are provider-specific hints/filters, not verified dates. Returns structured results and durable artifact paths; inspect status AND providerMeta.integrationDiagnostics even in codemode. Completion is not warning-free native schema compliance; failed calls can still incur reported cost. Each call needs an approved live allowance.",
  namespace: { name: "research", description: "Bounded live source discovery with preserved provenance." },
  parameters: Type.Object({
    provider: Type.Union([Type.Literal("brave"), Type.Literal("perplexity"), Type.Literal("grok"), Type.Literal("agy")]),
    query: Type.String({ minLength: 1, maxLength: 1800, description: "Search text, not instructions or CLI flags." }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "Maximum leads (default 5)." })),
    since: Type.Optional(Type.String({ description: "YYYY-MM-DD start; native Brave/Grok filter, query hint for others." })),
    until: Type.Optional(Type.String({ description: "YYYY-MM-DD exclusive end; query hint for Perplexity/AGY." })),
  }, { additionalProperties: false }),
  outputSchema: Type.Object({
    provider: Type.String(), query: Type.String(),
    status: Type.Union([Type.Literal("completed"), Type.Literal("empty"), Type.Literal("failed")]),
    sources: Type.Array(sourceSchema), omitted: Type.Integer(), elapsedMs: Type.Integer(),
    artifactDir: Type.String(), rawPath: nullableString,
    partialOutput: Type.Boolean({ description: "Failed invocation emitted stdout, retained but not promoted to usable results." }),
    usage: Type.Unknown(), reportedCostUsd: Type.Union([Type.Number(), Type.Null()]),
    providerMeta: Type.Unknown(), dateSemantics: Type.String(), error: nullableString,
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const result = await search(params, { cwd: ctx.cwd, signal });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      details: result,
      structuredContent: result,
      isError: result.status === "failed",
    };
  },
});

const enrichedSource = Type.Object({
  ...sourceSchema.properties,
  inspection: Type.Optional(Type.Object({
    status: Type.Union([Type.Literal("inspected"), Type.Literal("inaccessible"), Type.Literal("not-inspected")]),
    text: Type.String({ maxLength: 3000 }), scope: Type.String(), url: Type.Optional(Type.String()),
  })),
  profileEvidence: Type.Optional(Type.Array(Type.Object({ text: Type.String({ maxLength: 500 }), url: Type.String() }), { maxItems: 4 })),
});
const researchPrepare = defineTool({
  name: "research_prepare", label: "Prepare research qualification",
  description: "Local-only: preserve 1–15 source records and build fixed v3 Jev requests, two small passes per source. Computes recency without an LLM. Does NOT classify, authenticate, crawl profiles or grant a live allowance. Supply only public, explicitly observed profile evidence. Returns the frozen profile, requests, original items, oversized/unprocessed IDs and durable artifact path. Use codemode to avoid copying per-source JSON by hand.",
  namespace: { name: "research", description: "Traceable source discovery and advisory qualification." },
  parameters: Type.Object({ question: Type.String({ minLength: 1, maxLength: 1800 }), since: Type.String(), until: Type.String(), sources: Type.Array(enrichedSource, { minItems: 1, maxItems: 15 }) }, { additionalProperties: false }),
  outputSchema: Type.Object({ batchId: Type.String(), artifactDir: Type.String(), profile: Type.Unknown(), profileHash: Type.String(), asOf: Type.String(), brief: Type.Unknown(), items: Type.Array(Type.Unknown()), requests: Type.Array(Type.Object({ sourceId: Type.String(), pass: Type.String(), state: Type.Unknown(), questions: Type.Unknown() })), unprocessed: Type.Array(Type.Unknown()), preparationMs: Type.Number() }),
  async execute(_id, params, signal, _update, ctx) {
    if (signal?.aborted) throw new Error("Cancelled before preparation.");
    const result = await prepare(params, ctx.cwd);
    return { content: [{ type: "text", text: JSON.stringify({ batchId: result.batchId, artifactDir: result.artifactDir, requests: result.requests.length, unprocessed: result.unprocessed, preparationMs: result.preparationMs }) }], details: result, structuredContent: result };
  },
});
const researchReview = defineTool({
  name: "research_review", label: "Review research qualification",
  description: "Local-only: validate saved-batch Jev responses and preserve a ranked view plus needs-context, needs-evidence, concern and material-qualification indexes. Missing/invalid answers remain unknown, not zero relevance. No model/network calls, no exclusions, no confidence-as-truth. Responses must identify their original source/pass. Prior review artifacts are never overwritten.",
  namespace: { name: "research", description: "Traceable source discovery and advisory qualification." },
  parameters: Type.Object({ batchId: Type.String(), responses: Type.Array(Type.Object({ sourceId: Type.String(), pass: Type.String(), result: Type.Unknown(), startMs: Type.Number(), endMs: Type.Number() }), { maxItems: 30 }) }, { additionalProperties: false }),
  outputSchema: Type.Object({ batchId: Type.String(), artifactDir: Type.String(), profileVersion: Type.String(), profileHash: Type.String(), items: Type.Array(Type.Unknown()), rankedIds: Type.Array(Type.String()), needsContextIds: Type.Array(Type.String()), needsEvidenceIds: Type.Array(Type.String()), materialQualificationIds: Type.Array(Type.String()), concernIds: Type.Array(Type.String()), retained: Type.Integer(), excluded: Type.Integer(), responseCount: Type.Integer(), expectedResponses: Type.Integer(), interpretation: Type.String(), reviewPath: Type.String() }),
  async execute(_id, params, signal, _update, ctx) {
    if (signal?.aborted) throw new Error("Cancelled before review.");
    const result = await review(params.batchId, params.responses, ctx.cwd);
    return { content: [{ type: "text", text: JSON.stringify({ reviewPath: result.reviewPath, retained: result.retained, rankedIds: result.rankedIds, needsContextIds: result.needsContextIds, needsEvidenceIds: result.needsEvidenceIds, interpretation: result.interpretation }) }], details: result, structuredContent: result };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(researchSearch);
  pi.registerTool(researchPrepare);
  pi.registerTool(researchReview);
}
