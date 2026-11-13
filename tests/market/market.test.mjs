import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile,stat} from "node:fs/promises";
import {join} from "node:path";
import {inflateSync} from "node:zlib";
import {runBatch,packageRoot,toolResult} from "../../src/market/research.mjs";
import {sha256} from "../../src/providers/yahoo/index.mjs";
import {renderChart} from "../../src/market/chart.mjs";
import {compute} from "../../src/market/analysis.mjs";
import {history} from "./fixtures.mjs";
const instruments=[{symbol:"ASML.AS",currency:"EUR"},{symbol:"RHM.DE",currency:"EUR"}];
const options=extra=>({artifactRoot:join(packageRoot,'.artifacts','market','tests'),executable:process.execPath,sourceMode:"fixture",...extra});
function stub(payload,code=0,extra={}) {return async()=>({stdout:typeof payload==='string'?payload:JSON.stringify(payload),stderr:code?'Synthetic failure':'',code,killed:false,truncated:false,...extra});}
export function decodePng(png) {
 assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 let offset=8,data=[],header;
 while(offset<png.length) {const n=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8);if(type==='IHDR')header=png.subarray(offset+8,offset+8+n);if(type==='IDAT')data.push(png.subarray(offset+8,offset+8+n));offset+=n+12;}
 assert.equal(offset,png.length);assert.equal(header[8],8);assert.equal(header[9],2);
 const pixels=inflateSync(Buffer.concat(data)),width=header.readUInt32BE(0),height=header.readUInt32BE(4);
 assert.equal(pixels.length,height*(1+width*3));return {width,height,pixels};
}
test("one invocation for two symbols; immutable raw reuse, summaries, charts and fixed evidence shape",async()=>{
 const payload=instruments.map(i=>history(i.symbol,i.currency));let calls=0,renderCalls=0;
 const raw=JSON.stringify(payload);
 const result=await runBatch(instruments,options({exec:async(command,args,opts)=>{
  calls++;assert.equal(command,await import('node:fs/promises').then(m=>m.realpath(process.execPath)));
  assert.deepEqual(args,['--range','1y','--format','json','--','ASML.AS','RHM.DE']);assert.equal(opts.timeout,45000);
  return {stdout:raw,stderr:'',code:0,killed:false,truncated:false};
 },render:(i,bars,series)=>{renderCalls++;assert.ok(Object.isFrozen(bars));assert.deepEqual(series,compute(bars).series);return renderChart(i,bars,series);}}));
 assert.equal(calls,1);assert.equal(renderCalls,2);assert.equal(result.kind,'evidence');assert.equal(result.status,'completed');
 assert.equal(await readFile(result.rawPath,'utf8'),raw);assert.equal(result.source.rawSha256,sha256(raw));
 assert.equal((await stat(result.rawPath)).mode&0o222,0);
 assert.deepEqual(JSON.parse(await readFile(result.resultPath,'utf8')),result);assert.ok(JSON.stringify(result).length<24000);
 assert.equal(result.source.adjustment,'unknown');assert.ok(result.acquiredAt<=result.acquisitionFinishedAt);
 for(const record of result.records) {
  assert.equal(record.identity.currency,'EUR');assert.equal(record.identity.exchange,null);
  assert.equal(record.barCount,250);assert.equal(record.status,'completed');
  const png=decodePng(await readFile(record.chartPath));assert.equal(png.width,1200);assert.equal(png.height,920);
  assert.ok(new Set(png.pixels).size>10);
  const saved=JSON.parse(await readFile(record.seriesPath,'utf8'));assert.deepEqual(saved.bars,payload.find(p=>p.symbol===record.requested.symbol).points);
 }
 for(const key of ['fetchMs','computeMs','renderMs','totalMs'])assert.ok(result.timings[key]>=0);
 const tool=toolResult(result);assert.deepEqual(tool.structuredContent,JSON.parse(tool.content[0].text));assert.equal(tool.isError,false);
 assert.ok(!('verdict' in result.records[0]));assert.match(result.imageInspection,/image\(await tools.read/);
});
test("partial symbol failure, duplicate returned symbol and bad bars preserve siblings",async()=>{
 for(const payload of [
  [history()], [history(),history()],
  [history(),{...history('RHM.DE'),points:[{date:'bad'}]}],
  [history(),history('RHM.DE','USD')],
 ]) {
  let calls=0;const result=await runBatch(instruments,options({exec:async(...a)=>{calls++;return stub(payload,1)(...a);}}));
  assert.equal(calls,1);assert.equal(result.records.length,2);assert.ok(result.records.some(r=>r.status==='failed'));
  assert.equal(result.kind,'evidence');assert.ok(result.stderrPath);
 }
 const result=await runBatch(instruments,options({exec:stub([history()],1)}));
 assert.equal(result.status,'partial');assert.equal(result.records[0].status,'completed');assert.equal(result.records[1].status,'failed');
});
test("total, malformed, empty, non-array, nonfinite, killed and truncated output never retried",async()=>{
 for(const [payload,extra] of [['',{}],['not json',{}],['{}',{}],[[],{}],[[history()],{killed:true}],[[history()],{truncated:true}],[JSON.stringify([history()]).replace('"open":99.7','"open":1e309'),{}]]) {
  let calls=0;const result=await runBatch(instruments,options({exec:async()=>{calls++;return stub(payload,2,extra)();}}));
  assert.equal(calls,1);assert.equal(result.status,'failed');assert.equal(result.kind,'evidence');assert.ok(result.records.every(r=>r.error));
  assert.equal(toolResult(result).isError,true);
 }
});
test("spawn failure, unavailable executable and pre-abort preserve failed evidence",async()=>{
 let calls=0;
 for(const config of [
  {exec:async()=>{calls++;throw Error('spawn failed');}},
  {exec:async()=>{throw Error('must not run');},executable:'/nonexistent/pi-market-ticker'},
  {exec:async()=>{throw Error('must not run');},signal:AbortSignal.abort()},
 ]) {
  const result=await runBatch(instruments,options(config));
  assert.equal(result.status,'failed');assert.ok(result.acquisition.error);assert.equal(result.records.length,2);
 }
 assert.equal(calls,1);
});
test("render failure preserves computed summary and raw, without refetch",async()=>{
 let calls=0;const result=await runBatch([instruments[0]],options({exec:async()=>{calls++;return stub([history()])();},render:()=>{throw Error('synthetic renderer error');}}));
 assert.equal(calls,1);assert.equal(result.status,'partial');assert.ok(result.records[0].indicators);assert.ok(result.records[0].seriesPath);
 assert.equal(result.records[0].chartPath,null);assert.match(result.records[0].error,/renderer error/);
});
test("short/flat charts exist; four-symbol summary bounded and chart window does not shorten SMA",async()=>{
 for(const n of [1,14,199]) {
  const item=history('ASML.AS','EUR',n,()=>100),before=JSON.stringify(item);
  const result=await runBatch([instruments[0]],options({exec:stub([item])}));
  assert.equal(result.status,'completed');decodePng(await readFile(result.records[0].chartPath));
  assert.equal(result.records[0].indicators.sma200.values.value,null);assert.equal(JSON.stringify(item),before);
 }
 const requested=['AAPL','MSFT','ASML.AS','RHM.DE'].map(symbol=>({symbol,currency:symbol.includes('.')?'EUR':'USD'}));
 const r=await runBatch(requested,options({exec:stub(requested.map(i=>history(i.symbol,i.currency)))}));
 assert.equal(r.status,'completed');assert.ok(JSON.stringify(r).length<24000);
});
test("cancel after acquisition and mid-render remains visible; invalid requests never execute",async()=>{
 const controller=new AbortController();let calls=0;
 const result=await runBatch(instruments,options({signal:controller.signal,exec:async()=>{calls++;controller.abort();return stub(instruments.map(i=>history(i.symbol)))();}}));
 assert.equal(calls,1);assert.equal(result.status,'failed');
 const afterFirst=new AbortController();let renderCount=0;
 const partial=await runBatch(instruments,options({signal:afterFirst.signal,exec:stub(instruments.map(i=>history(i.symbol))),render:(...args)=>{renderCount++;const png=renderChart(...args);afterFirst.abort();return png;}}));
 assert.equal(renderCount,1);assert.equal(partial.status,'partial');assert.equal(partial.records[0].status,'completed');assert.equal(partial.records[1].status,'failed');
 await assert.rejects(runBatch([],options({exec:async()=>{throw Error('must not run');}})),/1–4/);
});
