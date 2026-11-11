# Precedent: architecture

> **The one canonical document for Precedent's architecture and functions.** Update it in the same commit as any change to modules, resolvers, storage, events or data shapes. If the code and this file disagree, fix whichever is wrong. Pitch: `README.md`.

Last updated: 2026-11-08

---

## 1. Product in one paragraph
Decisions about physical places are pinned to a LiDAR scan, with evidence (photos, voice note, documents), and linked to the assets they govern. Every Jira or Jira Service Management work order touching those assets is checked against them. A conflict shows on the work order, and the work order is **blocked from starting** until someone reaffirms, supersedes (with approver sign-off) or withdraws. Scans come from third-party LiDAR apps (Scaniverse → GLB) uploaded in the browser. There's no native app (dropped on 2026-11-08, see §10).

## 2. Hard constraints (from the rules)
1. **Everything shown in the video works from the install link on a clean judge site,** with no phone needed. Install seeds a complete sample site.
2. **Use only Forge-hosted services,** working until 3 Feb 2027. No external backend; keep "Runs on Atlassian" eligibility.
3. **Make no claim the installed app can't back up.**
4. **The core loop survives the LLM being unavailable.** The deterministic check, panel and validator still work; only the plain-language explanation degrades.

## 3. Environments and identifiers
| Item | Value |
|---|---|
| Developer Space | Precedent |
| App | `precedent`, `ari:cloud:ecosystem::app/0fa45447-08dc-430d-93a1-8501bd630d9d` |
| Environments | development (active), staging, production |
| Dev site | https://one-atlas-uyqa.atlassian.net (expires 2027-02-06) |
| Installed | development env → Jira on the dev site (2026-11-08) |
| Runtime | `nodejs24.x`, arm64, 256 MB |
| CLI | `@forge/cli` 15.0.0 via `npx forge` at the repo root, or `../node_modules/.bin/forge` from `forge/`. Bare `forge` on this machine is Foundry |

## 4. Repository layout
```
forge/                      Forge app root (run CLI commands here)
  manifest.yml              modules, resources, permissions
  package.json              backend deps; scripts: test, build:ui, lint, deploy
  src/                      backend: resolvers, the check, decisions, sites, Assets, samples
  test/                     unit tests for the check's matching logic
  static/workspace/         Custom UI: Vite + React 19 → dist/ (built before deploy)
    public/models/exb.glb   the sample building's 3D model (built from IFC)
samples/bim/exb/            anonymised as-built IFC4 + COBie of the sample building
samples/scans/              real LiDAR scans (GLB) used in development
scripts/                    build_exb_seed.py, build_exb_model.py, fetch_rules.sh
docs/ARCHITECTURE.md        this file
```

## 5. As built (keep current)

### 5.1 Modules
| Module | Key | Resource / handler | Status |
|---|---|---|---|
| `jira:globalPage` | `precedent-workspace` | resource `workspace` → `static/workspace/dist`, resolver `resolver` | ✅ deployed |
| `function` | `resolver` | `src/index.handler` | ✅ deployed |
| `jira:issuePanel` | `precedent-work-order-panel` | Same `workspace` resource and resolver; `App.jsx` renders `WorkOrderPanel` when `context.extension.type === 'jira:issuePanel'`. Icon `resource:workspace;precedent-icon.svg` | ✅ deployed (v6.3.0) |
| `trigger` | `precedent-work-order-trigger` | `avi:jira:created:issue`, `avi:jira:updated:issue`, filter `ignoreSelf: true` → function `work-order-check` (`src/index.onWorkOrderEvent`) → `checkWorkOrder` asApp | ✅ deployed (v6.3.0) |
| `objectStore` | `precedent-objects` | `storageClass: standard` (Preview). Added in app v3.0.0 (major upgrade, admin approval) | ✅ deployed |
| `jira:entityProperty` | `precedent-check-index` | Indexes issue property `precedent.check` for JQL: `status` → **`precedentStatus`**, `siteId` → **`precedentSite`** (strings). Only values written after install are indexed. Verified: `project = "FAC" AND precedentStatus = conflict` | ✅ deployed (v5.0.0) |
| `jira:workflowValidator` | `precedent-open-conflict-validator` | **Expression** validator (Preview), no function: passes when issue property `precedent.check` is absent or `status != 'conflict'`, otherwise returns a string error quoting the decision. Project types: company- and team-managed. Rule key in workflows: `forge:expression-validator`, parameter `key` = extension ARI `ari:cloud:ecosystem::extension/0fa45447-…/27ecd14d-…/static/precedent-open-conflict-validator` (dev env) | ✅ deployed (v4.0.0) |

