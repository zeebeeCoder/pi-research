import {test} from "node:test";
import assert from "node:assert/strict";
import {validateRequest,sma,smooth,compute} from "../../src/market/analysis.mjs";
import {validateHistory} from "../../src/providers/yahoo/index.mjs";
import {history} from "./fixtures.mjs";
const request={symbol:"ASML.AS",currency:"EUR"},time="2026-01-01T00:00:00Z";
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test("request bounds, duplicate identity, option/path injection, currency explicit",()=>{
  validateRequest([request,{symbol:"AAPL",currency:"USD"}]);
  for(const value of [[],Array(5).fill(request),[request,request],[{symbol:"--debug",currency:"EUR"}],[{symbol:"../AAPL",currency:"USD"}],[{symbol:"AAPL"}],[{symbol:"aapl",currency:"USD"}],[{symbol:"AAPL",currency:"GBp"}]])assert.throws(()=>validateRequest(value));
});
test("validation freezes data; no sorting, row dropping, coercion or currency inference",()=>{
  const good=history();const snapshot=JSON.stringify(good);
  const bars=validateHistory(good,request,time);assert.ok(Object.isFrozen(bars));assert.ok(Object.isFrozen(bars[0]));assert.equal(JSON.stringify(good),snapshot);
  const mutations=[
    x=>x.symbol="ASML",x=>x.currency="USD",x=>delete x.currency,x=>x.name="",x=>x.points=[],
    x=>x.points[1].date=x.points[0].date,x=>x.points.reverse(),x=>x.points[0].date="2025-02-30",
    x=>x.points.at(-1).date="2030-01-01",x=>x.points[0].close=NaN,x=>x.points[0].open=Infinity,
    x=>x.points[0].volume=-1,x=>x.points[0].volume=1.5,x=>x.points[0].volume=Number.MAX_SAFE_INTEGER+1,
    x=>x.points[0].close="100",x=>x.points[0].open=0,x=>x.points[0].low=300,x=>x.points[0].high=1,
    x=>delete x.points[0].volume,x=>x.points[0].low=-1,x=>x.points[0].close=1e15,
  ];
  for(const mutate of mutations){const x=structuredClone(good);mutate(x);assert.throws(()=>validateHistory(x,request,time));}
});
test("SMA full window; never shorten 200; EMA and Wilder hand seeds",()=>{
  assert.deepEqual(sma([1,2,3,4,5],3),[null,null,2,3,4]);
  assert.equal(compute(history("A","USD",199).points).indicators.sma200.status,"insufficient_data");
  near(compute(history("A","USD",200,i=>100+i).points).indicators.sma200.values.value,199.5);
  assert.deepEqual(smooth([1,2,3,4],3),[null,null,2,3]);
  near(smooth([1,2,3,4],3,1/3)[3],8/3);
});
test("RSI known Wilder vector, exact warmup, monotonic limits and flat undefined",()=>{
  const c=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
  const result=compute(history("A","USD",15,i=>c[i]).points);
  near(result.indicators.rsi14.values.value,70.46413502109705);
  const extended=compute(history("A","USD",16,i=>i<15?c[i]:46).points).indicators.rsi14.values;
  const gain=result.indicators.rsi14.values.averageGain*13/14;
  const loss=(result.indicators.rsi14.values.averageLoss*13+0.28)/14;
  near(extended.averageGain,gain);near(extended.averageLoss,loss);near(extended.value,100-100/(1+gain/loss));
  assert.equal(result.series.rsi14[13],null);
  assert.equal(compute(history("A","USD",14).points).indicators.rsi14.status,"insufficient_data");
  assert.equal(compute(history("A","USD",15,i=>100+i).points).indicators.rsi14.values.value,100);
  assert.equal(compute(history("A","USD",15,i=>100-i).points).indicators.rsi14.values.value,0);
  const flat=compute(history("A","USD",40,()=>100).points);
  assert.equal(flat.indicators.rsi14.status,"undefined");assert.equal(flat.indicators.rsi14.values.value,null);
  assert.equal(flat.indicators.macd.values.value,0);assert.equal(flat.indicators.macdSignal.values.histogram,0);
});
test("ATR previous close, seed, gap and Wilder update",()=>{
  const rows=history("A","USD",16,i=>100+i).points;
  const a=compute(rows);assert.equal(a.series.atr14[13],null);near(a.series.atr14[14],4);
  rows[15]={...rows[15],open:130,close:130,high:132,low:128};
  near(compute(rows).series.atr14[15],(4*13+18)/14);
});
test("MACD ramps, signal warmup 34, Bollinger population SD, volume and OBV",()=>{
  const a=compute(history("A","USD",40,i=>i+100).points);
  near(a.series.macd[25],7);assert.equal(a.series.macd[24],null);
  assert.equal(a.series.macdSignal[32],null);near(a.series.macdSignal[33],7);near(a.series.macdHistogram[33],0);
  const rows=history("A","USD",20,i=>i+10).points;rows.forEach(r=>r.volume=100);
  const b=compute(rows).indicators;near(b.bollinger20.values.middle,19.5);
  near(b.bollinger20.values.upper,19.5+2*Math.sqrt(33.25));near(b.bollinger20.values.lower,19.5-2*Math.sqrt(33.25));
  assert.equal(b.volume20.values.mean,100);assert.equal(b.volume20.values.ratio,1);assert.equal(b.obv.values.value,1900);
  rows.forEach(r=>r.volume=0);assert.equal(compute(rows).indicators.volume20.status,"undefined");
  rows.forEach(r=>r.volume=Number.MAX_SAFE_INTEGER);assert.throws(()=>compute(rows),/safe integer precision/);
});
test("prefix isolation, full-series seed reuse, no mutation",()=>{
  const rows=history().points,snapshot=JSON.stringify(rows),all=compute(rows);
  for(const n of [1,14,15,20,26,33,34,50,199,200]){
    const prefix=compute(rows.slice(0,n));
    for(const key of Object.keys(prefix.series))assert.deepEqual(prefix.series[key],all.series[key].slice(0,n));
  }
  assert.equal(JSON.stringify(rows),snapshot);
});
