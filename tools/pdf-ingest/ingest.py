#!/usr/bin/env python3
"""Build the versioned cable dataset from the source catalogue PDF.

Run from the repository root:

    python3 tools/pdf-ingest/ingest.py

Output is deterministic — no timestamps, sorted keys — so CI can regenerate the
datasets and assert that the committed JSON is byte-identical. That is what
makes the dataset provably derived from the PDF rather than hand-edited.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import cables  # noqa: E402
import general  # noqa: E402
import reactance as reactance_module  # noqa: E402
from extract import Report, page_texts, sha256  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_PDF = REPO_ROOT / "power-cables-catalogue.pdf"
OUTPUT_DIR = REPO_ROOT / "packages" / "standards-data" / "datasets" / "elsewedy-cables"
OVERRIDES = Path(__file__).parent / "overrides.json"

DATASET_ID = "elsewedy-cables"
# Bump when the parsing rules change in a way that alters output. Projects pin
# this, so an existing design keeps resolving against the build it was made with.
DATASET_VERSION = "1.0.0"

SOURCE_DOCUMENT = "Elsewedy Electric Power Cables Catalogue"


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False)
    path.write_text(text + "\n", encoding="utf-8")


def main() -> int:
    if not SOURCE_PDF.exists():
        print(f"error: source PDF not found at {SOURCE_PDF}", file=sys.stderr)
        return 1

    report = Report()
    pages = page_texts(SOURCE_PDF)
    digest = sha256(SOURCE_PDF)

    print(f"Reading {SOURCE_PDF.name} ({len(pages)} pages, sha256 {digest[:12]}...)")

    rows = cables.parse(pages, report)
    tables = general.parse_all(pages, report)
    quarantined = apply_overrides(rows, report)
    product_json = [row.to_json() for row in rows]
    derived_reactance = reactance_module.derive(product_json, tables, report)

    duplicates = _duplicate_codes(rows)
    for code, count in duplicates.items():
        report.add(0, f"product code {code!r} appears {count} times")

    write_json(
        OUTPUT_DIR / "cables.json",
        {
            "datasetId": DATASET_ID,
            "version": DATASET_VERSION,
            "products": product_json,
        },
    )
    write_json(
        OUTPUT_DIR / "general.json",
        {"datasetId": DATASET_ID, "version": DATASET_VERSION, "tables": tables},
    )
    write_json(
        OUTPUT_DIR / "derived-reactance.json",
        {
            "datasetId": DATASET_ID,
            "version": DATASET_VERSION,
            "reactance": derived_reactance,
        },
    )
    write_json(
        OUTPUT_DIR / "provenance.json",
        {
            "datasetId": DATASET_ID,
            "version": DATASET_VERSION,
            "source": {
                "document": SOURCE_DOCUMENT,
                "file": SOURCE_PDF.name,
                "sha256": digest,
                "pageCount": len(pages),
            },
            "coverage": {
                "cablePages": [cables.FIRST_CABLE_PAGE, cables.LAST_CABLE_PAGE],
                "generalTablePages": [17, 25],
                "excluded": {
                    "pages": [144, len(pages)],
                    "reason": (
                        "26/45 kV and above are outside the tool's declared "
                        "LV + MV (to 36 kV) scope and use a different table "
                        "layout, with ratings in a separate block from "
                        "construction data."
                    ),
                },
            },
            "referenceConditions": {
                "ambientAirTempC": 30,
                "groundTempC": 20,
                "soilThermalResistivityKmPerW": 1.0,
                "burialDepthM": 0.5,
                "ductInnerDiameterRatio": 1.5,
                "loadFactor": 1.0,
                "frequencyHz": 50,
                "ampacityBasis": "IEC 60287",
                "sourcePage": 16,
            },
            "tables": _table_provenance(tables),
            "quarantinedValues": quarantined,
        },
    )

    print(f"  products     {len(rows)}")
    print(f"  quarantined  {len(quarantined)} defective published value(s)")
    print(f"  reactance    derived for {_count_reactance(derived_reactance)} size(s)")
    print(f"  general      {len(tables)} table groups: {', '.join(sorted(tables))}")
    print(f"  written to   {OUTPUT_DIR.relative_to(REPO_ROOT)}")

    if len(report):
        print(f"\n{len(report)} parse problem(s):", file=sys.stderr)
        for problem in report.problems[:40]:
            location = f"p{problem.page}" if problem.page else "general"
            print(f"  [{location}] {problem.detail}", file=sys.stderr)
            if problem.line:
                print(f"        {problem.line[:110]}", file=sys.stderr)
        if len(report) > 40:
            print(f"  ... and {len(report) - 40} more", file=sys.stderr)
        return 1

    print("\nNo parse problems.")
    return 0


def apply_overrides(rows: list[cables.CableRow], report: Report) -> list[dict]:
    """Remove published values that review found to be defective.

    Values are dropped rather than corrected. Substituting a plausible figure
    would put a number into the dataset that no manufacturer ever published,
    and once there it is indistinguishable from real data. Leaving the cell
    empty means the engine has no rating for that cable in that condition and
    will not offer it, which is the safe direction to fail in.
    """
    if not OVERRIDES.exists():
        return []

    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    by_code = {row.product_code: row for row in rows}
    applied: list[dict] = []

    for entry in overrides.get("quarantine", []):
        row = by_code.get(entry["productCode"])
        if row is None:
            report.add(0, f"override targets unknown product {entry['productCode']!r}")
            continue

        parts = entry["field"].split(".")
        if parts[0] != "ampacity" or len(parts) != 3:
            report.add(0, f"unsupported override field {entry['field']!r}")
            continue

        _, condition, formation = parts
        published = row.ampacity.get(condition, {}).get(formation)
        if published is None:
            report.add(0, f"override {entry['productCode']} {entry['field']}: value absent")
            continue
        if published != entry["published"]:
            # The override records the exact value it was written against, so a
            # re-ingest that changes the parse cannot silently drop a different
            # number than the one that was reviewed.
            report.add(
                0,
                f"override {entry['productCode']} {entry['field']}: expected "
                f"{entry['published']} but dataset holds {published}",
            )
            continue

        del row.ampacity[condition][formation]
        if not row.ampacity[condition]:
            del row.ampacity[condition]
        applied.append(entry)

    return applied


def _count_reactance(derived: dict) -> int:
    total = 0
    for family in ("singleCore", "multiCore"):
        for insulations in derived.get(family, {}).values():
            for sizes in insulations.values():
                total += len(sizes)
    return total


def _duplicate_codes(rows: list[cables.CableRow]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.product_code] = counts.get(row.product_code, 0) + 1
    return {code: count for code, count in counts.items() if count > 1}


def _table_provenance(tables: dict[str, object]) -> dict[str, object]:
    """Map each general table group to its caption and page in the source."""
    catalogue = {
        "metals": ("Table 1 — Electrical properties of metals", 17),
        "temperatureDerating": ("Tables 3 & 4 — Air and ground temperature", 17),
        "burialDepth": ("Table 5 — Burial depth", 18),
        "soilResistivity": ("Table 6 — Soil thermal resistivity", 18),
        "pvcRatedTemperature": ("Table 7 — PVC rated temperature", 18),
        "groupingInGround": ("Tables 8 & 9 — Grouping laid direct in ground", 18),
        "shortCircuitTemperatures": ("Table 13 — Max short-circuit temperatures", 21),
        "shortCircuit": ("Tables 14-17 — Short-circuit current", 22),
        "voltageDrop": ("Tables 18-19 — Voltage drop mV/A/m", 24),
    }
    return {
        name: {"caption": caption, "page": page, "document": SOURCE_DOCUMENT}
        for name, (caption, page) in catalogue.items()
        if name in tables
    }


if __name__ == "__main__":
    raise SystemExit(main())
