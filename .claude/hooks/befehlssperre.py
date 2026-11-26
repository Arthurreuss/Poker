#!/usr/bin/env python3
"""Befehlssperre: PreToolUse-Haken von Claude Code für Shell-Befehle (gespiegelt aus fleet).

Liest die Eingabe des Hakens als JSON von stdin (`tool_input.command`, `cwd`, `scratchpad_dir`),
prüft den Befehl gegen die Regeln aus `befehlssperre.toml` neben dieser Datei und gibt bei einem
Treffer `permissionDecision: deny` mit Regel, Grund und erlaubtem Weg aus. Ohne Treffer keine
Ausgabe, Exit 0. Sind die Regeln nicht lesbar, blockiert Exit 2 jeden Befehl (die Meldung sagt warum).
Felder der Regeln: Kopf von `befehlssperre.toml`.

Die Einstellungen eines Projekts (`fleet.toml` [agenten]: Ziel-Branches, abgeschaltete und eigene
Regeln) gelten je Teilbefehl aus dem Repo, in dem er wirkt (auch aus einem Worktree heraus), im
gemergten Stand: aus dem Standard-Branch des Remotes (`origin/HEAD`, sonst `origin/main`,
`origin/master`; der lokale Ref, ohne fetch), gleich was ausgecheckt ist. Ohne diesen Ref gilt die
Datei im Hauptcheckout, ohne `fleet.toml` die Vorgaben. Außerhalb jedes Repos gilt das Projekt der
Sitzung (`CLAUDE_PROJECT_DIR`).

Läuft ab Python 3.9 (`python3` von macOS); fehlt `tomllib` (vor 3.11), startet sich der Haken über uv
mit Python 3.12 neu.
"""

from __future__ import annotations

import glob
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

HIER = Path(__file__).resolve().parent
TRENNER = {";", "&&", "||", "|", "&", "\n", "(", ")", ";;", "|&"}
GIT_OPTIONEN_MIT_WERT = {"-C", "-c", "--git-dir", "--work-tree", "--namespace"}
FELDER = {"name", "grund", "weg", "muster", "ganz", "auch", "ausser", "hauptcheckout", "zweig", "befehl",
          "erlaubt_in"}
ORTE = {"worktree", "arbeitsordner", "temp"}
TEMP = ("/tmp", "/private/tmp")  # dazu $TMPDIR, wenn er darunter oder unter /var/folders liegt
TEMP_JE_NUTZER = ("/var/folders", "/private/var/folders")  # der Ordner je Nutzer: drei Ebenen tiefer
MUSTER = re.compile(r"[*?\[]")
SSH_MIT_WERT = set("BbcDEeFIiJLlmOoPpQRSWw")  # Optionen von ssh, die einen Wert nehmen
ZIELE = ["main", "master"]  # Ziel-Branches, wenn fleet.toml [agenten] ziel_branches fehlt
UV = ("/opt/homebrew/bin/uv", "/usr/local/bin/uv", "~/.local/bin/uv", "~/.cargo/bin/uv")
NEU_GESTARTET = "BEFEHLSSPERRE_NEU_GESTARTET"


@dataclass
class Regel:
    name: str
    grund: str
    weg: str
    muster: re.Pattern[str]
    ganz: bool = False
    auch: re.Pattern[str] | None = None
    ausser: re.Pattern[str] | None = None
    hauptcheckout: bool = False
    zweig: re.Pattern[str] | None = None
    befehl: re.Pattern[str] | None = None
    erlaubt_in: list[str] = field(default_factory=list)

    @classmethod
    def aus(cls, roh: dict, ziel: str) -> Regel:
        """Regel aus der TOML-Tabelle; `{ziel}` in Ausdrücken wird `ziel` (die Ziel-Branches)."""
        fremd = set(roh) - FELDER
        if fremd or not all(isinstance(roh.get(k), str) for k in ("name", "grund", "weg", "muster")):
            raise ValueError(f"Regel {roh.get('name', '?')}: name, grund, weg, muster nötig; unbekannt {sorted(fremd)}")
        if set(roh.get("erlaubt_in", [])) - ORTE or bool(roh.get("erlaubt_in")) != bool(roh.get("befehl")):
            raise ValueError(f"Regel {roh['name']}: befehl und erlaubt_in nur zusammen, Orte {sorted(ORTE)}")
        regex = {k: re.compile(roh[k].replace("{ziel}", ziel))
                 for k in ("muster", "auch", "ausser", "zweig", "befehl") if k in roh}
        return cls(roh["name"], roh["grund"], roh["weg"], ganz=bool(roh.get("ganz")),
                   hauptcheckout=bool(roh.get("hauptcheckout")), erlaubt_in=list(roh.get("erlaubt_in", [])), **regex)


