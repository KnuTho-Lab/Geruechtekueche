-- Arbeitsbereich des Dashboards (dashboard-k/, Tab 2): Gerüchte lesen und den Status mit
-- Historie ändern (Knut, 2026-10-05). Aufgerufen nur von den Edge Functions arbeitsbereich und
-- arbeitsbereich_status (service_role), nie direkt vom Browser.
--
-- Historie: JEDE Statusänderung landet in status_historie, gleich auf welchem Weg sie kommt.
-- Das erledigt ein Trigger, nicht der Endpunkt. Wer die Änderung auslöst, steht in der
-- Sitzungsvariable app.nutzer (status_setzen setzt sie); fehlt sie, steht dort 'system'.
-- Die Historie ist die Grundlage für spätere Kennzahlen wie die Bearbeitungsdauer und lässt
-- sich nachträglich nicht rekonstruieren, deshalb von Anfang an.
-- Ausgeliefert werden nie user_id, Embeddings oder Zuordnungs-Interna.
create table public.status_historie (
  historie_id   bigint generated always as identity primary key,
  geruecht_id   bigint not null references public.geruechte (geruecht_id),
  alt           text not null check (alt in ('offen', 'bestätigt', 'widerlegt', 'nicht prüfbar')),
  neu           text not null check (neu in ('offen', 'bestätigt', 'widerlegt', 'nicht prüfbar')),
  geaendert_am  timestamptz not null default now(),
  geaendert_von text not null check (char_length(geaendert_von) between 1 and 40),
  check (alt <> neu)
);

alter table public.status_historie enable row level security;
create index status_historie_geruecht on public.status_historie (geruecht_id, geaendert_am);
create index status_historie_zeit on public.status_historie (geaendert_am);

comment on table public.status_historie is
  'Jede Statusänderung eines Gerüchts: alt, neu, Zeitpunkt, wer (Nutzername oder system). Geschrieben vom Trigger, nie von Hand.';

create or replace function public.status_historie_schreiben()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.status_historie (geruecht_id, alt, neu, geaendert_von)
  values (new.geruecht_id, old.status, new.status,
          coalesce(nullif(current_setting('app.nutzer', true), ''), 'system'));
  return new;
end;
$$;

create trigger geruecht_status_historie
  after update of status on public.geruechte
  for each row
  when (old.status is distinct from new.status)
  execute function public.status_historie_schreiben();

revoke execute on function public.status_historie_schreiben() from public, anon, authenticated;

-- Statuswechsel. Gibt nie eine Ausnahme für erwartbare Fälle, sondern ein Ergebnis:
--   ok            geändert, status ist der neue Wert
--   unveraendert  der Status war schon so, nichts geschrieben
--   konflikt      der Status ist nicht mehr der, den der Aufrufer gesehen hat (zweite Person war schneller)
--   nicht_gefunden
-- p_erwartet verhindert, dass zwei Personen sich gegenseitig unbemerkt überschreiben.
create or replace function public.status_setzen(p_geruecht_id bigint, p_neu text, p_erwartet text, p_von text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  aktuell text;
begin
  if p_neu is null or p_neu not in ('offen', 'bestätigt', 'widerlegt', 'nicht prüfbar') then
    raise exception 'ungueltiger Status: %', p_neu using errcode = '22023';
  end if;
  if p_von is null or char_length(p_von) not between 1 and 40 then
    raise exception 'p_von fehlt oder ist zu lang' using errcode = '22023';
  end if;

  select status into aktuell from public.geruechte where geruecht_id = p_geruecht_id for update;
  if not found then
    return jsonb_build_object('ergebnis', 'nicht_gefunden');
  end if;
  if p_erwartet is not null and aktuell <> p_erwartet then
    return jsonb_build_object('ergebnis', 'konflikt', 'status', aktuell);
  end if;
  if aktuell = p_neu then
    return jsonb_build_object('ergebnis', 'unveraendert', 'status', aktuell);
  end if;

  perform set_config('app.nutzer', p_von, true);
  update public.geruechte set status = p_neu where geruecht_id = p_geruecht_id;
  perform set_config('app.nutzer', '', true);
  return jsonb_build_object('ergebnis', 'ok', 'status', p_neu, 'vorher', aktuell);
end;
$$;

-- Liste für den Arbeitsbereich: ein Eintrag je Gerücht, ohne Meldungstexte.
create or replace function public.arbeitsbereich_liste()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'erzeugt_am', now(),
    'grenzen', jsonb_build_object('mittel', 0.40, 'hoch', 0.75),
    'geruechte', coalesce(jsonb_agg(z order by z.sortierung), '[]'::jsonb)
  )
  from (
    select
      g.geruecht_id,
      g.status,
      g.kernaussage,
      k1.name as kategorie,
      k2.name as zweitkategorie,
      g.risiko,
      g.risiko_status,
      g.manuell_pruefen,
      (select count(*) from public.meldungen m where m.geruecht_id = g.geruecht_id) as anzahl_meldungen,
      g.angelegt_am,
      (select max(m.eingegangen_am) from public.meldungen m where m.geruecht_id = g.geruecht_id) as letzte_meldung_am,
      (select max(h.geaendert_am) from public.status_historie h where h.geruecht_id = g.geruecht_id) as status_geaendert_am,
      g.geruecht_id as sortierung
    from public.geruechte g
    left join public.kategorien k1 on k1.kategorie_id = g.kategorie_id
    left join public.kategorien k2 on k2.kategorie_id = g.zweitkategorie_id
    order by g.geruecht_id desc
    limit 1000
  ) z;
