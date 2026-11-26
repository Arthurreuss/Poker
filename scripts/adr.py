#!/usr/bin/env python3
"""ADRs des Projekts: Index erzeugen, prüfen und beim Merge nummerieren.

Gespiegelt aus fleet (fleet-Repo `vorlage/GESPIEGELT`), im Projekt nie von Hand ändern; Regel in
`.agents/rules/ordnung.md` „ADRs“, Verhalten im Zug in fleet-Repo docs/merge-zug.md „Haken“.

    python3 scripts/adr.py               # prüfen (Stufe static): Namen, Kopf, Nummern, Index
    python3 scripts/adr.py index         # Tabelle in docs/DECISIONS.md aus den ADRs neu schreiben
    python3 scripts/adr.py nach-rebase   # Haken des Merge-Zugs (fleet.toml [zug] nach_rebase)

Kopf jeder ADR `docs/adr/NNNN-slug.md`: `# ADR NNNN — Titel`, dann vor dem ersten `## ` je eine
Zeile `Status: …` und `Bereich: …`. Die Tabelle in `docs/DECISIONS.md` ab
`| Nr. | Titel | Status | Bereich |` bis zum Dateiende folgt daraus, nach Nummer; ADRs mit dem
Platzhalter (vier X statt der Nummer, Feature-Branch) stehen nicht darin.

Haken nach dem Rebase (Umgebung `ZUG_BASIS`, `ZUG_TITEL`, `ZUG_ERGEBNIS`; Exit 0 weiter, 3 zurück):
1. Neue ADRs mit Platzhalter bekommen fortlaufend die Nummern ab der höchsten im Stand, nach Slug
   geordnet: Dateiname, Kopf und jeder Verweis in den Zeilen, die der Branch hinzufügt oder ändert,
   dazu der PR-Titel. Eine neue ADR mit fester Nummer, die das Ziel schon hat, geht zurück.
2. Verweise: der Pfad `adr/<Platzhalter>-<slug>` überall; `ADR <Platzhalter>` und der Platzhalter
   als eigenes Wort außerhalb von Code-Spans, in der ADR selbst als ihre Nummer, sonst nur, wenn
   der Branch genau eine neue ADR bringt. Ersetzt wird in Fließtext und Konfiguration (nicht unter
   Test-Ordnern, nicht in Code-Blöcken), in Python in Kommentaren und Docstrings, sonst in
   Kommentarzeilen; nie in String-Literalen.
3. Bleibt ein Verweis stehen (mehrdeutig, ohne neue ADR, im String-Literal), geht der Branch mit
   den Fundstellen zurück. Danach wird der Index neu erzeugt.

Nur Standardbibliothek; Tests im fleet-Repo (`tests/test_adr.py`, `tests/test_zug_adr.py`).
"""

from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import tokenize
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
P = "X" * 4  # der Platzhalter, zur Laufzeit gebaut: der Haken ersetzt ihn nie in dieser Datei
ADR_ORDNER = "docs/adr"
INDEX = "docs/DECISIONS.md"
NAME = re.compile(rf"^(\d{{4}}|{P})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$")
KOPF_TABELLE = "| Nr. | Titel | Status | Bereich |\n|---|---|---|---|\n"
FELDER = ("Status", "Bereich")
ZURUECK = 3

# `ADR `, `ADR-` oder `adr/` vor dem Platzhalter (Gruppe 1), oder der Platzhalter als eigenes Wort.
VERWEIS = re.compile(rf"(?:(ADR[ -]|adr/){P}(?![\w])|(?<![\w/.`-]){P}(?![\w-]))")
EXPLIZIT = re.compile(rf"(?:ADR[ -]|adr/){P}(?![\w])")
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", re.MULTILINE)
FLIESSTEXT = re.compile(r"(\.(md|txt|toml|ya?ml|ini|cfg)|(^|/)\.env[^/]*)$")
TEST = re.compile(r"(^|/)(tests?|e2e|fixtures|__tests__)/|(^|/)test_[^/]*$|\.(test|spec)\.[^/]+$")
RAUTE = re.compile(r"(\.(sh|bash|zsh|rb)|(^|/)(Makefile|Dockerfile[^/]*|\.gitignore|\.gitattributes))$")
SCHRAEG = re.compile(r"\.([cm]?[jt]sx?|s?css|swift|go|rs|java|kt|c|h|cpp)$")
ZAUN = re.compile(r"^\s*(```|~~~)")

