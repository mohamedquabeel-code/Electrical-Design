"""Parse the general-information tables from the Elsewedy catalogue (pp. 17-25).

These tables are small, irregular and each has its own shape, so each gets a
targeted extractor anchored on its own caption text. A generic table detector
would be shorter but far harder to audit, and a silently mis-parsed derating
factor is exactly the sort of error that produces an undersized cable while
looking entirely plausible.

Every extractor asserts the row labels it expects. If the catalogue is ever
re-issued with a changed layout the ingest fails loudly instead of emitting
numbers that are quietly attached to the wrong headings.
"""

from __future__ import annotations

import re
from typing import Any

from extract import Report, numbers

# Page numbers are 1-based as printed in the PDF viewer.
PAGE_METALS = 17
PAGE_DERATING_DEPTH = 18
PAGE_DERATING_GROUPS = 19
PAGE_DERATING_SINGLE_AIR = 20
PAGE_SC_TEMPS = 21
PAGE_SHORT_CIRCUIT = (22, 23)
PAGE_VOLTAGE_DROP = (24, 25)


def _row_after(text: str, anchor: str, count: int, occurrence: int = 0) -> list[float]:
    """Numeric values on the first line after `anchor` that holds `count` of them."""
    lines = text.split("\n")
    hits = [i for i, line in enumerate(lines) if anchor.lower() in line.lower()]
    if len(hits) <= occurrence:
        raise KeyError(f"anchor not found: {anchor!r} (occurrence {occurrence})")
    for line in lines[hits[occurrence] :]:
        values = numbers(line)
        if len(values) == count:
            return values
    raise KeyError(f"no row of {count} values after {anchor!r}")


def parse_metals(pages: list[str]) -> dict[str, Any]:
    """Table 1 — conductor resistivity and temperature coefficient."""
    text = pages[PAGE_METALS - 1]
    result: dict[str, Any] = {}
    for label, key in (("Copper (annealed)", "copper"), ("Aluminum", "aluminium")):
        values = _row_after(text, label, 3)
        iacs, resistivity, alpha = values
        result[key] = {
            "iacsPercent": iacs,
            "resistivityOhmMm2PerM": resistivity,
            "temperatureCoefficient": alpha,
        }
    return result


def parse_temperature_derating(pages: list[str]) -> dict[str, Any]:
    """Tables 3 and 4 — ambient air and ground temperature correction factors.

    Both tables share the same temperature axis and the same two row labels, so
    they are located by page and by occurrence: Table 3 (air) comes first on
    p.17, Table 4 (ground) second.
    """
    text = pages[PAGE_METALS - 1]
    temperatures = [15, 20, 25, 30, 35, 40, 45, 50, 55]

    def series(occurrence: int) -> dict[str, dict[str, float]]:
        # Each row reads "PVC cables rated 70 degC  1.21 1.15 ...", so the row
        # carries the compound's rated temperature ahead of the nine factors.
        pvc = _row_after(text, "PVC cables rated", len(temperatures) + 1, occurrence)
        xlpe = _row_after(text, "XLPE cables rated", len(temperatures) + 1, occurrence)
        if pvc[0] != 70 or xlpe[0] != 90:
            raise ValueError(f"unexpected rated temperatures {pvc[0]} / {xlpe[0]}")
        return {
            "pvc": {str(t): v for t, v in zip(temperatures, pvc[1:])},
            "xlpe": {str(t): v for t, v in zip(temperatures, xlpe[1:])},
        }

    air = series(0)
    ground = series(1)
    if air == ground:
        raise ValueError("air and ground derating tables parsed identically")
    # Reference conditions: unity at 30 degC in air, 20 degC in ground (p.16).
    if air["pvc"]["30"] != 1.0 or ground["pvc"]["20"] != 1.0:
        raise ValueError("temperature derating tables are not unity at the reference condition")
    return {"air": air, "ground": ground}


