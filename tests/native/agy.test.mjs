import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProcessExited } from './assert-process-exit.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs, modelFor, effectiveQuery, buildCommand, StreamAudit, publicHttpUrl, resolveCitation, normalizeSources, runScout, formatText } from '../../src/providers/agy/scout.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-agy.mjs', import.meta.url));
const script = fileURLToPath(new URL('../../src/providers/agy/scout.mjs', import.meta.url));
chmodSync(fixture, 0o755);
const options = (...args) => parseArgs(['query', ...args]);
const source = (changes = {}) => ({ title: 'Example', url: 'https://example.com/source', snippet: 'Short search summary', ...changes });
const payload = sources => ({ sources, note: null });
const citation = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/EXAMPLE';
function temporary() {
  const dir = mkdtempSync(join(tmpdir(), 'agy-search-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }), env: mode => ({ ...process.env, AGY_SEARCH_BIN: fixture, AGY_SEARCH_STATE_DIR: dir, FAKE_AGY_MODE: mode }) };
}

test('defaults, shorthand, data after -- and offline help', () => {
  assert.deepEqual(options(), { query: 'query', limit: 5, effort: 'low', timeout: 45, youtube: false, resolve: true, json: false });
  assert.equal(parseArgs(['search', 'quoted "data"', '-j']).json, true);
  assert.equal(parseArgs(['--', '--literal']).query, '--literal');
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.equal(effectiveQuery(options('--youtube')), 'site:youtube.com query');
});

for (const effort of ['low', 'medium', 'high']) {
  test(`Flash-only ${effort} selects matching variant and effort`, () => {
    const opt = options('--effort', effort), args = buildCommand(opt);
    assert.equal(modelFor(opt), `gemini-3.8-flash-${effort}`);
    assert.equal(args[args.indexOf('--model') + 1], modelFor(opt));
    assert.equal(args[args.indexOf('--effort') + 1], effort);
    assert.equal(args[args.indexOf('--mode') + 1], 'plan');
    assert.ok(!args.includes('--dangerously-skip-permissions'));
    assert.ok(!args.includes('--disable-slash-commands'));
    assert.ok(!args.includes('--json-schema'));
    assert.ok(!args.includes('--continue'));
  });
}

for (const argv of [[], ['q', '-n', '0'], ['q', '-n', '11'], ['q', '-n', '1.2'], ['q', '--timeout', '121'], ['q', '--timeout', 'NaN'], ['q', '--effort', 'max'], ['q', '--model', 'claude'], ['q', '--effort'], ['q', '--unknown'], ['x'.repeat(2001)]]) {
  test(`reject invalid arguments ${JSON.stringify(argv).slice(0, 70)}`, () => assert.throws(() => parseArgs(argv), error => error.exitCode === 64));
}

for (const value of ['file:///tmp/private', 'http://localhost/a', 'http://127.0.0.1/a', 'http://2130706433/a', 'http://[::1]/a', 'https://name:secret@example.com', 'https://service.internal/a', 'https://foo.local/a', 'javascript:alert(1)', 'not URL']) {
  test(`reject unsafe source URL ${value}`, () => assert.throws(() => publicHttpUrl(value)));
}

test('direct sources never trigger network resolution', async () => {
  const result = await resolveCitation('https://example.com/source', { fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal(result.resolution, 'not-needed');
});

test('citation resolver makes one HEAD to exact Google host, never fetches destination', async () => {
  const calls = [];
  const result = await resolveCitation(citation, { fetchImpl: async (url, config) => {
    calls.push({ url, config }); return new Response(null, { status: 302, headers: { location: 'https://www.youtube.com/watch?v=EXAMPLE' } });
  } });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, citation);
  assert.equal(calls[0].config.method, 'HEAD'); assert.equal(calls[0].config.redirect, 'manual');
  assert.equal(result.url, 'https://www.youtube.com/watch?v=EXAMPLE'); assert.equal(result.resolution, 'redirect');
});

test('citation resolution failure keeps original citation', async () => {
  const result = await resolveCitation(citation, { fetchImpl: async () => { throw new Error('timeout'); } });
  assert.equal(result.url, citation); assert.equal(result.resolution, 'failed');
  const blocked = await resolveCitation(citation, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }) });
  assert.equal(blocked.url, citation); assert.equal(blocked.resolution, 'failed');
});

