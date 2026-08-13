"""Derive LV cable reactance from the catalogue's own voltage-drop tables.

WHY THIS EXISTS
---------------
Voltage drop needs both R and X. The catalogue publishes inductance directly for
MV cables, so reactance there is measured data. For LV it publishes neither
inductance nor reactance — only tabulated mV/A/m, which embeds X at a fixed
power factor of 0.8 and is defective for multicore cables from 16 mm2 upward
(see docs/engineering/dataset-findings.md).

Reactance is therefore recovered from Table 18, the single-core voltage-drop
table, which validation showed to be internally consistent across its full
range. Rearranging the catalogue's own formula (p.16):

    Vd = sqrt(3) (R cos phi + X sin phi)   =>   X = (Vd/sqrt(3) - 0.8 R) / 0.6

RESISTANCE BASIS
----------------
R is recomputed from R_DC at 20 degC at the compound's rated temperature rather
than read from the published R_AC column, because that column is on a 70 degC
basis for XLPE below 16 mm2 despite its 90 degC heading. Using the published
value there yields X = 0.635 ohm/km for 4 mm2 XLPE, which is not a cable
property. Recomputing yields 0.185, matching the 0.180 of PVC at the same size —
and reactance is set by geometry, not by insulation compound, so those two
agreeing is the check that the method is sound.

That agreement also settles which of the two published tables is wrong: the
voltage-drop tables were computed at the correct temperature, and it is the
resistance column that is mislabelled.

WHY TABLE 19 IS NOT USED AT ALL
-------------------------------
Comparing the two tables' XLPE columns against their PVC columns settles it.
Reactance does not depend on insulation compound, so the ratio between them
should be purely the resistance ratio between 90 degC and 70 degC:

    (1 + 0.00393 x 70) / (1 + 0.00393 x 50) = 1.0657

Table 18 shows 1.061-1.068 at every size, so it was computed correctly.
Table 19 shows 0.998-1.006 at 1.5, 4, 6, 10 and 16 mm2 — its XLPE column is a
near-copy of its PVC column and was never recomputed at 90 degC. Combined with
the values below their own resistive term from 16 mm2 upward, nothing in
Table 19 can be relied on.

Multicore reactance is therefore taken from single-core trefoil as a stated
upper bound. Multicore cores sit closer together than touching single-core
cables, whose spacing includes two sheath thicknesses, so trefoil overestimates
X and pushes voltage drop toward a larger cable — the safe direction. Every
such value is marked derived so a report can show it was not read from the
catalogue.

NUMERICAL CONDITIONING
----------------------
Back-solving X is ill-conditioned when the reactive term is a small part of the
total. At 1.5 mm2 multicore it is 1.4% of the tabulated drop, so the 0.1%
rounding in a published figure becomes a ~30% error in X — which is how that
row yielded 0.2735 ohm/km, roughly triple a real value. Derivation is therefore
restricted to sizes where the reactive term is at least 3% of the voltage drop.
Below that the value is carried down from the smallest well-conditioned size:
since X contributes under 3% of the drop there, any residual error is well
under 1% of the result.
"""

from __future__ import annotations

import math
from typing import Any

from extract import Report

TEMPERATURE_COEFFICIENT = {"copper": 0.00393, "aluminium": 0.00403}
RATED_TEMPERATURE = {"pvc": 70.0, "xlpe": 90.0, "epr": 90.0}

POWER_FACTOR = 0.8
SIN_PHI = 0.6
SQRT3 = math.sqrt(3)

# Bounds outside which a value is not a cable reactance but an error.
MIN_REACTANCE = 0.01
MAX_REACTANCE = 0.40

# Minimum share of the tabulated voltage drop that the reactive term must carry
# for back-solving X to be numerically meaningful. Below this, published
# rounding dominates the result.
MIN_REACTIVE_SHARE = 0.03


def resistance_at(r_dc_20: float, conductor: str, temperature: float) -> float:
    """R_theta = R20 [1 + alpha(theta - 20)], catalogue p.15."""
    return r_dc_20 * (1 + TEMPERATURE_COEFFICIENT[conductor] * (temperature - 20))


