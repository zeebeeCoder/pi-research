// Offline only. Uses public Pi SDK APIs, no model session, credentials or services.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {join,resolve,delimiter} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {history} from '../market/fixtures.mjs';
import {packageRoot} from '../../src/market/research.mjs';

if(process.argv.length!==2)throw Error('Offline contact takes no arguments; it cannot perform live acquisition.');
if(!process.env.PI_RESEARCH_PI_PACKAGE)throw Error('Set PI_RESEARCH_PI_PACKAGE to the installed @earendil-works/pi-coding-agent directory.');
const piPackage=resolve(process.env.PI_RESEARCH_PI_PACKAGE);
const manifest=JSON.parse(await readFile(join(piPackage,'package.json'),'utf8'));
const sdk=await import(pathToFileURL(join(piPackage,manifest.main)));
const require=createRequire(join(piPackage,'package.json'));
let aiEntry;
for(const base of require.resolve.paths('@earendil-works/pi-ai')) {
 try {const root=join(base,'@earendil-works/pi-ai');const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));aiEntry=join(root,pkg.exports['.'].import);break;}catch{}
}
if(!aiEntry)throw Error('Installed Pi AI public entry not found');
const {validateToolArguments}=await import(pathToFileURL(aiEntry));
const dir=join(packageRoot,'.artifacts','market','contact',randomUUID());
await mkdir(join(dir,'bin'),{recursive:true});await mkdir(join(dir,'agent'),{recursive:true});
const data=JSON.stringify([history()]);await writeFile(join(dir,'fixture.json'),data);
const fake=join(dir,'bin','ticker-cli'),callsPath=join(dir,'calls.jsonl');
await writeFile(fake,`#!${process.execPath}
import {readFileSync,appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(callsPath)},JSON.stringify(process.argv.slice(2))+'\\n');
process.stdout.write(readFileSync(${JSON.stringify(join(dir,'fixture.json'))}));
process.stderr.write('Synthetic RHM.DE unavailable: offline test only\\n');
process.exitCode=1;
`);
// The extensionless executable is treated as ESM by this nearest manifest.
await writeFile(join(dir,'bin','package.json'),'{"type":"module"}\n');await chmod(fake,0o700);
const oldPath=process.env.PATH;process.env.PATH=join(dir,'bin')+delimiter+oldPath;
try {
 const settingsManager=sdk.SettingsManager.inMemory({packages:[],extensions:[],retry:{enabled:false},codemode:{mode:'on'}});
 const loader=new sdk.DefaultResourceLoader({cwd:dir,agentDir:join(dir,'agent'),settingsManager,
  noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,
  additionalExtensionPaths:[packageRoot],
  extensionFactories:[],
 });
 await loader.reload();const loaded=loader.getExtensions();assert.deepEqual(loaded.errors,[]);
 const tools=loaded.extensions.flatMap(e=>[...e.tools.values()].map(t=>t.definition));
 const market=tools.find(t=>t.name==='market_research'),route=tools.find(t=>t.name==='research_route');
 assert.ok(market);assert.ok(route);
 assert.equal(loaded.extensions.length,1,'Only the research extension is loaded');
 assert.deepEqual(tools.map(t=>t.name).sort(),['market_research','research_search','research_route','research_reduce','research_sources','research_prepare','research_review','research_read_pages'].sort());
 assert.equal(new Set(tools.map(t=>t.name)).size,8);
 assert.equal(market.namespace.name,'research');
 assert.equal(market.outputSchema.properties.kind.const,'evidence');
 const read=sdk.createReadTool(packageRoot);
 const callable=[market,route,read];let nestedId=0,codemode;
 // Instantiate the public Codemode factory against a minimal test ExtensionAPI.
 // Real QuickJS execution; nested dispatch is the documented context contract, not a model session.
 sdk.createCodemodeExtension({mode:'on',models:false})({registerTool:t=>{codemode=t;},getAllTools:()=>callable,getSettings:()=>({}),appendEntry:()=>{throw Error('Unexpected persistent session write');}});
 const ctx={cwd:dir,hasUI:false,tools:callable,sessionManager:{getSessionId:()=> 'offline-contact',getSessionFile:()=>undefined,getBranch:()=>[]},
  modelRegistry:new Proxy({},{get(){throw Error('No model/classifier access permitted');}}),
  executeTool:async(name,args,options={})=>{
   const tool=callable.find(t=>t.name===name),id='nested-'+(++nestedId),toolCall={id,name,arguments:args};
   try {assert.ok(tool);validateToolArguments(tool,toolCall);const result=await tool.execute(id,args,options.signal,options.onUpdate,ctx);return {toolCall,result,isError:result.isError??false};}
   catch(e){return {toolCall,result:{content:[{type:'text',text:String(e)}],details:undefined},isError:true};}
  },
 };
 const input={instruments:[{symbol:'ASML.AS',currency:'EUR'},{symbol:'RHM.DE',currency:'EUR'}]};
 validateToolArguments(market,{id:'direct',name:market.name,arguments:input});
 const direct=await market.execute('direct',input,undefined,undefined,ctx),result=direct.structuredContent;
 validateToolArguments({name:'result',description:'Output validation',parameters:market.outputSchema},{id:'output',name:'result',arguments:result});
 assert.deepEqual(JSON.parse(direct.content[0].text),result);assert.deepEqual(direct.details,result);assert.equal(result.status,'partial');
 assert.equal(result.records[0].status,'completed');assert.equal(result.records[1].status,'failed');assert.equal(direct.isError,false);
 const directImage=await read.execute('read-chart',{path:result.records[0].chartPath},undefined,undefined,ctx);
 assert.ok(directImage.content.some(c=>c.type==='image'));
 const outcomes=[{status:'fulfilled',value:result},{status:'rejected',reason:'Offline unrelated acquisition failure'}];
 const routed=await route.execute('route',{outcomes},undefined,undefined,ctx);
 assert.deepEqual(routed.structuredContent,{leads:[],evidence:[0],rejected:[1]});
 // Real installed QuickJS Codemode, explicit model-visible image forwarding.
 const script=`const r=await tools.market_research(${JSON.stringify(input)});
const routing=await tools.research_route({outcomes:[{status:'fulfilled',value:r}]});
text({kind:r.kind,status:r.status,resultPath:r.resultPath,chartPath:r.records[0].chartPath,routing});
image(await tools.read({path:r.records[0].chartPath}));`;
 // Direct tool execution uses the public tool's structured arguments; the model-facing grammar is raw JS.
 const coded=await codemode.execute('codemode-contact',{code:script},undefined,undefined,ctx);
 assert.equal(coded.isError??false,false,JSON.stringify(coded.content.filter(c=>c.type==='text')));
 assert.ok(coded.content.some(c=>c.type==='image'),'Codemode must expose image content, not just a path');
 const invocations=(await readFile(callsPath,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
 assert.equal(invocations.length,2);for(const args of invocations)assert.deepEqual(args,['--range','1y','--format','json','--','ASML.AS','RHM.DE']);
 const report={mode:'offline-only',piVersion:manifest.version,publicSdkLoader:true,singlePackage:true,registeredTools:tools.map(t=>t.name),mockedNestedDispatch:true,schemas:'valid',fakeTickerInvocations:2,liveInvocations:0,
  classifierCalls:0,oneInvocationPerRequestedBatch:true,directImage:true,codemodeImage:true,partialSymbolPreserved:true,
  routing:routed.structuredContent,directResultPath:result.resultPath,chartPath:result.records[0].chartPath,
  timings:result.timings,codemodeText:coded.content.filter(c=>c.type==='text').map(c=>c.text),
  note:'Synthetic fixture. Provider fields describe the adapter, not live Yahoo observations. No production reliability or latency claim.'};
 await writeFile(join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');
 await writeFile(join(packageRoot,'.artifacts','market','latest-contact.json'),JSON.stringify({reportPath:join(dir,'report.json'),...report},null,2)+'\n');
 console.log(JSON.stringify({reportPath:join(dir,'report.json'),mode:report.mode,schemas:report.schemas,directImage:true,codemodeImage:true,routing:report.routing,liveInvocations:0}));
} finally {process.env.PATH=oldPath;}
