import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJson, runCli } from '../http.mjs';

// Only the existing pplx search operation is carried over. No ask, deep-research,
// job registry or polling capability is exposed by this adapter.
export function apiKey({ env = process.env, home = homedir(), read = readFileSync } = {}) {
  if (env.PERPLEXITY_API_KEY) return env.PERPLEXITY_API_KEY;
  try {
    const contents = read(join(home, '.config/perplexity/.env'), 'utf8');
    const match = contents.match(/^PERPLEXITY_API_KEY=["']?([^"'\r\n]+)/m);
    if (match) return match[1];
  } catch { /* Missing config is reported without disclosing file contents. */ }
  throw new Error('PERPLEXITY_API_KEY not found (environment or ~/.config/perplexity/.env).');
}
export async function search(options, { env = process.env, home = homedir(), read = readFileSync, signal, fetchImpl = fetch } = {}) {
  signal?.throwIfAborted();
  const key = apiKey({ env, home, read });
  return fetchJson('https://api.perplexity.ai/search', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: options.query, max_results: options.limit }),
  }, { signal, fetchImpl });
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli(search);