Bereiche = dict[int, list[tuple[int, int]]]  # Zeile (ab 1) → Spalten [von, bis), in denen ersetzt wird


class AdrFehler(ValueError):
    """Eine ADR oder der Index passt nicht zur Regel."""


class Zurueck(Exception):
    """Der Branch geht mit diesem Grund zurück."""


# --- Index -------------------------------------------------------------------------------------

def kopf(name: str, text: str) -> dict[str, str]:
    """Titel, Status und Bereich einer ADR aus ihrem Kopf (vor dem ersten `## `)."""
    zeilen = text.splitlines()
    nr = name[:4]
    titel = re.match(rf"^# ADR {nr} — (\S.*)$", zeilen[0] if zeilen else "")
    if not titel:
        raise AdrFehler(f"{name}: erste Zeile `# ADR {nr} — Titel`")
    felder = {"Titel": titel.group(1).strip()}
    for zeile in zeilen[1:]:
        if zeile.startswith("## "):
            break
        for feld in FELDER:
            if zeile.startswith(f"{feld}:") and feld not in felder:
                felder[feld] = zeile[len(feld) + 1:].strip().rstrip(".")
    fehlt = [f"`{f}: …`" for f in FELDER if not felder.get(f)]
    if fehlt:
        raise AdrFehler(f"{name}: Zeile {' und '.join(fehlt)} vor dem ersten Abschnitt fehlt")
    return felder


def adrs(repo: Path) -> list[tuple[str, dict[str, str]]]:
    """Nummer (oder Platzhalter) und Kopf jeder ADR, nach Dateiname; Fehler gesammelt."""
    ordner = repo / ADR_ORDNER
    fehler, out = [], []
    for pfad in sorted(ordner.iterdir()) if ordner.is_dir() else []:
        treffer = NAME.match(pfad.name)
        if not treffer:
            fehler.append(f"{ADR_ORDNER}/{pfad.name}: Name nicht `NNNN-kurzer-slug.md`")
            continue
        try:
            out.append((treffer.group(1), kopf(pfad.name, pfad.read_text(encoding="utf-8"))))
        except AdrFehler as fehler_kopf:
            fehler.append(str(fehler_kopf))
    nummern = [nr for nr, _ in out if nr != P]
    fehler += [f"ADR {nr} gibt es mehrfach" for nr in sorted({n for n in nummern if nummern.count(n) > 1})]
    if fehler:
        raise AdrFehler("; ".join(fehler))
    return out


def _zelle(text: str) -> str:
    return re.sub(r"(?<!\\)\|", r"\\|", text)


def index_text(repo: Path) -> str:
    """`docs/DECISIONS.md` mit erzeugter Tabelle: Text davor bleibt, Tabelle bis zum Dateiende."""
    jetzt = (repo / INDEX).read_text(encoding="utf-8")
    start = jetzt.find(KOPF_TABELLE.splitlines()[0])
    if start < 0 or (start and jetzt[start - 1] != "\n"):
        raise AdrFehler(f"{INDEX}: Tabelle `{KOPF_TABELLE.splitlines()[0]}` fehlt")
    zeilen = [f"| {nr} | {_zelle(k['Titel'])} | {_zelle(k['Status'])} | {_zelle(k['Bereich'])} |\n"
              for nr, k in sorted(adrs(repo), key=lambda adr: adr[0]) if nr != P]
    return jetzt[:start] + KOPF_TABELLE + "".join(zeilen)


