"""Prüfungen in Paketen über die Server (fleet-Repo docs/pruefungen.md „Prüfen aus dem Projekt“).

    python3 scripts/pruefung.py <stufe…>

Das Projekt beschreibt hier nur seine Pakete (`plan`): je Stufe ein Paket, das
`scripts/ci_job.sh <stufe>` auf einem Knoten ruft; Stufen nach `DAUER` (Inhalt:
.agents/rules/testing.md „Stufen“). Die Stufen in `EINHEITEN` haben Worker (Einheiten): So
viele, wie neben ihrer Grundlast unter der Obergrenze Platz haben (`einheiten_hoechstens`,
höchstens `WORKER`); `ci_job.sh` startet `FLEET_EINHEITEN` Worker und setzt die Marke dabei.
`db` und `e2e` sind schwer (Test-Datenbank), `e2e` startet Chromium (`browser`).
Gemessene Dauern legt `nachlauf` ab (`pruefung_dauern`). Einreichen, Buchung nach Messung, Folgen,
Ergebnisdatei und Rückfall kommen aus fleet (Python 3.12, aus einem fleet-Checkout: `FLEET_DIR`,
sonst `/Users/fleet/fleet`, der ausgerollte Stand der Server, sonst `~/code/Arthurreuss/fleet`).

Aufrufer: Commit-Hook (`PRUEFUNG_QUELLE=commit`), Agenten und der Merge-Zug (`fleet.toml` [zug]).
Exit: 0 grün, 1 rot, 130 Abbruch, 75 = Warteschlange nicht nutzbar: lokal prüfen
(`scripts/ci_job.sh <stufe>`), der Zug hält an und startet begrenzt neu. Umgebung: `PRUEFUNG`
(Adresse der Nomad-API oder `lokal`), `PRUEFUNG_QUELLE` (agent, commit, merge-zug, release),
`PRUEFUNG_BRANCH`, `PRUEFUNG_LOGS`, `FLEET_PRUEFUNG_ERGEBNIS` (Ergebnisdatei für den Merge-Zug).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import IO, Any

REPO = Path(__file__).resolve().parents[1]
LOCAL = 75
# Geschätzte Dauer je Stufe in s, bis eine Messung vorliegt (fleet `pruefung_dauern`): das längste
# Paket startet zuerst, die Frist gegen Hängen folgt daraus.
# Je eingerichtete Stufe von scripts/ci_job.sh ein Eintrag, gemessen auf den Servern (#19).
DAUER = {"static": 60.0, "test": 90.0, "db": 40.0, "e2e": 70.0}
WORKER = 4  # Wunsch an Test-Workern je Paket
EINHEITEN = ("test", "db", "e2e")  # Stufen mit Workern (FLEET_EINHEITEN)
BROWSER = {"e2e"}  # Pakete, die Chromium starten
SCHWER = {"db", "e2e"}  # Pakete mit Test-Datenbank oder Browser


def fleet_laden() -> bool:
    """fleetlib aus einem fleet-Checkout importierbar machen; False, wenn es keinen gibt."""
    for ort in (os.environ.get("FLEET_DIR", ""), "/Users/fleet/fleet", str(Path.home() / "code/Arthurreuss/fleet")):
        if ort and (Path(ort) / "fleetlib" / "pruefung_ablauf.py").is_file():
            sys.path.insert(0, ort)
            return True
    return False


def main(stufen: list[str], out: IO[str] = sys.stdout, **testhilfen: Any) -> int:
    if not fleet_laden() or sys.version_info < (3, 12):
        out.write("pruefung: kein fleet-Checkout mit Python 3.12 → prüfe lokal\n")
        return LOCAL
    from fleetlib import pruefung_dauern  # noqa: PLC0415 -- erst nach fleet_laden
    from fleetlib.pruefung_ablauf import Projekt, pruefen  # noqa: PLC0415
    from fleetlib.pruefung_buchung import Messungen  # noqa: PLC0415
    from fleetlib.pruefung_lauf import Paket  # noqa: PLC0415

    unbekannt = [s for s in stufen if s not in DAUER]
    if unbekannt or not stufen:
        out.write(f"pruefung: Stufen {unbekannt or stufen} unbekannt ({', '.join(DAUER)}) → prüfe lokal\n")
        return LOCAL

    def plan(nomad: Any, knoten: object, messungen: Messungen) -> tuple[list[Paket], list[str]]:
        einheiten = {s: messungen.einheiten_hoechstens(s, WORKER) for s in EINHEITEN}  # ci_job.sh: FLEET_EINHEITEN
        dauern = pruefung_dauern.laden(nomad, projekt.name)
        pakete = [Paket(s, s, [s], dauern.get(s, DAUER[s]), einheiten=einheiten.get(s, 1),
                        browser=s in BROWSER, schwer=s in SCHWER) for s in stufen]
        return pakete, list(stufen)

    def nachlauf(nomad: Any, pakete: list[Paket], stages: list[str], say: Any) -> list[str]:
        """Dauern grüner Pakete für die nächste Prüfung ablegen."""
        problem = pruefung_dauern.speichern(nomad, projekt.name, {p.name: p.sekunden for p in pakete if p.code == 0})
        if problem:
            say(f"Dauern nicht gespeichert ({problem})")
        return []

    projekt = Projekt("poker", REPO, "https://github.com/Arthurreuss/Poker.git", "PRUEFUNG",
                      "http://100.116.114.9:4646")
    # Quelle commit (Commit-Hook): genau der Index wird geprüft und jedes Log ausgegeben.
    modus = "commit" if os.environ.get("PRUEFUNG_QUELLE") == "commit" else "verify"
    return pruefen(projekt, modus, plan, out, nachlauf, **testhilfen)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
