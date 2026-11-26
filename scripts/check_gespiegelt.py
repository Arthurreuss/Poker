#!/usr/bin/env python3
"""Wächter der gespiegelten Dateien (gespiegelt aus fleet, im Projekt nicht von Hand ändern).

Gespiegelte Dateien gehören fleet und kommen nur über `fleet.py projekt abgleichen` ins Projekt
(fleet-Repo `vorlage/GESPIEGELT`). Der Abgleich legt ihren Stand mit Prüfsummen in `STAND` ab; dieser
Wächter vergleicht das Projekt damit, ohne fleet zu brauchen. Rot (Exit 1) ist:
1. kein Stand: das Projekt wurde nie abgeglichen;
2. eine gespiegelte Datei fehlt oder weicht von ihrer Prüfsumme ab (von Hand geändert);
3. in einem gespiegelten Ordner liegt eine Datei, die nicht aus fleet kommt;
4. `.claude/settings.json` trägt den Haken der Befehlssperre nicht ein;
5. die Befehlssperre lädt ihre Regeln nicht (etwa `fleet.toml` [agenten.befehlssperre_aus] ohne
   Begründung oder mit unbekannter Regel).
Abhilfe ist immer der Abgleich aus fleet; Änderungen an gespiegelten Dateien gehören nach fleet.
Abgeschaltete Regeln der Befehlssperre zeigt der Wächter mit Begründung an, sie sind nicht rot; was
erst der Arbeitsbaum ändert, ist mit „nach dem Merge“ markiert (die Sperre liest den gemergten Stand).
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from types import ModuleType

REPO = Path(__file__).resolve().parents[1]
STAND = ".agents/fleet/gespiegelt.sha256"
KOPF = ("# Stand der gespiegelten Dateien aus fleet (vorlage/GESPIEGELT). Nicht von Hand ändern:\n"
        "# erzeugt von fleet.py projekt abgleichen, geprüft von scripts/check_gespiegelt.py.\n")
HAKEN = ".claude/hooks/befehlssperre.py"


def pruefsumme(pfad: Path) -> str:
    return hashlib.sha256(pfad.read_bytes()).hexdigest()


def stand_text(dateien: dict[str, str], ordner: list[str]) -> str:
    """Der Inhalt von `STAND`: Ordner (`ordner <pfad>/`), dann je Datei `<sha256>  <pfad>`."""
    zeilen = [f"ordner {o}" for o in sorted(ordner)] + [f"{h}  {p}" for p, h in sorted(dateien.items())]
    return KOPF + "".join(f"{z}\n" for z in zeilen)


def stand_lesen(text: str) -> tuple[dict[str, str], list[str]]:
    dateien, ordner = {}, []
    for zeile in text.splitlines():
        if zeile.startswith("ordner "):
            ordner.append(zeile.removeprefix("ordner ").strip())
        elif zeile.strip() and not zeile.startswith("#"):
            summe, pfad = zeile.split(maxsplit=1)
            dateien[pfad.strip()] = summe
    return dateien, ordner


def haken_eingetragen(repo: Path) -> bool:
    try:
        settings = json.loads((repo / ".claude/settings.json").read_text())
    except (OSError, ValueError):
        return False
    gruppen = settings.get("hooks", {}).get("PreToolUse", [])
    return any(g.get("matcher") == "Bash" and HAKEN in h.get("command", "")
               for g in gruppen for h in g.get("hooks", []))


def abgeschaltet(repo: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Die im Projekt abgeschalteten Regeln der Befehlssperre (Name → Begründung), geladen wie im Haken:
    was jetzt gilt (gemergter Stand) und was der Arbeitsbaum mitbringt (geprüft, gilt nach dem Merge)."""
    quelle = repo / HAKEN
    modul = ModuleType("befehlssperre")
    modul.__file__ = str(quelle)
    sys.modules[modul.__name__] = modul  # dataclass braucht das Modul; ohne __pycache__ im Projekt
    exec(compile(quelle.read_text(), quelle, "exec"), modul.__dict__)
    return modul.laden(repo)[1], modul.laden(repo, arbeitsbaum=True)[1]


def funde(repo: Path) -> list[str]:
    if not (repo / STAND).is_file():
        return [f"{STAND} fehlt: nie aus fleet abgeglichen (fleet.py projekt abgleichen)"]
    dateien, ordner = stand_lesen((repo / STAND).read_text())
    bad = []
    for pfad, summe in sorted(dateien.items()):
        if not (repo / pfad).is_file():
            bad.append(f"{pfad}: fehlt")
        elif pruefsumme(repo / pfad) != summe:
            bad.append(f"{pfad}: von Hand geändert (gehört fleet)")
    for o in ordner:
        for datei in sorted((repo / o).rglob("*")):
            rel = datei.relative_to(repo).as_posix()
            if datei.is_file() and rel not in dateien and rel != STAND:
                bad.append(f"{rel}: liegt im gespiegelten Ordner {o}, kommt nicht aus fleet")
    if not haken_eingetragen(repo):
        bad.append(f".claude/settings.json: Haken {HAKEN} für Bash fehlt in PreToolUse")
    return bad


def main() -> int:
    bad = funde(REPO)
    try:
        gilt, kommt = abgeschaltet(REPO)
        for name, grund in kommt.items():
            ab = "" if gilt.get(name) == grund else " (nach dem Merge)"
            print(f"gespiegelt: Befehlssperre „{name}“ abgeschaltet{ab}: {grund}")
        for name in sorted(set(gilt) - set(kommt)):
            print(f"gespiegelt: Befehlssperre „{name}“ nach dem Merge wieder an")
    except Exception as e:  # noqa: BLE001 -- der Haken blockiert dann jeden Befehl
        bad.append(f"Befehlssperre lädt ihre Regeln nicht ({type(e).__name__}: {e})")
    for fund in bad:
        print(f"gespiegelt: {fund}")
    if bad:
        print("gespiegelt: Abhilfe ist der Abgleich aus fleet (fleet.py projekt abgleichen <pfad>)")
        return 1
    print("gespiegelt: unverändert")
    return 0


if __name__ == "__main__":
    sys.exit(main())
