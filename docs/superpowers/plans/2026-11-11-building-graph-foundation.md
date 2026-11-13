# Building graph foundation: implementation plan (spikes 7–10 + graph step 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the four platform unknowns behind §6.7, then ship step 1 of the build order: the sample building's context graph (illustrative design, provenance on every fact), stored per site, readable through a resolver and shown on the site page.

**Architecture:** A stdlib Python generator turns the take-off CSVs plus a hand-written `illustrative.json` into `forge/src/seed/exb-graph.json`. The backend copies it into KVS per site when the sample building loads (app storage is the source of truth; the Assets mirror is a later plan). Pure graph logic (`graphWalk.js`, no Forge imports) answers "what feeds this, what does it serve, what holds it up", and is unit-tested with `node --test`.

**Tech Stack:** Forge (nodejs24.x, `@forge/kvs`, `@forge/resolver`, `@forge/object-store`), Custom UI (React 19, Vite), Python 3 stdlib, `node --test`.

**Spec:** `docs/ARCHITECTURE.md` §6.7 (design approved 2026-11-11). Plans for step 2 (agent + actions + `rovo:mcp`) and step 3 (portal closeout) are written after this plan's spikes report, because they depend on them.

## Global Constraints
- Atlassian CLI: `npx forge` from the repo root, or `../node_modules/.bin/forge` from `forge/`. Bare `forge` is Foundry.
- First, in this worktree: `npm install && (cd forge && npm install && npm --prefix static/workspace install)`.
- Never set `"type": "module"` in `forge/package.json` (§5.6).
- Assets schema and type descriptions: under 50 characters (§5.6).
- No egress, no CSP additions, no backend outside Forge.
- Every graph node, link and attribute value carries `provenance` ∈ {`as-built`, `illustrative`, `as-installed`} and a `source` (sheet reference, `illustrative.json`, or issue key). Illustrative data is never labelled or described as as-built.
- Scripts are stdlib-only and run with `python3 -I`.
- Reads that run without a user (trigger, actions) use `asApp`. Assets admin writes use `asUser`. The caller's identity always comes from `context.accountId`, never from the payload.
- Update `docs/ARCHITECTURE.md` (§5 "As built", §7 spike rows) in the same commit as the code it describes.
- Deploy to the dev site: `cd forge && npm run deploy`. Add `npx forge install --upgrade …` (command in §5.7) only after a scope or module change.

## Review Focus
1. **Tag spelled loosely** (`rtu-2`, ` RTU-2 `). Expected: found as RTU-2. Pinned in Task 6 (`normalises tag`).
2. **Equipment with no electrical data** (elevators, CUs with assumed ratings). Expected: a chain marked `ratingAssumed`, or an empty chain, never an exception. Pinned in Tasks 5 and 6.
3. **A site with no graph** (user-created site). Expected: `{ source: 'none' }` and an empty-state message in the UI. Pinned in Task 7.
4. **The sample loaded twice.** Expected: each site has its own graph keyed by site id, and deleting one site's graph never touches the other. Pinned in Task 7.
5. **Unknown tag.** Expected: the error "Equipment XYZ isn't in this site's graph", not a crash. Pinned in Task 6.

---

### Task 1: Spike 7, Assets reference attributes and app-account writes

**Files:**
- Create: `forge/src/spikes/assetsRefs.js`
- Modify: `forge/src/index.js` (register resolver `spikeAssetsRefs`), `forge/static/workspace/src/Diagnostics.jsx` (button + log), `docs/ARCHITECTURE.md` §7 row 7

**Interfaces:**
- Produces: `spikeAssetsRefs(): Promise<{ steps: Array<{ name: string, ok: boolean, detail: string }> }>`