### 5.2 Resolver functions (Custom UI `invoke`)
| Function | Input | Output | Auth | Status |
|---|---|---|---|---|
| `ping` | none | `{ ok, backendVersion, accountId, serverTime }` | Forge context only | ✅ deployed |
| `getScanUploadUrls` | `{ allObjectMetadata: [{ length, checksum (SHA-256 base64), checksumType }] }` (sent by the `objectStore.upload` bridge) | `{ [presignedPutUrl]: { key, length, checksum, checksumType } }` | Any user who can open the page (to tighten: §9) | ✅ deployed |
| `getScanDownloadUrls` | `{ keys: string[] }` (sent by the `objectStore.download` bridge); only `scans/` keys are signed | `{ [presignedGetUrl]: key }` | Any user who can open the page | ✅ deployed |
| `listSites` | none | `Site[]` sorted by name (KVS `site:` prefix, paged by cursor) | Any user | ✅ deployed |
| `getSite` | `{ id }` | `Site` | Any user | ✅ deployed |
| `createSite` | `{ name ≤80, description ≤500, space: { id, key, name, projectTypeKey } \| null }` | `Site` (`createdBy` from context) | Any user | ✅ deployed |
| `updateSite` | `{ id, name?, description?, space? }` | `Site` | Any user | ✅ deployed |
| `deleteSite` | `{ id }` | `{ deleted }`; also deletes the site's graph (`graph:<id>`). Scan objects are kept (content-addressed, may be shared) | Any user | ✅ deployed |
| `addScanToSite` | `{ siteId, key (scans/…), fileName }`; the object must exist in Object Store, size is taken from storage | `Site` (≤50 scans) | Any user | ✅ deployed |
| `loadSampleSite` | `{ space }` | `{ site, sampleScanAttached }`: "North Plant Room", with the spike-1 sample scan if this install has it | Any user | ✅ deployed (judge-site seeding still TODO) |
| `assetsProbe` | none | `{ available, workspaceId, schemas[] }`: read-only check that the app can see Assets | Any user (runs `asApp`) | ✅ deployed (v6.0.0) |
| `assetsSetup` | none | `{ ws, schemaId, schemaKey: 'PREC', types: { Site, Level, Equipment: { id, attrs } }, created }`. Ensures the schema, types and attributes (idempotent) and caches ids in KVS `assets:model` | **asUser**: needs Assets admin (the installing site admin). The app account gets 403 | ✅ deployed |
| `assetsImportPlan` | none | `{ building, steps: [{ kind: site\|level\|equipment, ref }] }` from `src/seed/exb.json` (1 + 6 + 28 steps) | Any user | ✅ deployed |
| `assetsImportStep` | `{ kind, ref }` | `{ id, objectKey, name, created }`: find by Name (AQL) or create. One object per call (keeps under the 25 s limit) | **asUser** | ✅ deployed |
| `getSiteEquipment` | `{ siteId }` | `{ source: 'assets' \| 'seed' \| 'none', equipment: [{ tag, objectKey, category, level, serves, manufacturer, model, specs, sourceSheet, ifcGuid }] }`: live AQL read asApp, falling back to the bundled seed | Any user | ✅ deployed |
| `loadSampleBuilding` | `{ space }` | `{ site, decisions, graph }`: "Example Office Building" (equipment from Assets) + 3 standing decisions (`src/samples.js`) + its building context graph (`seedGraph`) | Any user | ✅ deployed |
| `getEquipmentContext` | `{ siteId, tag }` | `{ source: 'graph' \| 'none', context? }`: `context(ix, tag)` from `src/graphWalk.js` (equipment, powerChain source→equipment, panel { busA, connectedBreakerA, siblings }, serves, connects, loopMembers, support, provenanceSummary). Sample-building sites created before v6.11 get their graph seeded on first read | Any user | ✅ deployed (v6.11.0) |
| `listDecisions` | `{ siteId }` | `Decision[]` newest first | Any user | ✅ deployed |
| `createDecision` | `{ siteId, statement ≤300, reason ≤1000, equipment: tags (≥1), guards: phrases, pin?, decidedAt? }` | `Decision` (standing; `decidedBy` from context) | Any user | ✅ deployed |
| `withdrawDecision` | `{ siteId, decisionId }` | standing → `withdrawn`, proposed → `rejected` | Any user | ✅ deployed |
| `proposeSupersession` | `{ siteId, decisionId, statement, reason, issueKey? }` | `{ proposal (status proposed, supersedes, originIssueKey), original }` | User must see `issueKey` | ✅ deployed |
| `approveDecision` | `{ siteId, decisionId }` | `{ approved, superseded, selfApproved, recheck? }`. Only `site.approvers` (default: creator). On approval the original becomes `superseded`, and the origin work order gets the new decision acknowledged and is re-checked | Site approvers | ✅ deployed |
| `checkWorkOrder` | `{ issueKey }` | the `precedent.check` value (or `{ status: 'unlinked' }`) | User must see the issue; check runs asApp | ✅ deployed |
| `reaffirmConflict` | `{ issueKey, siteId, decisionId, reason ≥5 chars }` | re-checked value; stores KVS `resolution:<issueKey>:<decisionId>` | Needs EDIT_ISSUES on the work order (checked asUser via `mypermissions`) | ✅ deployed |
| `setWorkOrderEquipment` | `{ issueKey, tags }` | re-checked value; writes issue property `precedent.equipment` `{ tags }` | Needs EDIT_ISSUES | ✅ deployed |

**The check** (`src/check.js`, pure logic in `src/match.js`, unit tests `forge/test/match.test.mjs`, run with `npm test` in `forge/`, 10 cases):
1. The sites whose linked space is the work order's project.
2. **Touched equipment** = whole-token tag matches in summary + ADF description (`RTU-1` ≠ `RTU-10`), plus manual tags (`precedent.equipment`).
3. A **standing** decision conflicts when it governs touched equipment AND (it has no guards, or a guard phrase appears in the text).
4. Reaffirmed decisions (KVS `resolution:`) are listed as acknowledged, not blocking.
5. Writes `precedent.check`. On each *new* conflict it posts one Jira comment @mentioning the decider (tracked in `notified`).

**Decision record** (KVS `decision:<siteId>:<id>`): `{ id, siteId, statement, reason, equipment: [TAG], guards: [phrase], pin: { scanKey, point, normal } | null, status: standing | proposed | superseded | withdrawn | rejected, supersedes, supersededBy, originIssueKey, decidedBy, decidedAt, approvedBy, approvedAt, createdAt }`.

