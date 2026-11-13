/** Operation-owned routing categories, not truth labels or domain payload schemas. */
export type ResultKind = "leads" | "evidence";
export const routingLimit = 24;

export function resultKind(value: unknown): ResultKind {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !("kind" in value) || (value.kind !== "leads" && value.kind !== "evidence")) {
    throw new Error('Expected an operation-produced result with kind "leads" or "evidence"; missing/unknown kinds are not inferred from provider or content.');
  }
  return value.kind;
}

/** Local-only routing of settled acquisition results. Return indices, not copies
 * of potentially large payloads. Every outcome belongs to exactly one bucket.
 * Rejections have no result kind: preserve them separately, never guess their lane.
 * A failed/partial result keeps its declared kind AND its original status; routing
 * does not make it usable evidence. Payload validation belongs to the operation.
 */
export function routeResults(outcomes: readonly PromiseSettledResult<unknown>[]) {
  if (!Array.isArray(outcomes) || outcomes.length > routingLimit) {
    throw new Error(`Supply at most ${routingLimit} settled research outcomes; nothing was routed or discarded.`);
  }
  const routes: { leads: number[]; evidence: number[]; rejected: number[] } = { leads: [], evidence: [], rejected: [] };
  for (const [index, outcome] of outcomes.entries()) {
    if (!outcome || typeof outcome !== "object") throw new Error(`Invalid settled outcome at index ${index}.`);
    if (outcome.status === "rejected") {
      if (!("reason" in outcome)) throw new Error(`Missing rejection reason at index ${index}.`);
      routes.rejected.push(index);
    } else if (outcome.status === "fulfilled") {
      routes[resultKind(outcome.value)].push(index);
    } else {
      throw new Error(`Invalid settled outcome at index ${index}.`);
    }
  }
  return routes;
}
