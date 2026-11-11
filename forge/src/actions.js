/**
 * Rovo actions (also exposed as rovo:mcp tools). Contract: docs/ARCHITECTURE.md §5.3.
 *
 * `get-equipment-context`: one piece of equipment from the site's building context graph (power chain from
 * the source, panel loading, what it serves, what it connects to, what holds it up, standing decisions),
 * every fact with its provenance. Inputs can be hallucinated by the agent: they select data only; the caller
 * is `context.accountId`.
 */
import { equipmentContextForAction } from './graph';

export async function getEquipmentContext(payload) {
  try {
    return await equipmentContextForAction(payload);
  } catch (err) {
    return { error: err.message };
  }
}

/** Single Forge function behind every action; Forge passes the action's inputs as the payload. */
export const handler = async (payload, context) => {
  console.log(`action get-equipment-context tag=${payload?.tag} project=${payload?.context?.jira?.projectKey ?? '-'} account=${context?.principal?.accountId ?? context?.accountId ?? 'unknown'}`);
  return getEquipmentContext(payload);
};
