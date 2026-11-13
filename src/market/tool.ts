import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { runBatch, toolResult } from "./research.mjs";

const nullableString=Type.Union([Type.String(),Type.Null()]);
const nullableNumber=Type.Union([Type.Number(),Type.Null()]);
const instrument=Type.Object({
  symbol:Type.String({pattern:"^[A-Z0-9][A-Z0-9.-]{0,23}$",description:"Exact uppercase Yahoo equity ticker, e.g. ASML.AS, RHM.DE, AAPL"}),
  currency:Type.String({pattern:"^[A-Z]{3}$",description:"Expected ISO currency, e.g. EUR. Must match upstream; not inferred."}),
},{additionalProperties:false});
const indicator=Type.Object({
  status:StringEnum(["complete","insufficient_data","undefined"]),warmupBars:Type.Integer(),observedBars:Type.Integer(),
  formula:Type.String(),values:Type.Record(Type.String(),nullableNumber),seededAt:nullableString,reason:nullableString,
});
const source=Type.Object({
  provider:Type.String(),mode:Type.String(),command:nullableString,args:Type.Array(Type.String()),binarySha256:nullableString,
  format:Type.String(),interval:Type.String(),requestedRange:Type.String(),adjustment:Type.Literal("unknown"),rawSha256:Type.String(),
});
const outputSchema=Type.Object({
  kind:Type.Literal("evidence"),schemaVersion:Type.Literal("pi-market.v1"),status:StringEnum(["completed","partial","failed"]),
  runId:Type.String(),artifactDir:Type.String(),resultPath:Type.String(),rawPath:Type.String(),stderrPath:Type.String(),
  acquiredAt:Type.String(),acquisitionFinishedAt:Type.String(),source,
  acquisition:Type.Object({invoked:Type.Boolean(),error:nullableString,code:nullableNumber,killed:Type.Boolean(),truncated:Type.Boolean()}),
  timings:Type.Object({fetchMs:Type.Number(),computeMs:Type.Number(),renderMs:Type.Number(),totalMs:Type.Number()}),
  warnings:Type.Array(Type.String()),limitations:Type.Array(Type.String()),imageInspection:Type.String(),
  records:Type.Array(Type.Object({
    requested:instrument,status:StringEnum(["completed","partial","failed"]),
    identity:Type.Union([Type.Null(),Type.Object({symbol:Type.String(),name:Type.String(),currency:Type.String(),exchange:Type.Null(),isin:Type.Null(),verified:Type.Literal(false)})]),
    barCount:Type.Integer(),firstBarDate:nullableString,lastBarDate:nullableString,lastClose:nullableNumber,quality:Type.Array(Type.String()),
    formulaVersion:nullableString,indicators:Type.Union([Type.Null(),Type.Record(Type.String(),indicator)]),
    seriesPath:nullableString,chartPath:nullableString,error:nullableString,timings:Type.Object({computeMs:Type.Number(),renderMs:Type.Number()}),
  }),{minItems:1,maxItems:4}),
});
export function registerMarketTool(pi:ExtensionAPI) {
  pi.registerTool({
    name:"market_research",label:"Market research",exposure:"direct",
    namespace:{name:"research",description:"Source discovery, qualification and market evidence."},
    description:"Research-only daily OHLCV, basic indicators and PNG charts for 1–4 US/EU Yahoo equity tickers. One ticker-cli batch invocation, fixed 1y, no separate live quote, wrapper retries or fallback. IMPORTANT: installed ticker-cli v0.1.0 internally may refresh auth, retry a chart and POST EU consent; obtain user authorization for those behaviors, and do not call under strict no-retry/read-only-network restrictions. <=24000 JSON characters; full raw/series/PNG artifacts under pi-research/.artifacts/market/. Fixed kind:evidence, even partial/failed; never submit to research_reduce. No trading or recommendations. Read chartPath with read; Codemode: image(await tools.read({path: chartPath})).",
    promptSnippet:"Get bounded market evidence and chart paths using installed ticker-cli",
    promptGuidelines:[
      "Use market_research only for authorized ticker research; ticker-cli internal retry/session/consent behavior requires approval when constrained.",
      "With market_research preserve failed symbols, timestamps, currency, adjustment uncertainty and quality warnings; evidence does not mean verified fact.",
      "Inspect a selected market_research chart with read, or Codemode image(await tools.read({path: chartPath})); printing a path does not expose the chart to the model.",
      "Do not convert market_research indicators into automatic Buy/Hold/Sell advice or claim Yahoo data is exchange-grade.",
    ],
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true},
    parameters:Type.Object({instruments:Type.Array(instrument,{minItems:1,maxItems:4})},{additionalProperties:false}),
    outputSchema,
    async execute(_id,params,signal) {
      return toolResult(await runBatch(params.instruments,{exec:pi.exec.bind(pi),signal}));
    },
  });
}
