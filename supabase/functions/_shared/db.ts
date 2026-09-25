// Datenbank-Client mit Admin-Rechten. Er umgeht RLS und existiert nur serverseitig in
// der Edge Function, der Schluessel verlaesst Supabase nie.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { waehleAdminKey } from "./logik.ts";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = Deno.env.get("SUPABASE_URL");
  const key = waehleAdminKey(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), Deno.env.get("SUPABASE_SECRET_KEYS"));
  if (!url || !key) throw new Error("SUPABASE_URL oder Admin-Schluessel fehlt in der Umgebung");
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
