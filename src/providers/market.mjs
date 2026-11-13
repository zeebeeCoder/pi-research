import { yahoo } from './yahoo/index.mjs';

// Operation-specific registry: market evidence is not a search/snippet payload.
// Re-exported by index.ts; kept in ESM for Node-only computations/tests.
export const marketProviders = Object.freeze({ yahoo });