@dataclass
class Teil:
    """Ein Teilbefehl: Wörter (vor git ohne -C/-c) und das Verzeichnis, in dem er läuft."""
    woerter: list[str]
    ort: Path

    @property
    def text(self) -> str:
        return " ".join(self.woerter)


def projekt_ordner() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or HIER.parents[1])


def toml_lesen(pfad: Path) -> dict:
    import tomllib  # noqa: PLC0415 -- ab 3.11; davor startet main() den Haken über uv neu

    return tomllib.loads(pfad.read_text())


def gemergt(repo: Path) -> str | None:
    """`fleet.toml` im Standard-Branch des Remotes (aus dem lokalen Ref, ohne fetch); "" ohne die
    Datei dort, None ohne Remote-Ref."""
    standard = git(repo, "symbolic-ref", "-q", "refs/remotes/origin/HEAD")
    for ref in filter(None, (standard, "refs/remotes/origin/main", "refs/remotes/origin/master")):
        if git(repo, "rev-parse", "-q", "--verify", f"{ref}^{{commit}}"):
            return git(repo, "show", f"{ref}:fleet.toml")
    return None


def einstellungen(projekt: Path, arbeitsbaum: bool = False) -> dict:
    """`fleet.toml` [agenten] im gemergten Stand (`gemergt`), ohne Remote-Ref oder mit `arbeitsbaum`
    aus der Datei im Ordner; ohne beides leer."""
    import tomllib  # noqa: PLC0415 -- ab 3.11; davor startet main() den Haken über uv neu

    text = None if arbeitsbaum else gemergt(projekt)
    if text is None:
        datei = projekt / "fleet.toml"
        text = datei.read_text() if datei.is_file() else ""
    return tomllib.loads(text).get("agenten", {})


def laden(projekt: Path, arbeitsbaum: bool = False) -> tuple[list[Regel], dict[str, str]]:
    """Die geltenden Regeln und die vom Projekt abgeschalteten (Name → Begründung)."""
    agenten = einstellungen(projekt, arbeitsbaum)
    ziele = agenten.get("ziel_branches", ZIELE)
    if not ziele or not all(isinstance(z, str) and z for z in ziele):
        raise ValueError("fleet.toml [agenten] ziel_branches: Liste von Branch-Namen")
    ziel = "(?:" + "|".join(map(re.escape, ziele)) + ")"
    roh = toml_lesen(HIER / "befehlssperre.toml")["regel"] + agenten.get("befehlssperre", [])
    regeln = [Regel.aus(r, ziel) for r in roh]
    namen = [r.name for r in regeln]
    doppelt = sorted({n for n in namen if namen.count(n) > 1})
    if doppelt:
        raise ValueError(f"Regeln doppelt (ein Projekt ergänzt nur, ersetzt keine): {doppelt}")
    aus = agenten.get("befehlssperre_aus", {})
    unbekannt = sorted(set(aus) - set(namen))
    ohne = sorted(n for n, b in aus.items() if not isinstance(b, str) or not b.strip())
    if unbekannt or ohne:
        raise ValueError(f"fleet.toml [agenten.befehlssperre_aus]: unbekannte Regeln {unbekannt}, ohne Begründung {ohne}")
    return [r for r in regeln if r.name not in aus], aus


