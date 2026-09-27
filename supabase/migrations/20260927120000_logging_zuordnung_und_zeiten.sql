-- Logging, Teil 1: wie jede Meldung zugeordnet wurde, und wann ein Geruecht entstand
-- und klassifiziert wurde. Bisher stand die Zuordnung nur in der API-Antwort und ging
-- danach verloren; Zeitstempel hatte nur die Meldung.
-- Nutzen: Fehlersuche (warum landete Meldung X in Geruecht Y?), Kalibrieren der
-- Aehnlichkeitsschwelle, Trends und Durchlaufzeiten im Dashboard.

alter table public.meldungen
  add column zuordnung_art text check (zuordnung_art in ('explizit', 'embedding', 'neu')),
  add column beste_aehnlichkeit double precision check (beste_aehnlichkeit between -1 and 1),
  add column embedding_fehler text;

comment on column public.meldungen.zuordnung_art is
  'explizit = geruecht_id mitgeschickt, embedding = per Aehnlichkeitssuche, neu = neues Geruecht. Leer bei Meldungen vor 2026-09-27.';
comment on column public.meldungen.beste_aehnlichkeit is
  'Kosinus-Aehnlichkeit zur aehnlichsten frueheren Meldung, auch unterhalb der Schwelle. Leer, wenn nicht gesucht wurde (explizite geruecht_id, allererste Meldung, Embedding-Ausfall).';
comment on column public.meldungen.embedding_fehler is
  'Grund, warum kein Embedding gespeichert oder nicht gesucht wurde. Leer = alles lief.';

alter table public.geruechte
  add column angelegt_am timestamptz not null default now(),
  add column klassifiziert_am timestamptz;

-- Bestand: als Anlagezeit gilt die erste Meldung. Wann der Bestand klassifiziert wurde,
-- ist nicht mehr feststellbar, klassifiziert_am bleibt dort leer.
update public.geruechte g
set angelegt_am = m.erste
from (
  select geruecht_id, min(eingegangen_am) as erste
  from public.meldungen
  group by geruecht_id
) m
where m.geruecht_id = g.geruecht_id;

comment on column public.geruechte.angelegt_am is 'Zeitpunkt, zu dem das Geruecht entstand.';
comment on column public.geruechte.klassifiziert_am is
  'Zeitpunkt, zu dem die Kategorie zum ersten Mal gesetzt wurde. Leer = noch nicht klassifiziert oder vor 2026-09-27 klassifiziert.';

-- klassifiziert_am setzt die Datenbank selbst, egal auf welchem Weg die Kategorie kommt
-- (Edge Function oder SQL von Hand). Nur beim ersten Setzen, danach bleibt der Wert.
create or replace function public.klassifiziert_am_setzen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.kategorie_id is null and new.kategorie_id is not null then
    new.klassifiziert_am := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.klassifiziert_am_setzen() from public, anon, authenticated;

create trigger geruecht_klassifiziert_am_setzen
  before update of kategorie_id on public.geruechte
  for each row execute function public.klassifiziert_am_setzen();
