import { test, expect } from "bun:test";
import { marketProviders, sourceProviders, providers } from "../src/providers/index.ts";
import { yahoo } from "../src/providers/yahoo/index.mjs";
import { search } from "../src/search.ts";

test("provider entrypoint exposes Yahoo evidence separately from unchanged search providers", () => {
  expect(marketProviders.yahoo).toBe(yahoo);
  expect(yahoo.kind).toBe("evidence");
  expect(yahoo.operation).toBe("daily-history");
  expect(typeof yahoo.acquire).toBe("function");
  expect(Object.isFrozen(marketProviders)).toBe(true);
  expect(providers).toEqual(["brave", "perplexity", "grok", "agy"]);
  expect(Object.keys(sourceProviders)).toEqual([...providers]);
});

test("Yahoo cannot enter the URL/snippet search pipeline", async () => {
  await expect(search({ provider: "yahoo", query: "ASML.AS" } as any, { cwd: "/must-not-create-market-search" })).rejects.toThrow("Unknown provider");
});
