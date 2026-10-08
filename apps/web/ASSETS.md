# Assets und Lizenzen (apps/web)

Alle Grafiken, Schriften und Sounds der Web-App mit Herkunft und Lizenz (D-008: keine Originalassets, Logos oder Namen anderer Anbieter).

| Datei | Herkunft | Lizenz |
|---|---|---|
| `public/icons/icon.svg` | eigenes SVG (Pik-Symbol auf Tisch-Kreis), erzeugt von `scripts/generate-icons.mjs` | Projekt-eigen |
| `public/icons/icon-192.png`, `icon-512.png` | aus demselben SVG gerendert (`@resvg/resvg-js`) | Projekt-eigen |
| `public/icons/icon-maskable-512.png` | wie oben, vollflächig ohne Rundung (Maskable-Safe-Zone eingehalten) | Projekt-eigen |
| `public/icons/apple-touch-icon.png` | wie oben, 180 × 180 px, vollflächig | Projekt-eigen |

Sounds (WP-031): keine Audiodateien. Alle Klänge am Tisch (Karten, Chips, Check, Fold, „Du bist dran“, Gewinn) werden zur Laufzeit per Web Audio API aus Rauschen und einfachen Tönen synthetisiert (`src/sound/synth.ts`) – Projekt-eigen, keine fremden Assets.

Schriften: keine eigenen – `--font-sans` nutzt die Systemschrift des Geräts.

Werkzeug: `@resvg/resvg-js` (MPL-2.0) wird nur als Entwicklungswerkzeug zum Rendern genutzt und nicht ausgeliefert.

Karten, Chips und Marker der Tischansicht (WP-016): siehe [src/table/ASSETS.md](src/table/ASSETS.md).

Neue Assets hier mit Herkunft und Lizenz ergänzen.
