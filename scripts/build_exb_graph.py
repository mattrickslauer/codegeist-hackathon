#!/usr/bin/env python3
"""Build the EXB building context graph the Forge app seeds per site.

    python3 -I scripts/build_exb_graph.py           # writes forge/src/seed/exb-graph.json

Inputs:
  forge/src/seed/exb.json            as-built equipment and levels (from COBie + take-off, build_exb_seed.py)
  samples/bim/exb/illustrative.json  the ILLUSTRATIVE electrical / structural design and its rules

Every node attribute and link carries `provenance` (as-built | illustrative | as-installed) and `source`.
Design: docs/ARCHITECTURE.md §6.7 G1. Tests: forge/test/graph-seed.test.mjs. Standard library only; sorted output.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, "forge", "src", "seed", "exb.json")
ILLUSTRATIVE = os.path.join(ROOT, "samples", "bim", "exb", "illustrative.json")
OUT = os.path.join(ROOT, "forge", "src", "seed", "exb-graph.json")
ILL_SRC = "samples/bim/exb/illustrative.json"


def fact(value, provenance, source):
    return {"value": value, "provenance": provenance, "source": source}


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def next_size(sizes, minimum):
    for s in sizes:
        if s >= minimum:
            return s
    raise ValueError(f"no standard size >= {minimum}")


def choose_feeder(breaker_a, table, minimum):
    """(sets, size, ampacity per set): smallest single set, else fewest parallel sets of >= 1/0."""
    start = [name for name, _ in table].index(minimum)
    for name, amp in table[start:]:
        if amp >= breaker_a:
            return 1, name, amp
    parallel_start = [name for name, _ in table].index("1/0")
    for sets in range(2, 9):
        for name, amp in table[parallel_start:]:
            if sets * amp >= breaker_a:
                return sets, name, amp
    raise ValueError(f"no feeder for {breaker_a} A")


def parse_specs(specs):
    """As-built electrical, weight and refrigerant facts from the take-off's specs text."""
    out = {}
    m = re.search(r"Electrical:\s*([0-9]+-[0-9]-[0-9]+)(?:,\s*MOP\s*([0-9.]+))?(?:,\s*([0-9.]+)\s*FLA)?", specs)
    if m:
        out["voltage"] = m.group(1)
        if m.group(2):
            out["mopA"] = int(float(m.group(2)))
        if m.group(3):
            out["flaA"] = float(m.group(3))
    m = re.search(r"Weight:\s*([0-9,]+)\s*lb", specs)
    if m:
        out["weightLb"] = int(m.group(1).replace(",", ""))
    m = re.search(r"Refrigerant:\s*(R-[0-9A-Z]+),\s*([0-9.]+)\s*lb", specs)
    if m:
        out["refrigerant"] = m.group(1)
        out["refrigerantChargeLb"] = float(m.group(2))
    return out