**Assets model** (schema `PREC` "Precedent", created by the app on any site): **Site** (Code, Description) · **Level** (Code, Site, Elevation (ft), Height (ft)) · **Equipment** (Site, Level, Category, System, Serves, Manufacturer, Model, Specs [textarea], Source sheet, Grid, IFC GlobalId, IFC class). The object Name is the site name, "EXB Level 1", or the equipment tag (RTU-1). Site/Level are text for now (Assets reference attributes are a follow-up). Seed data: `forge/src/seed/exb.json`, generated by `scripts/build_exb_seed.py` from `samples/bim/exb/` (COBie + CSV).

**Building context graph seed** (§6.7 step 1): `forge/src/seed/exb-graph.json` (136 nodes, 187 links, ≈88 KB compact), generated by `scripts/build_exb_graph.py` from `exb.json` plus the **illustrative** design in `samples/bim/exb/illustrative.json`. Shape: `{ schemaVersion, building, about, nodes: [{ id: '<type>:<key>', type, name, attrs: { k: { value, provenance, source } } }], links: [{ from, to, type: feeds|protects|serves|connects|supportedBy|locatedOn, provenance, source }] }`. Invariants are tested in `forge/test/graph-seed.test.mjs`. Loaded per site into KVS `graph:<siteId>` when the sample building loads.

**Rovo (spike 9, deployed v6.7.0):** `rovo:agent` `precedent-agent` ("Precedent"), action `get-equipment-context` (GET, inputs `tag`, optional `site` = site name or Jira space key) → function `actions` (`src/actions.js` → `equipmentContextForAction` in `src/graph.js`): resolves the site (the one linked to the Jira space the agent was opened from, else the only site with a graph, else the bundled sample; asks "Which site?" when ambiguous) and returns the equipment's graph context as facts with provenance, plus standing decisions about it. The agent prompt turns the facts into knock-on checks (breaker / wire / disconnect, panel load, curb load, decisions) framed as checks for a licensed professional. The same action is exposed through `rovo:mcp` `precedent-mcp`. Tag input is normalised by `src/tags.js` (`rtu 2` → `RTU-2`).

**Building model:** `forge/static/workspace/public/models/exb.glb` (≈260 KB, 165 objects, 2,356 triangles), shipped inside the app so it works on any site with no upload. Built by `scripts/build_exb_model.py` (IfcOpenShell 0.8.5 in `.venv-bim/`) from `EXB-ARC.ifc` + `EXB-MEC.ifc`: one glTF node per IFC product named by its IFC Name, with `extras { tag, ifcClass, guid }` on equipment (all 28 tags match Assets), Z-up → Y-up, centred, walls and slabs semi-transparent. The sample site stores `model: { kind: 'bundled', path: 'models/exb.glb' }`.

**Site record** (KVS `site:<uuid>`): `{ id, name, description, space: { id, key, name, projectTypeKey } | null, scans: [{ key, fileName, size, uploadedAt, uploadedBy }], createdAt, createdBy, updatedAt }`. A Site links to the **Jira space (project)** whose work orders it guards; it isn't called a "space" to avoid colliding with Jira and Confluence spaces.

**Jira data is read in the frontend as the user** (`requestJira` in `api.js`), so people only see spaces and work orders Jira already lets them see:
- `GET /rest/api/3/project/search`: the space picker.
- `POST /rest/api/3/search/jql` with `properties: ['precedent.check']`: the Work orders tab.
- `POST /rest/api/3/search/approximate-count`: open and blocked counts on site cards.
- Links into Jira use `router.navigate`: `/browse/KEY` and `/issues/?jql=…`.

**Upload contract (verified from `@forge/bridge` 7.2.1 source):** the browser hashes each Blob (SHA-256, base64), invokes the `functionKey` resolver with `allObjectMetadata`, then `PUT`s each Blob directly to its returned URL with `Content-Type` and `Content-Length`. The resolver never sees file bytes. Downloads work the same way: the resolver returns signed GET URLs and the bridge fetches Blobs.

