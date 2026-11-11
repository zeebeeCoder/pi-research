// Offline child-process transport. Installed only by tests through NODE_OPTIONS.
// Never delegates to real fetch; unexpected endpoints fail closed.
import { writeFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  const parsed = new URL(url);
  if (!['api.search.brave.com', 'api.perplexity.ai'].includes(parsed.hostname)) throw new Error('Unexpected test endpoint');
  const mode = process.env.FAKE_HTTP_MODE;
  if (mode === 'error') return new Response('private error body', { status: 429 });
  if (mode === 'malformed') return new Response('not-json');
  if (mode === 'hang') return new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    // Hold the process open until the orchestrator cancellation reaches it.
    const timer = setInterval(() => {}, 1000);
    options.signal.addEventListener('abort', () => clearInterval(timer), { once: true });
    writeFileSync(process.env.FAKE_HTTP_READY, 'ready');
  });
  const empty = mode === 'empty';
  const body = parsed.hostname === 'api.search.brave.com'
    ? { query: { original: parsed.searchParams.get('q') }, web: { results: empty ? [] : [{ title: 'Fixture source', url: 'https://example.org/source', description: 'Fixture only', page_age: '2026-11-09' }] } }
    : { results: empty ? [] : [{ title: 'Fixture source', url: 'https://example.org/source', snippet: 'Fixture only', date: '2026-11-09' }] };
  return Response.json(body);
};