def main():
    with open(SEED) as fh:
        seed = json.load(fh)
    with open(ILLUSTRATIVE) as fh:
        ill = json.load(fh)

    nodes, links = {}, []

    def node(nid, ntype, name, attrs):
        if nid in nodes:
            raise ValueError(f"duplicate node {nid}")
        nodes[nid] = {"id": nid, "type": ntype, "name": name, "attrs": attrs}

    def link(frm, to, ltype, provenance, source):
        links.append({"from": frm, "to": to, "type": ltype, "provenance": provenance, "source": source})

    # Levels (as-built).
    for lv in seed["levels"]:
        node(f"level:{lv['code']}", "Level", lv["name"], {
            "elevationFt": fact(lv["elevationFt"], "as-built", "data/levels.csv"),
            "heightFt": fact(lv["heightFt"], "as-built", "data/levels.csv"),
        })

    # Switchboard and panels (illustrative).
    sb = ill["switchboard"]
    node(f"switchboard:{sb['id']}", "Switchboard", sb["name"], {
        "voltage": fact(sb["voltage"], "illustrative", ILL_SRC),
        "busA": fact(sb["busA"], "illustrative", ILL_SRC),
        "location": fact(sb["location"], "illustrative", ILL_SRC),
    })
    link(f"switchboard:{sb['id']}", f"level:{sb['level']}", "locatedOn", "illustrative", ILL_SRC)
    panel_by_sheet = {}
    for p in ill["panels"]:
        node(f"panel:{p['id']}", "Panel", p["name"], {
            "busA": fact(p["busA"], "illustrative", ILL_SRC),
            "why": fact(p["why"], "illustrative", ILL_SRC),
        })
        link(f"switchboard:{p['fedFrom']}", f"panel:{p['id']}", "feeds", "illustrative", ILL_SRC)
        link(f"panel:{p['id']}", f"level:{p['level']}", "locatedOn", "illustrative", ILL_SRC)
        panel_by_sheet[p["sheet"]] = p["id"]

    # Structure (illustrative).
    for z in ill["roofZones"]:
        node(f"roofzone:{z['id']}", "RoofZone", z["name"], {
            "loadLimitLb": fact(z["loadLimitLb"], "illustrative", ILL_SRC),
            "why": fact(z["why"], "illustrative", ILL_SRC),
        })
        link(f"roofzone:{z['id']}", "level:ROOF", "locatedOn", "illustrative", ILL_SRC)

    loop = ill["heatingLoop"]
    node(f"pipeloop:{loop['id']}", "PipeLoop", loop["name"], {
        "medium": fact("Heating hot water", "as-built", "E3.06B; mech schedule p10"),
    })

    served_seen = set()
    table = ill["ampacityCu75C"]
    for e in seed["equipment"]:
        tag, source = e["tag"], e["sourceSheet"] or "EXB-COBie.xlsx"
        eid = f"equipment:{tag}"
        parsed = parse_specs(e["specs"] or "")
        attrs = {}
        for key in ("category", "level", "manufacturer", "model", "serves", "specs", "ifcGuid"):
            if e.get(key):
                attrs[key] = fact(e[key], "as-built", source)
        for key, value in parsed.items():
            attrs[key] = fact(value, "as-built", source)
        node(eid, "Equipment", tag, attrs)
        if f"level:{e['level']}" in nodes:
            link(eid, f"level:{e['level']}", "locatedOn", "as-built", source)

        # Served areas (as-built text) for air handlers and condensing units.
        prefix = tag.split("-")[0]
        if prefix in ("RTU", "CU") and e["serves"] and "not on the part" not in e["serves"].lower():
            sid = f"servedarea:{slug(e['serves'])}"
            if sid not in served_seen:
                node(sid, "ServedArea", e["serves"], {})
                served_seen.add(sid)
            link(eid, sid, "serves", "as-built", source)

        if prefix in ("HWB", "HWP"):
            link(eid, f"pipeloop:{loop['id']}", "connects", "as-built", source)
        if prefix == "CU":
            lid = f"lineset:{tag}"
            node(lid, "LineSet", f"{tag} refrigerant line set", {
                "refrigerant": fact(ill["lineSets"]["refrigerant"], "illustrative", ILL_SRC),
            })
            link(eid, lid, "connects", "illustrative", ILL_SRC)

        if tag in ill["curbs"]:
            c = ill["curbs"][tag]
            node(f"curb:{tag}", "Curb", f"{tag} roof curb", {
                "loadLimitLb": fact(c["loadLimitLb"], "illustrative", ILL_SRC),
                "why": fact(c["why"], "illustrative", ILL_SRC),
            })
            link(eid, f"curb:{tag}", "supportedBy", "illustrative", ILL_SRC)
            link(f"curb:{tag}", f"roofzone:{c['zone']}", "supportedBy", "illustrative", ILL_SRC)

        # Electrical chain (illustrative), for equipment on a roof sheet.
        sheet = (e["sourceSheet"] or "").split(";")[0].strip()
        panel = panel_by_sheet.get(sheet)
        if not panel:
            continue
        assumed = False
        if "mopA" in parsed:
            breaker = next_size(ill["standardBreakersA"], parsed["mopA"])
            rule = f"{ILL_SRC}: breaker = MOP {parsed['mopA']} A ({source})"
        elif "flaA" in parsed:
            breaker = next_size(ill["standardBreakersA"], max(15, 1.25 * parsed["flaA"]))
            rule = f"{ILL_SRC}: breaker from FLA {parsed['flaA']} A ({source})"
        elif prefix in ill["assumedRatings"]:
            assumed = True
            breaker = next_size(ill["standardBreakersA"], ill["assumedRatings"][prefix]["mopA"])
            rule = f"{ILL_SRC}: assumed rating ({ill['assumedRatings'][prefix]['why']})"
        else:
            continue
        sets, size, amp = choose_feeder(breaker, table, ill["minimumConductor"])
        disc = next_size(ill["standardDisconnectsA"], breaker)
        b_attrs = {"ratingA": fact(breaker, "illustrative", rule), "poles": fact(3, "illustrative", ILL_SRC)}
        if assumed:
            b_attrs["ratingAssumed"] = fact(True, "illustrative", rule)
        node(f"breaker:{tag}", "Breaker", f"{tag} breaker in {panel}", b_attrs)
        node(f"feeder:{tag}", "Feeder", f"{tag} feeder", {
            "material": fact("Cu", "illustrative", ILL_SRC),
            "size": fact(size, "illustrative", f"{ILL_SRC}: NEC 310.16 75 C Cu, {amp} A per set"),
            "sets": fact(sets, "illustrative", ILL_SRC),
            "ampacityA": fact(sets * amp, "illustrative", ILL_SRC),
            "insulation": fact("THHN/THWN-2", "illustrative", ILL_SRC),
        })
        node(f"disconnect:{tag}", "Disconnect", f"{tag} disconnect", {
            "ratingA": fact(disc, "illustrative", ILL_SRC),
            "type": fact("Fusible, NEMA 3R", "illustrative", ILL_SRC),
        })
        link(f"panel:{panel}", f"breaker:{tag}", "feeds", "illustrative", ILL_SRC)
        link(f"breaker:{tag}", f"feeder:{tag}", "feeds", "illustrative", ILL_SRC)
        link(f"breaker:{tag}", f"feeder:{tag}", "protects", "illustrative", ILL_SRC)
        link(f"feeder:{tag}", f"disconnect:{tag}", "feeds", "illustrative", ILL_SRC)
        link(f"disconnect:{tag}", eid, "feeds", "illustrative", ILL_SRC)

    graph = {
        "schemaVersion": 1,
        "building": seed["building"]["name"],
        "about": ill["about"],
        "nodes": sorted(nodes.values(), key=lambda n: n["id"]),
        "links": sorted(links, key=lambda l: (l["from"], l["type"], l["to"])),
    }
    with open(OUT, "w") as fh:
        json.dump(graph, fh, indent=1, sort_keys=False)
        fh.write("\n")
    counts = {}
    for n in nodes.values():
        counts[n["type"]] = counts.get(n["type"], 0) + 1
    print(f"wrote {os.path.relpath(OUT, ROOT)}: {len(nodes)} nodes, {len(links)} links; "
          + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
