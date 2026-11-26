#!/usr/bin/env bash
# Öffnet Planer und Orchestrierer des Projekts als zwei Sitzungen von Claude Code (gespiegelt aus
# fleet, im Projekt nicht von Hand ändern). Je Rolle ein Fenster der Terminal-App von macOS im
# Projekt-Ordner; die Sitzung heißt nach Projekt und Rolle (demo-planer, demo-orchestrierer) und
# lädt den Skill der Rolle aus .claude/skills/. Der Projektname kommt aus fleet.toml [zug] projekt,
# sonst vom Ordner.
#   scripts/start.sh                 beide Rollen
#   scripts/start.sh orchestrierer   nur eine, etwa nach einem Absturz
#   scripts/start.sh --neu [rolle]   bewusst frisch, ohne die alte Sitzung fortzusetzen
#
# Fortsetzen: Gibt es im Profil für diesen Ordner schon eine Sitzung mit dem Namen, setzt start.sh
# die jüngste fort (`claude --resume <id> /<rolle>`, der Skill lädt neu und läuft „Bei jedem Start“
# an); sonst startet es neu. Gesucht wird wie bei `claude --resume <name>`: Titel (eigener, sonst
# der erzeugte) ohne Groß- und Kleinschreibung gleich dem Namen, in den Sitzungsdateien unter
# <profil>/projects/<Ordner mit „-“ statt Sonderzeichen>/. Findet es nichts, öffnet es eine neue
# Sitzung; `claude --resume` mit unbekanntem Namen fiele dagegen in die Auswahlliste.
#
# Startbefehl aus fleet.toml [agenten]:
#   start_profil     Konfigurations-Ordner von Claude Code (CLAUDE_CONFIG_DIR), `~` erlaubt; ohne
#                    Eintrag der des Aufrufers, wenn gesetzt, sonst die Vorgabe von Claude Code
#   start_argumente  Argumente für claude vor Name und Rolle; Vorgabe ["--dangerously-skip-permissions"]
#                    (ohne Rückfragen, die Befehlssperre bleibt der Schutz), [] fragt wieder nach
# Ohne die einmalige macOS-Freigabe (Automation: Terminal) bricht der Start nach kurzer Frist mit
# Hinweis ab. Liest fleet.toml mit python3 ab 3.11, sonst mit Python 3.12 über uv.
#
# Commit-Hooks: Bringt das Projekt `.githooks/` mit und ist `core.hooksPath` nicht gesetzt (etwa
# nach einem frischen Clone), setzt start.sh ihn auf `.githooks`; das gilt für jeden Worktree des
# Clones. Ein schon gesetzter Pfad bleibt, wie er ist.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
FRIST=20  # Sekunden, die Terminal für die Antwort hat (ohne Freigabe wartet macOS sonst 2 Minuten)
HOOKS=.githooks

hooks_einrichten() {
  [ -d "$REPO/$HOOKS" ] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || return 0
  git -C "$REPO" config --get core.hooksPath >/dev/null && return 0
  if git -C "$REPO" config core.hooksPath "$HOOKS"; then
    echo "start: Commit-Hooks eingerichtet (core.hooksPath=$HOOKS)"
  else
    echo "start: Hinweis: core.hooksPath nicht gesetzt, Commit-Hooks laufen nicht" >&2
  fi
}

wie=weiter
if [ "${1:-}" = "--neu" ]; then
  wie=neu
  shift
fi
if [ "$#" -eq 0 ]; then
  set -- planer orchestrierer
fi
for rolle in "$@"; do
  case "$rolle" in
    planer|orchestrierer) ;;
    *) echo "start: unbekannte Rolle $rolle (planer, orchestrierer)" >&2; exit 2 ;;
  esac
done
hooks_einrichten
command -v claude >/dev/null || { echo "start: claude nicht gefunden (Claude Code installieren)" >&2; exit 2; }
command -v osascript >/dev/null || { echo "start: osascript fehlt, start.sh läuft nur unter macOS" >&2; exit 2; }

py=(python3)
if ! python3 -c 'import tomllib' 2>/dev/null; then
  uv="$(command -v uv || true)"
  for k in /opt/homebrew/bin/uv /usr/local/bin/uv "$HOME/.local/bin/uv"; do
    [ -n "$uv" ] || { [ -x "$k" ] && uv="$k"; }
  done
  [ -n "$uv" ] || { echo "start: python3 ab 3.11 oder uv nötig, um fleet.toml zu lesen" >&2; exit 2; }
  py=("$uv" run -q --python 3.12 --no-project python)
fi

# Je Rolle eine Zeile „Name<Tab>geöffnet|fortgesetzt<Tab>Befehl“; der Befehl läuft in der Shell des
# neuen Fensters.
read -r -d '' BEFEHLE <<'PYTHON'
import glob, json, os, re, shlex, sys, tomllib

