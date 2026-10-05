// Gemeinsamer Zugang der Dashboard-Seite zu Supabase: ein Client, ein Weg für Abfragen an die
// Edge Functions. Der öffentliche Schlüssel ist für den Browser gedacht und öffnet ohne Login
// nichts: anon und authenticated haben seit 2026-09-26 keine Tabellenrechte.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://apdwjhufucblzxaoztsv.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_weKrqRKNYmPJmUDdkT8FWg_VCA7wJ1m';
export const ZEITLIMIT_MS = 20000;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Ruft eine Edge Function mit dem Login-Token auf. Liefert { status, json }; json ist null,
// wenn die Antwort kein JSON war. Wirft nur bei Netzwerkfehlern und Zeitüberschreitung
// (status 0 am Fehlerobjekt), damit die Aufrufer einen Fehlertext ohne Technik zeigen können.
export async function funktion(name, { methode = 'GET', query = {}, body = null } = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { status: 401, json: null };
  const url = new URL(`${SUPABASE_URL}/functions/v1/${name}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url, {
      method: methode,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_KEY,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
      cache: 'no-store',
    });
    let json = null;
    try { json = await res.json(); } catch { /* keine JSON-Antwort */ }
    return { status: res.status, json };
  } catch (e) {
    throw Object.assign(new Error('netzwerk'), { status: 0 });
  }
}
