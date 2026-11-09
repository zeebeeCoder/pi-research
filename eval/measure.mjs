#!/usr/bin/env node
// Inspect real experiment artifacts; never calls a model/provider or edits reports.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../.artifacts/nvidia-eval-2026-11-09');
const read = async name => JSON.parse(await readFile(join(root, name), 'utf8'));
function concurrency(intervals) {
  const events = intervals.flatMap(i => [[i.startMs, 1], [i.endMs, -1]]).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  let active=0, peak=0;
  for (const [, delta] of events) { active += delta; peak = Math.max(peak, active); }
  return peak;
}
function usageTotals(usages) {
  const keys=['input','output','cacheRead','cacheWrite','totalTokens'];
  const sums=Object.fromEntries(keys.map(k=>[k,usages.reduce((n,u)=>n+(Number.isFinite(u[k])?u[k]:0),0)]));
  const costs=usages.map(u=>u.cost?.total).filter(c=>typeof c==='number' && Number.isFinite(c));
  return {...sums, reportedCostEstimateUsd: costs.length?costs.reduce((a,b)=>a+b,0):null,
    costEntries:costs.length,usageEntries:usages.length,note:'Recorded usage/price estimates, not an independently verified bill.'};
}
async function session(dir) {
  const meta=await read(`${dir}/metadata.json`);
  const entries=(await readFile(join(root,dir,'session.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const messages=entries.filter(e=>e.message).map(e=>e.message);
  const assistants=messages.filter(m=>m.role==='assistant');
  const toolCalls=assistants.flatMap(m=>(m.content??[]).filter(c=>c.type==='toolCall'));
  const nestedCalls=messages.flatMap(m=>Array.isArray(m.nestedCalls)?m.nestedCalls:[]);
  const first=Date.parse(entries[0].timestamp),last=Date.parse(entries.at(-1).timestamp);
  const reportCall=toolCalls.find(c=>c.name==='write' && String(c.arguments?.path??'').endsWith('/report.md'));
  const reportEvent=reportCall && entries.find(e=>e.message?.role==='toolResult' && e.message.toolCallId===reportCall.id && !e.message.isError);
  const reportTime=reportEvent?Date.parse(reportEvent.timestamp):null;
  const reportUsage=reportTime===null?null:usageTotals(entries.filter(e=>e.message?.role==='assistant' && Date.parse(e.timestamp)<=reportTime).flatMap(e=>e.message.usage?[e.message.usage]:[]));
  return {provider:meta.provider,model:meta.model,thinking:meta.thinking,startMs:first,endMs:last,elapsedMs:last-first,
    reportReadyMs:reportTime===null?null:reportTime-first,reportUsage,
    assistantMessages:assistants.length,toolCalls:toolCalls.map(c=>({name:c.name,arguments:c.arguments})),nestedCalls,
    usage:usageTotals(assistants.flatMap(m=>m.usage?[m.usage]:[]))};
}
const corpus=await read('corpus.json');
const byId=new Map(corpus.sources.map(s=>[s.id,s]));
const retrieval=await read('retrieval.json');
const classifier=await read('classifier-results.json');
const selection=await read('selection.json');
const intervals=retrieval.calls.map(c=>({startMs:c.startMs,endMs:c.endMs}));
const classificationIntervals=classifier.outcomes.filter(o=>Number.isFinite(o.startMs)&&Number.isFinite(o.endMs));
const collector=await session('children/collector');
const arms={};
for(const name of ['copper','silver']){
  const transcript=await session(`children/${name}`);
  const report=await readFile(join(root,`arms/${name}/report.md`),'utf8');
  const register=await read(`arms/${name}/claims.json`);
  const claims=register.claims??[],errors=[];
  let sourceReferences=0,quotes=0,quoteMatches=0;
  for(const claim of claims){
    if(!Array.isArray(claim.sourceIds)) errors.push({claim:claim.id,error:'missing sourceIds'});
    for(const id of claim.sourceIds??[]){sourceReferences++;if(!byId.has(id))errors.push({claim:claim.id,error:'unknown source ID',id});}
    for(const q of claim.quotes??[]){
      quotes++;
      const source=byId.get(q.sourceId);
      const text=q.field==='text'?source?.text:q.field==='inspection.text'?source?.inspection?.text:undefined;
      if(typeof text==='string'&&typeof q.quote==='string'&&q.quote.length>0&&text.includes(q.quote))quoteMatches++;
      else errors.push({claim:claim.id,error:'quote not an exact substring',quote:q});
      if(!claim.sourceIds?.includes(q.sourceId))errors.push({claim:claim.id,error:'quote source not in claim sourceIds',id:q.sourceId});
      if(typeof q.quote==='string'&&q.quote.length>400)errors.push({claim:claim.id,error:'quote exceeds400 characters'});
    }
  }
  const wordCount=report.trim().split(/\s+/).length;
  arms[name]={...transcript,reportWordCount:wordCount,within600Words:wordCount<=600,
    registeredClaims:claims.length,factualClaims:claims.filter(c=>c.kind==='factual').length,
    analysisClaims:claims.filter(c=>c.kind==='analysis').length,
    sourceReferences,quotes,quoteMatches,mechanicalErrors:errors,reopenedSourceIds:register.reopenedSourceIds??[],
    reportSha256:createHash('sha256').update(report).digest('hex'),
    note:'Reference/quotation integrity is not semantic support; manual review is separate.'};
}
const sumProviderMs=retrieval.calls.reduce((n,c)=>n+c.wallTimeMs,0);
const firstUsable=Math.min(...retrieval.calls.filter(c=>c.response?.status==='completed').map(c=>c.endMs))-retrieval.batchStartMs;
const metrics={
  generatedAt:new Date().toISOString(),
  retrieval:{batchWallTimeMs:retrieval.batchWallTimeMs,observedPeakConcurrency:concurrency(intervals),
    firstUsableMs:firstUsable,sumIndividualDurationMs:sumProviderMs,
    serialDurationProxyRatio:sumProviderMs/retrieval.batchWallTimeMs,
    providers:retrieval.calls.map(c=>({provider:c.request.provider,wallTimeMs:c.wallTimeMs,status:c.response?.status,
      leads:c.response?.sources?.length??0,reportedCostUsd:c.response?.reportedCostUsd??null})),
    note:'Sum/batch is a proxy, NOT a measured serial control or causal speedup.'},
  classifier:{wallTimeMs:classifier.wallTimeMs,items:classifier.outcomes.length,
    observedPeakConcurrency:concurrency(classificationIntervals),
    sumIndividualDurationMs:classificationIntervals.reduce((n,o)=>n+o.elapsedMs,0),
    valid:classifier.outcomes.filter(o=>o.status==='valid').length,
    unknown:classifier.outcomes.filter(o=>o.status!=='valid').length,
    requestedModel:classifier.requestedModel,returnedModels:[...new Set(classifier.outcomes.map(o=>o.result?.model).filter(Boolean))],
    usage:usageTotals(classifier.outcomes.flatMap(o=>o.result?.usage?[o.result.usage]:[])),
    note:'jev-latest is moving; returned alias does not expose an actual pinned version. Zero price estimate is not verified free billing.'},
  selection,collector,arms,
  orchestrationSpanMs:Math.max(arms.copper.endMs,arms.silver.endMs)-collector.startMs,
  orchestrationSpanNote:'First collector session entry to last synthesis session entry, including inter-stage parent gaps; excludes setup before collection and review after synthesis.',
  pipelineStageEstimatesMs:{
    baseline:collector.elapsedMs+arms.copper.elapsedMs,
    screened:collector.elapsedMs+classifier.wallTimeMs+arms.silver.elapsedMs,
    baselineReportReady:collector.elapsedMs+arms.copper.reportReadyMs,
    screenedReportReady:collector.elapsedMs+classifier.wallTimeMs+arms.silver.reportReadyMs,
    note:'Measured stage sums; complete-arm duration includes the evaluation claim register. Report-ready excludes later claim-register generation, but is not human acceptance time. Exclude parent orchestration/reference review/selection setup. Arms run concurrently and may contend for resources.'
  },
  overallInterpretation:'Exploratory pair; no pruning, no input-size reduction. Differences can be ordering, generation variance, cache behavior or contention, not a proven classifier benefit.'
};
await writeFile(join(root,'metrics.json'),JSON.stringify(metrics,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({orchestrationSpanMs:metrics.orchestrationSpanMs,retrieval:metrics.retrieval,classifier:metrics.classifier,selection:{selected:selection.selected,omitted:selection.omitted,baselineBytes:selection.baselineBytes,reducedBytes:selection.reducedBytes},
  collector:{elapsedMs:collector.elapsedMs,usage:collector.usage},
  arms:Object.fromEntries(Object.entries(arms).map(([name,a])=>[name,{elapsedMs:a.elapsedMs,reportReadyMs:a.reportReadyMs,reportUsage:a.reportUsage,usage:a.usage,reportWordCount:a.reportWordCount,factualClaims:a.factualClaims,quotes:a.quotes,quoteMatches:a.quoteMatches,mechanicalErrors:a.mechanicalErrors,reopenedSourceIds:a.reopenedSourceIds}])),pipelineStageEstimatesMs:metrics.pipelineStageEstimatesMs},null,2));