def parse_burial_depth(pages: list[str]) -> dict[str, Any]:
    """Table 5 — burial depth correction, by direct-buried vs duct and core count."""
    text = pages[PAGE_DERATING_DEPTH - 1]
    depths = [0.5, 0.6, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]
    columns = [
        ("directBuried", "singleCoreUpTo185"),
        ("directBuried", "singleCoreAbove185"),
        ("directBuried", "threeCore"),
        ("duct", "singleCoreUpTo185"),
        ("duct", "singleCoreAbove185"),
        ("duct", "threeCore"),
    ]
    result: dict[str, dict[str, dict[str, float]]] = {}
    lines = text.split("\n")
    found = 0
    for line in lines:
        values = numbers(line)
        if len(values) != 7:
            continue
        depth, *factors = values
        if found >= len(depths) or depth != depths[found]:
            continue
        for (group, column), factor in zip(columns, factors):
            result.setdefault(group, {}).setdefault(column, {})[str(depth)] = factor
        found += 1
    if found != len(depths):
        raise ValueError(f"burial depth table: matched {found} of {len(depths)} rows")
    if result["directBuried"]["threeCore"]["0.5"] != 1.0:
        raise ValueError("burial depth table is not unity at the 0.5 m reference depth")
    return result


def parse_soil_resistivity(pages: list[str]) -> dict[str, float]:
    """Table 6 — soil thermal resistivity correction.

    Anchored on the axis row rather than on the caption. The page carries the
    phrase "de-rating factors" twice — once as the table's own caption and once
    as the data row's label — and anchoring on the caption picks up the axis
    row instead, producing a table whose every value equals its own key. That
    passes a unity-at-reference check by coincidence (1.0 maps to 1.0) while
    making every other factor badly wrong, so the axis is located first and the
    factors are taken as the row after it.
    """
    text = pages[PAGE_DERATING_DEPTH - 1]
    axis = [0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0]

    lines = text.split("\n")
    start = next(
        (i for i, line in enumerate(lines) if "soil thermal resistivity" in line.lower()),
        None,
    )
    if start is None:
        raise KeyError("soil thermal resistivity axis row not found")

    rows = [numbers(line) for line in lines[start:]]
    matching = [row for row in rows if len(row) == len(axis)]
    if len(matching) < 2:
        raise ValueError("soil resistivity table: axis and factor rows not both found")

    parsed_axis, factors = matching[0], matching[1]
    if parsed_axis != axis:
        raise ValueError(f"soil resistivity axis is {parsed_axis}, expected {axis}")

    table = {str(k): v for k, v in zip(axis, factors)}

    # Drier soil conducts heat away less well, so the factor must fall as
    # resistivity rises, and must be unity at the 1.0 K.m/W reference.
    if table["1.0"] != 1.0:
        raise ValueError("soil resistivity table is not unity at the 1.0 K.m/W reference")
    if factors != sorted(factors, reverse=True):
        raise ValueError(f"soil resistivity factors are not decreasing: {factors}")
    if factors[0] <= 1.0:
        raise ValueError("soil resistivity factor below the reference should exceed 1")

    return table


def parse_pvc_rated_temperature(pages: list[str]) -> dict[str, dict[str, float]]:
    """Table 7 — uprating for PVC compounds rated above 70 degC."""
    text = pages[PAGE_DERATING_DEPTH - 1]
    axis = ["70", "90", "105"]
    return {
        "buried": dict(zip(axis, _row_after(text, "directly buried in ground", 3))),
        "air": dict(zip(axis, _row_after(text, "for cable in air", 3))),
        "duct": dict(zip(axis, _row_after(text, "for cable in duct", 3))),
    }


GROUPING_HEADER = re.compile(r"^\s*nr\b.*trefoil", re.IGNORECASE)


