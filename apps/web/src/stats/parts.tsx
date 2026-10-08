// Kleine Bausteine für Rangliste, Profil und Hand-Historie (WP-019).
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Card } from '@poker/engine';
import { cardName, cardSuit, rankLabel } from '../table/format';
import { playerName } from './format';
import type { Resource } from './useResource';
import styles from './Stats.module.css';

const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' } as const;

/** Karte als kompakter Text („A♠“); ohne Karte verdeckt. */
export function MiniCard({ card }: { card?: Card | undefined }) {
  if (card === undefined) {
    return (
      <span className={styles.miniCard} data-hidden="true" role="img" aria-label="verdeckte Karte">
        ?
      </span>
    );
  }
  const suit = cardSuit(card);
  return (
    <span
      className={styles.miniCard}
      data-red={suit === 'h' || suit === 'd'}
      data-card={card}
      role="img"
      aria-label={cardName(card)}
    >
      {rankLabel(card)}
      {SUIT_SYMBOLS[suit]}
    </span>
  );
}

export function Cards({ cards, count = 0 }: { cards: readonly Card[] | null; count?: number }) {
  const list: (Card | undefined)[] = cards === null ? Array.from({ length: count }, () => undefined) : [...cards];
  if (list.length === 0) return null;
  return (
    <span className={styles.cards}>
      {list.map((c, i) => (
        <MiniCard key={`${c ?? 'x'}-${String(i)}`} card={c} />
      ))}
    </span>
  );
}

/** Spielername, verlinkt aufs Profil; gelöschte Spieler ohne Link. */
export function PlayerLink({ name }: { name: string | null }) {
  if (name === null) return <span className={styles.muted}>{playerName(null)}</span>;
  return (
    <Link className={styles.link} to={`/players/${encodeURIComponent(name)}`}>
      {name}
    </Link>
  );
}

/** Lade- und Fehlerzustand einheitlich; `children` rendert die Daten. */
export function ResourceView<T>({ resource, children }: { resource: Resource<T>; children: (data: T) => ReactNode }) {
  if (resource.status === 'loading') return <p className={styles.muted}>Lädt …</p>;
  if (resource.status === 'error') {
    return (
      <p className={styles.error} role="alert">
        {resource.error.message}
      </p>
    );
  }
  return <>{children(resource.data)}</>;
}

export function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.tile} title={hint}>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileLabel}>{label}</span>
    </div>
  );
}
