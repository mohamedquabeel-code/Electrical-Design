"""Text extraction and shared parsing helpers for catalogue ingest.

Extraction is deliberately text-based rather than geometric. The catalogue's
text layer is clean and the tables have a strict row grammar (a product code
followed by a fixed number of numeric fields), so parsing lines against that
grammar is both simpler and far easier to audit than reconstructing cells from
glyph coordinates. Anything that does not match the grammar is reported rather
than guessed at.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

import pypdfium2

# Product code, e.g. "CP1-T102-U04", "CXB-T101-U12", "CXG-TX01-K17".
PRODUCT_CODE = re.compile(r"^([A-Z]{2,4}[0-9]?-[A-Z0-9]{4}-[A-Z0-9]{3})\s+(.*)$")

# Conductor shape markers that sit between numeric fields and carry no value
# for the engine: re = round solid, rm = round stranded, sm = sector stranded.
SHAPE_MARKER = re.compile(r"\b(RE|RM|SM)\b", re.IGNORECASE)

NUMBER = re.compile(r"-?\d+(?:\.\d+)?")

# Section header, e.g. "3 core cables - CU/PVC/STA/PVC" or "1 Core - Cu/XLPE/PVC".
SECTION = re.compile(
    r"^(?P<cores>\d+)\s*core(?:\s+cables)?"
    r"(?P<reduced>\s+with\s+reduced\s+neutral)?"
    r"\s*-\s*(?P<construction>[A-Za-z/]+)\s*$",
    re.IGNORECASE,
)

# Voltage grade banner, e.g. "0.6/1 (1.2) KV Multi Core Unarmoured Cables".
VOLTAGE_GRADE = re.compile(r"(\d+\.?\d*)\s*/\s*(\d+\.?\d*)\s*\(\d+\.?\d*\)\s*[kK][vV]")


def sha256(path: Path) -> str:
    """Content hash of a source document, recorded in the dataset provenance."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def page_texts(path: Path) -> list[str]:
    """Extract the text layer of every page, one string per page."""
    document = pypdfium2.PdfDocument(str(path))
    try:
        return [document[i].get_textpage().get_text_range() for i in range(len(document))]
    finally:
        document.close()


def numbers(text: str) -> list[float]:
    """Every numeric literal in a fragment, in order."""
    return [float(match) for match in NUMBER.findall(text)]


def strip_shape_markers(text: str) -> str:
    """Remove RE/RM/SM conductor shape markers so field positions line up."""
    return SHAPE_MARKER.sub(" ", text)


@dataclass
class Problem:
    """Something the parser could not handle, surfaced instead of guessed at."""

    page: int
    detail: str
    line: str = ""


@dataclass
class Report:
    """Accumulates parse problems so ingest can fail loudly rather than quietly."""

    problems: list[Problem] = field(default_factory=list)

    def add(self, page: int, detail: str, line: str = "") -> None:
        self.problems.append(Problem(page=page, detail=detail, line=line.strip()))

    def __len__(self) -> int:
        return len(self.problems)
