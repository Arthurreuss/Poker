/** Sitz-Hilfen, gemeinsam genutzt von Setzrunden und Showdown. */

/** Spieler im Uhrzeigersinn, beginnend mit dem ersten Sitz links von `seat` (`seat` selbst zuletzt). */
export function clockwiseFrom<T extends { seat: number }>(sortedBySeat: readonly T[], seat: number): T[] {
  const start = sortedBySeat.findIndex((p) => p.seat > seat);
  if (start <= 0) return [...sortedBySeat];
  return [...sortedBySeat.slice(start), ...sortedBySeat.slice(0, start)];
}