def index_schreiben(repo: Path) -> bool:
    """Index neu schreiben; True, wenn er sich geändert hat."""
    neu = index_text(repo)
    if neu == (repo / INDEX).read_text(encoding="utf-8"):
        return False
    (repo / INDEX).write_text(neu, encoding="utf-8")
    return True


def pruefen(repo: Path) -> list[str]:
    """Namen, Köpfe, eindeutige Nummern und Index gleich dem erzeugten."""
    if not (repo / INDEX).is_file():
        return [f"{INDEX} fehlt"]
    try:
        if index_text(repo) != (repo / INDEX).read_text(encoding="utf-8"):
            return [f"{INDEX}: Tabelle weicht von den ADRs ab (`python3 scripts/adr.py index`)"]
    except AdrFehler as fehler:
        return [str(fehler)]
    return []


# --- Verweise ersetzen ---------------------------------------------------------------------------

def _ganze_zeilen(zeilen: list[str], ohne_tabelle: bool) -> Bereiche:
    out: Bereiche = {}
    im_block = False
    for nr, zeile in enumerate(zeilen, 1):
        if ZAUN.match(zeile):
            im_block = not im_block
        elif not im_block and not (ohne_tabelle and zeile.startswith("|")):
            out[nr] = [(0, len(zeile))]
    return out


def _kommentarzeilen(zeilen: list[str], anfaenge: tuple[str, ...]) -> Bereiche:
    out: Bereiche = {}
    for nr, zeile in enumerate(zeilen, 1):
        rest = zeile.lstrip()
        if rest.startswith(anfaenge):
            out[nr] = [(len(zeile) - len(rest), len(zeile))]
    return out


def _python(text: str, zeilen: list[str]) -> Bereiche:
    """Kommentare und Docstrings (ein String als eigene Anweisung), kein anderes Literal."""
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, SyntaxError):
        return {}
    out: Bereiche = {}
    wichtig = [t for t in tokens if t.type not in (tokenize.NL, tokenize.COMMENT)]
    anfang = {tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENCODING}
    for i, t in enumerate(wichtig):
        davor = wichtig[i - 1].type if i else tokenize.NEWLINE
        danach = wichtig[i + 1].type if i + 1 < len(wichtig) else tokenize.ENDMARKER
        if t.type == tokenize.STRING and davor in anfang and danach in (tokenize.NEWLINE, tokenize.ENDMARKER):
            tokens.append(t._replace(type=tokenize.COMMENT))
    for t in tokens:
        if t.type == tokenize.COMMENT:
            (z0, s0), (z1, s1) = t.start, t.end
            for nr in range(z0, min(z1, len(zeilen)) + 1):
                out.setdefault(nr, []).append((s0 if nr == z0 else 0, s1 if nr == z1 else len(zeilen[nr - 1])))
    return out


def fliesstext(pfad: str) -> bool:
    return bool(FLIESSTEXT.search(pfad))


def bereiche(pfad: str, text: str) -> Bereiche:
    """Wo in `pfad` ein Verweis auf den Platzhalter ersetzt wird."""
    zeilen = text.splitlines(keepends=True)
    if pfad.endswith(".py"):
        return _python(text, zeilen)
    if TEST.search(pfad):
        return {}
    if fliesstext(pfad):
        return _ganze_zeilen(zeilen, ohne_tabelle=pfad == INDEX)
    if RAUTE.search(pfad):
        return _kommentarzeilen(zeilen, ("#",))
    if SCHRAEG.search(pfad):
        return _kommentarzeilen(zeilen, ("//", "/*", "*"))
    return {}