test('lookalike Google host never gets fetched', async () => {
  const url = 'https://vertexaisearch.cloud.google.com.evil.com/grounding-api-redirect/EXAMPLE';
  const result = await resolveCitation(url, { fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal(result.resolution, 'not-needed');
});

test('normalization caps snippets, deduplicates IDs/URLs and removes terminal controls', async () => {
  const result = await normalizeSources(payload([source({ snippet: '\u001b' + '🙂'.repeat(230) }), source(), source({ url: 'https://example.com/other' })]), options('-n', '1'));
  assert.equal(result.sources.length, 1); assert.equal(result.omitted, 2);
  assert.equal(Array.from(result.sources[0].snippet).length, 220); assert.equal(result.sources[0].truncated, true);
});

test('deduplicates resolved destinations without extra source fetches', async () => {
  const result = await normalizeSources(payload([source({ url: citation }), source({ url: 'https://example.com/source' })]), options(), {
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://example.com/source' } }),
  });
  assert.equal(result.sources.length, 1); assert.equal(result.omitted, 1);
});

test('YouTube discovery omits known off-site sources but preserves unresolved citations', async () => {
  const result = await normalizeSources(payload([source(), source({ url: citation }), source({ url: 'https://www.youtube.com/watch?v=EXAMPLE' })]), options('--youtube', '--no-resolve'));
  assert.equal(result.omitted, 1); assert.deepEqual(result.sources.map(s => s.kind), ['citation', 'youtube']);
});

test('--no-resolve makes no HEAD calls', async () => {
  const result = await normalizeSources(payload([source({ url: citation })]), options('--no-resolve'), { fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal(result.citations[0].resolution, 'disabled');
});

test('expired deadline and cancellation never return partial success', async () => {
  await assert.rejects(normalizeSources(payload([]), options(), { deadline: 0 }), error => error.exitCode === 124);
  await assert.rejects(normalizeSources(payload([]), options(), { signal: AbortSignal.abort() }), error => error.exitCode === 130);
});

for (const bad of [source({ url: 'file:///tmp/private' }), source({ title: '' }), source({ snippet: '' }), source({ snippet: '\u001b\u0007' })]) {
  test('malformed source rejects rather than fabricating fields', async () => assert.rejects(normalizeSources(payload([bad]), options())));
}

test('final success alone does not prove a search occurred', () => {
  const audit = new StreamAudit(options());
  audit.accept({ event: 'init', init: { model: 'gemini-3.8-flash-low' } });
  audit.accept({ event: 'result', result: { status: 'SUCCESS', response: JSON.stringify(payload([])) } });
  assert.throws(() => audit.finish(), /completed native search/);
});

for (const effort of ['low', 'medium', 'high']) {
  test(`spawn integration: ${effort} Flash, artifacts and safe query arguments`, async () => {
    const t = temporary();
    try {
      const query = 'literal $(touch /tmp/SHOULD_NOT_EXIST_AGY_SEARCH) "quoted"; text';
      const result = await runScout(parseArgs([query, '--effort', effort]), { env: t.env('success') });
      assert.equal(result.sources.length, 1); assert.equal(result.meta.model, `gemini-3.8-flash-${effort}`);
      assert.equal(result.meta.tool_calls.length, 1); assert.equal(result.meta.reported_cost_usd, null);
      assert.equal(result.meta.query, query); assert.ok(!existsSync('/tmp/SHOULD_NOT_EXIST_AGY_SEARCH'));
      assert.ok(existsSync(join(result.meta.trace_dir, 'trace.jsonl')));
      assert.ok(existsSync(join(result.meta.trace_dir, 'citations.json')));
      assert.ok(existsSync(join(result.meta.trace_dir, 'result.json')));
      assert.match(formatText(result), /1 search/); assert.match(formatText(result), /unverified search summaries/);
    } finally { t.cleanup(); }
  });
}

test('empty search succeeds with a note', async () => {
  const t = temporary();
  try { const result = await runScout(options(), { env: t.env('empty') }); assert.equal(result.sources.length, 0); assert.equal(result.meta.note, 'No matches.'); }
  finally { t.cleanup(); }
});

for (const mode of ['exit', 'bad-stream', 'no-init', 'fallback', 'no-call', 'local-tool', 'changed-query', 'extra-call', 'failed-tool', 'partial', 'empty-success', 'bad-answer', 'failed-result', 'timeout-warning']) {
  test(`fail closed on ${mode}`, async () => {
    const t = temporary();
    try { await assert.rejects(runScout(options(), { env: t.env(mode) }), error => /Trace:/.test(error.message)); }
    finally { t.cleanup(); }
  });
}

test('deadline stops resistant descendants', async () => {
  const t = temporary(), pidFile = join(t.dir, 'pid');
  try {
    await assert.rejects(runScout(options('--timeout', '1'), { env: { ...t.env('descendant'), FAKE_PID_FILE: pidFile } }), error => error.exitCode === 124);
    await assertProcessExited(Number(readFileSync(pidFile, 'utf8')));
  } finally { t.cleanup(); }
});

test('abort before and during invocation', async () => {
  await assert.rejects(runScout(options(), { signal: AbortSignal.abort() }), error => error.exitCode === 130);
  const t = temporary(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 100);
  try { await assert.rejects(runScout(options(), { env: t.env('hang'), signal: controller.signal }), error => error.exitCode === 130); }
  finally { clearTimeout(timer); t.cleanup(); }
});

test('missing binary and offline help / JSON usage errors', async () => {
  const t = temporary();
  try { await assert.rejects(runScout(options(), { env: { ...t.env('success'), AGY_SEARCH_BIN: join(t.dir, 'missing') } }), /executable not found/); }
  finally { t.cleanup(); }
  const env = { ...process.env, AGY_SEARCH_BIN: '/missing/agy' };
  const help = spawnSync(process.execPath, [script, '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /Flash-only/);
  const bad = spawnSync(process.execPath, [script, 'query', '--effort', 'max', '--json'], { env, encoding: 'utf8' });
  assert.equal(bad.status, 64); assert.equal(bad.stdout, ''); assert.equal(JSON.parse(bad.stderr).exit_code, 64);
});
