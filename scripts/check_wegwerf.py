#!/usr/bin/env python3
"""Wächter gegen Wegwerf-Dateien (gespiegelt aus fleet, im Projekt nicht von Hand ändern).

Hilfsskripte, Sicherungen und Reste eines Patches gehören in den Arbeitsordner der Sitzung oder
nach /tmp, nie ins Repo. Geprüft wird jede Datei, die Git kennt, und jede neue, die nicht ignoriert
ist. Rot (Exit 1) ist:
1. ein Name, der mit tmp_, temp_, fix_, patch_, scratch_ oder hack_ beginnt (auch mit - statt _);
2. eine Endung von Sicherungen und Editor-Resten: .bak, .orig, .rej, .tmp, .swp, ~;
3. ein Skript (.py, .sh, .js, .mjs, .cjs, .ts, .rb, .pl) direkt in der Wurzel des Repos, das nicht
   in `scripts/struktur.toml` `wurzel_skripte` steht; Konfigurationen (*.config.*) zählen nicht.
Abhilfe: die Datei in den Arbeitsordner oder nach /tmp verschieben; ein echtes Skript gehört nach
scripts/ oder, in der Wurzel, in `wurzel_skripte`.
"""

from __future__ import annotations

import re
import subprocess
import sys
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
STRUKTUR = "scripts/struktur.toml"
NAME = re.compile(r"(?i)^(tmp|temp|fix|patch|scratch|hack)[_-]")
ENDUNG = re.compile(r"(?i)(\.(bak|orig|rej|tmp|swp)|~)$")
SKRIPT = re.compile(r"\.(py|sh|js|mjs|cjs|ts|rb|pl)$")


def dateien(repo: Path) -> list[str]:
    """Bekannte und neue, nicht ignorierte Dateien relativ zur Wurzel, soweit vorhanden."""
    lauf = subprocess.run(["git", "-C", str(repo), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                          capture_output=True, text=True, check=True)
    return sorted({p for p in lauf.stdout.split("\0") if p and (repo / p).exists()})


def wurzel_skripte(repo: Path) -> set[str]:
    try:
        with (repo / STRUKTUR).open("rb") as f:
            return set(tomllib.load(f).get("wurzel_skripte", []))
    except FileNotFoundError:
        return set()


def befunde(repo: Path) -> list[str]:
    erlaubt = wurzel_skripte(repo)
    aus = []
    for pfad in dateien(repo):
        name = pfad.rsplit("/", 1)[-1]
        if NAME.match(name) or ENDUNG.search(name):
            aus.append(f"{pfad}: Wegwerf-Datei")
        elif "/" not in pfad and SKRIPT.search(name) and ".config." not in name and name not in erlaubt:
            aus.append(f"{pfad}: Skript in der Wurzel, nicht in {STRUKTUR} wurzel_skripte")
    return aus


def main(argv: list[str]) -> int:
    repo = Path(argv[0]).resolve() if argv else REPO
    gefunden = befunde(repo)
    for zeile in gefunden:
        print(f"check_wegwerf: {zeile}")
    if gefunden:
        print("check_wegwerf: Hilfsskripte und Reste in den Arbeitsordner der Sitzung oder nach /tmp, nie ins Repo")
        return 1
    print("check_wegwerf: keine Wegwerf-Dateien")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