def repo_von(ort: Path) -> Path | None:
    """Der Hauptcheckout des Git-Repos am Ort (auch aus einem Worktree), None außerhalb eines Repos."""
    while not ort.exists() and ort != ort.parent:
        ort = ort.parent
    gemeinsam = git(ort, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if not gemeinsam:
        return None
    pfad = Path(gemeinsam).resolve()
    return pfad.parent if pfad.name == ".git" else pfad


class Regelwerk:
    """Die geltenden Regeln je Repo, geladen beim ersten Teilbefehl, der dort wirkt."""

    def __init__(self, sitzung: Path) -> None:
        self.sitzung = sitzung
        self.geladen: dict[Path, list[Regel]] = {}

    def fuer(self, ort: Path) -> list[Regel]:
        projekt = repo_von(ort) or self.sitzung
        if projekt not in self.geladen:
            try:
                self.geladen[projekt] = laden(projekt)[0]
            except ValueError as e:
                raise ValueError(f"{projekt}: {e}") from e
        return self.geladen[projekt]


def neu_starten() -> None:
    """Startet den Haken über uv mit Python 3.12 neu (stdin bleibt ungelesen); kehrt nie zurück."""
    uv = shutil.which("uv") or next((p for p in map(os.path.expanduser, UV) if os.access(p, os.X_OK)), None)
    if os.environ.get(NEU_GESTARTET) or not uv:
        raise RuntimeError("Python ab 3.11 oder uv nötig")
    os.environ[NEU_GESTARTET] = "1"
    os.execv(uv, [uv, "run", "--quiet", "--no-project", "--python", "3.12", str(Path(__file__).resolve())])


def woerter(befehl: str) -> list[str]:
    lex = shlex.shlex(befehl, posix=True, punctuation_chars=";&|()\n")
    lex.whitespace = " \t\r"
    lex.whitespace_split = True
    try:
        return list(lex)
    except ValueError:  # offene Anführungszeichen: grob nach Leerraum
        return [w for w in re.split(r"[ \t]+|(\n|;|&&|\|\||\|)", befehl) if w]


def teilbefehle(befehl: str, cwd: Path) -> list[Teil]:
    """Zerlegt in Teilbefehle; `cd <ort>` gilt für die folgenden Teile."""
    teile, aktuell, ort = [], [], cwd
    for wort in [*woerter(befehl), ";"]:
        if wort not in TRENNER:
            if wort != "$":
                aktuell.append(wort)
            continue
        while aktuell and re.fullmatch(r"[A-Za-z_]\w*=.*", aktuell[0]):
            aktuell.pop(0)
        if aktuell[:1] == ["cd"] and len(aktuell) > 1:
            ort = ort_von(ort, aktuell[1])
        elif aktuell:
            teile.append(git_ohne_optionen(aktuell, ort))
        aktuell = []
    return teile


def ort_von(basis: Path, pfad: str) -> Path:
    return Path(os.path.normpath(basis / os.path.expanduser(os.path.expandvars(pfad))))


def git_ohne_optionen(w: list[str], ort: Path) -> Teil:
    if w[0] != "git":
        return Teil(w, ort)
    rest, i = ["git"], 1
    while i < len(w) and w[i].startswith("-"):
        if w[i] == "-C" and i + 1 < len(w):
            ort = ort_von(ort, w[i + 1])
        i += 2 if w[i] in GIT_OPTIONEN_MIT_WERT else 1
    return Teil(rest + w[i:], ort)


def git(ort: Path, *args: str) -> str:
    try:
        lauf = subprocess.run(["git", "-C", str(ort), *args], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return lauf.stdout.strip() if lauf.returncode == 0 else ""


def im_hauptcheckout(ort: Path) -> bool:
    zeilen = git(ort, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir").splitlines()
    return len(zeilen) == 2 and Path(zeilen[0]).resolve() == Path(zeilen[1]).resolve()


def erlaubte_orte(regel: Regel, ort: Path, eingabe: dict) -> list[Path]:
    orte = []
    if "worktree" in regel.erlaubt_in and not im_hauptcheckout(ort) and (oben := git(ort, "rev-parse", "--show-toplevel")):
        orte.append(Path(oben).resolve())
    if "arbeitsordner" in regel.erlaubt_in and eingabe.get("scratchpad_dir"):
        orte.append(Path(eingabe["scratchpad_dir"]).resolve())
    return orte


def temp_wurzel(pfad: Path) -> Path | None:
    """Der temporäre Ordner, unter dem `pfad` (absolut, normalisiert) echt tiefer liegt: /tmp,
    /private/tmp, /var/folders/<a>/<b>/<c> oder $TMPDIR (nur unter diesen); der engste zählt."""
    tmpdir = os.environ.get("TMPDIR", "")
    tmpdirs = [Path(os.path.normpath(tmpdir)), Path(os.path.realpath(tmpdir))] if os.path.isabs(tmpdir) else []
    wurzeln = [Path(w) for w in TEMP]
    for ordner in [pfad, *tmpdirs]:
        for basis in map(Path, TEMP_JE_NUTZER):
            tiefe = len(basis.parts) + 3
            if ordner.parts[:len(basis.parts)] == basis.parts and len(ordner.parts) >= tiefe:
                wurzeln.append(Path(*ordner.parts[:tiefe]))
    wurzeln += [t for t in tmpdirs if any(w == t or w in t.parents for w in wurzeln)]
    if pfad in wurzeln:
        return None
    unter = [w for w in wurzeln if w in pfad.parents and not any(MUSTER.search(t) for t in w.parts)]
    return max(unter, key=lambda w: len(w.parts), default=None)


def im_temp(wort: str) -> bool:
    """Ist `wort` (aufgelöst, absolut) ein Pfad echt unter einem temporären Ordner, ohne `..`, ohne
    offene Variable und ohne Muster direkt unter dem Ordner?"""
    if "$" in wort or not os.path.isabs(wort) or ".." in Path(wort).parts:
        return False
    pfad = Path(os.path.normpath(wort))
    wurzel = temp_wurzel(pfad)
    return wurzel is not None and not MUSTER.search(pfad.parts[len(wurzel.parts)])


def ssh_befehl(woerter: list[str], bis: int | None) -> list[str] | None:
    """Die Wörter, die ein ssh vor Index `bis` auf dem anderen Rechner ausführt; None ohne ssh."""
    i = next((i for i, w in enumerate(woerter[:bis]) if Path(w).name == "ssh"), None)
    if i is None:
        return None
    i += 1
    while i < len(woerter) and woerter[i].startswith("-"):
        wort, i = woerter[i], i + 1
        wert = next((j for j, c in enumerate(wort[1:], 1) if c in SSH_MIT_WERT), None)
        if wert == len(wort) - 1:  # der Wert ist das nächste Wort
            i += 1
    return woerter[i + 1:]


def ziele_ausserhalb(regel: Regel, teil: Teil, eingabe: dict, fern: bool = False) -> bool:
    """Liegt ein vorhandener Pfad nach dem Wort `befehl` außerhalb der erlaubten Orte? Kommen die
    Ziele aus xargs oder einer offenen Variable, sind sie unbekannt und zählen als außerhalb. Über ssh
    (`fern`) zählt nur "temp", mit absolutem Pfad ohne Variable, Symlinks bleiben ungeprüft."""
    assert regel.befehl
    start = next((i for i, w in enumerate(teil.woerter) if regel.befehl.search(w)), None)
    if (anderswo := ssh_befehl(teil.woerter, start)) is not None:
        innen = [t for t in teilbefehle(" ".join(anderswo), Path("/"))
                 if regel.muster.search(t.text) and not (regel.ausser and regel.ausser.search(t.text))]
        return "temp" not in regel.erlaubt_in or not innen or any(
            ziele_ausserhalb(regel, t, eingabe, fern=True) for t in innen)
    if start is None or "xargs" in teil.woerter[:start]:
        return True
    orte = [] if fern else erlaubte_orte(regel, teil.ort, eingabe)
    temp = "temp" in regel.erlaubt_in
    for wort in teil.woerter[start + 1:]:
        if wort.startswith("-") or wort in ("{}", "\\;", "+"):
            continue
        if fern:
            if not (temp and im_temp(wort)):
                return True
            continue
        roh = os.path.expanduser(os.path.expandvars(wort))
        if "$" in roh:
            return True
        pfad = ort_von(teil.ort, wort)
        lexikalisch = temp and ".." not in Path(roh).parts and im_temp(str(pfad))
        for treffer in glob.glob(str(pfad)) or ([str(pfad)] if pfad.parent.exists() else []):
            echt = Path(treffer).resolve()
            if not (any(echt == o or o in echt.parents for o in orte) or lexikalisch and im_temp(str(echt))):
                return True
    return False


def greift(regel: Regel, befehl: str, teil: Teil | None, eingabe: dict) -> bool:
    text = befehl if teil is None else teil.text
    if not regel.muster.search(text) or (regel.ausser and regel.ausser.search(text)):
        return False
    if regel.auch and not regel.auch.search(befehl):
        return False
    ort = teil.ort if teil else Path(eingabe.get("cwd") or ".")
    if regel.hauptcheckout and not im_hauptcheckout(ort):
        return False
    if regel.zweig and not regel.zweig.search(git(ort, "branch", "--show-current")):
        return False
    return not (regel.befehl and teil and not ziele_ausserhalb(regel, teil, eingabe))


def pruefen(befehl: str, eingabe: dict, regelwerk: Regelwerk) -> Regel | None:
    """Die erste Regel, die den Befehl sperrt, sonst None. Regeln auf den ganzen Befehl gelten nach
    dem Repo am Arbeitsort, die übrigen je Teilbefehl nach dem Repo, in dem er wirkt."""
    cwd = Path(eingabe.get("cwd") or os.getcwd())
    for regel in regelwerk.fuer(cwd):
        if regel.ganz and greift(regel, befehl, None, eingabe):
            return regel
    for teil in teilbefehle(befehl, cwd):
        for regel in regelwerk.fuer(teil.ort):
            if not regel.ganz and greift(regel, befehl, teil, eingabe):
                return regel
    return None


def main() -> int:
    try:
        if sys.version_info < (3, 11):
            neu_starten()
        eingabe = json.load(sys.stdin)
        befehl = (eingabe.get("tool_input") or {}).get("command") or ""
        if eingabe.get("tool_name", "Bash") != "Bash" or not befehl.strip():
            return 0
        regel = pruefen(befehl, eingabe, Regelwerk(projekt_ordner()))
    except Exception as e:  # noqa: BLE001 -- was sich nicht prüfen lässt, wird nicht ausgeführt
        print(f"Befehlssperre: nicht prüfbar ({type(e).__name__}: {e}); Regeln in "
              ".claude/hooks/befehlssperre.toml und fleet.toml [agenten] prüfen", file=sys.stderr)
        return 2
    if regel:
        grund = f"Befehlssperre „{regel.name}“: {regel.grund}. Erlaubt: {regel.weg}."
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                 "permissionDecisionReason": grund}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