def ersetze_text(text: str, nummern: dict[str, str], ziel: str | None) -> str:
    """Ein Stück Text (auch der PR-Titel): Pfade neuer ADRs (`nummern`: Slug → Nummer) überall, sonst
    außerhalb von Code-Spans; ein Verweis ohne Slug wird `ziel`, ohne `ziel` bleibt er."""
    teile = text.split("`")
    for i, teil in enumerate(teile):
        for slug, nr in nummern.items():
            teil = re.sub(rf"(adr/){P}(?=-{re.escape(slug)}(?![a-z0-9-]))", rf"\g<1>{nr}", teil)
        if i % 2 == 0 and ziel:
            teil = VERWEIS.sub(lambda m: (m.group(1) or "") + ziel, teil)
        teile[i] = teil
    return "`".join(teile)


def rest(pfad: str, zeile: str, adr_datei: bool) -> bool:
    """Steht in der Zeile nach dem Ersetzen noch ein Verweis? In Fließtext außerhalb von Code-Spans
    (in einer ADR auch der Platzhalter als Wort), sonst überall (String-Literal)."""
    if not fliesstext(pfad):
        return bool(EXPLIZIT.search(zeile))
    aussen = " ".join(zeile.split("`")[0::2])
    return bool((VERWEIS if adr_datei else EXPLIZIT).search(aussen))


def ersetzen(pfad: str, text: str, nur: set[int] | None, nummern: dict[str, str],
             eigene: str | None = None) -> tuple[str, list[int]]:
    """Verweise in den Zeilen `nur` (None: alle) von `pfad` ersetzen; ein Verweis ohne Slug wird
    `eigene` (in der ADR selbst), sonst die einzige neue Nummer. Neuer Text und Zeilen mit Rest."""
    ziel = eigene or (next(iter(nummern.values())) if len(nummern) == 1 else None)
    zeilen = text.splitlines(keepends=True)
    erlaubt = bereiche(pfad, text)
    adr_datei = pfad.startswith(f"{ADR_ORDNER}/")
    offen = []
    for nr in range(1, len(zeilen) + 1):
        if nur is not None and nr not in nur:
            continue
        zeile = zeilen[nr - 1]
        for von, bis in sorted(erlaubt.get(nr, []), reverse=True):
            zeile = zeile[:von] + ersetze_text(zeile[von:bis], nummern, ziel) + zeile[bis:]
        zeilen[nr - 1] = zeile
        if (nr in erlaubt or not fliesstext(pfad)) and rest(pfad, zeile, adr_datei):
            offen.append(nr)
    return "".join(zeilen), offen


# --- Haken des Zugs ------------------------------------------------------------------------------

def git(wt: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=wt, capture_output=True, text=True, check=True).stdout


def zeilen_des_branches(wt: Path, basis: str, pfad: str) -> set[int]:
    """Zeilen (ab 1), die der Branch in `pfad` gegenüber `basis` hinzufügt oder ändert."""
    out: set[int] = set()
    for treffer in HUNK.finditer(git(wt, "diff", "-U0", "--no-color", basis, "HEAD", "--", pfad)):
        start, anzahl = int(treffer.group(1)), int(treffer.group(2) or 1)
        out.update(range(start, start + anzahl))
    return out


def nummern_vergeben(wt: Path, basis: str) -> dict[str, str]:
    """Slug → Nummer der neuen ADRs mit Platzhalter; feste Nummern, die das Ziel hat, gehen zurück."""
    neu = git(wt, "diff", "--name-only", "--diff-filter=A", basis, "HEAD", "--", f"{ADR_ORDNER}/").split()
    ziel = {}
    for name in git(wt, "ls-tree", "--name-only", basis, f"{ADR_ORDNER}/").split():
        treffer = NAME.match(Path(name).name)
        if treffer and treffer.group(1) != P:
            ziel[treffer.group(1)] = name
    for pfad in neu:
        treffer = NAME.match(Path(pfad).name)
        if treffer and treffer.group(1) in ziel and ziel[treffer.group(1)] != pfad:
            raise Zurueck(f"ADR {treffer.group(1)} gibt es auf dem Ziel schon ({ziel[treffer.group(1)]}); "
                          f"neue ADRs mit Platzhalter {P} anlegen")
    vorhanden = [int(t.group(1)) for p in (wt / ADR_ORDNER).glob("*.md")
                 if (t := NAME.match(p.name)) and t.group(1) != P]
    slugs = sorted(t.group(2) for p in neu if (t := NAME.match(Path(p).name)) and t.group(1) == P)
    start = max(vorhanden, default=0)
    return {slug: f"{start + i:04d}" for i, slug in enumerate(slugs, 1)}


