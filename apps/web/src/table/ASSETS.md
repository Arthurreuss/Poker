# Assets der Tischansicht

Alle Grafiken der Tischansicht sind **selbst gezeichnet** (Ausnahme: Animationen der Feiern, siehe unten) (WP-016) als React-SVG-Komponenten direkt im Code – keine fremden Dateien, keine Schriftarten, keine Originalassets anderer Anbieter (D-008). Lizenz: wie das Projekt.

| Asset                              | Datei                                  | Beschreibung                                                                                                                                             |
| ---------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Farbsymbole Kreuz, Karo, Herz, Pik | `assets/suits.tsx`                     | eigene Bézier-Pfade im Raster 0–100                                                                                                                      |
| Kartenvorderseite                  | `assets/CardSvg.tsx` (`CardFaceSvg`)   | 5:7, großer Rang + Symbol oben links, großes Symbol unten rechts; Farben über Tokens `--color-card-*`, Vier-Farben-Deck optional (Karo blau, Kreuz grün) |
| Kartenrückseite                    | `assets/CardSvg.tsx` (`CardBackSvg`)   | eigenes Rautengitter mit Rahmen und Medaillon in `--color-surface-2`/`--color-accent`                                                                    |
| Chip                               | `assets/icons.tsx` (`ChipSvg`)         | Scheibe mit sechs Randmarken und Innenring                                                                                                               |
| Dealer-Button, SB/BB-Marker        | `assets/icons.tsx` (`MarkerDiscSvg`)   | Scheibe mit „D“ bzw. „SB“/„BB“                                                                                                                           |
| Symbol „Verbindung getrennt“       | `assets/icons.tsx` (`DisconnectedSvg`) | unterbrochener Stecker                                                                                                                                   |
| Menü-Symbol (Tisch-Menü, WP-017)   | `assets/icons.tsx` (`MenuSvg`)         | drei abgerundete Balken                                                                                                                                  |
| Symbol Hand-Übersicht (WP-038) | `hands/HandRankings.tsx` (`HandsSvg`) | zwei aufgefächerte Karten, vorne mit Karo |

Text auf Karten und Markern nutzt die System-Schrift (`--font-sans`).

## Animationen der Feiern (WP-040, D-034)

Lottie-Animationen von [LottieFiles](https://lottiefiles.com) unter der **Lottie Simple License** (kostenlos, auch kommerziell, ohne Namensnennungspflicht; [Lizenz](https://lottiefiles.com/page/license)). Ausgesucht von Arthur über `docs/animationen-vorschau.html`. Bearbeitung beim Übernehmen: aus `.lottie` entpackt, Zahlen auf 2–3 Nachkommastellen gerundet, Metadaten entfernt; bei `muenzen-stapel` die eingebettete Hintergrund-Bilddatei entfernt. Keine Expressions.

| Datei (`celebrate/clips/`) | Verwendung | Quelle |
| --- | --- | --- |
| `konfetti-kanone.json` | Konfetti | [exploding-ribbon-and-confetti](https://lottiefiles.com/free-animation/exploding-ribbon-and-confetti-9UErHOE0bL) |
| `konfetti-bunt.json` | Konfetti | [confetti-day](https://lottiefiles.com/free-animation/confetti-day-5JO59LTS6B) |
| `konfetti-feuerwerk.json` | Konfetti | [season-fireworks](https://lottiefiles.com/free-animation/season-fireworks-bbssnMF7fg) |
| `konfetti-party.json` | Konfetti | [party-celebration](https://lottiefiles.com/free-animation/party-celebration-Ei80CjLJQC) |
| `konfetti-regen.json` | Konfetti | [confetti-on-transparent-background](https://lottiefiles.com/free-animation/confetti-on-transparent-background-ajhx1TPBa7) |
| `konfetti-schlangen.json` | Konfetti | [confetti-im](https://lottiefiles.com/free-animation/confetti-im-s6Ca1FnyEe) |
| `konfetti-knall.json` | Konfetti | [celebration](https://lottiefiles.com/free-animation/celebration-mAnHKjVEgy) |
| `muenzen-klein.json` | Münzen ab 10 % | [coins-drop](https://lottiefiles.com/free-animation/coins-drop-TwJOQPJyFn) |
| `muenzen-stapel.json` | Münzen ab 25 % | [making-money](https://lottiefiles.com/free-animation/making-money-Os1hslOkjb) |
| `muenzen-regen.json` | Münzen ab 50 % | [money-rain](https://lottiefiles.com/free-animation/money-rain-hf41Intk7f) |
| `tisch-sieger.json` | Sieger des Tisches | [gold-winner-number-one-olive-branch-with-3-steps](https://lottiefiles.com/free-animation/gold-winner-number-one-olive-branch-with-3-steps-MSP8kwoeCq) |

Player: `lottie-web` 5.12.2 (MIT), Build `lottie_light`.