### 5.2a Frontend components (`static/workspace/src/`)
| Component | Purpose | Status |
|---|---|---|
| `App.jsx` | Picks the surface from `view.getContext()`: the issue panel → `WorkOrderPanel`; otherwise the workspace (routes `/` → `SitesPage`, `/sites/:id?equipment=TAG` → `SitePage`, `/diagnostics` → `Diagnostics`, lazy and **not linked** in the product) | ✅ deployed (v6.4.0) |
| `WorkOrderPanel.jsx` | Panel on each work order: Blocked / Clear lozenge, detected equipment (editable), each conflict with the decision, reason, matched equipment and guarded action, plus **Reaffirm…**, **Supersede…**, **Withdraw**, and **View on model** (`router.navigate({ target: 'module', moduleKey: 'precedent-workspace', path: '/sites/<id>?equipment=TAG' })`) | ✅ deployed (v6.4.0) |
| `SiteDecisions.jsx` | `DecisionsTab` (decisions by status, Approve/Reject proposals, Withdraw, "Record a decision" dialog with an equipment picker from Assets, free tags, guards, an optional scan pin) and `EquipmentTab` (live Assets equipment table) | ✅ deployed |
| `router.js` | Tiny router on `view.createHistory()` (real URLs, back button), with an in-memory fallback | ✅ deployed |
| `api.js` | Resolver wrappers (`api.*`), scan upload/download, Jira-as-user helpers, JQL builders, `openInJira` links | ✅ deployed |
| `ui.jsx` + `styles.css` | Button, Lozenge, StatusLozenge, SpaceChip (avatar with initials fallback), Dialog, Banner, Spinner. All styled with Atlassian Design System tokens, so it follows Jira light/dark | ✅ deployed |
| `SitesPage.jsx` | Site cards (linked space, live open/blocked counts via JQL). Empty state has one primary action, **Load sample building**, plus "Create your own site" (the LiDAR sample is no longer offered) | ✅ deployed (v6.4.0) |
| `SitePage.jsx` | Three tabs. **Model** (default): the 3D model on the left (bundled building model or the latest LiDAR scan) with equipment coloured **blue** (has standing decisions) / **red** (a blocked work order touches it); the side panel on the right is an *Overview* (counts, approvals, blocked work orders, standing decisions) or, when equipment is clicked, *Equipment detail* (specs from Assets, its decisions, its open work orders, "Record a decision about TAG"). A scan spot → "Record a decision here" (pin). **Work orders**: open work orders with Precedent status and touched equipment. **Settings**: details and linked space, LiDAR scans, equipment register | ✅ deployed (v6.4.0) |
| `Diagnostics.jsx` | The former spike panels (1: upload round trip, 2: viewer, 3: validator test controls) and a CSP-violation log; reached via the footer link | ✅ deployed |
| `ValidatorSpike.jsx` | Spike 3 test controls: read / set / clear `precedent.check` on an issue via `requestJira` (as the user) | ✅ deployed |
| `cspSafeTextures.js` | GLTFLoader plugin: decodes bufferView-embedded images with `createImageBitmap(Blob)` instead of fetching a `blob:` URL (see §5.6) | ✅ deployed, pending browser check |
| `EquipmentGraph.jsx` | In Equipment detail: power chain from the source, panel loading ("near capacity" at ≥ 80%) and the other units on it, served areas, connections and loop partners, support with the weight headroom. Every fact carries a provenance lozenge (As-built / Illustrative / As-installed; hover shows the source) | ✅ deployed (v6.11.0) |
| `ModelViewer.jsx` | three.js 0.186.1 viewer for a bundled model (`source.url`, fetched from the app's own resource) or a scan Blob. Objects whose glTF `extras.tag` is set are selectable (click → `onSelectTag`); other clicks → `onPick({ point, normal })`. `highlights` { tag: 'decision' \| 'blocked' } and `selectedTag` recolour in place. `ScanViewer.jsx` is now a thin wrapper used by Diagnostics | ✅ deployed (v6.4.0) |

### 5.3 Event triggers, web triggers, Rovo actions
- Trigger `precedent-work-order-trigger` (see §5.1): every created or updated work order is checked (asApp). Errors are logged, never thrown. Web triggers and Rovo: none yet.

### 5.4 Storage
| Store | Keys | Contents |
|---|---|---|
| Object Store `precedent-objects` | `scans/sha256-<base64url digest>` (content-addressed: identical bytes → identical key) | GLB scans, ≤ 200 MB each (`MAX_SCAN_BYTES`; the platform maximum is 1 GB) |
| Jira issue property | `precedent.check` on each work order | `{ version: 1, status: 'clear' \| 'conflict', siteId, summary, touched: [TAG], conflicts: [...], acknowledged: [...], notified: [decisionId], checkedAt }`. Written by the check (asApp); read by the validator, the JQL index and the panel |
| Jira issue property | `precedent.equipment` | `{ tags: [TAG] }`: equipment a work order touches, set by hand in the panel |
| KVS | `decision:<siteId>:<id>` | Decision records (§5.2) |
| KVS | `resolution:<issueKey>:<decisionId>` | `{ type: 'reaffirm', reason, by, at }` |
| KVS | `graph:<siteId>` | The site's building context graph (≈88 KB): the `exb-graph.json` shape + `seededFrom`, `updatedAt`. Source of truth for the graph (§6.7); helpers in `src/graph.js`, `src/graphKeys.js` |
| KVS | `site:<id>` | Sites (now also `equipmentSource: { kind: 'assets', siteName }` and `approvers: [accountId]`) |

### 5.5 Permissions (scopes, egress, CSP)
| Scope | Needed by |
|---|---|
| `read:jira-work` | Reading work orders and `precedent.check` (`ValidatorSpike`, later the check) |
| `write:jira-work` | Writing `precedent.check` (`ValidatorSpike`, later the check) |
| `storage:app` | Site records in Forge KVS (`sites.js`); Assets model id cache |
| `read:servicedesk-request` | `GET /rest/servicedeskapi/assets/workspace` (find the Assets workspace id) |
| `read:` / `write:cmdb-schema:jira`, `…cmdb-type…`, `…cmdb-attribute…`, `…cmdb-object…`, `read:cmdb-icon:jira` | Create/read the Precedent Assets schema, types, attributes and objects (`assets.js`). **No delete scopes**, by design. The linter doesn't check Assets routes, so these were added by hand |

Egress: none. CSP additions: none (§5.6).

### 5.6 Gotchas
- **Never set `"type": "module"` in `forge/package.json`.** Forge's webpack bundler then treats `src/` as strict ESM, which ignores the `__esModule` interop flag. `import Resolver from '@forge/resolver'` returns the module object instead of the class, and the backend fails with `out_namespaceObject is not a constructor` (seen 2026-11-08). The UI (`static/workspace/package.json`) can and does use `"type": "module"`, because Vite handles it.

- **Custom UI's CSP blocks `fetch(blob:)` (`connect-src`).** three.js `GLTFLoader` loads embedded textures by fetching a `blob:` object URL, so scans rendered untextured (2026-11-08). Fixed in-app with `cspSafeTextures.js`, with no manifest CSP change, so the app stays Runs on Atlassian eligible. Any future code that fetches `blob:` or `data:` URLs will hit the same wall: decode Blobs directly instead.
- **Assets: the app account can read but not administer.** As the app, listing schemas works, but `objectschema/create` returns **403** "you do not have permission" (2026-11-09). The installing user is a Jira admin in `assets-admins`. So setup and import run **asUser** (the admin clicking), and background reads (the work-order check) stay **asApp**. Judges install as site admins, so the setup step works for them.
- **Never trust the shape of stored issue properties.** On 2026-11-11 the site page crashed (`Cannot read properties of undefined (reading 'forEach')`): FAC-272/FAC-278 still had spike-3 test `precedent.check` values without a `conflicts` list. Every value read from Jira now goes through `normaliseCheck` (`static/workspace/src/siteState.js`, tested in `static/workspace/test/siteState.test.mjs`, run with `npm test` in `forge/static/workspace`), and `App.jsx` has an error boundary so one bad value can't blank the app. The two legacy test properties were deleted.
- **Assets reference types aren't reachable by the app.** `GET/POST …/config/referencetype` → "Authentication Required" with any scope we hold. Reference type ids are per-workspace UUIDs; learn them from existing attributes (`attribute.referenceType.id`, see `src/spikes/assetsRefs.js`).
- **Assets rejects long descriptions:** a 90-char schema description gave **400** `ObjectSchemaBean.Size.description` (the longest existing one is 80). Keep schema and type descriptions under 50 characters.

### 5.7 Build and deploy
```bash
cd forge
npm run build:ui                 # vite build → static/workspace/dist
npm run lint                     # forge lint
npm run deploy                   # build:ui + forge deploy -e development
../node_modules/.bin/forge install --non-interactive --upgrade \
  --site one-atlas-uyqa.atlassian.net --product jira --environment development   # only after scope/permission changes
```

---

## 6. Target design

### 6.1 Modules (planned)
| Module | Purpose |
|---|---|
| `jira:globalPage` (Custom UI) | Workspace: sites, scan upload, 3D viewer, pin decisions, decision history |
| `jira:issuePanel` + `jira:issueContext` | Conflict panel + badge on a work order; resolution actions |
| `jira:workflowValidator` | Blocks the transition into In Progress while a conflict is open (spike 3) |
| `trigger` on `avi:jira:created:issue` / `avi:jira:updated:issue` | Runs the check; sets issue property `precedent.status` for JQL |
| `rovo:agent` + `action` ×3 | `checkWorkOrder`, `decisionsForAsset`, `proposeSupersession` |
| Storage | Forge SQL (decisions, checks, pins); Object Store (scans, photos, audio) |
| `llm` (Forge LLM) | Explains a conflict in plain language. Never decides one |
| Lifecycle `avi:forge:installed:app` | Seeds the sample site; retries on 401/403. "Load sample site" button as a backstop |

### 6.2 Planned resolver functions
| Function | Purpose |
|---|---|
| `getUploadUrl` | Object Store pre-signed PUT for a scan / photo / audio (key, size, sha256) |
| `registerScan` | Record an uploaded scan against a site; returns a pre-signed GET for the viewer |
| `listSites`, `getSite` | Workspace navigation |
| `createDecision`, `listDecisions`, `getDecision` | Decision CRUD (pin, statement, reason, constrains, evidence) |
| `checkWorkOrder` | Run the check for an issue (also used by the trigger and the Rovo action) |
| `resolveCheck` | Reaffirm / propose supersession / withdraw |
| `approveSupersession` | Approver sign-off |
| `loadSampleSite` | Manual seed (backstop for the install event) |

### 6.3 Data model
```
Site ─┬─ Scan (GLB in Object Store, sha256, units m, Y-up)
      ├─ Location ── Asset (Assets object, or Forge SQL row when Assets is absent)
      └─ Decision
           statement, reason, decidedBy (Atlassian accountId), decidedAt
           status: standing | superseded | withdrawn | proposed
           pin: { scanId, point [x,y,z], normal, cameraView }
           constrains → Asset[]
           supersedes → Decision          (acyclic; enforced on write)
           ──< Evidence (photo | audio | document; Object Store key, sha256)
WorkOrder (Jira/JSM issue) ── touches → Asset[]   (Assets custom field, or a Precedent picker in the panel)
   ──< Check { decisionId, verdict: clear | conflict, rationale,
               resolution: reaffirm | supersede | withdraw, resolvedBy, approvedBy }
```

### 6.4 Flows
**Upload and pin (web)**
1. The browser calls `getUploadUrl` and PUTs the GLB directly to Object Store. Sample scans are 17–19 MB; `invoke` is capped at 500 KB.
2. The viewer (three.js `GLTFLoader`) loads the scan from a pre-signed GET.
3. The user clicks the mesh; a raycast picks a point and opens a "New decision" form: statement, reason, assets, photos, voice note (`MediaRecorder` → Object Store).

**Check (deterministic first)**
1. An issue event fires and the handler collects the assets the work order touches.
2. **Candidates** are the standing decisions whose `constrains` includes those assets. No candidates means clear.
3. **Conflict test:**
   - First, a rule-based pass over the decision's optional structured constraint (e.g. `asset V-12 must remain {state: open}`) against the work-order fields and keywords.
   - Then the LLM explains whether the work-order text contradicts the decision, quoting both.
   - **The LLM only explains candidates. It never adds a conflict and never clears a rule-based one.**
4. Write the issue property, the panel state and a comment. The handler must be idempotent, because one create can also emit an update.

**Enforce and resolve**
- The validator fails a transition into the "In Progress" category when `precedent.status = conflict`.
- **Reaffirm:** record why.
- **Supersede:** create a `proposed` decision. Once the approver signs off, the old decision becomes `superseded`, the check resolves, and the original decider is notified.
- **Withdraw:** edit the work order; the check re-runs.

### 6.5 Assets strategy
- Create the Precedent object schema (Site, Location, Equipment) on install and seed sample objects.
- If Assets is unavailable (licence or 401), fall back to Forge SQL tables of the same shape, shown in the UI as "Precedent assets". Never fail the install.

### 6.6 Scan formats
| Tier | Formats | Handling |
|---|---|---|
| View in 3D | GLB / glTF 2.0 (ISO/IEC 12113) | three.js `GLTFLoader`. Scaniverse GLBs are a single mesh + JPEG texture with no extensions |
| Later | LAS/LAZ, PLY, OBJ | viewer loaders (roadmap) |
| Evidence only | USDZ, E57, IFC | stored, hashed, downloadable |

Recommended capture: Scaniverse (free) in mesh mode → GLB. Alternatives: 3D Scanner App, SiteScape (E57/PLY), Polycam (glTF on the free plan).

### 6.7 Building context graph, scoping agent, contractor closeout (design, 2026-11-11, not built)

#### Why
The person asking for work on a building (an office or facilities manager) usually doesn't know what a job really involves. "Upgrade the AC on the roof" can mean a bigger breaker, new conductors because the existing wire gauge is too small for the new load, a new disconnect, a structural check because the new unit is heavier, and a weekday shutdown that a standing decision forbids. None of that is in the request, so quotes come back wrong, change orders follow and jobs stall on site.

Precedent becomes **everything a technician or contractor needs to know before quoting a job, kept true by every finished job**:
1. A **building context graph**: equipment and what powers it, what it feeds, what it serves and what holds it up.
2. A **Rovo agent** that walks the graph and produces a **scoping brief** for a job.
3. **Contractor closeout** in the JSM customer portal: the contractor records what was actually installed, with original photos of each part, and once accepted the graph reflects the building as it now is.

The existing decisions loop (§5) stays. Standing decisions become one layer of the brief ("shutdowns of RTU-1 are restricted on weekdays").

#### Goals
- G1. A typed graph of the sample building's electrical, mechanical and structural connections, where every node and link records where it came from.
- G2. A Rovo agent that answers "what's involved in <job> on <equipment>?" with a brief built **only from graph facts**, each fact cited with its source.
- G3. A contractor working through the customer portal can close out a job: what changed per part, plus original photos linked to that part.
- G4. Accepted closeouts update the graph. Every node keeps a history of who changed what, on which job, with which photos.
- G5. The same actions are exposed as `rovo:mcp` tools, so outside agents can use them too.

#### Non-goals
- Engineering sign-off, code compliance or load calculations someone could rely on. The brief lists *checks to make*, not answers. The existing disclaimer is extended: Precedent doesn't replace a licensed engineer or electrician.
- Prices or quote amounts.
- Editing IFC or CAD files.
- Any backend outside Forge.

#### Anti-goals (a failure even if it works)
- Presenting illustrative data as the real building's as-built data, in the app, the README or the video.
- The agent stating a spec, size or rating that isn't in the graph.
- A contractor's report changing the graph without a facilities-side review.
- Photos recompressed, resized or stripped of metadata. Originals are kept byte-for-byte.

#### Provenance (applies to every node, link and attribute value)
`provenance`: `as-built` (from the record drawings / COBie, cite `sheet`) · `illustrative` (written by us for the demo, never presented as real) · `as-installed` (from an accepted contractor closeout, cite `issueKey` + photo ids). The UI shows it as a small tag; the agent must say "illustrative" when it uses illustrative facts. Replacing illustrative links with the partner's real connection data later (open request, `samples/bim/exb/README.md`) needs no code change.

#### G1. The graph
**Node types:** Site · Level · RoofZone (with a load rating) · Equipment (existing 28) · Switchboard · Panel · Breaker (overcurrent protective device) · Feeder (conductor run: material, size, sets, insulation, length) · Disconnect · ServedArea (e.g. "North tower L2–5") · LineSet (refrigerant piping) · PipeLoop (heating hot water) · Curb/Support.

**Link types (directed):** `feeds` (switchboard → panel → breaker → feeder → disconnect → equipment) · `protects` (breaker → feeder) · `serves` (equipment → served area) · `connects` (condensing unit ↔ line set ↔ indoor unit; pump ↔ loop ↔ boiler) · `supportedBy` (equipment → curb → roof zone) · `locatedOn` (→ level).

**Illustrative electrical design for the sample building** (derived from the real ratings, all marked `illustrative`):
- Main switchboard MSB, 480Y/277 V, in the level 1 main electrical room. That room is real (CU-2 cools it), but the switchboard's details are illustrative.
- Roof distribution panels, one per tower.
- **Breaker size = the unit's real MOP**, rounded to a standard size: RTU-1/RTU-3 600 A, RTU-2/RTU-4 250 A. Boilers (6.5 FLA): 15 A.
- **Conductors from the NEC 310.16 table (75 °C copper column)**: 600 A → 2 parallel sets of 350 kcmil; 250 A → 250 kcmil; 15 A → 12 AWG. Each with a disconnect at the unit.
- Units with no electrical data in the take-off (CUs, fans, pumps): plausible ratings, flagged `illustrative` with `ratingAssumed: true`.
- RoofZones with load ratings, so a heavier replacement unit triggers a structural check.
- One deliberate tight spot for the demo: a panel close to its capacity, so "upgrade RTU-2" surfaces that the panel and feeder, not just the breaker, need attention.

The data lives in a generated seed file (like `exb.json`), written by a script from the take-off CSVs plus a hand-written `illustrative.yaml` (derivation rules and assumptions), so a reviewer can see exactly what was invented.

**Storage (call made 2026-11-11):** **app storage is the source of truth** for the graph (nodes, links, per-value provenance, history), written asApp. The app's own storage needs no Assets licence or admin rights, so the whole flow, including accepted closeouts, works on any site, and provenance has a natural home. The install seeds it from the bundled seed. **Jira Assets is a mirror** where available: nodes become objects in the `PREC` schema and links become reference attributes, so the graph is browsable in Jira. The mirror is synced asUser by an admin ("Sync to Assets" in site Settings, extending today's import), and again after accepted closeouts when the accepting user can write Assets. Otherwise the change is queued and shown as "Assets out of date". A missing or failing mirror never blocks anything.

