// Pure computations. Formula/version changes must change FORMULA_VERSION.
export const FORMULA_VERSION = "pi-market-indicators.v1";
export const symbolPattern = /^[A-Z0-9][A-Z0-9.-]{0,23}$/;
export function validateRequest(instruments) {
  if (!Array.isArray(instruments) || instruments.length < 1 || instruments.length > 4) throw Error("Supply 1–4 instruments.");
  const seen = new Set();
  for (const i of instruments) {
    if (!i || !symbolPattern.test(i.symbol) || typeof i.symbol !== "string") throw Error("Use exact uppercase Yahoo equity ticker (e.g. ASML.AS), not a company name.");
    if (typeof i.currency !== "string" || !/^[A-Z]{3}$/.test(i.currency)) throw Error("Supply expected ISO currency; do not guess currency from ticker suffix.");
    if (seen.has(i.symbol)) throw Error("Duplicate requested symbol.");
    seen.add(i.symbol);
  }
}
export function sma(values, period) {
  const out = Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) out[i] = values.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period;
  return out;
}
export function smooth(values, period, alpha = 2/(period+1)) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  let value = values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  out[period-1] = value;
  for (let i=period;i<values.length;i++) { value += alpha*(values[i]-value); out[i]=value; }
  return out;
}
export function compute(bars) {
  const c=bars.map(b=>b.close), n=c.length, last=a=>a.at(-1);
  const series={};
  for (const p of [20,50,200]) series["sma"+p]=sma(c,p);
  const delta=c.slice(1).map((v,i)=>v-c[i]);
  const gains=[null,...smooth(delta.map(v=>Math.max(v,0)),14,1/14)];
  const losses=[null,...smooth(delta.map(v=>Math.max(-v,0)),14,1/14)];
  series.rsi14=c.map((_,i)=>gains[i]===null ? null : losses[i]===0 ? (gains[i]===0 ? null : 100) : 100-100/(1+gains[i]/losses[i]));
  const tr=bars.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-c[i]),Math.abs(b.low-c[i])));
  series.atr14=[null,...smooth(tr,14,1/14)];
  const fast=smooth(c,12), slow=smooth(c,26);
  series.macd=c.map((_,i)=>slow[i]===null ? null : fast[i]-slow[i]);
  series.macdSignal=[...Array(Math.min(n,25)).fill(null),...smooth(series.macd.slice(25),9)];
  series.macdHistogram=c.map((_,i)=>series.macdSignal[i]===null ? null : series.macd[i]-series.macdSignal[i]);
  series.bbUpper=Array(n).fill(null); series.bbLower=Array(n).fill(null);
  for (let i=19;i<n;i++) {
    const m=series.sma20[i], sd=Math.sqrt(c.slice(i-19,i+1).reduce((s,v)=>s+(v-m)**2,0)/20);
    series.bbUpper[i]=m+2*sd; series.bbLower[i]=m-2*sd;
  }
  const volume=bars.map(b=>b.volume), avg=sma(volume,20);
  let obv=0;
  for (let i=1;i<n;i++) {
    obv+=Math.sign(c[i]-c[i-1])*volume[i];
    if (!Number.isSafeInteger(obv)) throw Error("OBV exceeds safe integer precision");
  }
  const evidence=(warmup,formula,values,seedIndex=null,undefinedReason=null)=>({
    status:n<warmup ? "insufficient_data" : Object.values(values).some(v=>v===null) ? "undefined" : "complete",
    warmupBars:warmup, observedBars:n, formula, values,
    seededAt:seedIndex!==null && n>seedIndex ? bars[seedIndex].date : null,
    reason:n<warmup ? "Full declared window required" : undefinedReason,
  });
  const indicators={};
  for (const p of [20,50,200]) indicators["sma"+p]=evidence(p,"arithmetic mean of last "+p+" closes",{value:last(series["sma"+p])});
  indicators.rsi14=evidence(15,"100-100/(1+avgGain/avgLoss); Wilder alpha=1/14, first 14 changes mean seed; flat 0/0 undefined",{value:last(series.rsi14),averageGain:last(gains),averageLoss:last(losses)},14,last(series.rsi14)===null && n>=15 ? "No gains and no losses" : null);
  indicators.atr14=evidence(15,"TR=max(H-L,abs(H-prevC),abs(L-prevC)); first bar undefined; Wilder alpha=1/14 with 14-TR mean seed",{value:last(series.atr14)},14);
  indicators.macd=evidence(26,"EMA12-EMA26; alpha=2/(period+1), arithmetic mean seeds at bars 12 and 26",{value:last(series.macd)},25);
  indicators.macdSignal=evidence(34,"EMA9 of MACD starting at bar 26; first 9 MACD mean seed; histogram=MACD-signal",{signal:last(series.macdSignal),histogram:last(series.macdHistogram)},33);
  const upper=last(series.bbUpper), lower=last(series.bbLower);
  indicators.bollinger20=evidence(20,"SMA20 +/- 2 population standard deviations (ddof=0)",{upper,middle:last(series.sma20),lower});
  indicators.volume20=evidence(20,"Mean of last 20 volumes INCLUDING latest; ratio=latest/mean, zero denominator undefined",{mean:last(avg),ratio:last(avg)===null || last(avg)===0 ? null : last(volume)/last(avg)},null,last(avg)===0 ? "Zero volume mean" : null);
  indicators.obv=evidence(1,"Zero at first bar; add/subtract current volume on close rise/fall; tie adds zero",{value:obv},0);
  for (const values of Object.values(series)) if (values.some(v=>v!==null && !Number.isFinite(v))) throw Error("Nonfinite computed series");
  for (const result of Object.values(indicators)) if (Object.values(result.values).some(v=>v!==null && !Number.isFinite(v))) throw Error("Nonfinite computed summary");
  return {formulaVersion:FORMULA_VERSION,indicators,series};
}
