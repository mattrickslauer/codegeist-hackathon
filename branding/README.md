# Branding

The single place for the product's name, words, colours, marks and media rules. Everything public (the app UI, README, Devpost text, video, screenshots) takes its copy and look from here.

> **Name: under review (2026-11-11).** The app ships as **Precedent**. The product has grown from "decisions enforced on work orders" into "everything a contractor needs to know before quoting a job, kept true by every finished job", so the name is being reconsidered before anything goes to judges. Until a new name is chosen, use *Precedent*. Rename steps: [Rename checklist](#rename-checklist).

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

- Current: `forge/static/workspace/public/precedent-icon.svg`, a location pin with a check ("decided here"), #0C66E4 on transparent, 24×24. Used as the issue panel icon.
- A new name gets a new mark. Brief: works at 16 px in Jira's sidebar; reads as *building* or *trace* (a unit with a line running to its source), not as a generic pin; single colour plus white; no third-party logos.
- Files go in `branding/marks/` (SVG source, plus 16/24/48/128 px PNG exports for Devpost and the Marketplace).

## Media rules (from the hackathon rules and our data agreements)

- **No third-party trademarks or copyrighted music** in the video. Equipment manufacturer names appear in the data (they're on the drawings). Don't feature them in titles, thumbnails or the voice-over.
- **The sample building stays anonymous:** no name, address, owner or people. See `samples/bim/exb/README.md`.
- **Never show illustrative data without its label.** Screenshots must show the *Illustrative* lozenges.
- Screenshots: 1920×1080 or 1600×900, light theme, the sample building, real interactions (no mock-ups).

## Folder layout

| Path | What | Public? |
|---|---|---|
| `branding/README.md` | This guide | yes |
| `branding/marks/` | Logo / icon sources and exports (empty until the name is final) | yes |
| `branding/screenshots/` | Devpost gallery images | yes |
| `branding/explore/` | Name shortlists, mark sketches, rejected options | **no** (git-ignored) |

## Rename checklist

The name appears in about 30 files. Change in this order, deploy, and check the dev site before anything is filmed:

1. **User-visible text**: `forge/manifest.yml` (`title` on the global page and issue panel, workflow validator `name`/`description`, `rovo:agent` name/prompt, `rovo:mcp` name), UI copy in `forge/static/workspace/src/*.jsx`, `index.html` `<title>`, the Jira comment text in `forge/src/check.js`, the Assets schema display name in `forge/src/assets.js` (`SCHEMA_NAME`).
2. **Docs**: `README.md`, `docs/ARCHITECTURE.md`, this file.
3. **Internal keys (optional, do it before any judge installs)**: issue properties `precedent.check` / `precedent.equipment`, JQL aliases `precedentStatus` / `precedentSite`, manifest module keys `precedent-*`, Assets schema key `PREC`, package names. Changing them orphans data on the dev site (re-load the sample). The Forge app id doesn't change.
4. **Developer console**: app name and Distribution listing name.
5. **Mark**: replace `precedent-icon.svg` and update the issue panel `icon` path.