#### G2. The Rovo agent
- `rovo:agent` "Precedent" (30-character name limit), with a prompt that says: answer only from action results, cite each fact's provenance and sheet/job, say "illustrative" when it applies, and end every brief with "checks for a licensed professional".
- **Actions** (Forge `action` modules, all `GET` except where noted):
  - `get-equipment-context(tag)`: the node, its upstream electrical chain, mechanical connections, served areas, support, standing decisions, open work orders and recent closeouts.
  - `scope-job(tag, jobType, newRatingAmps?, newWeightLb?, newRefrigerant?)`: a structured brief. **Deterministic rules** produce the knock-on items. For example: a new rating above the breaker → breaker, conductors and disconnect; the panel's connected load plus the delta over its rating → the panel too; more weight → a structural check on the support; a refrigerant change → the line set; standing decisions → scheduling constraints; served areas → occupant impact. The LLM phrases the brief; the rules decide its content.
  - `check-work-order(issueKey)`: the existing check (§5.2).
  - **Not Rovo-only:** `scope-job` and `attach-scope-brief` are shared backend functions. The issue panel has a **Scope this job** form (equipment, job type, optional new rating/weight/refrigerant) that calls them directly, so briefs and the closeout flow work with no Rovo and no LLM (§2.4). Rovo phrases the brief in conversation; the panel shows the same structured brief.
  - `attach-scope-brief(issueKey, tag, jobType, …)` (`CREATE`): saves the brief on the work order (issue property `precedent.brief`) so the panel and the contractor's portal view show it.
