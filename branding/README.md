# Branding

The single place for the product's name, words, colours, marks and media rules. Everything public (the app UI, README, Devpost text, video, screenshots) takes its copy and look from here.

> **Name: Walkdown** (chosen 2026-11-13; the app was called *Precedent* until then). A *walkdown* is the site walk a contractor or engineer does before quoting or starting work. Walkdown lets you do that walk from Jira, and every finished job keeps it true. In the video, say what a walkdown is once, in the first 20 seconds.
>
> **Tagline:** *The pre-quote walkdown, before anyone climbs the roof.*

## Positioning

- **One line:** Everything a contractor needs to know before quoting a job on a building, kept true by every finished job.
- **For:** facilities and building managers who request work, and the contractors and technicians who quote and do it.
- **The problem, in their words:** "I asked for a quote to upgrade the AC and nobody told me the wiring was too thin." The facts a quote depends on (what feeds a unit, what it serves, what holds it up, what's been decided about it) sit in drawings and in people's heads, not where the work is planned.
- **What it does:**
  1. A building context graph: equipment, its power chain, loads, served areas and supports.
  2. A Rovo agent that turns it into a scoping brief.
  3. Contractor closeout with original photos, so the record matches the building as it now is.
  4. Standing decisions, enforced on every work order.
- **Category:** Apps for Specialized Industries (facilities / building operations).

## Voice

- Plain, specific, trade-literate: say "250 A breaker" and "250 kcmil feeder", not "electrical components".
- Honest about data: every number has a source. **Illustrative** data is always labelled as such, in the UI, by the agent, and in the video.
- Checks, not conclusions: the product lists what a licensed professional should verify. It never gives engineering sign-off or prices.
- Short sentences, no hype words ("revolutionary", "AI-powered", "seamless").

## Colour

The app follows the Atlassian Design System tokens (so it matches Jira light and dark). Product meaning sits on top:

| Meaning | Token (fallback) | Used for |
|---|---|---|
| Brand / standing decision | `--ds-background-brand-bold` (#0C66E4) | Mark, primary buttons, equipment with standing decisions (blue in the 3D model) |
| Blocked / conflict | `--ds-background-danger-bold` (#C9372C) | Blocked work orders, equipment touched by a blocked work order (red), "Panel near capacity" |
| As-built | success lozenge | Facts from the record drawings |
| Illustrative | default (grey) lozenge | Sample data written for the demo |
| As-installed | information lozenge | Facts from an accepted contractor closeout |

## Mark

- **Walkdown mark** (v1, 2026-11-13): a trace walking down from its source, through a junction, to a rooftop unit (a box with a fan). White on brand blue #0C66E4, rounded square, 24×24 grid.
- Source: `branding/marks/walkdown-mark.svg` (the same file ships as `forge/static/workspace/public/walkdown-icon.svg`, the issue panel icon). Exports: `walkdown-16/24/48/128.png` for Devpost and a future Marketplace listing. Regenerate with `magick -background none -density 1200 walkdown-mark.svg -resize 128x128 walkdown-128.png`.
- Rules: legible at 16 px; single colour plus white; no third-party logos. v1 is a first pass: refine the unit's shape before filming if it reads as a camera.

## Media rules (from the hackathon rules and our data agreements)

- **No third-party trademarks or copyrighted music** in the video. Equipment manufacturer names appear in the data (they're on the drawings). Don't feature them in titles, thumbnails or the voice-over.
- **The sample building stays anonymous:** no name, address, owner or people. See `samples/bim/exb/README.md`.
- **Never show illustrative data without its label.** Screenshots must show the *Illustrative* lozenges.
- Screenshots: 1920×1080 or 1600×900, light theme, the sample building, real interactions (no mock-ups).

## Folder layout

| Path | What | Public? |
|---|---|---|
| `branding/README.md` | This guide | yes |
| `branding/marks/` | Mark source (SVG) and PNG exports | yes |
| `branding/screenshots/` | Devpost gallery images | yes |
| `branding/explore/` | Name shortlists, mark sketches, rejected options | **no** (git-ignored) |

## Rename record (Precedent → Walkdown, 2026-11-13)

Done in one commit across 40 files: every user-visible string (manifest titles, validator name, Rovo agent and MCP names and prompt, UI copy, `<title>`, the Jira comment), the docs, and the internal keys:

| Old | New |
|---|---|
| issue properties `precedent.check`, `precedent.equipment` | `walkdown.check`, `walkdown.equipment` |
| JQL aliases `precedentStatus`, `precedentSite` | `walkdownStatus`, `walkdownSite` |
| module keys `precedent-workspace`, `-work-order-panel`, `-work-order-trigger`, `-portal-closeout`, `-agent`, `-mcp`, `-check-index` | `walkdown-…` |
| Assets schema "Precedent" (key `PREC`) | "Walkdown" (key `WALK`) |
| package names `precedent`, `precedent-forge`, `precedent-workspace` | `walkdown…` |
| mark `precedent-icon.svg` | `walkdown-icon.svg` |

**Kept on purpose (invisible to users):** module key `precedent-objects` (the Object Store: a new key would orphan stored scans and photos) and `precedent-open-conflict-validator` (attached to the FAC workflow on the dev site; a new key would leave a dangling rule there). Both can change once nothing depends on them.

**Still to do by hand:** rename the app in the Atlassian developer console (and its Distribution listing). On the dev site, the old `PREC` schema and its objects stay in Assets (the app has no delete scopes); re-run the Assets import to create `WALK`. Old `precedent.check` properties are ignored; each work order gets `walkdown.check` the next time it is edited or its panel is opened.