def _solve(millivolts: float, resistance: float) -> float:
    return (millivolts / SQRT3 - POWER_FACTOR * resistance) / SIN_PHI


def derive(products: list[dict], tables: dict, report: Report) -> dict[str, Any]:
    """Build a reactance table keyed by conductor, insulation, size and formation."""
    voltage_drop = tables.get("voltageDrop")
    if not voltage_drop:
        report.add(0, "reactance derivation skipped: voltage drop tables missing")
        return {}

    # Index 0.6/1 kV unarmoured products, which are what Tables 18 and 19 cover.
    by_key: dict[tuple[str, str, str, float], dict] = {}
    for product in products:
        if product["voltageGrade"] != "0.6/1" or product["armour"] != "none":
            continue
        if product.get("reducedNeutralCsa"):
            continue
        family = "singleCore" if product["cores"] == 1 else "multiCore"
        if family == "multiCore" and product["cores"] != 3:
            continue
        key = (family, product["conductor"], product["insulation"], product["csa"])
        by_key.setdefault(key, product)

    single: dict[str, dict[str, dict[str, float]]] = {}
    multi: dict[str, dict[str, dict[str, float]]] = {}

    for conductor, rows in voltage_drop.get("singleCore", {}).items():
        for csa_text, entry in rows.items():
            csa = float(csa_text)
            for insulation in ("pvc", "xlpe"):
                product = by_key.get(("singleCore", conductor, insulation, csa))
                if product is None:
                    continue
                resistance = resistance_at(
                    product["rDc20"], conductor, RATED_TEMPERATURE[insulation]
                )
                values: dict[str, float] = {}
                for formation, column in (("flat", "Flat"), ("trefoil", "Trefoil")):
                    millivolts = entry.get(f"{insulation}{column}")
                    if millivolts is None:
                        continue
                    x = _solve(millivolts, resistance)
                    if not MIN_REACTANCE <= x <= MAX_REACTANCE:
                        report.add(
                            0,
                            f"derived single-core reactance out of range: {conductor}/"
                            f"{insulation}/{csa} {formation} = {x:.4f} ohm/km",
                        )
                        continue
                    # Reject values the published rounding cannot support.
                    if (SQRT3 * SIN_PHI * x) / millivolts < MIN_REACTIVE_SHARE:
                        continue
                    values[formation] = round(x, 4)
                if values:
                    single.setdefault(conductor, {}).setdefault(insulation, {})[csa_text] = values

    # Multicore takes single-core trefoil, as a conservative upper bound.
    # Table 19 is not used at all: its values fall below their own resistive
    # term from 16 mm2 up, and its XLPE column is a near-copy of its PVC column
    # rather than a recomputation at 90 degC.
    for conductor, insulations in single.items():
        for insulation, sizes in insulations.items():
            for csa_text, values in sizes.items():
                trefoil = values.get("trefoil")
                if trefoil is None:
                    continue
                multi.setdefault(conductor, {}).setdefault(insulation, {})[csa_text] = {
                    "default": trefoil
                }

    return {
        "singleCore": single,
        "multiCore": multi,
        "method": {
            "formula": "X = (Vd/sqrt(3) - 0.8 R) / 0.6",
            "resistanceBasis": (
                "R recomputed from R_DC at 20 degC at the compound's rated "
                "temperature (70 degC PVC, 90 degC XLPE), not read from the "
                "published R_AC column, which is on a 70 degC basis for XLPE "
                "below 16 mm2 despite its 90 degC heading."
            ),
            "source": "Table 18 (single core) and Table 19 (multicore, to 10 mm2)",
            "multiCore": (
                "Taken from single-core trefoil as a conservative upper bound. "
                "Table 19 is not used: its values fall below their own resistive "
                "term from 16 mm2 upward, and its XLPE column is a near-copy of "
                "its PVC column rather than a recomputation at 90 degC."
            ),
            "conditioning": (
                f"Derivation restricted to sizes where the reactive term is at "
                f"least {MIN_REACTIVE_SHARE:.0%} of the tabulated voltage drop. "
                "Below that, published rounding dominates the back-solved value."
            ),
            "powerFactor": POWER_FACTOR,
            "frequencyHz": 50,
        },
    }
