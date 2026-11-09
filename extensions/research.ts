import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { search } from "../src/search.ts";

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

export default function (pi: ExtensionAPI) {
  pi.registerTool(researchSearch);
}