- The user always comes from `context.accountId`, never from inputs. Issue access is checked as the user, as `assertCanView` does today.
- **`rovo:mcp`** exposes `get-equipment-context`, `scope-job` and `check-work-order` (Preview; an admin turns on external access per installation).
- Conversation starters: "What's involved in upgrading RTU-2 to a larger unit?", "What feeds RTU-1, and what does it serve?", "Is FAC-123 clear to start?"

#### G3/G4. Contractor closeout (JSM customer portal)
- `jiraServiceManagement:portalRequestDetail` (Custom UI, `unlicensedAccess: [customer]`) on requests in a site's linked service space. It shows the scoping brief and a **Close out this job** list of the graph parts the job touches: the brief's parts when a brief exists, otherwise the work order's touched equipment plus its upstream electrical chain and support, with **Add a part** (picker over the site graph) for anything else.
- Per part, the contractor records **what's there now** with fields specific to the node type (feeder: material, size, sets; breaker: rating, frame; equipment: model, serial, weight, refrigerant), plus a note.
- **Photos:** any number per part, uploaded as **originals** (JPEG, HEIC, PNG, camera RAW such as DNG), stored byte-for-byte in Object Store under a content-addressed key. Each photo records the SHA-256, uploader account id, time, issue key and node id. Browser-renderable types get a preview; others show as files.
- **If spike 8 fails** (Object Store not usable from the portal for customers): photos go in as **JSM request attachments** (Jira keeps attachment bytes unchanged). The app records each attachment's id, SHA-256 (computed in the browser before upload and verified on read), uploader and node id. The contract (original bytes, linked to a part) is the same either way.
- **Rule:** the closeout can't be submitted until every part marked "changed" has at least one photo.
- Submitting creates a closeout record with status **pending review**. Only the site's **approvers** (`site.approvers`, as for supersessions; default the site creator) may Accept or Reject. Facilities staff see it in the issue panel and on the site page, with the photos next to the proposed changes. **Accept** → the graph is updated (values become `as-installed`, the history entry links the job and photos). **Reject** needs a reason, which the contractor sees in the portal.
- Security: every portal resolver call checks the caller is the reporter or a participant of that request (looked up asApp, never taken from the payload). Photos are signed for download only for people who can see the request.

