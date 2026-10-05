-- Korrektur zu 20261005140000: die Liste des Arbeitsbereichs kam aufsteigend statt neueste zuerst
-- (jsonb_agg sortierte nach geruecht_id aufsteigend, gefunden von supabase/tests/arbeitsbereich_test.sql, Fall 11).
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
    'geruechte', coalesce(jsonb_agg(z order by z.sortierung desc), '[]'::jsonb)
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

revoke execute on function public.arbeitsbereich_liste() from public, anon, authenticated;
grant execute on function public.arbeitsbereich_liste() to service_role;
