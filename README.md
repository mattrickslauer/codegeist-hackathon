# Precedent

**Every decision about a building, pinned to the equipment it governs, enforced on every work order.**

*"RTU-1 must not be shut down on weekdays between 06:00 and 19:00. It's the only air supply for four floors."* Someone decided that, for a good reason. Three months later a different shift opens a Jira work order: *"Shut down RTU-1 Tuesday 10:00 for coil cleaning."* Nobody remembers the decision, and the reason never reached the system where work is planned.

Precedent is a Forge app for Jira and Jira Service Management. It keeps the decisions made about a site's equipment, shows them on the building's 3D model, and **checks every work order against them**. A work order that contradicts a standing decision is flagged on the work order itself, and can't start until someone reaffirms the decision, supersedes it (with an approver), or withdraws the work.

> Built for **Atlassian Codegeist 2026**. This repository is the full source. [Status](#status) lists exactly what works today and what's still in progress.

---

## How it works

### 1. A site, its building and its equipment
A **site** is a real place (a building, a plant) linked to the **Jira space** where its work orders live. The sample site is a real, anonymised five-storey office building:
- **3D model:** converted from the building's as-built IFC files. Every piece of equipment is a clickable object named by its tag (RTU-1, HWB-1…).
- **Equipment register:** the building's 28 pieces of rooftop plant (air handlers, condensing units, boilers, pumps, fans, elevators), with manufacturer, specs, what each unit serves and the drawing it came from. It's imported into **Jira Assets** from the building's COBie handover data.
- **Your own sites:** upload a LiDAR scan (GLB, e.g. from Scaniverse on an iPhone or iPad Pro) as the 3D model.

### 2. Decisions about equipment
Click a unit in the model and record a decision about it:
- what was decided, and why
- which equipment it governs
- which actions it guards ("shut down", "isolate", "drain"). With no actions listed, *any* work on that equipment needs review.

Equipment with standing decisions shows **blue** in the model.

### 3. Every work order is checked
When a work order is created or edited in the linked space, Precedent:
1. finds the equipment it mentions (matching whole tags: `RTU-1` never matches `RTU-10`)
2. checks it against the site's standing decisions
3. if it conflicts, marks the work order, colours the equipment **red** on the model, and posts one Jira comment that **@mentions the person who made the decision**, so they're notified the Jira way

The check is deterministic and explainable: no AI decides whether something conflicts.

### 4. Conflicts are resolved on the work order
The **Precedent panel** on every work order shows the conflicting decision, its reason and the matched equipment, with three choices:
- **Reaffirm:** the work is consistent after all. Say why; it's recorded.
- **Supersede:** propose a new decision. A **site approver** must accept it; then the old decision is superseded and the work order is released.
- **Withdraw:** change the work order. It's re-checked automatically.

A Jira **workflow validator** refuses the move to *In Progress* while a conflict is open, so a conflicting work order can't quietly start. Blocked work orders are also searchable in Jira: `precedentStatus = conflict`.

---

## Built on Atlassian

| | What Precedent uses it for |
|---|---|
| **Forge** | The whole app: Custom UI (React + three.js), functions, the issue-event trigger, Forge storage (KVS) and Object Store for scans. No external backend; the app is eligible for *Runs on Atlassian* |
| **Jira / Jira Service Management** | Work orders, the Precedent issue panel, the workflow validator, the JQL-indexed issue property, comments with mentions |
| **Jira Assets** | The site's equipment register (schema *Precedent*: Site → Level → Equipment) |

---

## Status

Honest as of this commit:

| Capability | State |
|---|---|
| Sites linked to a Jira space; sample building with its 3D model | ✅ working |
| 3D model: click equipment, blue (decisions) / red (blocked) highlights | ✅ working |
| Decisions: record, supersede with approval, withdraw | ✅ working |
| Automatic check on work-order create/edit, comment with @mention | ✅ deployed, end-to-end test in progress |
| Precedent panel on work orders (reaffirm / supersede / withdraw, *View on model*) | ✅ deployed |
| Workflow validator blocking *In Progress* | ✅ verified on a test workflow. **Attaching it to a space's workflows automatically during setup is in progress** |
| Equipment in Jira Assets | ✅ import verified. **Running it as part of setup is in progress** (until then the app uses the bundled equipment data) |
| LiDAR scan upload as a site's 3D model | ✅ working |
| Building context graph: each unit's power chain (panel, breaker, wire size, disconnect), what it serves and what holds it up, every fact labelled as-built or **illustrative** | ✅ working on the sample building. The electrical and structural parts are an **illustrative** design derived from the real equipment ratings (see `samples/bim/exb/README.md`) |
| Public install link | ⏳ coming before submission |
| Rovo agent "Precedent" + `get-equipment-context` action, also an MCP tool ("what feeds RTU-2?") | ✅ deployed to development, being verified |
| Scoping briefs ("what does replacing RTU-2 involve?") and contractor closeout with photos in the customer portal | ⏳ in progress |

---

## Repository

| Path | What |
|---|---|
| `forge/` | The Forge app: `manifest.yml`, backend in `src/`, Custom UI in `static/workspace/` |
| `forge/test/`, `forge/static/workspace/test/` | Unit tests (`npm test` in each) |
| `docs/ARCHITECTURE.md` | Architecture, every module, function, storage key and permission, plus what we learned on the way |
| `samples/bim/exb/` | The sample building: anonymised as-built IFC4 + COBie, generated from its record drawings |
| `samples/scans/` | Real LiDAR scans (Scaniverse, iPhone 17 Pro) used in development |
| `scripts/` | `build_exb_seed.py` (COBie → equipment seed), `build_exb_model.py` (IFC → 3D model, IfcOpenShell) |

### Develop
```bash
npm install                                   # Atlassian Forge CLI (pinned)
cd forge && npm install && npm --prefix static/workspace install
npm test                                      # check logic
npm run deploy                                # build UI + deploy to the development environment
```
Rebuild the sample data:
```bash
python3 -I scripts/build_exb_seed.py
python3 -m venv .venv-bim && .venv-bim/bin/pip install ifcopenshell==0.8.5
.venv-bim/bin/python -I scripts/build_exb_model.py
```

### Credits
- The sample building's as-built IFC and COBie were produced from its record drawings by our project partner's *AsBuilt* pipeline and are used with permission. The building is deliberately anonymised: no name, address or owner appears anywhere.
- 3D rendering with [three.js](https://threejs.org); IFC conversion with [IfcOpenShell](https://ifcopenshell.org).

*Precedent records and surfaces decisions. It does not replace a site's safety, engineering or Management of Change sign-off.*
