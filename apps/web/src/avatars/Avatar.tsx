/**
 * Avatar eines Spielers (WP-032): eines der festen Motive aus `art.tsx` oder – ohne Wahl – der
 * Anfangsbuchstabe auf neutralem Kreis. Größe über CSS des Aufrufers (`width`/`height` am Element).
 */
import { isAvatarId } from '@poker/engine/protocol';
import { cx } from '../styles/cx';
import { AVATAR_ART } from './art';
import styles from './Avatar.module.css';

export interface AvatarProps {
  /** Avatar-ID vom Server; unbekannte Werte und `null` zeigen den Anfangsbuchstaben. */
  readonly avatar: string | null | undefined;
  /** Name des Spielers (Anfangsbuchstabe, Beschriftung). */
  readonly name: string;
  readonly className?: string | undefined;
  /** `true` = nur Dekoration (Name steht daneben), für Screenreader ausgeblendet. */
  readonly decorative?: boolean;
}

/** Anfangsbuchstabe für den Platzhalter (erstes Zeichen, groß; „?“ ohne Namen). */
export function initialOf(name: string): string {
  const segments = new Intl.Segmenter('de', { granularity: 'grapheme' }).segment(name.trim());
  const first = segments[Symbol.iterator]().next();
  return first.done === true ? '?' : first.value.segment.toLocaleUpperCase('de');
}

export function Avatar({ avatar, name, className, decorative = false }: AvatarProps) {
  const art = isAvatarId(avatar) ? AVATAR_ART[avatar] : null;
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': art === null ? `${name} (kein Avatar)` : `${name}: ${art.label}` } as const);
  return (
    <svg
      className={cx(styles.avatar, className)}
      viewBox="0 0 64 64"
      data-testid="avatar"
      data-avatar={art === null ? 'none' : avatar}
      focusable="false"
      {...a11y}
    >
      {art === null ? (
        <>
          <circle cx="32" cy="32" r="32" className={styles.placeholder} />
          <text x="32" y="33" className={styles.initial} textAnchor="middle" dominantBaseline="central">
            {initialOf(name)}
          </text>
        </>
      ) : (
        <>
          <circle cx="32" cy="32" r="32" fill={art.bg} />
          {art.draw()}
        </>
      )}
    </svg>
  );
}
