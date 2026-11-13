// Yahoo daily-history provider. No indicators, chart rendering or classification.
import { readFile, writeFile, realpath, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, delimiter } from 'node:path';
import { performance } from 'node:perf_hooks';

export const sha256=data=>createHash('sha256').update(data).digest('hex');
const elapsed=start=>Math.round((performance.now()-start)*1000)/1000;
const shortError=e=>String(e?.message??e).slice(0,400);
const save=(path,data)=>writeFile(path,data,{flag:'wx',mode:0o444});
export async function resolveExecutable(command='ticker-cli') {
  const candidates=command.includes('/')?[resolve(command)]:(process.env.PATH??'').split(delimiter).map(p=>join(p,command));
  for(const candidate of candidates) { try { await access(candidate,constants.X_OK);return await realpath(candidate); } catch {} }
  throw Error('ticker-cli executable not found; no installation or fallback attempted.');
}

export function validateHistory(item, requested, acquiredAt) {
  if (!item || item.symbol !== requested.symbol) throw Error("Returned symbol does not exactly match requested instrument.");
  if (item.currency !== requested.currency) throw Error("Missing or mismatched currency; no currency conversion or suffix inference.");
  if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 200 || /[\x00-\x1f]/.test(item.name)) throw Error("Missing/invalid upstream instrument name.");
  if (!Array.isArray(item.points) || !item.points.length || item.points.length > 400) throw Error("Expected 1–400 daily bars.");
  let previous = "";
  const today = acquiredAt.slice(0, 10);
  const bars = item.points.map((b, index) => {
    const fail = message => { throw Error("Bar " + index + ": " + message); };
    if (!b || typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) fail("invalid date");
    const ms = Date.parse(b.date + "T00:00:00Z");
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10) !== b.date) fail("invalid calendar date");
    if (b.date <= previous) fail("duplicate or out-of-order date; never sorted/deduplicated");
    if (b.date > today) fail("future date");
    for (const key of ["open","high","low","close","volume"]) {
      if (typeof b[key] !== "number" || !Number.isFinite(b[key])) fail("nonfinite or missing " + key);
    }
    if ([b.open,b.high,b.low,b.close].some(v => v <= 0 || v > 1e12)) fail("prices outside supported positive equity range");
    if (!Number.isSafeInteger(b.volume) || b.volume < 0) fail("invalid volume");
    if (b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close) || b.low > b.high) fail("inconsistent OHLC");
    previous = b.date;
    return Object.freeze({date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume});
  });
  return Object.freeze(bars);
}

// Caller validates instruments and creates the exclusive run directory.
// One invocation only; ticker-cli itself can refresh/consent/retry as disclosed.
async function acquire(instruments, { exec, signal, artifactDir, executable='ticker-cli', sourceMode='live' }) {
  const rawPath=join(artifactDir,'ticker.stdout.json'), stderrPath=join(artifactDir,'ticker.stderr.txt');
  const args=['--range','1y','--format','json','--',...instruments.map(i=>i.symbol)];
  let command=null,binarySha256=null, invocationError=null;
  try { command=await resolveExecutable(executable); binarySha256=sha256(await readFile(command)); } catch(e) { invocationError=shortError(e); }
  const acquiredAt=new Date().toISOString(), fetchStart=performance.now();
  let transport={code:null,killed:false,truncated:false,stdout:'',stderr:''}, invoked=false;
  if(signal?.aborted)invocationError='Cancelled before acquisition';
  if(!invocationError) {
    invoked=true;
    try { transport={...transport,...await exec(command,args,{signal,timeout:45000,maxBuffer:2*1024*1024})}; }
    catch(e) { invocationError=shortError(e); }
  }
  const fetchMs=elapsed(fetchStart), acquisitionFinishedAt=new Date().toISOString();
  await save(rawPath,transport.stdout);await save(stderrPath,transport.stderr);
  const rawSha256=sha256(transport.stdout), warnings=[];
  const source={provider:sourceMode==='fixture'?'synthetic offline fixture':'Yahoo Finance via ticker-cli',mode:sourceMode,command,args,binarySha256,format:'ticker-cli history JSON',interval:'1d',requestedRange:'1y',adjustment:'unknown',rawSha256};
  const receipt={acquiredAt,acquisitionFinishedAt,source,invoked,invocationError,transport:{code:transport.code,killed:transport.killed,truncated:transport.truncated},fetchMs,rawPath,stderrPath,
    upstreamBehavior:'Inspected v0.1.0 can refresh session and retry chart once and can POST EU consent; no CLI disable flag. Wrapper never retries. New authorization required if those behaviors are prohibited.'};
  await save(join(artifactDir,'acquisition.json'),JSON.stringify(receipt,null,2)+'\n');
  let payload=[],parseError=invocationError;
  if(!parseError && (transport.killed || transport.truncated || signal?.aborted))parseError='Acquisition killed, truncated or cancelled; raw output retained but not promoted';
  if(!parseError)try {payload=JSON.parse(transport.stdout);if(!Array.isArray(payload))throw Error('Expected JSON history array');}catch(e){parseError=shortError(e);payload=[];}
  if(transport.code!==0)warnings.push('Nonzero or absent ticker-cli exit code: '+transport.code+'; inspect stderrPath.');
  if(transport.stderr)warnings.push('ticker-cli emitted stderr; full diagnostics preserved at stderrPath.');
  const unexpected=payload.filter(p=>!instruments.some(i=>i.symbol===p?.symbol)).length;
  if(unexpected)warnings.push(unexpected+' unexpected/unidentified result records retained only in raw artifact.');

  return {payload,parseError,source,receipt,warnings,rawPath,stderrPath,acquiredAt,acquisitionFinishedAt,fetchMs};
}
export const yahoo = Object.freeze({
  id: 'yahoo',
  transport: 'native-cli',
  operation: 'daily-history',
  kind: 'evidence',
  acquire,
  validateHistory,
});
