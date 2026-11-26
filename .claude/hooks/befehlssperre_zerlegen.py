"""Zerlegung eines Shell-Befehls für die Befehlssperre (gespiegelt aus fleet, neben befehlssperre.py).

Ein Befehl wird zu Teilbefehlen (`Teil`): Wörter mit der Kennung, ob sie in Anführungszeichen
standen, Umleitungen mit Ziel, Eingaben aus Heredocs und Here-Strings, der Ort nach `cd` und die
Variablen, die der Befehl vorher setzt (`X=…`, `export X=…`, `for x in …`). Heredoc-Körper sind nie
Befehle; Text in Anführungszeichen und Werte von Text-Optionen (`--body`, `-m`, `--title`) zählen
für die Muster als «text», außer der Teilbefehl startet eine Shell (ssh, sh, bash, zsh, eval).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

TRENNER = {";", "&&", "||", "|", "&", "\n", "(", ")", ";;", "|&"}
UMLEITUNGEN = {"&>>", "&>", ">>", ">|", ">&", "<<<", "<<-", "<<", "<&", "<>", ">", "<"}
OPERATOREN = sorted(TRENNER | UMLEITUNGEN, key=len, reverse=True)
HEREDOC = re.compile(r"(?<!<)<<(-?)[ \t]*(['\"]?)([A-Za-z_][\w.-]*)\2")
VARIABLE = re.compile(r"\$(?:(\w+)|\{(\w+)\})")
ZUWEISUNG =re.compile(r"([A-Za-z_]\w*)=(.*)", re.S)
SCHLUESSELWOERTER = {"do", "then", "else", "elif", "if", "while", "until", "{", "}", "!", "done", "fi", "esac"}
SHELLS = {"ssh", "sh", "bash", "zsh", "eval", "su"}
TEXT_OPTIONEN = {"--body", "--title", "--message", "--notes", "--subject"}
TEXT_KURZ = {"-m", "-b", "-t"}  # nur nach git und gh
GIT_OPTIONEN_MIT_WERT = {"-C", "-c", "--git-dir", "--work-tree", "--namespace"}
SSH_MIT_WERT = set("BbcDEeFIiJLlmOoPpQRSWw")  # Optionen von ssh, die einen Wert nehmen
TEXT = "«text»"
HOECHSTENS = 64  # Varianten eines Worts aus Variablen mit mehreren Werten


class Wort(str):
    """Ein Wort des Befehls; `zitiert`, wenn ein Teil davon in Anführungszeichen stand."""

    zitiert: bool

    def __new__(cls, text: str, zitiert: bool = False) -> Wort:
        wort = super().__new__(cls, text)
        wort.zitiert = zitiert
        return wort


class Op(str):
    """Ein Operator außerhalb von Anführungszeichen: Trenner oder Umleitung (mit Nummer davor)."""


@dataclass
class Teil:
    """Ein Teilbefehl: Wörter (vor git ohne -C/-c, ohne Umleitungen) und das Verzeichnis, in dem er läuft."""
    woerter: list[str]
    ort: Path
    umleitungen: list[tuple[str, str]] = field(default_factory=list)  # (Operator, Ziel)
    eingaben: list[str] = field(default_factory=list)  # Heredocs und Here-Strings
    variablen: dict[str, list[str] | None] = field(default_factory=dict)  # None: Wert unbekannt

    @property
    def text(self) -> str:
        """Der Teilbefehl für die Muster der Regeln, Text als «text», Umleitungen hinten."""
        shell = any(Path(w).name in SHELLS for w in self.woerter if not getattr(w, "zitiert", False))
        kurz = self.woerter[:1] in (["git"], ["gh"])
        aus = []
        for i, w in enumerate(self.woerter):
            davor = self.woerter[i - 1] if i else ""
            if davor in TEXT_OPTIONEN or kurz and davor in TEXT_KURZ:
                w = TEXT
            elif w.split("=", 1)[0] in TEXT_OPTIONEN and "=" in w:
                w = w.split("=", 1)[0] + "=" + TEXT
            elif not shell and getattr(w, "zitiert", False) and re.search(r"\s", w):
                w = TEXT
            aus.append(w)
        return " ".join(aus + [f"{op} {ziel}" for op, ziel in self.umleitungen])


def heredocs_heraus(befehl: str) -> tuple[str, list[str]]:
    """Der Befehl ohne die Körper seiner Heredocs (nur mit Endzeile) und die Körper der Reihe nach."""
    zeilen, rest, koerper, i = befehl.split("\n"), [], [], 0
    while i < len(zeilen):
        rest.append(zeilen[i])
        i += 1
        for m in HEREDOC.finditer(rest[-1]):
            ende = next((j for j in range(i, len(zeilen))
                         if (zeilen[j].lstrip("\t") if m[1] else zeilen[j]) == m[3]), None)
            if ende is not None:
                koerper.append("\n".join(zeilen[i:ende]))
                i = ende + 1
    return "\n".join(rest), koerper


def woerter(befehl: str) -> list[str]:
    """Wörter (`Wort`) und Operatoren (`Op`) wie die Shell; `$(` und Backticks trennen wie `(`."""
    aus: list[str] = []
    stueck: list[str] = []
    zitiert, i, n = False, 0, len(befehl)

    def fertig() -> None:
        nonlocal zitiert
        if stueck or zitiert:
            aus.append(Wort("".join(stueck), zitiert))
        stueck.clear()
        zitiert = False

    while i < n:
        c = befehl[i]
        if c == "\\":
            if befehl[i + 1:i + 2] not in ("\n", ""):
                stueck.append(befehl[i + 1])
                zitiert = True
            i += 2
        elif c in "'\"":
            text, i = zitat(befehl, i)
            stueck.append(text)
            zitiert = True
        elif c in " \t\r":
            fertig()
            i += 1
        elif c == "#" and not stueck and not zitiert:
            i = befehl.find("\n", i) if "\n" in befehl[i:] else n
        elif befehl.startswith("$(", i) or c == "`":
            fertig()
            aus.append(Op("("))
            i += 2 if c == "$" else 1
        elif op := next((o for o in OPERATOREN if befehl.startswith(o, i)), None):
            nummer = "".join(stueck) if op in UMLEITUNGEN and not zitiert and "".join(stueck).isdigit() else ""
            stueck.clear() if nummer else fertig()
            aus.append(Op(nummer + op))
            i += len(op)
        else:
            stueck.append(c)
            i += 1
    fertig()
    return aus


def zitat(befehl: str, i: int) -> tuple[str, int]:
    """Inhalt der Anführungszeichen ab `i` und die Stelle dahinter; offen bis zum Ende."""
    zeichen, j, text = befehl[i], i + 1, []
    while j < len(befehl) and befehl[j] != zeichen:
        if zeichen == '"' and befehl[j] == "\\" and befehl[j + 1:j + 2] in ('"', "\\", "$", "`"):
            j += 1
        text.append(befehl[j])
        j += 1
    return "".join(text), j + 1


def teilbefehle(befehl: str, cwd: Path) -> list[Teil]:
    """Zerlegt in Teilbefehle; `cd <ort>` und Zuweisungen gelten für die folgenden Teile."""
    rest, koerper = heredocs_heraus(befehl)
    teile: list[Teil] = []
    variablen: dict[str, list[str] | None] = {}
    toks, ort, i = [*woerter(rest), Op(";")], cwd, 0
    aktuell = Teil([], cwd)
    while i < len(toks):
        w, i = toks[i], i + 1
        if isinstance(w, Op) and w not in TRENNER:
            ziel = toks[i] if i < len(toks) and not isinstance(toks[i], Op) else ""
            i += bool(ziel)
            art = w.lstrip("0123456789")
            if art in ("<<", "<<-"):
                aktuell.eingaben.append(koerper.pop(0) if koerper else "")
            elif art == "<<<":
                aktuell.eingaben.append(ziel)
            else:
                aktuell.umleitungen.append((w, ziel))
        elif not isinstance(w, Op):
            for _ in HEREDOC.finditer(w) if getattr(w, "zitiert", False) else ():
                koerper[:1] = []  # Heredoc in "$(…)" in Anführungszeichen: Text
            aktuell.woerter.append(w)
        else:
            ort = abschliessen(aktuell, ort, variablen, teile, w == "(")
            aktuell = Teil([], ort)
    return teile


def abschliessen(teil: Teil, ort: Path, variablen: dict, teile: list[Teil], ersetzung: bool) -> Path:
    """Nimmt `teil` in `teile` auf, merkt Zuweisungen (vor `$(` unbekannt) und gibt den Ort danach zurück."""
    w = teil.woerter
    while w and w[0] in SCHLUESSELWOERTER and not getattr(w[0], "zitiert", False):
        w.pop(0)
    zuweisungen = [ZUWEISUNG.fullmatch(x) for x in (w[1:] if w[:1] in (["export"], ["local"]) else w)]
    if w and all(zuweisungen):
        for m in zuweisungen:
            werte = ausdehnen(m[2], variablen)
            variablen[m[1]] = None if ersetzung and m is zuweisungen[-1] or "$" in "".join(werte) else werte
        return ort
    while w and ZUWEISUNG.fullmatch(w[0]):
        w.pop(0)
    if len(w) >= 3 and w[0] == "for" and w[2] == "in":
        werte = [v for x in w[3:] for v in ausdehnen(x, variablen)]
        variablen[w[1]] = None if ersetzung or not werte or "$" in "".join(werte) else werte
    elif w[:1] == ["cd"] and len(w) > 1:
        return ort_von(ort, ausdehnen(w[1], variablen)[0])
    elif w or teil.umleitungen or teil.eingaben:
        teil.woerter, teil.ort = git_ohne_optionen(w, ort)
        teil.variablen = dict(variablen)
        teile.append(teil)
    return ort


def ausdehnen(wort: str, variablen: dict[str, list[str] | None]) -> list[str]:
    """Das Wort mit `~` und bekannten Variablen (aus dem Befehl, sonst aus der Umgebung), je Wert eine
    Variante; eine unbekannte Variable bleibt als `$` stehen."""
    varianten = [wort]
    for name in dict.fromkeys(m[1] or m[2] for m in VARIABLE.finditer(wort)):
        werte = variablen[name] if name in variablen else [os.environ[name]] if name in os.environ else None
        if werte is None:
            continue
        stelle = re.compile(rf"\$(?:{name}\b|\{{{name}\}})")
        varianten = [stelle.sub(lambda _, v=v: v, x) for x in varianten for v in werte][:HOECHSTENS]
    return [os.path.expanduser(x) for x in varianten]


def ort_von(basis: Path, pfad: str) -> Path:
    return Path(os.path.normpath(basis / os.path.expanduser(os.path.expandvars(pfad))))


def git_ohne_optionen(w: list[str], ort: Path) -> tuple[list[str], Path]:
    if w[:1] != ["git"]:
        return w, ort
    i = 1
    while i < len(w) and w[i].startswith("-"):
        if w[i] == "-C" and i + 1 < len(w):
            ort = ort_von(ort, w[i + 1])
        i += 2 if w[i] in GIT_OPTIONEN_MIT_WERT else 1
    return ["git", *w[i:]], ort


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
