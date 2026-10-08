/**
 * Chip-Symbol, Dealer-Button, Blind-Marker und Getrennt-Symbol – selbst gezeichnete SVGs (D-008).
 * Herkunft: ../ASSETS.md.
 */

/** Spielchip: Scheibe mit sechs Randmarken und Innenring. */
export function ChipSvg() {
  const marks = [0, 60, 120, 180, 240, 300];
  return (
    <svg viewBox="0 0 24 24" className="pt-chip-svg" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" className="pt-chip-base" />
      {marks.map((deg) => (
        <rect
          key={deg}
          x="10.4"
          y="0.6"
          width="3.2"
          height="4.4"
          rx="0.6"
          className="pt-chip-mark"
          transform={`rotate(${String(deg)} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="6.6" className="pt-chip-inner" />
      <circle cx="12" cy="12" r="5.2" className="pt-chip-base" />
    </svg>
  );
}

/** Dealer-Button („D“) bzw. Blind-Marker („SB“/„BB“) als Scheibe. */
export function MarkerDiscSvg({ label, variant }: { label: string; variant: 'dealer' | 'blind' }) {
  return (
    <svg viewBox="0 0 24 24" className={`pt-marker-svg pt-marker-${variant}`} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11.2" className="pt-marker-disc" />
      <circle cx="12" cy="12" r="9" className="pt-marker-ring" fill="none" strokeWidth="0.9" />
      <text
        x="12"
        y="12"
        dy="0.36em"
        textAnchor="middle"
        className="pt-marker-text"
        fontSize={label.length > 1 ? 9.5 : 13}
        letterSpacing={label.length > 1 ? -0.4 : 0}
      >
        {label}
      </text>
    </svg>
  );
}

/** Getrennt: unterbrochener Stecker. */
export function DisconnectedSvg() {
  return (
    <svg viewBox="0 0 16 16" className="pt-icon-svg" aria-hidden="true" focusable="false">
      <path
        d="M2 14 L5 11 M14 2 L11 5 M5.5 7 L3.8 8.7 A2.6 2.6 0 0 0 7.3 12.2 L9 10.5 M10.5 9 L12.2 7.3 A2.6 2.6 0 0 0 8.7 3.8 L7 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M2 2 L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Menü-Symbol des Tisch-Menüs: drei abgerundete Balken (WP-017). */
export function MenuSvg() {
  return (
    <svg viewBox="0 0 24 24" className="pt-icon-svg" aria-hidden="true" focusable="false">
      {[6, 12, 18].map((y) => (
        <rect key={y} x="4" y={y - 1.2} width="16" height="2.4" rx="1.2" fill="currentColor" />
      ))}
    </svg>
  );
}
