#!/usr/bin/env python3
"""Board-Prüfung: meldet Tickets, deren Status auf dem Board nicht stimmt. Planer und Orchestrierer
lassen sie bei jedem Start und Wecken laufen (`.claude/skills/planer/SKILL.md` „Zusammenarbeit“,
`.claude/skills/orchestrierer/SKILL.md` „Bei jedem Start und jedem Weckruf“).

Drei Fälle:
  (a) geschlossene Tickets, die nicht auf `Fertig` stehen (auch: gar nicht auf dem Board);
  (b) offene Tickets ohne Status (auch: gar nicht auf dem Board);
  (c) offene Tickets im `Backlog` mit mindestens einem Vorgänger aus der Zeile „Nach #…“, die alle
      geschlossen sind.
Mit `--beheben` setzt der Befehl (a) selbst auf `Fertig`. (b) und (c) meldet er nur: Ob ein Vertrag
`Bereit` ist, entscheidet der Planer.

Board ist das Projekt (GitHub Projects), das mit dem Repository verknüpft ist; Zugriff über `gh`.
Exit 0: Board stimmt (nach dem Beheben); 1: Befunde offen; 2: Fehler (gh, kein eindeutiges Board).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass, field

FERTIG = "Fertig"
BACKLOG = "Backlog"

# Zeile mit den Vorgängern: `Nach #16, #17`, `Nach: #39, #55`, `**Nach** #12.`; zählt nur bis zum
# Ende des ersten Satzes oder einer Klammer (aus `Nach #12. Das Ausrollen braucht #3` nur die erste).
NACH_ZEILE = re.compile(r"^[\s>*_\-]*nach\b[\s*_:]*(?P<rest>.*)$", re.IGNORECASE)
SATZENDE = re.compile(r"\.(\s|$)|\(")
NUMMER = re.compile(r"#(\d+)\b")

Gh = Callable[[list[str]], dict]


@dataclass(frozen=True)
class Ticket:
    nummer: int
    titel: str
    offen: bool
    status: str | None  # None: ohne Status oder nicht auf dem Board
    text: str = ""
    knoten: str = ""  # Node-ID des Issues
    eintrag: str | None = None  # ID des Eintrags auf dem Board, None: nicht auf dem Board


@dataclass
class Befunde:
    nicht_fertig: list[Ticket] = field(default_factory=list)  # (a)
    ohne_status: list[Ticket] = field(default_factory=list)  # (b)
    backlog_frei: list[tuple[Ticket, list[int]]] = field(default_factory=list)  # (c)

    def leer(self) -> bool:
        return not (self.nicht_fertig or self.ohne_status or self.backlog_frei)


def vorgaenger(text: str) -> list[int]:
    """Die Nummern aus den Zeilen „Nach #…“ eines Ticket-Texts, in Reihenfolge, ohne Doppelte."""
    nummern: list[int] = []
    for zeile in text.splitlines():
        treffer = NACH_ZEILE.match(zeile)
        if not treffer or not treffer["rest"].lstrip("*_ ").startswith("#"):
            continue
        rest = SATZENDE.split(treffer["rest"], maxsplit=1)[0]
        for nummer in map(int, NUMMER.findall(rest)):
            if nummer not in nummern:
                nummern.append(nummer)
    return nummern


def pruefen(tickets: list[Ticket]) -> Befunde:
    """Die drei Fälle aus dem Stand der Tickets; ein Vorgänger, den es nicht gibt, gilt als offen."""
    offen = {t.nummer: t.offen for t in tickets}
    befunde = Befunde()
    for t in sorted(tickets, key=lambda t: t.nummer):
        if not t.offen:
            if t.status != FERTIG:
                befunde.nicht_fertig.append(t)
        elif t.status is None:
            befunde.ohne_status.append(t)
        elif t.status == BACKLOG:
            nach = vorgaenger(t.text)
            if nach and not any(offen.get(n, True) for n in nach):
                befunde.backlog_frei.append((t, nach))
    return befunde


def bericht(befunde: Befunde) -> str:
    if befunde.leer():
        return "Board stimmt: keine Befunde."
    zeilen: list[str] = []
    if befunde.nicht_fertig:
        zeilen.append("(a) geschlossen, aber nicht auf Fertig (behebt --beheben):")
        zeilen += [f"  #{t.nummer} [{t.status or 'ohne Status'}] {t.titel}" for t in befunde.nicht_fertig]
    if befunde.ohne_status:
        zeilen.append("(b) offen ohne Status (Planer):")
        zeilen += [f"  #{t.nummer} {t.titel}" for t in befunde.ohne_status]
    if befunde.backlog_frei:
        zeilen.append("(c) im Backlog, alle Vorgänger geschlossen (Planer prüft, ob Bereit):")
        zeilen += [f"  #{t.nummer} {t.titel} (Nach {', '.join(f'#{n}' for n in nach)})"
                   for t, nach in befunde.backlog_frei]
    return "\n".join(zeilen)


# --- Zugriff auf GitHub -------------------------------------------------------------------------

