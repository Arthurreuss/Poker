# Avatare (WP-032)

Alle 24 Avatare sind **selbst gezeichnet** als React-SVG-Komponenten in `art.tsx` (Raster 0–64, Kreis mit Hintergrundfarbe und einfachem Motiv aus Kreisen, Ellipsen und Pfaden) – keine fremden Dateien, keine Originalassets anderer Anbieter (D-008). Nur SVG-Attribute, kein `style` (CSP). Lizenz: wie das Projekt.

Die IDs stehen im Protokoll (`AVATAR_IDS`, `packages/engine/src/protocol/avatars.ts`); `Avatar.tsx` zeigt ohne Avatar den Anfangsbuchstaben auf neutralem Kreis.

| ID | Motiv |
|---|---|
| `fox` | Fuchs |
| `cat` | Katze |
| `owl` | Eule |
| `bear` | Bär |
| `rabbit` | Hase |
| `frog` | Frosch |
| `panda` | Panda |
| `penguin` | Pinguin |
| `lion` | Löwe |
| `pig` | Schwein |
| `mouse` | Maus |
| `dog` | Hund |
| `chip` | Chip |
| `spade` | Pik |
| `heart` | Herz |
| `diamond` | Karo |
| `club` | Kreuz |
| `crown` | Krone |
| `star` | Stern |
| `moon` | Mond |
| `rocket` | Rakete |
| `ghost` | Geist |
| `robot` | Roboter |
| `cactus` | Kaktus |

Emoji-Reaktionen am Tisch (`src/reactions/reactions.ts`) sind Unicode-Emojis aus der Systemschrift des Geräts, keine eigenen Grafiken.