- [ ] **Step 1:** In `assetsRefs.js`, reuse `assetsClient`/`getWorkspaceId` from `assets.js` (export them). Then, as the user:
  - ensure two types in `WALK`, "Spike Panel" and "Spike Feeder";
  - add attribute "Fed from" on Spike Feeder with `type: 1` (object reference), `typeValue` = Spike Panel's type id, and `additionalValue` = the id of a reference type from `GET …/v1/config/referencetype` (create "feeds" if missing);
  - create panel `SP-1` and feeder `SF-1` referencing it.

  Then, as the app: try creating object `SF-2` (records whether the app account can write objects; this answers the reviewer's question on accept-time writes). Read `SF-1` back by AQL `"Fed from" = SP-1`, and time a 4-hop AQL chain using `inboundReferences()`/`outboundReferences()`. Each step pushes `{ name, ok, detail }` and never throws.
- [ ] **Step 2:** Add a "Spike 7 · Assets references" panel in Diagnostics that calls `invoke('spikeAssetsRefs')` and prints the steps.
- [ ] **Step 3:** `cd forge && npm run lint && npm run deploy`. Expected: lint "No issues found", deploy succeeds.
- [ ] **Step 4:** Open `/diagnostics` on the dev site and run the panel. Pass = the reference attribute is created, `SF-1` is readable asApp with its reference, and the 4-hop AQL takes < 5 s. Record whether the app-account write returned 201 or 403.
- [ ] **Step 5:** Write the result into §7 row 7 (and a §5.6 gotcha if anything surprised). Commit `Spike 7: Assets reference attributes`.

### Task 2: Spike 8, portal panel as a customer, original photo upload

**Files:**
- Modify: `forge/manifest.yml` (add `jiraServiceManagement:portalRequestDetail` key `walkdown-portal-closeout`, resource `workspace`, resolver `resolver`, `unlicensedAccess: [customer]`), `forge/src/index.js` (resolvers `portalWhoAmI`, `getPhotoUploadUrls`), `forge/static/workspace/src/App.jsx` (route extension type `jiraServiceManagement:portalRequestDetail` → `PortalSpike`)
- Create: `forge/static/workspace/src/PortalSpike.jsx`

**Interfaces:**
- Produces: `portalWhoAmI(): { accountId: string|null, requestKey: string|null, canSeeRequest: boolean }`. `canSeeRequest` is checked asApp: the caller is the reporter or in `GET /rest/servicedeskapi/request/{key}/participant`.
- Produces: `getPhotoUploadUrls` (same bridge contract as `getScanUploadUrls`, §5.2), keys `photos/sha256-<base64url>`, max 200 MB. Refactor the shared body out of `getScanUploadUrls` rather than copying it.

- [ ] **Step 1:** Add the module, the two resolvers, and `PortalSpike`. `PortalSpike` shows the context and the `portalWhoAmI` result, and has a file input that uploads with `objectStore.upload({ functionKey: 'getPhotoUploadUrls' })`, downloads the file back and compares SHA-256 (reuse `sha256Hex` from Diagnostics by moving it to `src/hash.js`).
- [ ] **Step 2:** Lint and deploy, then upgrade the install (new module): `npx forge install --non-interactive --upgrade --site one-atlas-uyqa.atlassian.net --product jira --environment development`.
- [ ] **Step 3:** Open an FAC request **in the portal** as yourself (licensed). Pass = the panel renders, `accountId` is set, `canSeeRequest: true`, and a DNG or HEIC photo of 20 MB or more round-trips with an identical SHA-256.
- [ ] **Step 4 (human):** Invite a customer account to the FAC portal, raise a request as that customer and repeat Step 3. Pass = same results as a customer. If the upload fails for customers, record the error; the design's fallback is JSM attachments.
- [ ] **Step 5:** Update §5.1, §5.2 and §7 row 8. Commit `Spike 8: portal panel and photo upload as a customer`.

### Task 3: Spike 9, Rovo agent, action and `rovo:mcp`

**Files:**
- Modify: `forge/manifest.yml` (add `rovo:agent` key `walkdown-agent`, name `Walkdown`, inline prompt; `action` key `get-equipment-context`, `actionVerb: GET`, input `tag` (string, required); `rovo:mcp` key `walkdown-mcp` with `tools: [get-equipment-context]`; function `actions` handler `actions.handler`)
- Create: `forge/src/actions.js`

**Interfaces:**
- Produces: `actions.handler(payload, context)`, dispatching on the action. For this spike, `get-equipment-context` returns the seed equipment record for `payload.tag` (normalised) or `{ error }`. Task 6 replaces this with the graph read.

- [ ] **Step 1:** Add the modules and `actions.js`. Prompt (inline, for now): "You help facilities staff understand building equipment. Answer only from action results. If a fact is marked illustrative, say so."
- [ ] **Step 2:** Lint, deploy and upgrade the install.
- [ ] **Step 3:** In Rovo chat on the dev site, select the Walkdown agent and ask "What is RTU-2?". Pass = the action is invoked and the answer quotes the 460-3-60 / MOP 250 specs.
- [ ] **Step 4 (human):** In admin.atlassian.com → Connected apps → Walkdown, turn on "Expose tools via external MCP endpoint". Connect an MCP client to `https://mcp.atlassian.com/forge/0fa45447-08dc-430d-93a1-8501bd630d9d` and call `get-equipment-context` with `RTU-2`. Pass = the same JSON comes back.
- [ ] **Step 5:** Update §5.1, §5.3 and §7 row 9. Commit `Spike 9: Rovo agent, action and MCP tool`.

### Task 4: Spike 10, a clean judge-like site

**Files:** `docs/ARCHITECTURE.md` §7 rows 9–10 only.

- [ ] **Step 1:** `cd forge && ../node_modules/.bin/forge deploy -e production` (current main code, so production stops being the scaffold).
- [ ] **Step 2 (human):** Create a second Atlassian site under a different account (a free Jira + JSM site). In the developer console → Distribution → Sharing, create the install link and install it there as that site's admin.
- [ ] **Step 3:** On the clean site, record whether: the install succeeds; Assets is available (`assetsProbe` on `/diagnostics`); Rovo is available and lists the Walkdown agent; "Load sample building" works. Pass = all four recorded with evidence. Any "no" changes the demo path in §6.7, so report it before Task 5.
- [ ] **Step 4:** Update §3 (production installed, clean-site URL) and §7 row 10. Commit `Spike 10: clean-site install`.

### Task 5: Graph generator and illustrative design

**Files:**
- Create: `samples/bim/exb/illustrative.json`, `scripts/build_exb_graph.py`, `forge/src/seed/exb-graph.json` (generated), `forge/test/graph-seed.test.mjs`
- Modify: `forge/package.json` (`test` runs `node --test test/`), `samples/bim/exb/README.md` (an "Illustrative design" section)

**Interfaces:**
- Produces: `exb-graph.json`:
  ```json
  { "schemaVersion": 1,
    "nodes": [{ "id": "breaker:RTU-2", "type": "Breaker", "name": "RTU-2 breaker",
                "attrs": { "ratingA": { "value": 250, "provenance": "illustrative", "source": "illustrative.json: breaker = MOP" } } }],
    "links": [{ "from": "breaker:RTU-2", "to": "feeder:RTU-2", "type": "protects", "provenance": "illustrative", "source": "illustrative.json" }] }
  ```
  Node `id` = `<lowercase type>:<name-ish key>`; equipment ids are `equipment:<TAG>`. Types and link types are exactly as in §6.7 G1.

- [ ] **Step 1: Write the failing tests** in `graph-seed.test.mjs` (load the JSON with `fs`):
  - `every node and link has provenance and source` (provenance ∈ the three values)
  - `no dangling links` (every from/to is a node id)
  - `RTU-1 chain`: feeds path `switchboard:MSB → panel:* → breaker:RTU-1 → feeder:RTU-1 → disconnect:RTU-1 → equipment:RTU-1`; breaker `ratingA.value === 600`; feeder `sets === 2`, `size === '350 kcmil'`, `material === 'Cu'`
  - `RTU-2 chain`: breaker 250, feeder 1 × `250 kcmil`
  - `boilers`: HWB-1 breaker 15, feeder `12 AWG`
  - `real ratings stay as-built`: `equipment:RTU-1` attr `mopA` is `{ value: 600, provenance: 'as-built', source: 'E3.06A; mech schedule p10' }`
  - `assumed ratings are flagged`: every CU / EF / HWP breaker node has `attrs.ratingAssumed.value === true`
  - `one tight panel`: at least one panel where the sum of connected breaker ratings ≥ 80% of its `busA`, and RTU-2 is on it
  - `structure`: each RTU has `supportedBy → curb:<TAG> → supportedBy → roofzone:*` with `loadLimitLb`; RTU-1's weight (90,000) is within its zone limit and RTU-2's zone has less than 20% headroom over 27,000 lb
  - `served areas and loops`: RTU-1 `serves` "North tower L2–5"; HWB-1/HWB-2 `connects` `pipeloop:HHW` with HWP-1/HWP-2
- [ ] **Step 2:** Run `cd forge && npm test`. Expected: FAIL (file missing).
- [ ] **Step 3:** Write `illustrative.json`: the switchboard (`MSB`, 480Y/277 V, `busA` 3000, level 1 main electrical room), the roof panels (north and south tower panels with `busA`; size the north panel so it's the tight one), roof zones with `loadLimitLb`, assumed ratings for units without electrical data, and the NEC 310.16 75 °C Cu ampacity rows used. Each entry carries a one-line `why`.
- [ ] **Step 4:** Write `build_exb_graph.py` (stdlib, deterministic, sorted output, same style as `build_exb_seed.py`). Rules:
  - parse `Electrical: 460-3-60, MOP 600` and `Weight:` out of `assets_mec.csv` specs (as-built);
  - breaker = MOP rounded up to the NEC 240.6 standard sizes;
  - feeder = the smallest single set whose ampacity ≥ the breaker, else the fewest parallel sets of 350 kcmil, 500 kcmil or larger;
  - with FLA only: breaker = the next standard size ≥ 2.5 × FLA, minimum 15 A;
  - `serves` from the CSV `name` column (as-built).

  Run `python3 -I scripts/build_exb_graph.py`. Expected: it prints node and link counts and writes the JSON.
- [ ] **Step 5:** Run `npm test`. Expected: all pass (the 10 existing tests plus the new ones).
- [ ] **Step 6:** Document the illustrative design in `samples/bim/exb/README.md` and the seed in §5.2. Commit `Graph seed: illustrative electrical/mechanical/structural design for EXB`.

### Task 6: Pure graph walk

**Files:**
- Create: `forge/src/graphWalk.js`, `forge/test/graphWalk.test.mjs`

**Interfaces:**
- Consumes: the `exb-graph.json` shape (Task 5).
- Produces:
  - `indexGraph(graph): Index` (maps by id, outgoing and incoming links by type)
  - `findEquipment(index, tag): Node`, which normalises the tag (trim, uppercase, collapse `RTU 2` → `RTU-2`) and throws `Equipment ${tag} isn't in this site's graph`
  - `powerChain(index, tag): Node[]`, ordered source → equipment (empty if none)
  - `context(index, tag): { equipment, powerChain, serves: Node[], connects: Node[], support: Node[], provenanceSummary: { asBuilt, illustrative, asInstalled } }`

- [ ] **Step 1: Write the failing tests:**
  - `normalises tag`: `findEquipment(ix, ' rtu 2 ').id === 'equipment:RTU-2'`
  - `unknown tag`: throws /isn't in this site's graph/
  - `RTU-1 power chain` (ids in order, 6 nodes)
  - `elevator has empty chain` (ELEV-1 → `[]`, no throw)
  - `context RTU-1` (serves includes "North tower L2–5", support ends at a roofzone, provenanceSummary counts > 0 for both as-built and illustrative)
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the functions in `graphWalk.js` (no Forge imports).
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `Graph walk: power chain and equipment context`.

### Task 7: Graph store, resolver, site page and action

**Files:**
- Create: `forge/src/graph.js`
- Modify: `forge/src/samples.js` (`loadSampleBuilding` seeds the graph), `forge/src/sites.js` (`deleteSite` deletes the site's graph keys), `forge/src/index.js` (resolver `getEquipmentContext`), `forge/src/actions.js` (use the graph), `forge/static/workspace/src/api.js`, `forge/static/workspace/src/SitePage.jsx` (`EquipmentDetail` adds "Power", "Serves", "Connected to", "Supported by" with a provenance lozenge per fact), `docs/ARCHITECTURE.md` §5.2/§5.4/§5.2a

**Interfaces:**
- Consumes: `indexGraph`, `context` (Task 6).
- Produces:
  - KVS key `graph:<siteId>` = `{ schemaVersion, nodes, links, seededFrom: 'exb-graph.json', updatedAt }` (≈150 nodes; check the size is under the KVS value limit in Step 4, and split to `graph:<siteId>:nodes` / `:links` if not)
  - `seedGraph(siteId)`, `getGraph(siteId) → graph|null`, `deleteGraph(siteId)`
  - resolver `getEquipmentContext({ siteId, tag }) → { source: 'graph' | 'none', context? }`
  - action `get-equipment-context(tag)`: resolves the site from `payload.context.jira.projectKey` when present, otherwise the only site with a graph, otherwise `{ error: 'Which site? …' }`

- [ ] **Step 1:** Write the failing test `forge/test/graphStore.test.mjs` for the pure helper `graphKey(siteId) === 'graph:' + siteId`, and for a `siteForAction(sites, projectKey)` helper (exported from `graph.js` and kept pure): it picks the site linked to the project, falls back to the single graph site, and errors on ambiguity.
- [ ] **Step 2:** Implement, then run `npm test`. Expected: PASS.
- [ ] **Step 3:** UI: `EquipmentDetail` calls `api.getEquipmentContext(site.id, tag)`. With `source: 'none'` it shows "No connection data for this site yet". Use the existing `Lozenge` with tones: as-built → `success`, illustrative → `default`, labelled "Illustrative", as-installed → `info`.
- [ ] **Step 4:** Lint, build, deploy. On the dev site:
  - load the sample building **twice**;
  - click RTU-2 in each site and confirm the chain MSB → panel → 250 A breaker → 250 kcmil feeder → disconnect, with "Illustrative" tags;
  - delete one site and confirm the other still shows its chain;
  - ask the Rovo agent "What feeds RTU-2?" and confirm the answer names the 250 A breaker and says it's illustrative.
- [ ] **Step 5:** Update ARCHITECTURE §5 (functions, KVS keys, components) and the README "Status" table (graph: ✅ working, illustrative). Commit `Graph: per-site store, equipment context in the site page and the Rovo action`.
