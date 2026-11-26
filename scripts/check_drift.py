#!/usr/bin/env python3
"""Drift-Wächter von poker: Entscheidungen und Doku bleiben beim Code.

Aus der fleet-Vorlage (fleet-Repo docs/projekt-anbinden.md „Regeln für die Doku“). Läuft in der
schnellen Prüfstufe; Exit 1 bei Fund, `--list` zeigt alle Funde ohne Exit-Code.

1. Die Zeile `Status:` jeder ADR beginnt mit `aktiv`, `vorgeschlagen`, `ersetzt durch NNNN`
   oder `teilw. ersetzt durch NNNN`; jedes Ziel von `ersetzt durch` gibt es. Auf dem
   Feature-Branch darf dort der Platzhalter der neuen ADR stehen, solange ihre Datei da ist.
2. Gemergt heißt gebaut: `vorgeschlagen` nur für die jüngsten `VORSCHLAG_FRIST` Nummern oder
   mit dem Ticket, auf das die ADR wartet (`vorgeschlagen, Bau #12`).
3. Ablösen in beide Richtungen: sagt eine ADR `ersetzt 0003` oder `löst 0003 ab`, nennt ADR 0003
   sie in ihrer Zeile `Status:`.
4. `ABGELOEST`: Begriffe für Zustände, die es nicht mehr gibt, mit Grund und den Dateien des
   aktuellen Stands, in denen sie nicht mehr stehen dürfen.
"""

from __future__ import annotations

import fnmatch
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADR_DIR = ROOT / "docs" / "adr"
PLACEHOLDER = "X" * 4  # zur Laufzeit gebaut: der Merge-Zug ersetzt den Platzhalter nicht hier
VORSCHLAG_FRIST = 15

# Eine Nummer oder, auf dem Feature-Branch, der Platzhalter der neuen ADR; den Platzhalter gibt es
# nur, solange seine Datei da ist, sonst meldet Regel 1 das Ziel als fehlend.
NR = rf"(?:\d{{4}}|{PLACEHOLDER})"
STATUS_START = re.compile(rf"^(aktiv|vorgeschlagen|ersetzt durch {NR}|teilw\. ersetzt durch {NR})\b")
NUMMERN = rf"{NR}(?:(?:, | und |/){NR})*"
ERSETZT_DURCH = re.compile(rf"ersetzt durch ({NUMMERN})")
ERSETZT = re.compile(rf"\b(?:ersetzt(?: teilw\.)?(?! durch)|löst) ({NUMMERN})")
TICKET = re.compile(r"#\d+")


@dataclass(frozen=True)
class Begriff:
    muster: str
    grund: str
    dateien: tuple[str, ...]


AKTUELL = ("README.md", "CLAUDE.md", ".agents/*.md", ".agents/rules/*.md")
# Doku und Code ohne die Bestände: docs/DECISIONS.md (D-001–D-039, fleet#153) und die Migrationen
# (Prüfsumme, angewandte Dateien ändern sich nicht).
DOKU_UND_CODE = (
    "docs/ARCHITECTURE.md", "docs/OPERATIONS.md", "docs/PRODUCT.md", "docs/adr/*", "docs/*.html",
    "apps/web/*", "apps/server/src/*", "apps/server/*.mjs", "packages/*", "scripts/*", "docker/*",
    ".env*", "compose.*.yml", "eslint.config.js", "vitest.config.ts",
)
# Beispiel: Begriff(r"Staging-Server", "seit ADR 0007 kein Staging mehr", AKTUELL),
ABGELOEST: tuple[Begriff, ...] = (
    Begriff(r"\bWP-\d{3}\b|work-packages|PROGRESS\.md|WORKFLOW\.md|docs:sync",
            "seit ADR 0001 Tickets statt Arbeitspaketen", AKTUELL),
    Begriff(r"\bWP-\d{3}\b", "Arbeitspakete abgebaut (fleet#153): Herkunft weglassen, Offenes als Issue (#7–#17)",
            DOKU_UND_CODE),
)


def status_zeilen() -> dict[str, str]:
    zeilen: dict[str, str] = {}
    for path in sorted(ADR_DIR.glob("*.md")):
        nr = path.name[:4]
        if not (nr.isdigit() or nr == PLACEHOLDER):
            continue
        status = next((z[7:].strip() for z in path.read_text(encoding="utf-8").splitlines() if z.startswith("Status:")), "")
        zeilen[nr] = status.rstrip(".")
    return zeilen


def check_status(zeilen: dict[str, str]) -> list[str]:
    fehler: list[str] = []
    juengste = set(sorted(n for n in zeilen if n.isdigit())[-VORSCHLAG_FRIST:])
    for nr, status in sorted(zeilen.items()):
        if not STATUS_START.match(status):
            fehler.append(f"ADR {nr}: Status `{status[:60]}` ohne festen Anfang (aktiv, vorgeschlagen, ersetzt durch NNNN)")
        for ziel in re.findall(NR, " ".join(ERSETZT_DURCH.findall(status))):
            if ziel not in zeilen:
                fehler.append(f"ADR {nr}: `ersetzt durch {ziel}`, ADR {ziel} gibt es nicht")
        if nr.isdigit() and status.startswith("vorgeschlagen") and nr not in juengste and not TICKET.search(status):
            fehler.append(f"ADR {nr}: noch `vorgeschlagen`, ist aber gemergt -- `aktiv` setzen oder Ticket nennen")
        for ziel in re.findall(NR, " ".join(ERSETZT.findall(status.replace("ersetzt durch", "§")))):
            if nr.isdigit() and ziel in zeilen and ziel != nr and nr not in zeilen[ziel]:
                fehler.append(f"ADR {nr} ersetzt ADR {ziel}, deren Status nennt {nr} nicht")
    return fehler


def check_begriffe() -> list[str]:
    try:
        dateien = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
    except (OSError, subprocess.CalledProcessError):
        return []
    fehler: list[str] = []
    for begriff in ABGELOEST:
        muster = re.compile(begriff.muster)
        for name in dateien:
            if name == "scripts/check_drift.py" or not any(fnmatch.fnmatch(name, g) for g in begriff.dateien):
                continue
            try:
                text = (ROOT / name).read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            fehler += [f"{name}:{i}: `{begriff.muster}` -- {begriff.grund}" for i, z in enumerate(text.splitlines(), 1) if muster.search(z)]
    return fehler


def main(argv: list[str]) -> int:
    zeilen = status_zeilen()
    fehler = check_status(zeilen) + check_begriffe()
    if "--list" in argv:
        print("\n".join(fehler) or "keine Funde")
        return 0
    for f in fehler:
        print(f"❌ {f}")
    if not fehler:
        print("✅ Drift-Wächter: ADR-Status und Doku passen zum Stand.")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
