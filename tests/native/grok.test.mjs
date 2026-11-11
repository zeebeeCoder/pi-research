import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProcessExited } from './assert-process-exit.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs, searchSpec, buildCommand, StreamAudit, normalizePosts, runScout, formatText } from '../../src/providers/grok/scout.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-grok.mjs', import.meta.url));
const script = fileURLToPath(new URL('../../src/providers/grok/scout.mjs', import.meta.url));
chmodSync(fixture, 0o755);
const options = (...args) => parseArgs(['query', ...args]);
const payload = posts => ({ posts, note: null });
const post = (changes = {}) => ({ url: 'https://x.com/example/status/123', author: '@example', date: '2026-10-10', excerpt: 'Short excerpt', ...changes });

function temporary() {
  const dir = mkdtempSync(join(tmpdir(), 'grok-x-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }), env: mode => ({ ...process.env, GROK_X_BIN: fixture, GROK_X_STATE_DIR: dir, FAKE_GROK_MODE: mode }) };
}

test('scout defaults and quoted queries', () => {
  assert.deepEqual(options(), { query: 'query', mode: 'semantic', limit: 5, timeout: 45, model: 'grok-4.7', json: false });
  assert.equal(parseArgs(['search', 'from:xai "Grok Build"', '--mode', 'keyword', '-n', '3', '-j']).query, 'from:xai "Grok Build"');
  assert.equal(parseArgs(['--', '--literal']).query, '--literal');
  assert.deepEqual(parseArgs(['--help']), { help: true });
});

for (const argv of [[], ['q', '-n', '0'], ['q', '-n', '11'], ['q', '-n', '2.5'], ['q', '--timeout', '121'], ['q', '--timeout', 'NaN'], ['q', '--mode', 'research'], ['q', '--since', '2026-02-30'], ['q', '--until', 'today'], ['q', '--since', '2026-10-10', '--until', '2026-10-10'], ['q', '--model', '--always-approve'], ['q', '--unknown'], ['q', '--limit'], ['x'.repeat(2001)]]) {
  test(`reject invalid arguments ${JSON.stringify(argv).slice(0, 80)}`, () => assert.throws(() => parseArgs(argv), error => error.exitCode === 64));
}

test('native requests use one exact query and explicit dates', () => {
  assert.deepEqual(searchSpec(options('--since', '2026-10-01', '--until', '2026-10-15')), { name: 'x_semantic_search', args: { query: 'query', limit: 5, from_date: '2026-10-01', to_date: '2026-10-15' } });
  assert.deepEqual(searchSpec(options('--mode', 'keyword', '-n', '2', '--since', '2026-10-01')), { name: 'x_keyword_search', args: { query: 'query since:2026-10-01', limit: 2, mode: 'Latest' } });
});

test('command requests low effort, disabled local tools, deny-all and no bypass', () => {
  const args = buildCommand(options(), '/tmp/isolated');
  assert.equal(args[args.indexOf('--reasoning-effort') + 1], 'low');
  assert.equal(args[args.indexOf('--deny') + 1], '*');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'plan');
  assert.ok(args.includes('--no-subagents'));
  assert.ok(args[args.indexOf('--disallowed-tools') + 1].includes('run_terminal_command'));
  assert.ok(!args.includes('--always-approve'));
  assert.ok(!args.includes('--continue'));
});

test('normalizes URLs, deduplicates status IDs and limits excerpts by Unicode characters', () => {
  const result = normalizePosts(payload([post({ url: 'https://twitter.com/example/status/123?s=20', excerpt: '🙂'.repeat(230) }), post({ url: 'https://x.com/other/status/123' }), post({ url: 'https://x.com/example/status/456' })]), options('-n', '1'));
  assert.equal(result.posts[0].url, 'https://x.com/example/status/123');
  assert.equal(Array.from(result.posts[0].excerpt).length, 220);
  assert.equal(result.posts[0].truncated, true);
  assert.equal(result.omitted, 2);
});

test('untrusted excerpts cannot emit terminal controls', () => {
  const result = normalizePosts(payload([post({ excerpt: '\u001b]52;c;payload\u0007\nA\tB' })]), options());
  assert.equal(result.posts[0].excerpt, ']52;c;payload A B');
  assert.throws(() => normalizePosts(payload([post({ excerpt: '\u001b\u0007' })]), options()), /Empty excerpt/);
});

test('local window check uses stated dates; omits unknown and exclusive-end dates', () => {
  const result = normalizePosts(payload([post(), post({ url: 'https://x.com/example/status/124', date: null }), post({ url: 'https://x.com/example/status/125', date: '2026-10-15' })]), options('--since', '2026-10-01', '--until', '2026-10-15'));
  assert.equal(result.posts.length, 1); assert.equal(result.omitted, 2);
});

for (const bad of [post({ url: 'https://evil.com/example/status/123' }), post({ url: 'https://x.com/example' }), post({ url: 'https://x.com.evil.com/example/status/123' }), post({ date: '2026-02-30' }), post({ excerpt: '' }), post({ author: 'invented display name' })]) {
  test(`reject malformed record ${JSON.stringify(bad).slice(0, 90)}`, () => assert.throws(() => normalizePosts(payload([bad]), options())));
}

test('audit does not trust a final JSON answer without a completed tool call', () => {
  const audit = new StreamAudit(options());
  audit.accept({ type: 'text', data: JSON.stringify(payload([])) });
  audit.accept({ type: 'end', stopReason: 'end_turn' });
  assert.throws(() => audit.finish(), /completed native search/);
});

test('pre-search commentary is separate from the strict final JSON answer', () => {
  const audit = new StreamAudit(options());
  audit.accept({ type: 'text', data: "I'll run the requested search now." });
  audit.accept({ type: 'tool_call', toolCallId: 'search-1', rawInput: { variant: 'XSearch', backend: true } });
  audit.accept({ type: 'tool_call_update', toolCallId: 'search-1', status: 'completed', rawOutput: {
    name: 'x_semantic_search', input: JSON.stringify(searchSpec(options()).args),
  } });
  audit.accept({ type: 'text', data: JSON.stringify(payload([post()])) });
  audit.accept({ type: 'end', stopReason: 'end_turn' });
  assert.deepEqual(audit.finish(), payload([post()]));
  audit.accept({ type: 'text', data: 'Extra prose after JSON must still fail.' });
  assert.throws(() => audit.finish(), /valid JSON answer/);
});

test('reject excessive assistant output', () => {
  assert.throws(() => new StreamAudit(options()).accept({ type: 'text', data: 'x'.repeat(20001) }), /output budget/);
});

for (const mode of ['success', 'empty']) {
  test(`spawn integration: ${mode}, private artifacts, compact JSON and safe arguments`, async () => {
    const t = temporary();
    try {
      const query = 'literal $(touch /tmp/SHOULD_NOT_EXIST_GROK_X) "quoted"; text';
      const result = await runScout(parseArgs([query]), { env: t.env(mode) });
      assert.equal(result.posts.length, mode === 'empty' ? 0 : 1);
      assert.equal(result.meta.tool_calls.length, 1);
      assert.equal(result.meta.query, query);
      assert.equal(result.meta.reported_cost_usd, 0.001);
      assert.ok(existsSync(join(result.meta.trace_dir, 'trace.jsonl')));
      assert.ok(existsSync(join(result.meta.trace_dir, 'result.json')));
      assert.match(formatText(result), /1 search/);
      assert.match(formatText(result), /unverified sample/);
      assert.ok(!existsSync('/tmp/SHOULD_NOT_EXIST_GROK_X'));
    } finally { t.cleanup(); }
  });
}

for (const mode of ['exit', 'bad-stream', 'partial', 'local-tool', 'extra-call', 'wrong-query', 'wrong-tool', 'failed-call', 'no-call', 'bad-answer', 'turn-limit', 'error', 'extra-argument', 'wrong-date']) {
  test(`fail closed on ${mode}`, async () => {
    const t = temporary();
    try {
      await assert.rejects(runScout(options('--since', '2026-10-01'), { env: t.env(mode) }), error => /Trace:/.test(error.message));
    } finally { t.cleanup(); }
  });
}

test('deadline rejects partial success and stops resistant descendants', async () => {
  const t = temporary();
  const pidFile = join(t.dir, 'pid');
  try {
    await assert.rejects(runScout(options('--timeout', '1'), { env: { ...t.env('descendant'), FAKE_PID_FILE: pidFile } }), error => error.exitCode === 124);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    await assertProcessExited(pid);
  } finally { t.cleanup(); }
});

test('abort before invocation makes no run', async () => {
  await assert.rejects(runScout(options(), { signal: AbortSignal.abort() }), error => error.exitCode === 130);
});

test('abort during invocation returns cancellation', async () => {
  const t = temporary(); const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try { await assert.rejects(runScout(options(), { env: t.env('hang'), signal: controller.signal }), error => error.exitCode === 130); }
  finally { clearTimeout(timer); t.cleanup(); }
});

test('missing binary provides an actionable error', async () => {
  const t = temporary();
  try { await assert.rejects(runScout(options(), { env: { ...t.env('success'), GROK_X_BIN: join(t.dir, 'missing') } }), /executable not found/); }
  finally { t.cleanup(); }
});

test('actual CLI help does not invoke grok; JSON failure is stderr-only', () => {
  const env = { ...process.env, GROK_X_BIN: '/definitely/not/a/grok' };
  const help = spawnSync(process.execPath, [script, '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /X-only scout/);
  const bad = spawnSync(process.execPath, [script, 'query', '--limit', '99', '--json'], { env, encoding: 'utf8' });
  assert.equal(bad.status, 64); assert.equal(bad.stdout, ''); assert.equal(JSON.parse(bad.stderr).exit_code, 64);
});
