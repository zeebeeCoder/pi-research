import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchJson, runCli } from '../http.mjs';

// Search request lifted from the Brave skill; raw API envelope is preserved.
// No content extraction, DOM dependencies, or skill installation is needed.
export async function search(options, { env = process.env, signal, fetchImpl = fetch, now = new Date() } = {}) {
  signal?.throwIfAborted();
  const key = env.BRAVE_API_KEY;
  if (!key) throw new Error('BRAVE_API_KEY environment variable is required.');
  const params = new URLSearchParams({ q: options.query, count: String(options.limit), country: 'US' });
  if (options.since || options.until) {
    const from = options.since ?? '1970-01-01';
    const through = options.until ? new Date(Date.parse(options.until) - 86400000).toISOString().slice(0, 10) : now.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(through) || from > through) throw new Error('Brave freshness bounds are outside the supported calendar range.');
    params.set('freshness', from + 'to' + through);
  }
  return fetchJson('https://api.search.brave.com/res/v1/web/search?' + params, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
  }, { signal, fetchImpl });
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli(search);
