import { fileURLToPath } from "node:url";

// Discovery and market acquisition have separate input/output contracts.
// Keep the search provider union stable; Yahoo is evidence, not a URL/snippet lead.
export { marketProviders } from "./market.mjs";
export const providers = ["brave", "perplexity", "grok", "agy"] as const;
export type Provider = (typeof providers)[number];
export type SearchInput = { provider: Provider; query: string; limit?: number; since?: string; until?: string };
export type ProviderCommand = { binary: string; script: string; args: string[]; timeoutMs: number };
type Payload = Record<string, any>;
const object = (value: unknown): value is Payload => !!value && typeof value === "object" && !Array.isArray(value);

/** One source-provider unit. It owns protocol details, not allowance or retry policy.
 * Commands contain no credentials and resolve only package-owned entrypoints.
 * The search orchestrator validates inputs and validates every projected lead.
 */
export type SourceProvider = {
  id: Provider;
  transport: "http" | "native-cli";
  dateSemantics: string;
  kind: "search-result" | "model-extracted-lead";
  pointer: string;
  command(input: SearchInput): ProviderCommand;
  records(data: Payload): unknown;
  fields(item: Payload): { title: unknown; text: unknown; date: unknown };
};

function command(relative: string, args: string[], timeoutMs = 55_000): ProviderCommand {
  const script = fileURLToPath(new URL(relative, import.meta.url));
  return { binary: "node", script, args: [script, ...args], timeoutMs };
}
const args = (input: SearchInput, query = input.query.trim()) => [query, "-n", String(input.limit ?? 5), "--json"];
function requireScoutMeta(data: Payload, key: string) {
  if (!object(data.meta)) throw new Error("Missing scout provenance metadata.");
  return data[key];
}

export const sourceProviders: Readonly<Record<Provider, SourceProvider>> = {
  brave: {
    id: "brave", transport: "http", kind: "search-result", pointer: "/web/results",
    dateSemantics: "Brave freshness range; source.date carries page_age metadata as supplied (timezone may be absent), not an independently verified publication date.",
    command(input) {
      const argv = args(input);
      if (input.since) argv.push("--since", input.since);
      if (input.until) argv.push("--until", input.until);
      return command("./brave/search.mjs", argv);
    },
    records(data) {
      if (!object(data.query)) throw new Error("Missing Brave query envelope.");
      if (data.web !== undefined && (!object(data.web) || !Array.isArray(data.web.results))) throw new Error("Malformed Brave web results.");
      return data.web?.results ?? [];
    },
    fields: item => ({ title: item.title, text: item.description, date: item.page_age }),
  },
  perplexity: {
    id: "perplexity", transport: "http", kind: "search-result", pointer: "/results",
    dateSemantics: "Date window appended to query as a hint, NOT an enforced publication-date filter.",
    command(input) {
      let query = input.query.trim();
      if (input.since || input.until) query += ` (publication window: ${input.since ?? "any start"} inclusive to ${input.until ?? "present"} exclusive)`;
      return command("./perplexity/search.mjs", args(input, query));
    },
    records: data => data.results,
    fields: item => ({ title: item.title, text: item.snippet, date: item.date }),
  },
  grok: {
    id: "grok", transport: "native-cli", kind: "model-extracted-lead", pointer: "/posts",
    dateSemantics: "Native since-inclusive/until-exclusive filter, with wrapper filtering on Grok-extracted dates.",
    command(input) {
      const argv = [...args(input), "--timeout", "90"];
      if (input.since) argv.push("--since", input.since);
      if (input.until) argv.push("--until", input.until);
      return command("./grok/scout.mjs", argv, 100_000);
    },
    records: data => requireScoutMeta(data, "posts"),
    fields: item => ({ title: item.author ?? "Unknown X author", text: item.excerpt, date: item.date }),
  },
  agy: {
    id: "agy", transport: "native-cli", kind: "model-extracted-lead", pointer: "/sources",
    dateSemantics: "Google after/before query hints, NOT verified publication-date filters.",
    command(input) {
      let query = input.query.trim();
      if (input.since) query += ` after:${input.since}`;
      if (input.until) query += ` before:${input.until}`;
      return command("./agy/scout.mjs", args(input, query));
    },
    records: data => requireScoutMeta(data, "sources"),
    fields: item => ({ title: item.title, text: item.snippet, date: item.date }),
  },
};
