#!/usr/bin/env python3
"""Convert the EXB as-built IFC (architecture + mechanical) into one GLB the app ships with.

    python3 -m venv .venv-bim && .venv-bim/bin/pip install ifcopenshell==0.8.5
    .venv-bim/bin/python -I scripts/build_exb_model.py        # → forge/static/workspace/public/models/exb.glb

Every IFC product becomes one glTF node named by its IFC Name (equipment = its tag, e.g. "RTU-1"), with
`extras` { tag, ifcClass, category, guid } so the viewer can map a click to the equipment record.
Geometry is triangulated by IfcOpenShell in world coordinates (metres), converted from IFC Z-up to glTF Y-up,
and de-indexed with flat normals (the model is small: a few thousand triangles).
Colours by category; architectural elements are semi-transparent so rooftop equipment stays visible.
"""
import json
import math
import os
import struct
import sys

import ifcopenshell
import ifcopenshell.geom

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "samples", "bim", "exb")
OUT = os.path.join(ROOT, "forge", "static", "workspace", "public", "models", "exb.glb")
FILES = ["EXB-ARC.ifc", "EXB-MEC.ifc"]

# category → (rgba, is_equipment)
STYLE = {
    "IfcWall": ((0.80, 0.82, 0.86, 0.22), False),
    "IfcSlab": ((0.70, 0.73, 0.78, 0.35), False),
    "IfcTransportElement": ((0.55, 0.60, 0.68, 0.6), True),
    "IfcUnitaryEquipment": ((0.62, 0.66, 0.72, 1.0), True),
    "IfcFan": ((0.62, 0.66, 0.72, 1.0), True),
    "IfcBoiler": ((0.62, 0.66, 0.72, 1.0), True),
    "IfcPump": ((0.62, 0.66, 0.72, 1.0), True),
}
DEFAULT_STYLE = ((0.7, 0.7, 0.7, 1.0), False)


def triangulate(path):
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    f = ifcopenshell.open(path)
    it = ifcopenshell.geom.iterator(settings, f)
    if not it.initialize():
        return
    while True:
        s = it.get()
        product = f.by_guid(s.guid)
        yield {
            "name": s.name or s.type,
            "type": s.type,
            "guid": s.guid,
            "verts": list(s.geometry.verts),
            "faces": list(s.geometry.faces),
            "category": (getattr(product, "ObjectType", None) or "") if product else "",
        }
        if not it.next():
            break


def flat_mesh(verts, faces):
    """De-index triangles, convert Z-up → Y-up, compute per-face normals."""
    pos, nor = [], []
    for i in range(0, len(faces), 3):
        tri = []
        for k in range(3):
            j = faces[i + k] * 3
            x, y, z = verts[j], verts[j + 1], verts[j + 2]
            tri.append((x, z, -y))  # IFC (x, y, z up) → glTF (x, y up, z toward viewer)
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = tri
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        n = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        for p in tri:
            pos.extend(p)
            nor.extend((nx / n, ny / n, nz / n))
    return pos, nor


def build():
    products = [p for name in FILES for p in triangulate(os.path.join(SRC, name)) if p["faces"]]

    # Centre the model on the origin (x/z) with its base at y = 0, so the viewer frames it nicely.
    xs, ys, zs = [], [], []
    meshes = []
    for p in products:
        pos, nor = flat_mesh(p["verts"], p["faces"])
        meshes.append((p, pos, nor))
        xs.extend(pos[0::3]); ys.extend(pos[1::3]); zs.extend(pos[2::3])
    cx, cz, base = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2, min(ys)

    gltf = {"asset": {"version": "2.0", "generator": "Walkdown: build_exb_model.py (IfcOpenShell)"},
            "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "materials": [],
            "accessors": [], "bufferViews": [], "buffers": []}
    blob = bytearray()
    material_index = {}

    def material_for(ifc_type):
        rgba, _ = STYLE.get(ifc_type, DEFAULT_STYLE)
        if ifc_type not in material_index:
            m = {"name": ifc_type, "pbrMetallicRoughness": {"baseColorFactor": list(rgba), "metallicFactor": 0.0, "roughnessFactor": 0.85}}
            if rgba[3] < 1.0:
                m["alphaMode"] = "BLEND"
                m["doubleSided"] = True
            material_index[ifc_type] = len(gltf["materials"])
            gltf["materials"].append(m)
        return material_index[ifc_type]

    def add_view(data, target):
        while len(blob) % 4:
            blob.append(0)
        offset = len(blob)
        blob.extend(data)
        gltf["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(data), "target": target})
        return len(gltf["bufferViews"]) - 1

    for p, pos, nor in meshes:
        pos = [v - (cx if i % 3 == 0 else base if i % 3 == 1 else cz) for i, v in enumerate(pos)]
        count = len(pos) // 3
        pv = add_view(struct.pack(f"<{len(pos)}f", *pos), 34962)
        nv = add_view(struct.pack(f"<{len(nor)}f", *nor), 34962)
        mins = [min(pos[k::3]) for k in range(3)]
        maxs = [max(pos[k::3]) for k in range(3)]
        gltf["accessors"].append({"bufferView": pv, "componentType": 5126, "count": count, "type": "VEC3", "min": mins, "max": maxs})
        gltf["accessors"].append({"bufferView": nv, "componentType": 5126, "count": count, "type": "VEC3"})
        a = len(gltf["accessors"])
        gltf["meshes"].append({"name": p["name"], "primitives": [{"attributes": {"POSITION": a - 2, "NORMAL": a - 1}, "material": material_for(p["type"])}]})
        _, is_equipment = STYLE.get(p["type"], DEFAULT_STYLE)
        extras = {"ifcClass": p["type"], "guid": p["guid"]}
        if is_equipment:
            extras["tag"] = p["name"]
        gltf["nodes"].append({"name": p["name"], "mesh": len(gltf["meshes"]) - 1, "extras": extras})
        gltf["scenes"][0]["nodes"].append(len(gltf["nodes"]) - 1)

    while len(blob) % 4:
        blob.append(0)
    gltf["buffers"].append({"byteLength": len(blob)})
    js = json.dumps(gltf, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    glb = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(blob))
    glb += struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(blob), b"BIN\x00") + bytes(blob)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as fh:
        fh.write(glb)
    tags = sorted(n["extras"]["tag"] for n in gltf["nodes"] if "tag" in n["extras"])
    tris = sum(len(pos) // 9 for _, pos, _ in meshes)
    print(f"wrote {os.path.relpath(OUT, ROOT)}: {len(glb) / 1024:.0f} KB, {len(gltf['nodes'])} objects, {tris} triangles, "
          f"{len(tags)} tagged equipment: {', '.join(tags)}")
    return 0


if __name__ == "__main__":
    sys.exit(build())
