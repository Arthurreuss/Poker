#!/usr/bin/env python3
"""Struktur-Wächter: Ordner und Schichten des Projekts nach dem Gerüst seiner Art.

Die Regeln stehen in `scripts/struktur.toml`; sie kommen mit dem Gerüst der Art aus dem Baukasten
(`.agents/fleet/baukasten.md`) und gehören dem Projekt. Läuft in der schnellen Prüfstufe; rot
(Exit 1) ist:
1. ein Ordner aus `ordner` fehlt;
2. ein Eintrag aus `verboten` liegt im Wurzelordner;
3. eine Zeile einer Datei aus `[[regel]] dateien` trifft deren `muster` (etwa ein Import, der eine
   Schicht nach oben greift).
"""

from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REGELN = "scripts/struktur.toml"


def funde(repo: Path) -> list[str]:
    pfad = repo / REGELN
    if not pfad.is_file():
        return [f"{REGELN} fehlt (Gerüst der Art, fleet.py projekt anlegen)"]
    regeln = tomllib.loads(pfad.read_text(encoding="utf-8"))
    gefunden = [f"{o}/: Ordner fehlt" for o in regeln.get("ordner", []) if not (repo / o).is_dir()]
    gefunden += [f"{v}: gehört nicht zu dieser Art" for v in regeln.get("verboten", []) if (repo / v).exists()]
    for regel in regeln.get("regel", []):
        muster = re.compile(regel["muster"])
        for datei in sorted(repo.glob(regel["dateien"])):
            if not datei.is_file():
                continue
            for nr, zeile in enumerate(datei.read_text(encoding="utf-8").splitlines(), 1):
                if muster.search(zeile):
                    gefunden.append(f"{datei.relative_to(repo)}:{nr}: {regel['grund']}")
    return gefunden


def main() -> int:
    gefunden = funde(REPO)
    for f in gefunden:
        print(f"struktur: {f}")
    if not gefunden:
        print("struktur: Ordner und Schichten wie im Gerüst")
    return 1 if gefunden else 0


if __name__ == "__main__":
    sys.exit(main())