$$;

-- Detail eines Gerüchts: Klassifizierung, Meldungen (Text, Zeit, Standort, Stimmung, Quelle) und Historie.
create or replace function public.arbeitsbereich_geruecht(p_geruecht_id bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  ergebnis jsonb;
begin
  select jsonb_build_object(
    'geruecht_id', g.geruecht_id,
    'status', g.status,
    'kernaussage', g.kernaussage,
    'kategorie', k1.name,
    'kategorie_konfidenz', g.kategorie_konfidenz,
    'zweitkategorie', k2.name,
    'zweitkategorie_konfidenz', g.zweitkategorie_konfidenz,
    'kategorie_begruendung', g.kategorie_begruendung,
    'manuell_pruefen', g.manuell_pruefen,
    'risiko', g.risiko,
    'risiko_status', g.risiko_status,
    'angelegt_am', g.angelegt_am,
    'meldungen', coalesce((
      select jsonb_agg(jsonb_build_object(
               'meldung_id', m.meldung_id,
               'eingegangen_am', m.eingegangen_am,
               'text', m.text,
               'standort', m.standort,
               'emotion', m.emotion,
               'quellenkette', m.quellenkette
             ) order by m.eingegangen_am, m.meldung_id)
      from public.meldungen m where m.geruecht_id = g.geruecht_id), '[]'::jsonb),
    'historie', coalesce((
      select jsonb_agg(jsonb_build_object(
               'historie_id', h.historie_id,
               'alt', h.alt,
               'neu', h.neu,
               'geaendert_am', h.geaendert_am,
               'geaendert_von', h.geaendert_von
             ) order by h.geaendert_am, h.historie_id)
      from public.status_historie h where h.geruecht_id = g.geruecht_id), '[]'::jsonb)
  ) into ergebnis
  from public.geruechte g
  left join public.kategorien k1 on k1.kategorie_id = g.kategorie_id
  left join public.kategorien k2 on k2.kategorie_id = g.zweitkategorie_id
  where g.geruecht_id = p_geruecht_id;

  return ergebnis; -- null, wenn es das Gerücht nicht gibt
end;
$$;

revoke execute on function public.status_setzen(bigint, text, text, text) from public, anon, authenticated;
revoke execute on function public.arbeitsbereich_liste() from public, anon, authenticated;
revoke execute on function public.arbeitsbereich_geruecht(bigint) from public, anon, authenticated;
grant execute on function public.status_setzen(bigint, text, text, text) to service_role;
grant execute on function public.arbeitsbereich_liste() to service_role;
grant execute on function public.arbeitsbereich_geruecht(bigint) to service_role;

comment on function public.status_setzen(bigint, text, text, text) is
  'Statuswechsel mit Konfliktschutz (p_erwartet) und Nutzername für die Historie. Nur service_role.';
comment on function public.arbeitsbereich_liste() is
  'Alle Gerüchte für die Liste im Arbeitsbereich, ohne Meldungstexte. Nur service_role.';
comment on function public.arbeitsbereich_geruecht(bigint) is
  'Ein Gerücht mit Meldungen und Statushistorie, ohne user_id und Embeddings. Nur service_role.';
