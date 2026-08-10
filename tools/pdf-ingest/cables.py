"""Parse cable product rows from the Elsewedy Power Cables Catalogue.

COLUMN SCHEMAS
--------------
The catalogue uses five distinct row layouts. Each is identified by the number
of numeric fields in a data row together with whether the page publishes
capacitance and inductance:

  indoor450     7  csa, rDc20, rAc70, aFree, aPipe, diameter, weight
  lvMulticore   8  csa, rDc20, rAcMax, aGround, aDuct, aFreeAir, diameter, weight
  lvSingleCore 11  csa, rDc20, rAcMax,
                   aGroundFlat, aGroundTrefoil, aDuct,
                   aAirFlatSpaced, aAirFlatTouching, aAirTrefoilTouching,
                   diameter, weight
  mvMulticore  10  csa, rDc20, rAc90, capacitance, inductance,
                   aGround, aDuct, aFreeAir, diameter, weight
  mvSingleCore 13  csa, rDc20, rAc90, capacitance,
                   inductanceTrefoil, inductanceFlat,
                   aGroundFlat, aGroundTrefoil, aDuct,
                   aAirFlatTouching, aAirTrefoilTouching,
                   diameter, weight

Ampacities are kept per formation rather than collapsed to one figure per
installation condition. Trefoil and flat ratings differ materially — the
catalogue lists 0.6/1 kV 240 mm2 single-core copper at 622 A flat-touching
against 602 A trefoil-touching in free air — and the formation is a decision the
engineer makes, so flattening it would discard a real input.

MV pages publish inductance directly, which means reactance there is measured
data rather than something this pipeline has to infer. That is also what makes
the LV reactance derivation checkable: the same method applied to MV rows can be
compared against the published inductance.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any

from extract import (
    PRODUCT_CODE,
    SECTION,
    VOLTAGE_GRADE,
    Report,
    numbers,
    strip_shape_markers,
)

# Cable pages within the plan's LV + MV scope. Pages 144 onward are 26/45 kV and
# above, which are outside the tool's declared scope and use a different table
# layout (construction dimensions with ratings in a separate block), so they are
# recorded as skipped rather than partially parsed.
FIRST_CABLE_PAGE = 59
LAST_CABLE_PAGE = 141

MATERIALS = {"CU": "copper", "AL": "aluminium"}
INSULATIONS = {"PVC": "pvc", "XLPE": "xlpe", "XPLE": "xlpe", "EPR": "epr"}
ARMOURS = {"STA": "sta", "SWA": "swa", "ATA": "ata", "AWA": "awa"}
SHEATHS = {"PVC": "pvc", "LSZH": "lszh", "PE": "pe"}

# Nominal system frequency for the catalogue data (p.16).
FREQUENCY_HZ = 50.0


@dataclass
class Section:
    """Construction context established by a section header."""

    cores: int
    conductor: str
    insulation: str
    armour: str
    sheath: str
    reduced_neutral: bool


@dataclass
class CableRow:
    product_code: str
    csa: float
    conductor: str
    insulation: str
    armour: str
    sheath: str
    voltage_grade: str
    cores: int
    r_dc_20: float
    r_ac_max: float
    ampacity: dict[str, dict[str, float]]
    source_page: int
    reduced_neutral_csa: float | None = None
    capacitance: float | None = None
    inductance: dict[str, float] = field(default_factory=dict)
    reactance: dict[str, float] = field(default_factory=dict)
    overall_diameter: float | None = None
    weight: float | None = None

    def to_json(self) -> dict[str, Any]:
        record = asdict(self)
        return {key: value for key, value in record.items() if value not in (None, {}, [])}


def parse_construction(text: str) -> tuple[str, str, str, str] | None:
    """Decode "CU/PVC/STA/PVC" into conductor, insulation, armour and sheath.

    Three parts means unarmoured; four means the third is the armour. Anything
    else is reported rather than assumed, because a wrong armour assignment
    changes both the ampacity family and the fault-loop impedance.
    """
    parts = [part.strip().upper() for part in text.split("/") if part.strip()]
    if len(parts) == 3:
        conductor, insulation, sheath = parts
        armour = "none"
    elif len(parts) == 4:
        conductor, insulation, armour_code, sheath = parts
        armour = ARMOURS.get(armour_code, "")
        if not armour:
            return None
    else:
        return None

    if conductor not in MATERIALS or insulation not in INSULATIONS or sheath not in SHEATHS:
        return None
    return MATERIALS[conductor], INSULATIONS[insulation], armour, SHEATHS[sheath]


def reactance_from_inductance(inductance_mh_per_km: float) -> float:
    """X = 2*pi*f*L, with L in mH/km, giving ohm/km."""
    return 2 * math.pi * FREQUENCY_HZ * inductance_mh_per_km * 1e-3


def _ampacity(pairs: list[tuple[str, str, float]]) -> dict[str, dict[str, float]]:
    """Group (condition, formation, value) triples, dropping zero entries."""
    result: dict[str, dict[str, float]] = {}
    for condition, formation, value in pairs:
        if value > 0:
            result.setdefault(condition, {})[formation] = value
    return result


def _build(
    schema: str, values: list[float]
) -> tuple[dict[str, dict[str, float]], dict[str, float], float | None, float | None, float | None]:
    """Map a row's numeric fields onto ampacities, inductance, diameter, weight."""
    if schema == "indoor450":
        _csa, _r_dc, _r_ac, free, pipe, diameter, weight = values
        return (
            _ampacity([("freeAir", "default", free), ("conduit", "default", pipe)]),
            {},
            None,
            diameter,
            weight,
        )

    if schema == "flexible450":
        # Flexible conductors carry an extra "maximum diameter of wires" column
        # between the size and the resistances. Without handling it separately
        # the row has the same field count as an LV multicore row and every
        # value lands one column to the left.
        _csa, _wire_diameter, _r_dc, _r_ac, free, pipe, diameter, weight = values
        return (
            _ampacity([("freeAir", "default", free), ("conduit", "default", pipe)]),
            {},
            None,
            diameter,
            weight,
        )

    if schema == "lvMulticore":
        _csa, _r_dc, _r_ac, ground, duct, air, diameter, weight = values
        return (
            _ampacity(
                [
                    ("ground", "default", ground),
                    ("duct", "default", duct),
                    ("freeAir", "default", air),
                ]
            ),
            {},
            None,
            diameter,
            weight,
        )

    if schema == "lvSingleCore":
        (
            _csa,
            _r_dc,
            _r_ac,
            ground_flat,
            ground_trefoil,
            duct,
            air_flat_spaced,
            air_flat_touching,
            air_trefoil_touching,
            diameter,
            weight,
        ) = values
        return (
            _ampacity(
                [
                    ("ground", "flat", ground_flat),
                    ("ground", "trefoil", ground_trefoil),
                    ("duct", "default", duct),
                    ("freeAir", "flatSpaced", air_flat_spaced),
                    ("freeAir", "flatTouching", air_flat_touching),
                    ("freeAir", "trefoilTouching", air_trefoil_touching),
                ]
            ),
            {},
            None,
            diameter,
            weight,
        )

    if schema == "mvMulticore":
        (
            _csa,
            _r_dc,
            _r_ac,
            capacitance,
            inductance,
            ground,
            duct,
            air,
            diameter,
            weight,
        ) = values
        return (
            _ampacity(
                [
                    ("ground", "default", ground),
                    ("duct", "default", duct),
                    ("freeAir", "default", air),
                ]
            ),
            {"default": inductance},
            capacitance,
            diameter,
            weight,
        )

    if schema == "mvSingleCore":
        (
            _csa,
            _r_dc,
            _r_ac,
            capacitance,
            inductance_trefoil,
            inductance_flat,
            ground_flat,
            ground_trefoil,
            duct,
            air_flat_touching,
            air_trefoil_touching,
            diameter,
            weight,
        ) = values
        return (
            _ampacity(
                [
                    ("ground", "flat", ground_flat),
                    ("ground", "trefoil", ground_trefoil),
                    ("duct", "default", duct),
                    ("freeAir", "flatTouching", air_flat_touching),
                    ("freeAir", "trefoilTouching", air_trefoil_touching),
                ]
            ),
            {"trefoil": inductance_trefoil, "flat": inductance_flat},
            capacitance,
            diameter,
            weight,
        )

    raise ValueError(f"unknown schema {schema}")