#### Judge path (the rules require the video to work from the install link)
- Site setup links a **service space** (JSM). The sample-building setup creates one if the site has none (scope `manage:jira-project`, verify), with a "Contractor work" request type and seeded requests: one already scoped, one ready to close out.
- A judge walks the contractor side **as themselves** in the portal (licensed users can open portal requests, and the panel declares `unlicensedAccess: [customer]` for real contractors). No second account is needed. The setup instructions also say how to invite a customer if they want the true contractor view.
- The judge is the sample site's creator, so they are its approver and can accept their own closeout (shown as "self-approved", as decisions already are).

#### Build order (each step is demoable alone)
1. Graph seed (illustrative design + generator) and graph read API; graph in the site page (equipment detail shows its chain).
2. Agent + actions + `rovo:mcp`.
3. Portal closeout + photos + review → graph update.
4. Stretch: feed graph nodes and closeouts into Teamwork Graph through a connector (verify the module and its status first).

#### Left to the builder
Exact Assets attribute types and reference configuration, the Forge SQL vs KVS choice for history, the portal UI layout, the deterministic rule table's exact thresholds, and the conversation-starter wording.

## 7. Spikes (each must pass on the dev site before we build on it)
| # | Spike | Status |
|---|---|---|
| 0 | Scaffold deploy + install + UI → resolver `ping` | ✅ verified 2026-11-08: page renders in Jira, `ping` returns (after fixing the ESM interop crash, §5.6) |
| 1 | Object Store pre-signed PUT **from the browser** (CORS) with a 17 MB GLB, then GET for the viewer | ✅ passed 2026-11-08 with `scaniverse-2026-11-07-1225.glb` (16,985,152 B): upload 3.6 s (4.5 MB/s), download 2.5 s, SHA-256 identical. URLs are on `tdp-os.services.atlassian.com` (Atlassian-hosted), so no CSP or egress config was needed and Runs on Atlassian is kept |
| 2 | three.js + `GLTFLoader` inside Custom UI (CSP, WebGL) at acceptable FPS for 180k triangles; otherwise a decimated preview | ✅ passed 2026-11-08: the full-resolution sample (187,275 triangles, 7.02 × 4.85 × 7.06 m) renders **textured** in WebGL2 at 59 FPS, after the CSP texture fix (§5.6). No decimation needed for viewing. Click-to-pick is implemented but not yet confirmed in the browser |
| 3 | `jira:workflowValidator` blocks a transition based on an issue property | ✅ passed 2026-11-08 on FAC (company-managed JSM). Expression validator attached **programmatically** to "Start" (81) via `POST /rest/api/3/workflows/update` (dry run `…/update/validation` first, no errors; workflow v2 → v3). Test on FAC-277: with `precedent.check.status = conflict`, `POST …/transitions {id: 81}` → **HTTP 400** with our message quoting the decision; after clearing the property → **HTTP 204**, now In Progress. FAC-278 left blocked for a UI check. **Follow-ups:** (a) attach to *every* transition into an in-progress-category status: FAC has 3 (Start 81, Approved 101, Reopened 141 → In Progress); (b) to attach from the app itself on setup, add scope `manage:jira-configuration` and call the same endpoints `asApp`; (c) the validator ARI differs per environment, so read it from workflow capabilities at runtime, never hard-code it |
| 4 | Assets REST from Forge: create a schema, object types and objects | ✅ passed 2026-11-09 (reported in the browser): "Import EXB into Assets" created the **Precedent** schema (PREC), Site/Level/Equipment types, and the EXB site, 6 levels and 28 equipment. Reads work asApp; schema/object creation needs **asUser** (the app account got 403, see §5.6). Two fixes on the way: descriptions under 50 chars, then asUser for setup |
| 5 | Forge LLM `chat()` in an install-link app; cost per check | ⏳ |
| 6 | A Rovo agent + action calling the shared check function | ⏳ |
| 7 | Assets **reference attributes** created by the app (asUser) and read asApp; AQL walk of a 4-hop electrical chain in < 5 s | ✅ passed 2026-11-11 (run 3, v6.10.0). Reference attribute "Fed from" created (`type: 1`, `typeValue` = target object type id, `additionalValue` = **reference type UUID**); SF-1 → SP-1 written asUser; **the app account CAN create objects** (SF-2, asApp), so accepted closeouts can update the Assets mirror asApp (only schema/type creation needs asUser); AQL by reference and `object HAVING outboundReferences(…)` work asApp, ≈0.2–0.4 s per query. Runs 1–2: `config/referencetype` → "Authentication Required"; `additionalValue` missing → 400; small integers → "ReferenceType invalid". **Risk:** reference type ids are per-workspace UUIDs, learnable only from existing reference attributes, so a clean site may have none (check in spike 10). Leftovers on the dev site: types Spike Panel/Spike Feeder (150/151), objects PREC-4703…4705 (the app has no delete scopes; delete by hand) |
| 8 | `portalRequestDetail` as a **customer**: resolver gets the customer's `accountId`; `objectStore.upload` works from the portal; a 25 MB DNG uploads byte-identical | ⏳ |
| 9 | Rovo agent + actions on a **clean** site (is Rovo available to judges?) and `rovo:mcp` reachable from an external client | ⏳ |
| 10 | Assets availability on a clean judge-like site (plan/licence); otherwise the seed fallback is the demo path | ⏳ |

