// Market evidence orchestration: provider acquisition → computation → chart.
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { marketProviders } from '../providers/market.mjs';
import { validateRequest, compute } from './analysis.mjs';
import { renderChart } from './chart.mjs';
export const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const elapsed=start=>Math.round((performance.now()-start)*1000)/1000;
const shortError=e=>String(e?.message??e).slice(0,400);
const save=(path,data)=>writeFile(path,data,{flag:'wx',mode:0o444});
export const LIMITATIONS = Object.freeze([
 'Yahoo via ticker-cli is not exchange-grade; upstream accuracy, delay and completeness are unverified.',
 'Adjustment unknown: ticker-cli v0.1.0 emits Yahoo quote OHLC, not adjclose or corporate actions; never claim adjusted or definitely unadjusted.',
 'ticker-cli v0.1.0 rounds OHLC to 2 decimals, uses UTC date labels, and can turn missing upstream numeric values into zero. Original Yahoo HTTP payload is unavailable.',
 'Exchange, ISIN, session timezone, bar completion and trade timestamp are unavailable. Exact Yahoo symbol/name/currency are provider identity only, not independently verified.',
 'Latest daily bar may be incomplete. No exchange calendar, missing-session repair, current quote, currency conversion, recommendation or execution capability.',
 'EMA/Wilder/OBV depend on the captured history seed. Observation counts are not calendar windows. Minimum warm-up is not convergence.',
]);

export async function runBatch(instruments, { exec, signal, artifactRoot=join(packageRoot,'.artifacts','market','runs'), executable='ticker-cli', sourceMode='live', render=renderChart }={}) {
  validateRequest(instruments);
  if(typeof exec!=='function')throw Error('An exec implementation is required.');
  const start=performance.now(), runId=randomUUID(), artifactDir=join(resolve(artifactRoot),runId);
  await mkdir(artifactDir,{recursive:true});
  const resultPath=join(artifactDir,'result.json');
  const provider=marketProviders.yahoo;
  const {payload,parseError,source,receipt,warnings,rawPath,stderrPath,acquiredAt,acquisitionFinishedAt,fetchMs} =
    await provider.acquire(instruments,{exec,signal,artifactDir,executable,sourceMode});
  const records=[];let computeMs=0,renderMs=0;
  for(const instrument of instruments) {
    const record={requested:instrument,status:'failed',identity:null,barCount:0,firstBarDate:null,lastBarDate:null,lastClose:null,quality:[],formulaVersion:null,indicators:null,seriesPath:null,chartPath:null,error:null,timings:{computeMs:0,renderMs:0}};
    const cStart=performance.now();let bars,computed;
    try {
      if(signal?.aborted)throw Error('Cancelled; no further compute/render');
      if(parseError)throw Error(parseError);
      const matches=payload.filter(p=>p?.symbol===instrument.symbol);
      if(matches.length!==1)throw Error(matches.length?'Duplicate returned symbol; ambiguous identity':'Requested symbol missing from response; inspect stderrPath');
      bars=provider.validateHistory(matches[0],instrument,acquiredAt);
      record.identity={symbol:matches[0].symbol,name:matches[0].name,currency:matches[0].currency,exchange:null,isin:null,verified:false};
      record.barCount=bars.length;record.firstBarDate=bars[0].date;record.lastBarDate=bars.at(-1).date;record.lastClose=bars.at(-1).close;
      const ageDays=(Date.parse(acquiredAt)-Date.parse(bars.at(-1).date+'T00:00:00Z'))/86400000;
      record.quality.push('Adjustment and latest-bar completion unknown; all validated bars included.');
      if(ageDays>7)record.quality.push('Latest date more than 7 calendar days old; heuristic warning, not exchange-calendar validation.');
      if(bars.at(-1).date===acquiredAt.slice(0,10))record.quality.push('Latest bar has acquisition UTC date and may still be forming.');
      let gaps=0;for(let i=1;i<bars.length;i++)if(Date.parse(bars[i].date)-Date.parse(bars[i-1].date)>4*86400000)gaps++;
      if(gaps)record.quality.push(gaps+' gaps exceed 4 calendar days; holidays versus missing sessions unresolved.');
      const zeroVolumes=bars.filter(b=>b.volume===0).length;
      if(zeroVolumes)record.quality.push(zeroVolumes+' zero-volume bars; upstream missing-versus-zero semantics unavailable.');
      computed=compute(bars);record.formulaVersion=computed.formulaVersion;record.indicators=computed.indicators;
      record.status='partial';
    } catch(e) {record.error=shortError(e);}
    record.timings.computeMs=elapsed(cStart);computeMs+=record.timings.computeMs;
    if(computed) {
      const seriesPath=join(artifactDir,instrument.symbol+'.series.json');
      await save(seriesPath,JSON.stringify({source,acquiredAt,identity:record.identity,bars,...computed},null,2)+'\n');record.seriesPath=seriesPath;
      const rStart=performance.now();
      try {
        if(signal?.aborted)throw Error('Cancelled before rendering');
        const png=render({...instrument,sourceMode},bars,computed.series), chartPath=join(artifactDir,instrument.symbol+'.png');
        await save(chartPath,png);record.chartPath=chartPath;record.status='completed';
      } catch(e) { record.error='Chart: '+shortError(e); }
      record.timings.renderMs=elapsed(rStart);renderMs+=record.timings.renderMs;
    }
    records.push(record);
  }
  const successful=records.filter(r=>r.status==='completed').length, usable=records.some(r=>r.indicators);
  const status=successful===records.length && !warnings.length ? 'completed' : usable ? 'partial' : 'failed';
  const result={kind:'evidence',schemaVersion:'pi-market.v1',status,runId,artifactDir,resultPath,rawPath,stderrPath,acquiredAt,acquisitionFinishedAt,source,
    acquisition:{invoked:receipt.invoked,error:receipt.invocationError,...receipt.transport},timings:{fetchMs,computeMs,renderMs,totalMs:elapsed(start)},warnings,limitations:[...LIMITATIONS],records,
    imageInspection:'A path is not image inspection. Direct: read({path: record.chartPath}). Codemode: image(await tools.read({path: record.chartPath})). Select only needed charts; no new acquisition.'};
  if(JSON.stringify(result).length>24000)throw Error('Internal bounded result budget exceeded; inspect run artifacts');
  await save(resultPath,JSON.stringify(result,null,2)+'\n');
  return result;
}

export function toolResult(result) {
  return {content:[{type:'text',text:JSON.stringify(result)}],details:result,structuredContent:result,isError:result.status==='failed'};
}