def nach_rebase(wt: Path, basis: str, titel: str) -> tuple[dict[str, object], int]:
    """Nummern vergeben, Verweise ersetzen, Index neu; Antwort für den Zug und Exit."""
    notizen: list[str] = []
    try:
        nummern = nummern_vergeben(wt, basis)
        offen: list[str] = []
        for pfad in git(wt, "diff", "--name-only", "--diff-filter=AMR", basis, "HEAD").splitlines():
            datei = wt / pfad
            try:
                text = datei.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            treffer = NAME.match(datei.name) if pfad.startswith(f"{ADR_ORDNER}/") else None
            eigene = nummern.get(treffer.group(2)) if treffer and treffer.group(1) == P else None
            neu, zeilen = ersetzen(pfad, text, None if eigene else zeilen_des_branches(wt, basis, pfad), nummern, eigene)
            ziel = f"{ADR_ORDNER}/{eigene}-{treffer.group(2)}.md" if eigene and treffer else pfad
            if ziel != pfad:
                datei.unlink()
            if ziel != pfad or neu != text:
                (wt / ziel).write_text(neu, encoding="utf-8")
            offen += [f"{ziel}:{nr}" for nr in zeilen]
        titel = ersetze_text(titel, nummern, ", ".join(nummern.values()) or None)
        notizen += [f"ADR {nr} ({slug})" for slug, nr in nummern.items()]
        if offen:
            raise Zurueck(f"Verweis auf den ADR-Platzhalter bleibt stehen ({', '.join(offen)}): mehrdeutig bei "
                          "mehreren neuen ADRs (Pfad `docs/adr/<Platzhalter>-<slug>.md` nennen), ohne neue ADR "
                          "oder in einem String-Literal (Platzhalter zur Laufzeit bauen)")
        if index_schreiben(wt):
            notizen.append("ADR-Index neu erzeugt")
    except AdrFehler as fehler:
        return {"titel": titel, "notizen": notizen, "grund": f"ADRs passen nicht zur Regel: {fehler}"}, ZURUECK
    except Zurueck as grund:
        return {"titel": titel, "notizen": notizen, "grund": str(grund)}, ZURUECK
    return {"titel": titel, "notizen": notizen}, 0


def main(argv: list[str]) -> int:
    if argv == ["nach-rebase"]:
        if not os.environ.get("ZUG_BASIS") or not os.environ.get("ZUG_ERGEBNIS"):
            print("Aufruf nur vom Merge-Zug: ZUG_BASIS=… ZUG_ERGEBNIS=… adr.py nach-rebase", file=sys.stderr)
            return 2
        antwort, code = nach_rebase(Path.cwd(), os.environ["ZUG_BASIS"], os.environ.get("ZUG_TITEL", ""))
        Path(os.environ["ZUG_ERGEBNIS"]).write_text(json.dumps(antwort, ensure_ascii=False), encoding="utf-8")
        return code
    if argv == ["index"]:
        try:
            print(f"{INDEX} {'neu geschrieben' if index_schreiben(ROOT) else 'unverändert'}")
        except AdrFehler as fehler:
            print(f"❌ {fehler}")
            return 1
        return 0
    if argv:
        print("Aufruf: adr.py [index | nach-rebase]", file=sys.stderr)
        return 2
    fehler = pruefen(ROOT)
    for f in fehler:
        print(f"❌ ADRs: {f}")
    if not fehler:
        print("✅ ADRs: Namen, Köpfe und Index passen.")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