## 8. Scope order (cut from the bottom)
**Never cut:**
1. Sample site seeded on install
2. Scan upload + 3D viewer + pin decision
3. Work-order check + conflict panel
4. Workflow validator
5. Reaffirm / supersede (with approver) / withdraw

**Cut from the bottom:**
6. Rovo agent + 3 actions (the bonus target)
7. Assets-backed model (fallback: Forge SQL)
8. LLM explanations (fallback: rule text + quoted decision)
9. Voice-note evidence
10. JQL property + dashboard gadget

## 9. Open questions
- [ ] Decimated sample scan for the install seed (aim for ~2–5 MB)
- [ ] A real site to film with permission; 2–3 short domain interviews
- [ ] Eligibility: the entrant's residence and employer
- [ ] Marketplace bonus: an install link may not work for a Marketplace-submitted app (separate listing app, or skip)
- [ ] JavaScript now. Move the backend to TypeScript before the engine grows?

## 10. Decision log
| Date | Decision | Why |
|---|---|---|
| 2026-11-07 | Precedent (site decisions enforced on work orders) over Rebase (a CAD checker) | Theme fit ("what's already been decided"), Atlassian-native |
| 2026-11-08 | Drop the native iPhone app; Scaniverse + web upload | Judges only test the install link; no Mac or Apple account; frees weeks for Jira polish |
| 2026-11-08 | Custom UI (not UI Kit) for the workspace | The WebGL scan viewer needs a real DOM/canvas |
| 2026-11-08 | Vite + React 19 instead of the template's Create React App on React 16 | CRA is deprecated; Vite bundles three.js well |
| 2026-11-11 | Expand to a building context graph + scoping agent + contractor closeout (§6.7) | Building managers can't scope jobs; contractors need connections (feeders, breakers, structure), not just an equipment list |
| 2026-11-11 | Invent an **illustrative** electrical/mechanical design for the sample building, derived from its real ratings and always labelled | The partner's connection data hasn't arrived; the demo needs a graph; we must never present invented data as as-built |
| 2026-11-11 | Contractor closeouts change the graph only after facilities review | Trust: the graph is what the next quote relies on |
