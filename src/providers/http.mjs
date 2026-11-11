// Shared HTTP transport for package-owned search adapters. No retries or redirects.
export function parseSearchArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const [query, ...rest] = argv;
  if (typeof query !== 'string' || !query.trim() || query.length > 2000 || /^\s*-/.test(query) || /[\x00-\x1f\x7f]/.test(query)) throw new Error('Expected one printable search query.');
  const options = { query, limit: 5 };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json') continue;
    const key = { '-n': 'limit', '--since': 'since', '--until': 'until' }[rest[i]];
    if (!key || rest[i + 1] === undefined) throw new Error('Unknown or incomplete search option.');
    options[key] = rest[++i];
  }
  if (!/^[1-5]$/.test(String(options.limit))) throw new Error('Limit must be 1–5.');
  options.limit = Number(options.limit);
  for (const date of [options.since, options.until]) {
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('Expected real UTC calendar dates.');
  }
  if (options.since && options.until && options.since >= options.until) throw new Error('since must precede exclusive until.');
  return options;
}

export async function fetchJson(url, init, { fetchImpl = fetch, signal, maxBytes = 2 * 1024 * 1024 } = {}) {
  signal?.throwIfAborted();
  const response = await fetchImpl(url, { ...init, redirect: 'error', signal });
  if (!response.ok) {
    await response.body?.cancel();
    // Do not echo headers, credentials or untrusted response bodies into errors.
    throw new Error(`Provider HTTP ${response.status}; no retry.`);
  }
  if (!response.body) throw new Error('Provider returned no response body.');
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Provider response exceeded 2 MiB.');
      chunks.push(Buffer.from(value));
    }
    signal?.throwIfAborted();
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Provider response is not valid JSON.'); }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function runCli(search, argv = process.argv.slice(2)) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 50_000);
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const options = parseSearchArgs(argv);
    if (options.help) { process.stdout.write('Search-only adapter: QUERY [-n 1..5] [--since YYYY-MM-DD] [--until YYYY-MM-DD] --json\n'); return; }
    const result = await search(options, { signal: controller.signal });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: controller.signal.aborted ? 'Search cancelled or deadline exceeded; no retry.' : error.message }) + '\n');
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
  }
}
