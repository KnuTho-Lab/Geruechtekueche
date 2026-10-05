// Reine Logik der Function statistik (Dashboard-Daten). Ohne Netzwerk, getestet in
// tests/statistik_logik_test.ts.

export const STANDARD_WOCHEN = 12;
export const MAX_WOCHEN = 52;

type Ergebnis<T> = { ok: true; wert: T } | { ok: false; fehler: string[] };

// Query-Parameter ?wochen=<1..52>, ohne Angabe 12. Nur ganze Zahlen in Dezimalschreibweise.
export function parseWochen(roh: string | null): Ergebnis<number> {
  if (roh === null || roh === "") return { ok: true, wert: STANDARD_WOCHEN };
  if (!/^\d{1,3}$/.test(roh)) return { ok: false, fehler: [`wochen muss eine ganze Zahl von 1 bis ${MAX_WOCHEN} sein`] };
  const n = Number(roh);
  if (n < 1 || n > MAX_WOCHEN) return { ok: false, fehler: [`wochen muss zwischen 1 und ${MAX_WOCHEN} liegen, nicht ${n}`] };
  return { ok: true, wert: n };
}
