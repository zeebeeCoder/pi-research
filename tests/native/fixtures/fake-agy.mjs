#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2), mode = process.env.FAKE_AGY_MODE || 'success';
const prompt = args[args.indexOf('-p') + 1];
const parameters = JSON.parse(prompt.match(/parameters (.+), then immediately give the final answer\./)[1]);
const model = args[args.indexOf('--model') + 1];
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
if (mode === 'exit') { process.stderr.write('authentication or quota error\n'); process.exit(7); }
if (mode === 'bad-stream') { process.stdout.write('not JSON\n'); process.exit(0); }
if (mode === 'hang' || mode === 'descendant') {
  if (mode === 'descendant') {
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: 'inherit' });
    writeFileSync(process.env.FAKE_PID_FILE, String(child.pid)); process.on('SIGTERM', () => {});
  }
  setInterval(() => {}, 1000);
} else {
  if (mode !== 'no-init') emit({ event: 'init', init: { model: mode === 'fallback' ? 'claude-sonnet-other' : model } });
  if (mode !== 'no-call') {
    const step = { conversation_id: 'fixture', step_index: 2, step_type: 'tool', tool_name: mode === 'local-tool' ? 'view_file' : 'search_web', tool_info: { parameters: { query: mode === 'changed-query' ? 'rewritten' : parameters.query } } };
    emit({ event: 'step_update', step_update: { ...step, state: 'ACTIVE' } });
    if (mode === 'extra-call') emit({ event: 'step_update', step_update: { ...step, step_index: 4, state: 'ACTIVE' } });
    emit({ event: 'step_update', step_update: { ...step, state: mode === 'failed-tool' ? 'ERROR' : 'DONE' } });
  }
  const source = { title: 'Fixture source', url: 'https://example.com/source', snippet: 'Fixture only, not a real search result.' };
  const payload = { sources: mode === 'empty' ? [] : [source], note: mode === 'empty' ? 'No matches.' : null };
  if (mode === 'timeout-warning') process.stderr.write('[agy] print timeout after 45s with turn in progress; returning partial output\n');
  if (mode !== 'partial') emit({ event: 'result', result: {
    status: mode === 'failed-result' ? 'ERROR' : 'SUCCESS', response: mode === 'empty-success' ? '' : mode === 'bad-answer' ? 'No JSON' : JSON.stringify(payload),
    conversation_id: 'fixture', num_turns: 1, usage: { input_tokens: 100, output_tokens: 40, thinking_tokens: 0 },
  } });
}