SCHEMA_FIELD_COUNT = {
    "indoor450": 7,
    "flexible450": 8,
    "lvMulticore": 8,
    "lvSingleCore": 11,
    "mvMulticore": 10,
    "mvSingleCore": 13,
}

# Header fragment marking the extra wire-diameter column on flexible-conductor
# pages. It collides with the LV multicore field count, so the header decides.
WIRE_DIAMETER_HEADER = "of Wires"

# Index of the DC resistance within a row's numeric fields. Every layout puts
# the conductor size first and the resistances immediately after, except the
# flexible-conductor pages, which insert a wire-diameter column between them.
RESISTANCE_INDEX = {schema: 1 for schema in SCHEMA_FIELD_COUNT}
RESISTANCE_INDEX["flexible450"] = 2


def detect_schema(page_text: str, cores: int, field_count: int) -> str | None:
    """Pick the row layout from the field count and the page's own column headers."""
    has_capacitance = "Capacitance" in page_text
    has_wire_diameter = WIRE_DIAMETER_HEADER in page_text

    if field_count == SCHEMA_FIELD_COUNT["flexible450"]:
        return "flexible450" if has_wire_diameter else "lvMulticore"

    candidates = [
        name
        for name, count in SCHEMA_FIELD_COUNT.items()
        if count == field_count
        and (name.startswith("mv") == has_capacitance or name.endswith("450"))
    ]
    if len(candidates) == 1:
        return candidates[0]
    # Fall back on the core count to break a tie between single and multicore.
    single = cores == 1
    for name in candidates:
        if ("SingleCore" in name) == single:
            return name
    return None


