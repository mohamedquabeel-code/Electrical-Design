# Dataset findings — Elsewedy Power Cables Catalogue

Recorded during Phase 0 ingest of `power-cables-catalogue.pdf`
(167 pages, sha256 `b4317601a700…`), which produced **1,974 product rows** across
pages 59–141 and nine general table groups from pages 17–25.

These findings affect how the engine may use the data, so they are reproduced in
the assumptions register of any calculation report generated from this dataset.

---

## 1. The catalogue does not cover IEC 60364-5-52 reference methods

The catalogue publishes ampacities for three installation conditions — **in
ground, in duct, in free air** — computed per **IEC 60287** under the reference
conditions on p.16 (air 30 °C, ground 20 °C, soil thermal resistivity
1.0 K·m/W, burial depth 0.5 m, duct inner diameter 1.5 × cable OD, unity load
factor, 50 Hz).

Final circuits inside a building are designed against IEC 60364-5-52 **reference
methods A1–G** (in conduit in an insulated wall, in trunking, clipped direct, on
a tray, spaced from a surface). A domestic socket circuit in conduit in a wall is
Method B1, and the catalogue has no column for it.

**Consequence.** Two ampacity datasets are required, and the engine must not mix
them. `DesignBasis` on every circuit records which applies. Using a free-air
rating for a cable buried in wall insulation would oversize the result badly.

---

## 2. Table 19 (multicore voltage drop) is unusable at 16 mm² and above

For multicore copper PVC at 16 mm², the catalogue's own resistance column gives
R_AC at 70 °C = 1.39 Ω/km. The resistive term alone is therefore

    sqrt(3) × 1.39 × 0.8 = 1.926 mV/A/m

yet Table 19 lists **1.275 mV/A/m** — below its own resistive component, which is
not physically possible at any reactance. The same holds at 25 mm² (1.206
computed against 0.957 listed) and upward. The step from 10 mm² (3.101) to
16 mm² (1.275) is a discontinuity no real cable exhibits.

Rows from 1.5 to 10 mm² are self-consistent, back-solving to reactances of
roughly 0.06–0.11 Ω/km.

Table 18 (single-core) **is** self-consistent: 25 mm² flat back-solves to
X = 0.146 Ω/km and trefoil to 0.088 Ω/km, both physically sensible, and flat
correctly exceeds trefoil.

**Consequence.** The engine computes voltage drop from **R and X** via
`Vd = √3·I·L·(R cos φ + X sin φ)`, never from the tabulated mV/A/m. This avoids
the defective rows and removes the tables' fixed power factor of 0.8, so any
power factor can be handled. The published values are retained in the dataset
only as a cross-check.

---

## 3. Small XLPE sizes carry resistance on a 70 °C basis, not 90 °C

Below 16 mm², skin and proximity effects are negligible, so R_AC/R_DC is
essentially pure temperature rise and the implied conductor temperature can be
read directly:

| CSA (mm²) | Implied temperature | Column heading |
|---|---|---|
| 1.5 | 72.6 °C | 90 °C |
| 2.5 | 70.1 °C | 90 °C |
| 4 | 71.3 °C | 90 °C |
| 6 | 70.4 °C | 90 °C |
| 10 | 70.1 °C | 90 °C |
| 16 | 73.1 °C (some rows reach 90 °C) | 90 °C |

The small XLPE rows appear to carry AC resistance computed on the PVC basis.

**Consequence.** Using resistance at 70 °C for a cable operating at 90 °C
understates voltage drop by roughly 8 %. The engine recomputes resistance at the
actual operating temperature from R_DC at 20 °C using
`R_θ = R₂₀[1 + α(θ − 20)]` (α = 0.00393 Cu, 0.00403 Al, catalogue Table 1)
rather than trusting the published R_AC column for these sizes.

---

## 4. Five published ampacities are defective and have been quarantined

Each was confirmed against the PDF page. Values are **removed, never replaced** —
substituting a plausible figure would put a number in the dataset that no
manufacturer published, and once there it is indistinguishable from real data.
With the cell absent the engine has no rating for that cable in that condition
and will not offer it, which fails safe.

| Product | Field | Published | Page | Why it is wrong |
|---|---|---|---|---|
| `CP1-T101-U10` | freeAir / flatTouching | 9 A | 61 | Between 48 A at 6 mm² and 85 A at 16 mm². Dropped digit. |
| `CXB-T101-B12` | ground / flat | 468 A | 114 | Same row's trefoil column reads 160 A; 35 mm² reads 203 A. ~2.3× too high. |
| `CXB-T101-B15` | freeAir / flatTouching | 234 A | 114 | Between 235 A at 50 mm² and 292 A at 95 mm². |
| `CX2-T101-B15` | freeAir / trefoilTouching | 500 A | 120 | Between 241 A at 50 mm² and 364 A at 95 mm². ~1.7× too high. |
| `CX5-T101-B60` | duct | 720 A | 138 | Between 733 A at 500 mm² and 929 A at 800 mm². |

The two marked "too high" are the dangerous direction: accepting them would let
the engine select a badly undersized cable.

To resolve any of these, obtain the correct figure from Elsewedy and add a
`replace` entry in `tools/pdf-ingest/overrides.json` citing the source.

---

## 5. What the ingest deliberately excludes

Pages 144–167 cover 26/45 kV and above. These are outside the tool's declared
LV + MV (to 36 kV) scope and use a different table layout, with current ratings
in a block separate from the construction data. They are recorded as excluded in
`provenance.json` rather than partially parsed.

---

## 6. A parser bug this validation caught

Page 60 (flexible copper conductors) carries an extra **"Maximum Diameter of
Wires"** column between the conductor size and the resistances. Its rows
therefore hold eight numeric fields — the same count as an LV multicore row — and
were initially matched to the multicore layout, shifting every value one column
to the left. The 1.5 mm² row came through with R_DC = 0.26 Ω/km (the wire
diameter) instead of 13.3.

The parse was clean and the JSON well-formed; nothing about the output looked
wrong. It surfaced only because the implied-temperature check found an
R_AC/R_DC ratio of 51 where physics allows about 1.2.

This is the reason the pipeline recomputes every derived quantity from an
independent relation instead of trusting a successful parse.

---

## Validation checks now enforced

Run by `python3 tools/pdf-ingest/validate.py`, failing on any finding not in
`tools/pdf-ingest/baseline.json`:

| Check | Relation |
|---|---|
| `resistance.impliedTemperature` | R_AC/R_DC implies the temperature the column claims |
| `voltageDrop.inconsistentWithResistance` | mV/A/m cannot fall below its own resistive term |
| `shortCircuit.sqrtTRelation` | I(t) = I(1 s)/√t, as the catalogue states on p.16 |
| `resistance.notMonotonic` | resistance falls as conductor size rises |
| `ampacity.notMonotonic` | ampacity rises as conductor size rises |
| `reactance.implausible` | derived reactance within 0.01–0.40 Ω/km |
| `reactance.formationOrder` | flat spacing exceeds trefoil, since conductors sit further apart |

CI additionally regenerates the datasets and asserts the committed JSON is
byte-identical, so the data is provably derived from the PDF rather than
hand-edited.