ABFRAGE = """
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 10) {
      nodes { id number title
        field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } }
    }
    issues(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id number title state body
        projectItems(first: 20) { nodes { id project { id }
          fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } }
    }
  }
}"""

STATUS_SETZEN = """
mutation($projekt: ID!, $eintrag: ID!, $feld: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {projectId: $projekt, itemId: $eintrag, fieldId: $feld,
                                        value: {singleSelectOptionId: $option}}) { projectV2Item { id } }
}"""

AUFNEHMEN = """
mutation($projekt: ID!, $knoten: ID!) {
  addProjectV2ItemById(input: {projectId: $projekt, contentId: $knoten}) { item { id } }
}"""


@dataclass(frozen=True)
class Board:
    projekt: str  # Node-ID des Projekts
    feld: str  # Node-ID des Felds Status
    optionen: dict[str, str]  # Name → Options-ID


class BoardFehler(Exception):
    pass


def gh_cli(argumente: list[str]) -> dict:
    lauf = subprocess.run(["gh", *argumente], capture_output=True, text=True, check=False)
    if lauf.returncode != 0:
        raise BoardFehler(f"gh {' '.join(argumente[:2])}: {lauf.stderr.strip()}")
    return json.loads(lauf.stdout) if lauf.stdout.strip() else {}


def graphql(gh: Gh, abfrage: str, **variablen: str) -> dict:
    argumente = ["api", "graphql", "-f", f"query={abfrage}"]
    for name, wert in variablen.items():
        argumente += ["-f", f"{name}={wert}"]
    antwort = gh(argumente)
    if antwort.get("errors"):
        raise BoardFehler(f"GraphQL: {antwort['errors']}")
    return antwort["data"]


def laden(gh: Gh, repo: str) -> tuple[Board, list[Ticket]]:
    """Board und alle Issues (offen und geschlossen) des Repositorys `besitzer/name`."""
    besitzer, name = repo.split("/", 1)
    board: Board | None = None
    tickets: list[Ticket] = []
    cursor: dict[str, str] = {}
    while True:
        daten = graphql(gh, ABFRAGE, owner=besitzer, name=name, **cursor)["repository"]
        if board is None:
            projekte = daten["projectsV2"]["nodes"]
            if len(projekte) != 1 or not projekte[0].get("field"):
                titel = ", ".join(p["title"] for p in projekte) or "keins"
                raise BoardFehler(f"kein eindeutiges Board mit Feld Status am Repository (gefunden: {titel})")
            p = projekte[0]
            board = Board(p["id"], p["field"]["id"], {o["name"]: o["id"] for o in p["field"]["options"]})
        for i in daten["issues"]["nodes"]:
            eintraege = [e for e in i["projectItems"]["nodes"] if e["project"]["id"] == board.projekt]
            eintrag = eintraege[0] if eintraege else None
            status = (eintrag.get("fieldValueByName") or {}).get("name") if eintrag else None
            tickets.append(Ticket(i["number"], i["title"], i["state"] == "OPEN", status, i["body"] or "",
                                  i["id"], eintrag["id"] if eintrag else None))
        seiten = daten["issues"]["pageInfo"]
        if not seiten["hasNextPage"]:
            return board, tickets
        cursor = {"cursor": seiten["endCursor"]}


def beheben(gh: Gh, board: Board, befunde: Befunde) -> list[Ticket]:
    """Setzt die Tickets aus (a) auf `Fertig`, nimmt sie dazu wenn nötig aufs Board. Nur (a)."""
    option = board.optionen.get(FERTIG)
    if option is None:
        raise BoardFehler(f"das Feld Status kennt die Option {FERTIG} nicht")
    erledigt = []
    for t in befunde.nicht_fertig:
        eintrag = t.eintrag
        if eintrag is None:
            daten = graphql(gh, AUFNEHMEN, projekt=board.projekt, knoten=t.knoten)
            eintrag = daten["addProjectV2ItemById"]["item"]["id"]
        graphql(gh, STATUS_SETZEN, projekt=board.projekt, eintrag=eintrag, feld=board.feld, option=option)
        erledigt.append(t)
    befunde.nicht_fertig = [t for t in befunde.nicht_fertig if t not in erledigt]
    return erledigt


def main(argv: list[str] | None = None, gh: Gh = gh_cli) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--beheben", action="store_true", help="Fall (a) selbst auf Fertig setzen")
    parser.add_argument("--repo", help="besitzer/name (Vorgabe: das Repository des Checkouts)")
    args = parser.parse_args(argv)
    try:
        repo = args.repo or gh(["repo", "view", "--json", "nameWithOwner"])["nameWithOwner"]
        board, tickets = laden(gh, repo)
        befunde = pruefen(tickets)
        if args.beheben and befunde.nicht_fertig:
            for t in beheben(gh, board, befunde):
                print(f"behoben: #{t.nummer} auf {FERTIG} gesetzt ({t.titel})")
    except BoardFehler as fehler:
        print(f"Board-Prüfung gescheitert: {fehler}", file=sys.stderr)
        return 2
    print(bericht(befunde))
    return 0 if befunde.leer() else 1


if __name__ == "__main__":
    sys.exit(main())