def parse_reduced_neutral(rest: str) -> tuple[list[float], float] | None:
    """Parse a "4 core with reduced neutral" row.

    These rows pair the phase and neutral values in the first three columns,
    e.g. "25 RM / 16 RM   0.727 / 1.15   0.8702 / 1.3762   130 95 103 22.6 1170".
    The neutral figures are kept (the reduced neutral CSA is retained on the
    record) but the phase figures drive sizing, so the pairs are unzipped and
    only the phase side continues into the normal field sequence.
    """
    cleaned = strip_shape_markers(rest)
    chunks = [chunk.strip() for chunk in cleaned.split("/")]
    if len(chunks) != 4:
        return None

    # chunks: "25", "16 0.727", "1.15 0.8702", "1.3762 130 95 103 22.6 1170"
    head = numbers(chunks[0])
    second = numbers(chunks[1])
    third = numbers(chunks[2])
    tail = numbers(chunks[3])
    if not (head and len(second) >= 2 and len(third) >= 2 and len(tail) >= 2):
        return None

    csa = head[0]
    neutral_csa = second[0]
    r_dc = second[1]
    r_ac = third[1]
    remainder = tail[1:]
    return [csa, r_dc, r_ac, *remainder], neutral_csa


def parse(pages: list[str], report: Report) -> list[CableRow]:
    """Parse every in-scope cable page into product rows."""
    rows: list[CableRow] = []
    voltage_grade = ""
    section: Section | None = None

    for index in range(FIRST_CABLE_PAGE - 1, min(LAST_CABLE_PAGE, len(pages))):
        page_number = index + 1
        text = pages[index]

        banner = VOLTAGE_GRADE.search(text)
        if banner:
            voltage_grade = f"{_trim(banner.group(1))}/{_trim(banner.group(2))}"
        elif page_number <= 60:
            voltage_grade = "450/750"

        for line in text.split("\n"):
            stripped = line.strip()

            header = SECTION.match(stripped)
            if header:
                construction = parse_construction(header.group("construction"))
                if construction is None:
                    report.add(page_number, "unrecognised construction", stripped)
                    section = None
                    continue
                conductor, insulation, armour, sheath = construction
                section = Section(
                    cores=int(header.group("cores")),
                    conductor=conductor,
                    insulation=insulation,
                    armour=armour,
                    sheath=sheath,
                    reduced_neutral=bool(header.group("reduced")),
                )
                continue

            match = PRODUCT_CODE.match(stripped)
            if not match:
                continue

            product_code, rest = match.group(1), match.group(2)

            if section is None:
                # The 450/750 V indoor wire pages carry the construction in the
                # page description rather than a section header.
                if page_number <= 60:
                    section = Section(1, "copper", "pvc", "none", "pvc", False)
                else:
                    report.add(page_number, "product row before any section header", stripped)
                    continue

            neutral_csa: float | None = None
            if "/" in rest:
                parsed = parse_reduced_neutral(rest)
                if parsed is None:
                    report.add(page_number, "unparsable reduced-neutral row", stripped)
                    continue
                values, neutral_csa = parsed
            else:
                values = numbers(strip_shape_markers(rest))

            schema = detect_schema(text, section.cores, len(values))
            if schema is None:
                report.add(
                    page_number,
                    f"no column schema matches {len(values)} numeric fields",
                    stripped,
                )
                continue

            ampacity, inductance, capacitance, diameter, weight = _build(schema, values)
            resistance_at = RESISTANCE_INDEX[schema]
            reactance = {
                formation: round(reactance_from_inductance(value), 6)
                for formation, value in inductance.items()
            }

            rows.append(
                CableRow(
                    product_code=product_code,
                    csa=values[0],
                    conductor=section.conductor,
                    insulation=section.insulation,
                    armour=section.armour,
                    sheath=section.sheath,
                    voltage_grade=voltage_grade,
                    cores=section.cores,
                    r_dc_20=values[resistance_at],
                    r_ac_max=values[resistance_at + 1],
                    ampacity=ampacity,
                    source_page=page_number,
                    reduced_neutral_csa=neutral_csa,
                    capacitance=capacitance,
                    inductance=inductance,
                    reactance=reactance,
                    overall_diameter=diameter,
                    weight=weight,
                )
            )

    return rows


def _trim(value: str) -> str:
    """Render "0.6" and "18" without trailing zeros, matching the catalogue."""
    number = float(value)
    return str(int(number)) if number == int(number) else str(number)
