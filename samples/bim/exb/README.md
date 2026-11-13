# EXB: Example Office Building (as-built IFC4 + COBie)

An **anonymised real building**: a 5-storey office building with a parking structure. These files were generated from its 2014–2015 record (as-built) drawings by our partner's *AsBuilt* pipeline (drawings → take-off → IFC4 + COBie). Received 2026-11-09.

**Keep it anonymous.** No building name, address, owner, designer or people's names may appear in any file, video or submission text. The address in the files is a placeholder (`123 Main Street, Anytown`), and the contact is `contact@example.com`. The source drawings are not in this repository. An anonymity scan of these files on 2026-11-09 was clean.

| File | Contents | Status |
|---|---|---|
| `EXB-ARC.ifc` | Architecture: 8 storeys (L1–L5, ROOF, SITE, PS = parking structure), 125 walls, 12 slabs, 4 elevators, structural grid | ✅ usable |
| `EXB-MEC.ifc` | HVAC: 26 equipment items with property sets: RTU-1..4 (Mammoth rooftop AHUs), CU-1..8 (Daikin VRF condensing units), EF-* exhaust fans (7), HWB-1/2 (RBI CB2000 boilers), HWP-1/2 (Bell & Gossett pumps) | ✅ usable |
| `EXB-ELE.ifc`, `EXB-PLB.ifc`, `EXB-FIR.ifc` | Spatial structure only; **no elements yet** | ⏳ requested from partner |
| `EXB-COBie.xlsx` | COBie handover workbook: 28 components (`ExtIdentifier` = IFC GlobalId), 7 types (manufacturer/model), 126 attributes. `System` and `Connection` sheets are **empty** | ✅ components; ⏳ systems |
| `data/*.csv` | The take-off tables the IFC/COBie were generated from (equipment specs with source sheet refs, levels, grid, footprint) | ✅ |

## Illustrative design (not part of the as-built record)

The take-off has no electrical, plumbing or structural connections, so Walkdown's demo uses an **illustrative** design written by us: `illustrative.json`. It holds the main switchboard, two roof panels split by drawing sheet (E3.06A north, E3.06B south), roof zones and curbs with load limits, line sets and the heating hot water loop. It also holds the rules that derive each breaker, feeder and disconnect from the units' **real** MOP/FLA ratings (NEC 240.6 standard sizes, NEC 310.16 75 °C copper ampacities).

`scripts/build_exb_graph.py` merges it with the as-built equipment into `forge/src/seed/exb-graph.json`. Every fact keeps its provenance: `as-built` (with its sheet) or `illustrative`. The app shows that label and the Rovo agent says it out loud. The north roof panel RDP-N is deliberately close to full (1,005 A of breakers on a 1,200 A bus), and RTU-2's curb has only about 11% spare capacity, so an RTU-2 upgrade shows realistic knock-on work. **None of this is the real building's electrical or structural design.**

**Requested from the partner:** electrical, plumbing and fire elements; COBie System + Connection data (what serves what); a GLB export with objects named by tag; written OK to show the anonymised building in a public hackathon submission.

| File | SHA-256 |
|---|---|
| EXB-ARC.ifc | `e2026f937400e45a36ccfa15c06189f34260782552efaee6e37786e333aa191d` |
| EXB-MEC.ifc | `73a4bb777e1b0295d3793005185470a502c51341f88220aef4e76e43325781ab` |
| EXB-ELE.ifc | `e775b3c67343ac71d3c61760b4f73717ff8e0f9804056f3cb77ed569b4cce1d5` |
| EXB-PLB.ifc | `c9d71a10b7cc4ca65cff604f14e404c3faed5765a578b7ecb83ff6ba8d8bce88` |
| EXB-FIR.ifc | `ff88908d5708e11926f1c3209a1deb9e1cc60e6d18edb31bb5a2adb56795f198` |
| EXB-COBie.xlsx | `54cb1c4a1b698c1135cbfbc36e200d1a12b5b6b2050589fee4d3ca8b86d33e53` |
