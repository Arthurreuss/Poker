/** Verbindet CSS-Klassen (CSS-Modules liefern `string | undefined`); leere Werte fallen weg. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter((c): c is string => typeof c === 'string' && c !== '').join(' ');
}
