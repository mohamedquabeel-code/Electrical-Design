#!/usr/bin/env python3
"""Validate the generated cable dataset against physical consistency relations.

Run from the repository root:

    python3 tools/pdf-ingest/validate.py

Digitised engineering tables must never be trusted on the strength of a clean
parse. A column read one position to the left still produces well-formed JSON,
and a transcription error in an ampacity or a resistance yields a cable that
looks correctly sized and is not. So every derived quantity is recomputed from
an independent relation and compared:

  * resistance ratio      R_AC/R_DC implies a conductor temperature, which must
                          match the temperature the column header states
  * voltage drop          the published mV/A/m must be consistent with the
                          published resistance, since Vd = k(R cos phi + X sin phi)
                          cannot be smaller than its own resistive term
  * short circuit         tabulated I(t) must satisfy I(t) = I(1s)/sqrt(t)
  * monotonicity          resistance falls and ampacity rises with conductor size
  * reactance             derived from MV inductance, must be physically plausible

Findings are compared against `baseline.json`, which records anomalies already
reviewed and accepted as defects in the source document. Anything not in the
baseline fails the run, so a future re-ingest cannot quietly introduce an error.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATASET_DIR = REPO_ROOT / "packages" / "standards-data" / "datasets" / "elsewedy-cables"
BASELINE = Path(__file__).parent / "baseline.json"
REVIEW_DIR = Path(__file__).parent / "out" / "review"

TEMPERATURE_COEFFICIENT = {"copper": 0.00393, "aluminium": 0.00403}
RATED_TEMPERATURE = {"pvc": 70.0, "xlpe": 90.0, "epr": 90.0}

# Reactance bounds for LV and MV power cables, ohm/km. Anything outside this is
# not a cable property, it is a data or parsing error.
MIN_REACTANCE = 0.01
MAX_REACTANCE = 0.40


@dataclass(frozen=True, order=True)
class Finding:
    check: str
    subject: str
    severity: str
    detail: str

    def key(self) -> str:
        return f"{self.check}::{self.subject}"


def load(name: str) -> dict:
    return json.loads((DATASET_DIR / name).read_text(encoding="utf-8"))


def check_resistance_ratio(products: list[dict]) -> list[Finding]:
    """R_AC/R_DC implies a conductor temperature; it must match the header.

    Skin and proximity effects are negligible at small sizes, so below 16 mm2
    the ratio is essentially pure temperature rise and the implied temperature
    can be compared directly against the compound's rating.
    """
    findings: list[Finding] = []
    grouped: dict[tuple[str, float], list[float]] = defaultdict(list)

    for product in products:
        if product["csa"] > 16:
            continue
        alpha = TEMPERATURE_COEFFICIENT[product["conductor"]]
        implied = 20 + (product["rAcMax"] / product["rDc20"] - 1) / alpha
        grouped[(product["insulation"], product["csa"])].append(implied)

    for (insulation, csa), values in sorted(grouped.items()):
        rated = RATED_TEMPERATURE[insulation]
        worst = max(values, key=lambda value: abs(value - rated))
        if abs(worst - rated) > 5:
            findings.append(
                Finding(
                    check="resistance.impliedTemperature",
                    subject=f"{insulation}/{csa}",
                    severity="error",
                    detail=(
                        f"R_AC/R_DC implies {worst:.1f} degC for {csa} mm2 {insulation}, "
                        f"but the column is headed {rated:.0f} degC. Using resistance at "
                        f"the wrong temperature misstates voltage drop."
                    ),
                )
            )
    return findings


def _reactance_from_voltage_drop(millivolts: float, resistance: float, phases: float) -> float:
    """Back-solve X from a tabulated mV/A/m figure at power factor 0.8.

    Vd = k(R cos phi + X sin phi) with k = sqrt(3) three phase, 2 single phase.
    """
    return (millivolts / phases - 0.8 * resistance) / 0.6


def check_voltage_drop(products: list[dict], tables: dict) -> list[Finding]:
    """Published mV/A/m must be consistent with published resistance."""
    findings: list[Finding] = []
    voltage_drop = tables.get("voltageDrop")
    if not voltage_drop:
        return findings

    # Index resistance by (cores-family, conductor, insulation, csa) using the
    # 0.6/1 kV unarmoured products, which are what the voltage-drop tables cover.
    resistance: dict[tuple[str, str, str, float], float] = {}
    for product in products:
        if product["voltageGrade"] != "0.6/1" or product["armour"] != "none":
            continue
        family = "singleCore" if product["cores"] == 1 else "multiCore"
        if family == "multiCore" and product["cores"] != 3:
            continue
        if product.get("reducedNeutralCsa"):
            continue
        key = (family, product["conductor"], product["insulation"], product["csa"])
        resistance.setdefault(key, product["rAcMax"])

    columns = {
        "pvcFlat": ("pvc", math.sqrt(3)),
        "pvcTrefoil": ("pvc", math.sqrt(3)),
        "xlpeFlat": ("xlpe", math.sqrt(3)),
        "xlpeTrefoil": ("xlpe", math.sqrt(3)),
        "pvc": ("pvc", math.sqrt(3)),
        "xlpe": ("xlpe", math.sqrt(3)),
    }

    for family in ("singleCore", "multiCore"):
        for conductor, rows in voltage_drop.get(family, {}).items():
            for csa_text, entry in sorted(rows.items(), key=lambda item: float(item[0])):
                csa = float(csa_text)
                for column, millivolts in entry.items():
                    insulation, phases = columns[column]
                    key = (family, conductor, insulation, csa)
                    if key not in resistance:
                        continue
                    r = resistance[key]
                    x_three = _reactance_from_voltage_drop(millivolts, r, phases)
                    x_single = _reactance_from_voltage_drop(millivolts, r, 2.0)
                    if any(MIN_REACTANCE <= x <= MAX_REACTANCE for x in (x_three, x_single)):
                        continue
                    resistive_only = phases * 0.8 * r
                    findings.append(
                        Finding(
                            check="voltageDrop.inconsistentWithResistance",
                            subject=f"{family}/{conductor}/{column}/{csa_text}",
                            severity="error",
                            detail=(
                                f"Tabulated {millivolts} mV/A/m against R_AC {r} ohm/km implies "
                                f"reactance {x_three:.4f} ohm/km (three phase) or "
                                f"{x_single:.4f} ohm/km (single phase), both outside "
                                f"{MIN_REACTANCE}-{MAX_REACTANCE}. The resistive term alone is "
                                f"{resistive_only:.3f} mV/A/m."
                            ),
                        )
                    )
    return findings


def check_short_circuit(tables: dict) -> list[Finding]:
    """Tabulated I(t) must follow I(t) = I(1s)/sqrt(t), as the catalogue states.

    Small currents are skipped: the table is rounded to 0.1 kA, so at 0.2 kA the
    rounding alone is 25% and the relation cannot be tested meaningfully.
    """
    findings: list[Finding] = []
    for conductor, insulations in sorted(tables.get("shortCircuit", {}).items()):
        for insulation, rows in sorted(insulations.items()):
            for csa, durations in sorted(rows.items(), key=lambda item: float(item[0])):
                one_second = durations.get("1")
                if not one_second or one_second < 5:
                    continue
                for duration_text, current in durations.items():
                    duration = float(duration_text)
                    expected = one_second / math.sqrt(duration)
                    if expected == 0:
                        continue
                    error = abs(current - expected) / expected
                    if error > 0.02:
                        findings.append(
                            Finding(
                                check="shortCircuit.sqrtTRelation",
                                subject=f"{conductor}/{insulation}/{csa}/{duration_text}s",
                                severity="error",
                                detail=(
                                    f"Tabulated {current} kA at {duration_text} s, but "
                                    f"I(1s)/sqrt(t) = {expected:.2f} kA ({error:.1%} apart)."
                                ),
                            )
                        )
    return findings


def check_monotonicity(products: list[dict]) -> list[Finding]:
    """Within one product family, resistance must fall and ampacity must rise."""
    findings: list[Finding] = []
    families: dict[tuple, list[dict]] = defaultdict(list)
    for product in products:
        if product.get("reducedNeutralCsa"):
            continue
        key = (
            product["voltageGrade"],
            product["conductor"],
            product["insulation"],
            product["armour"],
            product["cores"],
            product["sourcePage"],
        )
        families[key].append(product)

    for key, rows in sorted(families.items()):
        rows.sort(key=lambda row: row["csa"])
        label = "/".join(str(part) for part in key)

        for previous, current in zip(rows, rows[1:]):
            # Some pages list solid and stranded variants of the same size, which
            # legitimately share a resistance. Only strictly increasing sizes are
            # required to show a strictly falling resistance.
            if current["csa"] == previous["csa"]:
                continue
            if current["rDc20"] >= previous["rDc20"]:
                findings.append(
                    Finding(
                        check="resistance.notMonotonic",
                        subject=f"{label}/{previous['csa']}->{current['csa']}",
                        severity="error",
                        detail=(
                            f"R_DC does not fall with size: {previous['rDc20']} then "
                            f"{current['rDc20']} ohm/km."
                        ),
                    )
                )

        for condition in ("ground", "duct", "freeAir"):
            for formation in ("default", "flat", "trefoil", "flatTouching", "trefoilTouching"):
                series = [
                    (row["csa"], row["ampacity"].get(condition, {}).get(formation))
                    for row in rows
                ]
                series = [(csa, value) for csa, value in series if value is not None]
                for (previous_csa, previous), (current_csa, current) in zip(series, series[1:]):
                    if current_csa == previous_csa:
                        continue
                    if current < previous:
                        findings.append(
                            Finding(
                                check="ampacity.notMonotonic",
                                subject=f"{label}/{condition}/{formation}/"
                                f"{previous_csa}->{current_csa}",
                                severity="error",
                                detail=(
                                    f"Ampacity falls as size rises: {previous} A at "
                                    f"{previous_csa} mm2 then {current} A at {current_csa} mm2."
                                ),
                            )
                        )
    return findings


def check_reactance(products: list[dict]) -> list[Finding]:
    """Reactance derived from published MV inductance must be plausible."""
    findings: list[Finding] = []
    for product in products:
        for formation, value in product.get("reactance", {}).items():
            if not MIN_REACTANCE <= value <= MAX_REACTANCE:
                findings.append(
                    Finding(
                        check="reactance.implausible",
                        subject=f"{product['productCode']}/{formation}",
                        severity="error",
                        detail=(
                            f"Derived reactance {value} ohm/km is outside "
                            f"{MIN_REACTANCE}-{MAX_REACTANCE} ohm/km."
                        ),
                    )
                )
        # Flat spacing always gives more inductance than trefoil, because the
        # conductors sit further apart. A reversal means the columns are swapped.
        reactance = product.get("reactance", {})
        if "flat" in reactance and "trefoil" in reactance:
            if reactance["flat"] <= reactance["trefoil"]:
                findings.append(
                    Finding(
                        check="reactance.formationOrder",
                        subject=product["productCode"],
                        severity="error",
                        detail=(
                            f"Flat reactance {reactance['flat']} is not greater than trefoil "
                            f"{reactance['trefoil']}; the formation columns may be swapped."
                        ),
                    )
                )
    return findings


def write_review(products: list[dict], findings: list[Finding]) -> Path:
    """Emit an HTML page grouping parsed rows by source page for sign-off.

    Digitised values are only trustworthy once a person has compared them
    against the original, so the pipeline produces the page that makes that
    comparison quick: one section per PDF page, in the catalogue's own order.
    """
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    by_page: dict[int, list[dict]] = defaultdict(list)
    for product in products:
        by_page[product["sourcePage"]].append(product)

    flagged = {finding.subject.split("/")[0] for finding in findings}

    parts = [
        "<!doctype html><meta charset='utf-8'>",
        "<title>Cable dataset review</title>",
        "<style>",
        "body{font:14px/1.5 system-ui,sans-serif;margin:2rem;max-width:1200px}",
        "h2{margin-top:2.5rem;border-bottom:2px solid #333;padding-bottom:.3rem}",
        "table{border-collapse:collapse;width:100%;margin:.5rem 0 2rem}",
        "th,td{border:1px solid #ccc;padding:.25rem .5rem;text-align:right;font-size:13px}",
        "th{background:#f4f4f4;text-align:center}",
        "td:first-child,td:nth-child(2){text-align:left;font-family:ui-monospace,monospace}",
        "tr.flagged{background:#fff3cd}",
        ".summary{background:#f8f8f8;padding:1rem;border-left:4px solid #666}",
        "</style>",
        "<h1>Elsewedy Power Cables Catalogue — parsed dataset</h1>",
        "<div class='summary'>",
        f"<p><strong>{len(products)}</strong> product rows across ",
        f"<strong>{len(by_page)}</strong> pages. ",
        f"<strong>{len(findings)}</strong> validation finding(s).</p>",
        "<p>Compare each table against the corresponding page of the PDF. ",
        "Highlighted rows carry a validation finding.</p>",
        "</div>",
    ]

    for page in sorted(by_page):
        rows = by_page[page]
        parts.append(f"<h2>Page {page}</h2>")
        parts.append(
            "<table><tr><th>Product code</th><th>Construction</th><th>mm²</th>"
            "<th>R<sub>DC</sub>20</th><th>R<sub>AC</sub>max</th>"
            "<th>Ampacity (A)</th><th>Ø mm</th><th>kg/km</th></tr>"
        )
        for row in rows:
            construction = (
                f"{row['conductor'][:2].upper()}/{row['insulation'].upper()}"
                f"{'/' + row['armour'].upper() if row['armour'] != 'none' else ''}"
                f" {row['cores']}c {row['voltageGrade']}kV"
            )
            ampacity = ", ".join(
                f"{condition[:2]}:{'/'.join(str(int(v)) for v in formations.values())}"
                for condition, formations in sorted(row["ampacity"].items())
            )
            css = " class='flagged'" if row["productCode"] in flagged else ""
            parts.append(
                f"<tr{css}><td>{row['productCode']}</td><td>{construction}</td>"
                f"<td>{row['csa']}</td><td>{row['rDc20']}</td><td>{row['rAcMax']}</td>"
                f"<td>{ampacity}</td><td>{row.get('overallDiameter', '')}</td>"
                f"<td>{row.get('weight', '')}</td></tr>"
            )
        parts.append("</table>")

    path = REVIEW_DIR / "cables.html"
    path.write_text("\n".join(parts), encoding="utf-8")
    return path


def main() -> int:
    products = load("cables.json")["products"]
    tables = load("general.json")["tables"]

    findings: list[Finding] = []
    findings += check_resistance_ratio(products)
    findings += check_voltage_drop(products, tables)
    findings += check_short_circuit(tables)
    findings += check_monotonicity(products)
    findings += check_reactance(products)
    findings.sort()

    review = write_review(products, findings)

    accepted = set()
    if BASELINE.exists():
        baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
        accepted = {entry["key"] for entry in baseline["accepted"]}

    new = [finding for finding in findings if finding.key() not in accepted]
    known = len(findings) - len(new)

    print(f"Validated {len(products)} products.")
    print(f"  findings         {len(findings)}")
    print(f"  known/accepted   {known}")
    print(f"  new              {len(new)}")
    print(f"  review page      {review.relative_to(REPO_ROOT)}")

    (REVIEW_DIR / "findings.json").write_text(
        json.dumps([asdict(finding) for finding in findings], indent=2) + "\n",
        encoding="utf-8",
    )

    if new:
        print("\nNew findings not present in baseline.json:", file=sys.stderr)
        for finding in new[:30]:
            print(f"  [{finding.check}] {finding.subject}", file=sys.stderr)
            print(f"      {finding.detail}", file=sys.stderr)
        if len(new) > 30:
            print(f"  ... and {len(new) - 30} more", file=sys.stderr)
        print(
            "\nEach must be reviewed against the PDF and either fixed in the "
            "parser or recorded in baseline.json with a justification.",
            file=sys.stderr,
        )
        return 1

    print("\nNo new findings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
