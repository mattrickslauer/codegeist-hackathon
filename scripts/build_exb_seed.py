#!/usr/bin/env python3
"""Build the EXB seed (building, levels, equipment) the Forge app imports into Jira Assets.

    python3 -I scripts/build_exb_seed.py            # writes forge/src/seed/exb.json

Sources (samples/bim/exb/): COBie components and types (IFC GlobalIds, categories, manufacturers)
merged by tag with data/assets_mec.csv (specs, what each unit serves, level, grid, source sheet)
and data/levels.csv. Standard library only. Deterministic output (sorted), so diffs stay readable.
"""
import csv
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "samples", "bim", "exb")
OUT = os.path.join(ROOT, "forge", "src", "seed", "exb.json")

CATEGORY_LABELS = {
    "ahu": "Rooftop air handler", "boiler": "Boiler", "pump": "Pump", "cu": "Condensing unit",
    "ef": "Exhaust fan", "elevator": "Elevator",
}


def cobie_sheet(path, sheet):
    """Rows of one COBie sheet as dicts (header row → keys). Handles shared and inline strings."""
    with zipfile.ZipFile(path) as z:
        names = re.findall(r'<sheet [^>]*name="([^"]+)"', z.read("xl/workbook.xml").decode())
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            shared = [re.sub(r"<[^>]+>", "", s) for s in re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode(), re.S)]
        xml = z.read(f"xl/worksheets/sheet{names.index(sheet) + 1}.xml").decode()
    rows = []
    for row in re.findall(r"<row [^>]*>(.*?)</row>", xml, re.S):
        vals = []
        for attrs, inner in re.findall(r"<c ([^>]*)>(.*?)</c>", row, re.S):
            kind = re.search(r't="(\w+)"', attrs)
            v = re.search(r"<v>(.*?)</v>", inner)
            t = re.search(r"<t[^>]*>(.*?)</t>", inner)
            val = v.group(1) if v else (t.group(1) if t else "")
            if kind and kind.group(1) == "s" and val.isdigit():
                val = shared[int(val)]
            vals.append(val.replace("&amp;", "&").strip())
        rows.append(vals)
    header, data = rows[0], rows[1:]
    return [dict(zip(header, r)) for r in data if any(r)]


def clean(value):
    return "" if value in (None, "n/a") else value.strip()


def main():
    cobie = os.path.join(SRC, "EXB-COBie.xlsx")
    types = {t["Name"]: t for t in cobie_sheet(cobie, "Type")}
    components = {c["Name"]: c for c in cobie_sheet(cobie, "Component")}
    facility = cobie_sheet(cobie, "Facility")[0]

    with open(os.path.join(SRC, "data", "assets_mec.csv"), newline="") as fh:
        mec = {r["id"]: r for r in csv.DictReader(fh)}
    with open(os.path.join(SRC, "data", "levels.csv"), newline="") as fh:
        levels = [{"code": r["level"], "name": r["name"], "elevationFt": float(r["elev_ft"]), "heightFt": float(r["height_ft"])}
                  for r in csv.DictReader(fh)]

    equipment = []
    for tag in sorted(set(components) | set(mec), key=lambda t: (re.sub(r"\d", "", t), int(re.sub(r"\D", "", t) or 0))):
        comp = components.get(tag, {})
        row = mec.get(tag, {})
        ctype = types.get(comp.get("TypeName", ""), {})
        equipment.append({
            "tag": tag,
            "category": CATEGORY_LABELS.get(row.get("type", ""), clean(ctype.get("Category", "")) or "Equipment"),
            "system": clean(row.get("system", "")).upper() or "HVAC",
            "level": clean(row.get("level", "")) or clean(comp.get("Space", "")).split("-")[0],
            "serves": clean(row.get("name", "")),
            "manufacturer": clean(row.get("manufacturer", "")) or clean(ctype.get("Manufacturer", "")),
            "model": clean(row.get("model", "")) or clean(ctype.get("ModelNumber", "")),
            "specs": clean(row.get("specs", "")) or clean(comp.get("Description", "")),
            "sourceSheet": clean(row.get("sheet", "")),
            "grid": clean(row.get("grid", "")),
            "ifcGuid": clean(comp.get("ExtIdentifier", "")),
            "ifcClass": clean(comp.get("ExtObject", "")),
            "inCobie": bool(comp),
        })

    seed = {
        "schemaVersion": 1,
        "building": {
            "code": "EXB",
            "name": facility.get("Name", "Example Office Building"),
            "description": "Anonymised 5-storey office building with a parking structure. As-built IFC4 + COBie from record drawings.",
        },
        "levels": levels,
        "equipment": equipment,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(seed, fh, indent=2, sort_keys=False)
        fh.write("\n")
    print(f"wrote {os.path.relpath(OUT, ROOT)}: {len(levels)} levels, {len(equipment)} equipment "
          f"({sum(e['inCobie'] for e in equipment)} in COBie, {sum(bool(e['ifcGuid']) for e in equipment)} with IFC GlobalId)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
