#!/usr/bin/env node
// Rank-only inspection of real Jev results. No model, network or source deletion.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const base=resolve(import.meta.dirname,'../.artifacts/nvidia-eval-2026-11-09');
const root=resolve(import.meta.dirname,'../.artifacts/nvidia-rank-v2-2026-11-09');
const read=async(dir,name)=>JSON.parse(await readFile(join(dir,name),'utf8'));
const corpus=await read(base,'corpus.json'), reference=await read(base,'reference-review.json');
const previous=await read(base,'selection.json');
const profile=await read(root,'profile.json'), batch=await read(root,'results.json');
assert.equal(profile.version,batch.profileVersion);
const outcomes=new Map(batch.outcomes.map(o=>[o.id,o]));
assert.equal(outcomes.size,corpus.sources.length);
const rows=corpus.sources.map((source,index)=>{
  const outcome=outcomes.get(source.id); assert.ok(outcome);
  const a=outcome.result?.answers;
  return {source,index,assessment:{
    score:outcome.status==='valid'?a.contribution.score:null,
    sufficiency:a?.sufficiency?.choice??'unknown',
    qualification:a?.qualification?.choice??'insufficient_context',
    status:outcome.status,needsContext:outcome.needsContext,
    validationErrors:outcome.validationErrors,
  }};
});
const ranked=rows.filter(r=>!r.assessment.needsContext).sort((a,b)=>b.assessment.score-a.assessment.score||a.index-b.index);
const needsContext=rows.filter(r=>r.assessment.needsContext);
assert.equal(new Set([...ranked,...needsContext].map(r=>r.source.id)).size,corpus.sources.length);
const anchorCoverage=(order,k)=>reference.requiredTopics.filter(t=>t.sourceIds.some(id=>order.slice(0,k).includes(id))).map(t=>t.id);
const orderMetrics=order=>({
  top1:anchorCoverage(order,1),top3:anchorCoverage(order,3),top5:anchorCoverage(order,5),
  depthToAllAnchors:Array.from({length:order.length},(_,i)=>i+1).find(k=>anchorCoverage(order,k).length===reference.requiredTopics.length)??null,
});
const events=batch.outcomes.flatMap(o=>[[o.startMs,1],[o.endMs,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
let active=0,peak=0;for(const [,delta]of events){active+=delta;peak=Math.max(peak,active);}
const usage=batch.outcomes.flatMap(o=>o.result?.usage?[o.result.usage]:[]);
const costs=usage.map(u=>u.cost?.total).filter(n=>typeof n==='number'&&Number.isFinite(n));
const metrics={
  createdAt:new Date().toISOString(),profileVersion:profile.version,
  profileSha256:createHash('sha256').update(await readFile(join(root,'profile.json'))).digest('hex'),
  sourceCorpusSha256:createHash('sha256').update(await readFile(join(base,'corpus.json'))).digest('hex'),
  sources:corpus.sources.length,ranked:ranked.length,needsContext:needsContext.length,
  retained:ranked.length+needsContext.length,excluded:0,
  sufficiencyCounts:rows.reduce((out,r)=>(out[r.assessment.sufficiency]=(out[r.assessment.sufficiency]??0)+1,out),{}),
  qualificationCounts:rows.reduce((out,r)=>(out[r.assessment.qualification]=(out[r.assessment.qualification]??0)+1,out),{}),
  wallTimeMs:batch.wallTimeMs,observedPeakConcurrency:peak,
  requestedModel:batch.requestedModel,returnedModels:[...new Set(batch.outcomes.map(o=>o.result?.model).filter(Boolean))],
  usage:{input:usage.reduce((n,u)=>n+(u.input??0),0),output:usage.reduce((n,u)=>n+(u.output??0),0),
    totalTokens:usage.reduce((n,u)=>n+(u.totalTokens??0),0),
    reportedCostEstimateUsd:costs.length?costs.reduce((a,b)=>a+b,0):null,
    note:'Pi estimate, not independent billing; a zero estimate does not establish a free service.'},
  referenceAnchorCount:reference.requiredTopics.length,
  orderComparison:{original:orderMetrics(corpus.sources.map(s=>s.id)),coarseV1:orderMetrics(previous.selectedIds),ordinalV2:orderMetrics(ranked.map(r=>r.source.id))},
  rankedSummary:ranked.map((r,i)=>({rank:i+1,id:r.source.id,title:r.source.title,url:r.source.url,...r.assessment})),
  interpretation:'In-sample ordering diagnostic only. V2 was designed after seeing this corpus/v1; no holdout, no new synthesis, no evidence deletion or measured context reduction. Anchor presence does not prove a reader retains its qualifications.',
};
const view={question:profile.researchQuestion,utcWindow:corpus.utcWindow,
  ranked:ranked.map(r=>({...r.source,ranking:r.assessment})),
  needsContext:needsContext.map(r=>({...r.source,ranking:r.assessment})),
  materialQualificationIds:rows.filter(r=>r.assessment.qualification==='material').map(r=>r.source.id),
  interpretation:metrics.interpretation};
await writeFile(join(root,'ranked-view.json'),JSON.stringify(view,null,2)+'\n',{flag:'wx',mode:0o600});
await writeFile(join(root,'metrics.json'),JSON.stringify(metrics,null,2)+'\n',{flag:'wx',mode:0o600});
const markdown=['# Rank-only v2 review queue','',
  'Ordinal expected contribution scores (0–4), not factual confidence. All sources retained; limited context remains flagged.','',
  '| Rank | Score | Context | Source |','|---:|---:|---|---|',
  ...metrics.rankedSummary.map(r=>`| ${r.rank} | ${r.score.toFixed(2)} | ${r.sufficiency} | [${r.title.replace(/\|/g,' / ')}](${r.url}) |`),
  '',`Needs-context lane: ${needsContext.length}. Material qualifications flagged: ${view.materialQualificationIds.length}. Excluded: 0.`,
  '',metrics.interpretation,''].join('\n');
await writeFile(join(root,'ranking.md'),markdown,{flag:'wx',mode:0o600});
console.log(JSON.stringify(metrics,null,2));
