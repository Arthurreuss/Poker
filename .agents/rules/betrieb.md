---
trigger: always_on
description: Prod, Deploys, Prioritäten, Modelle und Überwachung des Projekts poker im fleet-Verbund.
---
# Betrieb im fleet-Verbund

Verbindlich sind die Verträge im fleet-Repo (`docs/`, Index im `README.md`); hier steht nur,
was das Projekt davon beachtet. Verweise auf die fleet-Doku nur über Datei und Überschrift.

- **Grundregel:** Auf den Servern läuft das Projekt nur als Nomad-Job des Verbunds (Prüfung,
  Deploy, Modell, eigener Job im fleet-Repo) und nur bei Bedarf; keine eigenen Daemons.
  fleet-README „Grundregel“.
- **Zugang:** Die Server holen den Code über einen Deploy-Key (nur lesen), Host
  `github-poker`; Remote `git@github-poker:Arthurreuss/Poker.git`. fleet-Repo
  docs/maschinen.md „Zugang zum Repo“.
- **Prod:** Checkout von `main` unter `~fleet/poker`, Dienste als `docker compose`-Projekt
  `poker-prod` in der Prod-VM `prod-spiele` auf mac-2 (`prod.toml`, `deploy.toml` [poker]) mit
  `restart: unless-stopped`; Agenten fassen Prod nicht an, Release und Rollback startet der
  Mensch (`workflow.md` „Branches und Umgebungen“, Bedienung `docs/OPERATIONS.md`).
  Docker-Volumes immer benannt, Präfix `poker_`. Bind-Mounts nur unter `~fleet` und
  `/Users/Shared/fleet`. Sicherungen nach `/Users/Shared/fleet/backups/poker/`. fleet-Repo
  docs/ausrollen.md „Prod-VM“.
- **Von außen:** nur über einen eigenen Cloudflare-Tunnel des Projekts, als Compose-Dienst mit
  Profil `tunnel`; `scripts/deploy_job.sh` startet ihn, wenn das Token in der `.env` gesetzt ist.
  Der Hostname zeigt auf den Dienst im Compose-Netz. Nie der Tunnel `fleet`. fleet-Repo
  docs/ausrollen.md „Prod-VM“.
- **Deploys:** nur über die Warteschlange: `scripts/deploy_job.sh` nach dem Vertrag, Start mit
  `fleet.py deploy poker [<tag>] [--rollback]`; kein ssh-Deploy am Verbund vorbei.
  fleet-Repo docs/ausrollen.md „Deploys“.
- **Merge-Zug:** der Zug von fleet als Lauf `zug-poker` auf
  dem Studio, `fleet.toml` [zug] im Projekt, Eintrag in `zug.toml`; geschrieben wird mit dem
  Token der App, nie mit einem persönlichen. fleet-Repo docs/merge-zug.md „Merge-Zug“.
- **Prioritäten:** nur nach der Leiter im fleet-Repo docs/nomad.md „Prioritäten“; das Projekt
  setzt keine eigenen.
- **Platz:** Alles, was das Projekt auf den Servern ablegt, steht in
  `register/projekte/poker.toml` (fleet). Den Rücksicherungs-Test liefert `scripts/restore_test.sh` (Zeitplan in `deploy.toml`).
  fleet-Repo docs/ueberwachung.md „Platz und Sicherungen“.
- **Ausfälle:** Container mit Health-Check; neu starten tun Docker, Nomad und fleet, Alarme
  kommen vom Verbund. Keine eigenen Wächter. fleet-Repo docs/ueberwachung.md „Selbstheilung“.
- **Modelle und Live-Tests:** poker nutzt keine Modelle und hat keine Live-Tests.
- **Überwachung:** Health-URL als `[[check]]` in `fleet.toml` (fleet); Alarme stehen in Grafana,
  auf Telegram nur die, bei denen der Betreiber handeln muss. fleet-Repo docs/ueberwachung.md
  „Health-Prüfungen“.
- **Actions:** nur auf eigenen Runnern (`runs-on: [self-hosted, fleet, …]`, fleet-Repo docs/pruefungen.md
  „Actions-Runner“); keine Workflows, die GitHub-Minuten verbrauchen (Ausgabengrenze 0 $).
- **Änderungen am Verbund** (Register, Jobs, Alarme, Deploy-Vorlage): `.agents/fleet/arbeitsweise.md`
  „Verbote“.