repo, wie, rollen = sys.argv[1], sys.argv[2], sys.argv[3:]


def titel(datei):
    """Titel der Sitzung wie bei Claude Code: der eigene (-n, /rename), sonst der erzeugte."""
    eigen = erzeugt = None
    with open(datei, "rb") as f:
        for zeile in f:
            if b'-title"' not in zeile:
                continue
            try:
                eintrag = json.loads(zeile)
            except ValueError:
                continue
            if eintrag.get("type") == "custom-title":
                eigen = eintrag.get("customTitle") or eigen
            elif eintrag.get("type") == "ai-title":
                erzeugt = eintrag.get("aiTitle") or erzeugt
    try:
        with open(os.path.join(datei[:-len(".jsonl")], "custom-title.json"), "rb") as f:
            eigen = json.load(f).get("customTitle") or eigen
    except (OSError, ValueError, AttributeError):
        pass
    return eigen or erzeugt


def sitzung(konfig, name):
    """ID der jüngsten Sitzung dieses Ordners mit dem Namen als Titel, sonst None."""
    treffer = []
    for ordner in {repo, os.path.realpath(repo)}:
        sitzungen = os.path.join(konfig, "projects", re.sub(r"[^A-Za-z0-9]", "-", ordner))
        for datei in glob.glob(os.path.join(glob.escape(sitzungen), "*.jsonl")):
            t = titel(datei)
            if isinstance(t, str) and t.strip().lower() == name.lower():
                treffer.append((os.path.getmtime(datei), os.path.basename(datei)[:-len(".jsonl")]))
    return max(treffer)[1] if treffer else None


try:
    with open(os.path.join(repo, "fleet.toml"), "rb") as f:
        daten = tomllib.load(f)
except FileNotFoundError:
    daten = {}
except tomllib.TOMLDecodeError as e:
    sys.exit(f"start: fleet.toml nicht lesbar: {e}")
projekt = (daten.get("zug") or {}).get("projekt")
if not isinstance(projekt, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", projekt):
    projekt = os.path.basename(repo)
agenten = daten.get("agenten") or {}
profil = agenten.get("start_profil", os.environ.get("CLAUDE_CONFIG_DIR", ""))
argumente = agenten.get("start_argumente", ["--dangerously-skip-permissions"])
if not isinstance(profil, str):
    sys.exit("start: fleet.toml [agenten] start_profil ist ein Pfad (Text)")
if not isinstance(argumente, list) or not all(isinstance(a, str) and a for a in argumente):
    sys.exit("start: fleet.toml [agenten] start_argumente ist eine Liste von Texten")
profil = os.path.expanduser(profil)
umgebung = f"CLAUDE_CONFIG_DIR={shlex.quote(profil)} " if profil else ""
konfig = profil or os.path.expanduser("~/.claude")
for rolle in rollen:
    name = f"{projekt}-{rolle}"
    alt = sitzung(konfig, name) if wie == "weiter" else None
    weg = ["--resume", alt] if alt else ["-n", name]
    claude = shlex.join(["claude", *argumente, *weg, f"/{rolle}"])
    print(f"{name}\t{'fortgesetzt' if alt else 'geöffnet'}\tcd {shlex.quote(repo)} && {umgebung}{claude}")
PYTHON

read -r -d '' APPLESCRIPT <<'APPLESCRIPT'
on run argv
  with timeout of (item 2 of argv as integer) seconds
    tell application "Terminal"
      activate
      do script (item 1 of argv)
    end tell
  end timeout
end run
APPLESCRIPT

zeilen="$("${py[@]}" -c "$BEFEHLE" "$REPO" "$wie" "$@")" || exit 2

while IFS=$'\t' read -r -u 3 name art befehl; do
  if ! fehler="$(osascript -e "$APPLESCRIPT" "$befehl" "$FRIST" 2>&1 >/dev/null)"; then
    case "$fehler" in
      *-1712*|*-1743*|*-1744*)
        echo "start: macOS lässt Terminal nicht steuern (keine Antwort binnen $FRIST s oder verweigert)." >&2
        echo "start: Freigabe einmal geben: Systemeinstellungen > Datenschutz & Sicherheit > Automation >" \
             "die App, aus der start.sh läuft > Terminal einschalten; fehlt der Eintrag, start.sh im" \
             "Terminal erneut aufrufen und die Rückfrage von macOS mit OK bestätigen." >&2 ;;
      *) echo "start: Fenster für $name nicht geöffnet: $fehler" >&2 ;;
    esac
    exit 1
  fi
  echo "start: $name $art"
done 3<<< "$zeilen"
