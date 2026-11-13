import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageRoot } from '../../src/market/research.mjs';
import { history } from './fixtures.mjs';

test('market provider and computation run from an unrelated package copy, no sibling dependency', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-research-market-package-')));
  try {
    await mkdir(join(root, 'src', 'providers'), {recursive:true});
    await cp(join(packageRoot, 'src', 'market'), join(root, 'src', 'market'), {recursive:true});
    await cp(join(packageRoot, 'src', 'providers', 'yahoo'), join(root, 'src', 'providers', 'yahoo'), {recursive:true});
    await cp(join(packageRoot, 'src', 'providers', 'market.mjs'), join(root, 'src', 'providers', 'market.mjs'));
    const moved = await import(pathToFileURL(join(root, 'src', 'market', 'research.mjs')));
    assert.equal(moved.packageRoot, root);
    let calls = 0;
    const result = await moved.runBatch([{symbol:'ASML.AS',currency:'EUR'}], {
      executable:process.execPath, sourceMode:'fixture',
      exec:async () => {
        calls++;
        return {stdout:JSON.stringify([history()]),stderr:'',code:0,killed:false,truncated:false};
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.status, 'completed');
    assert.equal(result.kind, 'evidence');
    assert.ok(result.records[0].chartPath.startsWith(join(root,'.artifacts','market','runs')));
  } finally { await rm(root,{recursive:true,force:true}); }
});