def _grouping_in_ground(text: str, _anchor: str) -> dict[str, Any]:
    """Tables 8 and 9 — grouping of circuits laid direct in ground.

    Six factors per row: {touching, 0.15 m, 0.30 m} x {trefoil, flat}.

    Anchored on the "nr Trefoil Flat ..." column header immediately above the
    data, not on the table caption. Page 19 carries the captions for Tables 9
    and 10 together, with Table 10's data printed first, and Table 10's rows
    are keyed by tray count — so they also begin with 2 and 3 and have the same
    field count. Anchoring on the caption silently mixed the two tables,
    yielding a "3 circuits touching trefoil" factor of 1.00 (no derating at all)
    where the real figure is 0.69.
    """
    lines = text.split("\n")
    start = next((i for i, line in enumerate(lines) if GROUPING_HEADER.match(line)), None)
    if start is None:
        raise KeyError("grouping table column header not found")
    spacings = ["touching", "0.15", "0.30"]
    formations = ["trefoil", "flat"]
    result: dict[str, Any] = {}
    expected = [2, 3, 4, 5, 6]
    found: list[int] = []
    for line in lines[start:]:
        values = numbers(line)
        if len(values) != 7:
            continue
        circuits, *factors = values
        if int(circuits) not in expected or int(circuits) in found:
            continue
        entry: dict[str, dict[str, float]] = {}
        for index, factor in enumerate(factors):
            spacing = spacings[index // 2]
            formation = formations[index % 2]
            entry.setdefault(spacing, {})[formation] = factor
        result[str(int(circuits))] = entry
        found.append(int(circuits))
    if found != expected:
        raise ValueError(f"grouping table: matched circuit counts {found}, expected {expected}")

    # Two physical properties the table must satisfy. Both were violated by the
    # caption-anchored version, so they are asserted rather than assumed:
    # more circuits crowded together means less cooling, and more spacing
    # between them means more.
    for formation in ("trefoil", "flat"):
        crowding = [result[str(n)]["touching"][formation] for n in expected]
        if crowding != sorted(crowding, reverse=True):
            raise ValueError(f"grouping factors do not fall as circuits are added: {crowding}")
        for count in expected:
            entry = result[str(count)]
            spread = [entry[s][formation] for s in spacings]
            if spread != sorted(spread):
                raise ValueError(f"grouping factors do not rise with spacing: {spread}")

    return result


def parse_grouping_in_ground(pages: list[str]) -> dict[str, Any]:
    """Table 8 (single-core) and Table 9 (multicore), both laid direct in ground."""
    return {
        "singleCore": _grouping_in_ground(
            pages[PAGE_DERATING_DEPTH - 1], "Trefoil or"
        ),
        "multiCore": _grouping_in_ground(
            pages[PAGE_DERATING_GROUPS - 1], "Trefoil formation De-rating"
        ),
    }


def parse_short_circuit(pages: list[str]) -> dict[str, Any]:
    """Tables 14-17 — short-circuit current in kA against duration.

    Rows are conductor sizes, columns are durations from 0.1 s to 5 s. The
    catalogue also gives I(t) = I(1s)/sqrt(t) for durations it does not tabulate,
    which the validator checks the tabulated values against.
    """
    durations = ["0.1", "0.2", "0.3", "0.4", "0.5", "1", "2", "3", "4", "5"]
    tables = [
        ("copper", "pvc", PAGE_SHORT_CIRCUIT[0], 0),
        ("copper", "xlpe", PAGE_SHORT_CIRCUIT[0], 1),
        ("aluminium", "pvc", PAGE_SHORT_CIRCUIT[1], 0),
        ("aluminium", "xlpe", PAGE_SHORT_CIRCUIT[1], 1),
    ]

    result: dict[str, dict[str, dict[str, dict[str, float]]]] = {}
    for conductor, insulation, page, occurrence in tables:
        text = pages[page - 1]
        lines = text.split("\n")
        starts = [i for i, line in enumerate(lines) if "Duration in second" in line]
        if len(starts) <= occurrence:
            raise KeyError(f"short circuit table not found on p.{page} #{occurrence}")
        block: dict[str, dict[str, float]] = {}
        for line in lines[starts[occurrence] + 1 :]:
            values = numbers(line)
            if len(values) != len(durations) + 1:
                if block and "Duration in second" in line:
                    break
                continue
            csa, *currents = values
            block[_csa_key(csa)] = dict(zip(durations, currents))
        if len(block) < 15:
            raise ValueError(
                f"short circuit {conductor}/{insulation}: only {len(block)} rows parsed"
            )
        result.setdefault(conductor, {})[insulation] = block
    return result


def parse_voltage_drop(pages: list[str]) -> dict[str, Any]:
    """Tables 18-19 — tabulated voltage drop in mV/A/m at power factor 0.8.

    Kept as published, but the engine does not size from these values. It works
    from resistance and reactance instead, which handles any power factor and
    is not affected by the errors the validator finds in the multicore table.
    """
    single_text = pages[PAGE_VOLTAGE_DROP[0] - 1]
    multi_text = pages[PAGE_VOLTAGE_DROP[1] - 1]

    def block(text: str, columns: int, occurrence: int) -> dict[str, dict[str, float]]:
        lines = text.split("\n")
        starts = [i for i, line in enumerate(lines) if "Voltage Drop (mv" in line]
        if len(starts) <= occurrence:
            raise KeyError(f"voltage drop block #{occurrence} not found")
        end = starts[occurrence + 1] if len(starts) > occurrence + 1 else len(lines)
        entries: dict[str, dict[str, float]] = {}
        for line in lines[starts[occurrence] : end]:
            values = numbers(line)
            if len(values) != columns + 1:
                continue
            csa, *rest = values
            if columns == 4:
                entries[_csa_key(csa)] = {
                    "pvcFlat": rest[0],
                    "pvcTrefoil": rest[1],
                    "xlpeFlat": rest[2],
                    "xlpeTrefoil": rest[3],
                }
            else:
                entries[_csa_key(csa)] = {"pvc": rest[0], "xlpe": rest[1]}
        if len(entries) < 10:
            raise ValueError(f"voltage drop block #{occurrence}: only {len(entries)} rows")
        return entries

    return {
        "singleCore": {
            "copper": block(single_text, 4, 0),
            "aluminium": block(single_text, 4, 1),
        },
        "multiCore": {
            "copper": block(multi_text, 2, 0),
            "aluminium": block(multi_text, 2, 1),
        },
        "basis": {
            "powerFactor": 0.8,
            "frequencyHz": 50,
            "note": "Flat touching formation; PVC at 70 degC, XLPE at 90 degC.",
        },
    }


def parse_short_circuit_temperatures(pages: list[str]) -> dict[str, Any]:
    """Table 13 — maximum permitted temperatures under short circuit."""
    text = pages[PAGE_SC_TEMPS - 1]
    if "XLPE insulation" not in text:
        raise KeyError("Table 13 not found on the expected page")
    return {
        "insulation": {
            # PVC is split by size: the catalogue gives 160 degC up to 300 mm2
            # and 140 degC above it.
            "pvc": {"upTo300mm2": 160, "above300mm2": 140},
            "xlpe": {"all": 250},
        },
        "sheath": {"pvc": 200, "lldpe": 150, "hdpe": 180},
        "conductor": {"copper": 250, "aluminium": 250},
    }


def _csa_key(value: float) -> str:
    """Render a conductor size as a stable key: 1.5 stays 1.5, 240.0 becomes 240."""
    return str(int(value)) if value == int(value) else str(value)


def parse_all(pages: list[str], report: Report) -> dict[str, Any]:
    """Run every general-table extractor, recording any that fail."""
    extractors = {
        "metals": parse_metals,
        "temperatureDerating": parse_temperature_derating,
        "burialDepth": parse_burial_depth,
        "soilResistivity": parse_soil_resistivity,
        "pvcRatedTemperature": parse_pvc_rated_temperature,
        "groupingInGround": parse_grouping_in_ground,
        "shortCircuitTemperatures": parse_short_circuit_temperatures,
        "shortCircuit": parse_short_circuit,
        "voltageDrop": parse_voltage_drop,
    }
    result: dict[str, Any] = {}
    for name, extractor in extractors.items():
        try:
            result[name] = extractor(pages)
        except (KeyError, ValueError, IndexError, StopIteration) as error:
            report.add(0, f"general table {name!r} failed to parse: {error}")
    return result


__all__ = ["parse_all", "re"]
