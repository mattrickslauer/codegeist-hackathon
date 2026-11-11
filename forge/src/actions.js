/**
 * Rovo actions (also exposed as rovo:mcp tools). Contract: docs/ARCHITECTURE.md §5.3.
 *
 * Spike 9: `get-equipment-context` answers from the bundled EXB seed. The graph plan (Task 7) replaces
 * this with the per-site building graph. Inputs can be hallucinated by the agent, so nothing here
 * trusts them for authorization; the caller is `context.accountId`.
 */
import seed from './seed/exb.json';
import { normaliseTagInput } from './tags';

export async function getEquipmentContext(payload) {
  const tag = normaliseTagInput(payload?.tag);
  if (!tag) return { error: 'Which equipment? Give a tag such as RTU-2.' };
  const e = seed.equipment.find((x) => x.tag === tag);
  if (!e) return { error: `Equipment ${tag} isn't in the sample building. Known tags: ${seed.equipment.map((x) => x.tag).join(', ')}` };
  return {
    building: seed.building.name,
    tag: e.tag,
    category: e.category,
    level: e.level,
    serves: e.serves,
    manufacturer: e.manufacturer,
    model: e.model,
    specs: e.specs,
    provenance: 'as-built',
    source: e.sourceSheet,
  };
}

/** Single Forge function behind every action; Forge passes the action's inputs as the payload. */
export const handler = async (payload, context) => {
  console.log(`action get-equipment-context tag=${payload?.tag} account=${context?.principal?.accountId ?? context?.accountId ?? 'unknown'}`);
  return getEquipmentContext(payload);
};
