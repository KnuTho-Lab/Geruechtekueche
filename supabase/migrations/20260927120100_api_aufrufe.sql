-- Logging, Teil 2: Protokoll der API-Aufrufe, fuer Fehlersuche und die Aufrufstatistik
-- im Dashboard. Das Function-Log von Supabase haelt nur kurz und ist von aussen schwer
-- abzufragen, deshalb eine eigene Tabelle.
-- Bewusst ohne Inhalt: kein Body, keine Query, keine IP, kein Schluessel. Die
-- Geruechtekueche ist anonym, das Protokoll darf keinen Weg zur meldenden Person oeffnen.
-- Geschrieben werden nur Aufrufe mit gueltigem Schluessel (siehe _shared/http.ts):
-- sonst koennte jeder ohne Schluessel die Tabelle vollschreiben. Abgelehnte Aufrufe
-- (401, 405) stehen nur im Function-Log.
create table public.api_aufrufe (
  aufruf_id bigint generated always as identity primary key,
  zeitpunkt timestamptz not null default now(),
  endpunkt  text not null check (char_length(endpunkt) <= 100),
  methode   text not null check (char_length(methode) <= 10),
  status    smallint not null check (status between 100 and 599),
  dauer_ms  integer not null check (dauer_ms >= 0)
);

alter table public.api_aufrufe enable row level security;

-- Das Dashboard fragt nach Zeitraeumen
create index api_aufrufe_zeitpunkt on public.api_aufrufe (zeitpunkt);

comment on table public.api_aufrufe is
  'Ein Eintrag je API-Aufruf mit gueltigem Schluessel: Endpunkt, Methode, Status, Dauer. Kein Inhalt, keine IP.';
