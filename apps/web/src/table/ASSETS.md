# Assets der Tischansicht

Alle Grafiken der Tischansicht sind **selbst gezeichnet** (WP-016) als React-SVG-Komponenten direkt im Code – keine fremden Dateien, keine Schriftarten, keine Originalassets anderer Anbieter (D-008). Lizenz: wie das Projekt.

| Asset                              | Datei                                  | Beschreibung                                                                                                                                             |
| ---------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Farbsymbole Kreuz, Karo, Herz, Pik | `assets/suits.tsx`                     | eigene Bézier-Pfade im Raster 0–100                                                                                                                      |
| Kartenvorderseite                  | `assets/CardSvg.tsx` (`CardFaceSvg`)   | 5:7, großer Rang + Symbol oben links, großes Symbol unten rechts; Farben über Tokens `--color-card-*`, Vier-Farben-Deck optional (Karo blau, Kreuz grün) |
| Kartenrückseite                    | `assets/CardSvg.tsx` (`CardBackSvg`)   | eigenes Rautengitter mit Rahmen und Medaillon in `--color-surface-2`/`--color-accent`                                                                    |
| Chip                               | `assets/icons.tsx` (`ChipSvg`)         | Scheibe mit sechs Randmarken und Innenring                                                                                                               |
| Dealer-Button, SB/BB-Marker        | `assets/icons.tsx` (`MarkerDiscSvg`)   | Scheibe mit „D“ bzw. „SB“/„BB“                                                                                                                           |
| Symbol „Verbindung getrennt“       | `assets/icons.tsx` (`DisconnectedSvg`) | unterbrochener Stecker                                                                                                                                   |
| Menü-Symbol (Tisch-Menü, WP-017)   | `assets/icons.tsx` (`MenuSvg`)         | drei abgerundete Balken                                                                                                                                  |

Text auf Karten und Markern nutzt die System-Schrift (`--font-sans`).
