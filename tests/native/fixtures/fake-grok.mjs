#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1];
const requestPart = prompt.split('. After the search,')[0];
const spec = JSON.parse(requestPart.slice(requestPart.indexOf('{')));
const mode = process.env.FAKE_GROK_MODE || 'success';
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
if (mode === 'exit') { process.stderr.write('quota error\n'); process.exit(7); }
if (mode === 'bad-stream') { process.stdout.write('not json\n'); process.exit(0); }
if (mode === 'hang' || mode === 'descendant') {
  if (mode === 'descendant') {
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: 'inherit' });
    writeFileSync(process.env.FAKE_PID_FILE, String(child.pid));
    process.on('SIGTERM', () => {});
  }
  setInterval(() => {}, 1000);
} else {
  emit({ type: 'available_commands', tools: [] });
  if (mode === 'error') { emit({ type: 'error', message: 'backend error' }); }
  else if (mode !== 'no-call') {
    emit({ type: 'tool_call', toolCallId: 'call-1', rawInput: { variant: mode === 'local-tool' ? 'ReadFile' : 'XSearch', backend: mode !== 'local-tool' } });
    if (mode === 'extra-call') emit({ type: 'tool_call', toolCallId: 'call-2', rawInput: { variant: 'XSearch', backend: true } });
    const callArgs = { ...spec.args, limit: String(spec.args.limit) };
    if (mode === 'wrong-query') callArgs.query = 'rewritten query';
    if (mode === 'wrong-date') delete callArgs.from_date;
    if (mode === 'extra-argument') callArgs.max_results = 999;
    emit({ type: 'tool_call_update', toolCallId: 'call-1', status: mode === 'failed-call' ? 'failed' : 'completed', rawOutput: { name: mode === 'wrong-tool' ? 'x_thread_fetch' : spec.name, input: JSON.stringify(callArgs) } });
  }
  const post = { url: 'https://x.com/example/status/123456789', author: '@example', date: '2026-10-10', excerpt: 'A real-looking fixture, not a network result.' };
  const result = mode === 'bad-answer' ? 'No JSON here' : JSON.stringify({ posts: mode === 'empty' ? [] : [post], note: mode === 'empty' ? 'No matches.' : null });
  // Exercise chunked text delivery rather than assuming one event per answer.
  emit({ type: 'text', data: result.slice(0, 17) }); emit({ type: 'text', data: result.slice(17) });
  if (mode !== 'partial') emit({ type: 'end', stopReason: mode === 'turn-limit' ? 'max_turns' : 'end_turn', sessionId: 'fixture-session', total_cost_usd: 0.001, usage: { input_tokens: 100, output_tokens: 40 } });
}
