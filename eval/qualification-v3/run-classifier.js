// Trusted local Codemode body, not Node or a script derived from source text.
// Caller sets stores qualificationPrepared and qualificationAllowance once.
const prepared = load('qualificationPrepared');
const allowance = load('qualificationAllowance');
if (!prepared || !allowance || allowance.batchId !== prepared.batchId || allowance.maxCalls !== 30 || allowance.maxConcurrency !== 4 || !allowance.root) throw new Error('Explicit bounded allowance/prepared batch missing.');
if (prepared.requests.length > allowance.maxCalls || prepared.profile.policy.maxConcurrency !== 4) throw new Error('Frozen budget exceeded.');
const model = (await models.getAvailableOfType('classifier', 'typesafe')).find(m => m.id === 'jev-latest');
if (!model) throw new Error('Requested Jev unavailable; no substitution or login.');
const quote = s => "'" + s.replace(/'/g, "'\\''") + "'";
const claim = await tools.bash({command:'mkdir -- ' + quote(allowance.root + '/classifier.claim'), timeout:10});
if (claim.exit_code !== 0) throw new Error('Classifier allowance already claimed or inaccessible; no retry.');
const responses = [], passes = [], startMs = Date.now();
for (const pass of ['ranking', 'provenance']) {
  const requests = prepared.requests.filter(r => r.pass === pass);
  const passStart = Date.now(); let cursor = 0;
  async function worker() {
    while (cursor < requests.length) {
      const index = cursor++, request = requests[index], start = Date.now();
      let result;
      try { result = await models.classify(model, {state:request.state, questions:request.questions}); }
      catch (error) { result = {provider:'typesafe', model:'jev-latest', stopReason:'error', answers:{}, errorMessage:String(error)}; }
      const response = {sourceId:request.sourceId, pass, result, startMs:start, endMs:Date.now()};
      responses.push(response);
      await tools.write({path:allowance.root + '/responses/' + pass + '-' + String(index + 1).padStart(2,'0') + '.json', content:JSON.stringify(response,null,2)+'\n'});
    }
  }
  const settled = await Promise.allSettled(Array.from({length:Math.min(4, requests.length)}, () => worker()));
  passes.push({pass,startMs:passStart,endMs:Date.now(),requested:requests.length,workerFailures:settled.filter(x=>x.status==='rejected').map(x=>String(x.reason))});
}
const endMs = Date.now();
const capture = {batchId:prepared.batchId,profileHash:prepared.profileHash,startMs,endMs,wallTimeMs:endMs-startMs,passes,responses};
await tools.write({path:allowance.root+'/classifier.json',content:JSON.stringify(capture,null,2)+'\n'});
const view = await tools.research_review({batchId:prepared.batchId,responses});
store('qualificationView',view);
store('qualificationCapture',capture);
text({batchId:prepared.batchId,wallTimeMs:capture.wallTimeMs,passes:passes.map(p=>({pass:p.pass,wallTimeMs:p.endMs-p.startMs,requested:p.requested,workerFailures:p.workerFailures})),reviewPath:view.reviewPath,retained:view.retained,excluded:view.excluded,ranked:view.rankedIds.length,needsContext:view.needsContextIds.length,needsEvidence:view.needsEvidenceIds.length,concerns:view.concernIds.length});
