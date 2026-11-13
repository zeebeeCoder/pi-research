import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBatch, packageRoot } from '../../src/market/research.mjs';
import { sha256 } from '../../src/providers/yahoo/index.mjs';

test('frozen live capture replays through integrated Yahoo provider with identical numerics and PNGs', async () => {
  const raw = await readFile(new URL('./fixtures/yahoo-2026-11-12.json', import.meta.url), 'utf8');
  const expected = JSON.parse(await readFile(new URL('./fixtures/yahoo-2026-11-12.expected.json', import.meta.url), 'utf8'));
  assert.equal(sha256(raw), expected.rawSha256);
  // Freeze only this test process's clock to the original capture; no new live call.
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [expected.acquiredAt])); }
    static now() { return RealDate.parse(expected.acquiredAt); }
  };
  let calls = 0;
  try {
    const result = await runBatch(expected.records.map(r => r.requested), {
      executable: process.execPath,
      artifactRoot: join(packageRoot, '.artifacts', 'market', 'replay'),
      sourceMode: 'saved-live-replay',
      exec: async (_command, args) => {
        calls++;
        assert.deepEqual(args, ['--range', '1y', '--format', 'json', '--', 'ASML.AS', 'RHM.DE']);
        return { stdout: raw, stderr: '', code: 0, killed: false, truncated: false };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.kind, 'evidence');
    assert.equal(result.status, 'completed');
    assert.equal(result.source.mode, 'saved-live-replay');
    assert.equal(result.source.rawSha256, expected.rawSha256);
    for (let i = 0; i < expected.records.length; i++) {
      const actual = result.records[i], baseline = expected.records[i];
      for (const key of ['requested','identity','barCount','firstBarDate','lastBarDate','lastClose','quality','formulaVersion','indicators']) {
        assert.deepEqual(actual[key], baseline[key], actual.requested.symbol + ': ' + key);
      }
      const series = JSON.parse(await readFile(actual.seriesPath, 'utf8'));
      assert.equal(sha256(JSON.stringify(series.series)), baseline.seriesSha256);
      assert.equal(sha256(await readFile(actual.chartPath)), baseline.pngSha256);
    }
  } finally { globalThis.Date = RealDate; }
});
