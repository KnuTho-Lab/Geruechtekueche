-- Risikostufe hoch (rot) beginnt jetzt bei 0,65 statt 0,75 (Knut, 2026-10-06). mittel bleibt ab 0,40.
-- Beide Funktionen sind sonst unveraendert gegenueber 20261005120000 (dashboard_statistik)
-- und 20261005140100 (arbeitsbereich_liste); die Grenzen liefern sie weiter im JSON unter 'grenzen',
-- das Frontend liest sie von dort.

create or replace function public.dashboard_statistik(p_wochen int default 12)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  c_mittel constant numeric := 0.40;
  c_hoch   constant numeric := 0.65;
  heute    date := (now() at time zone 'Europe/Berlin')::date;
  von      date;
  ergebnis jsonb;
begin
  if p_wochen is null or p_wochen < 1 or p_wochen > 52 then
    raise exception 'p_wochen muss zwischen 1 und 52 liegen, nicht %', p_wochen;
  end if;
  von := date_trunc('week', heute)::date - (p_wochen - 1) * 7;

  select jsonb_build_object(
    'erzeugt_am', now(),
    'zeitzone', 'Europe/Berlin',
    'grenzen', jsonb_build_object('mittel', c_mittel, 'hoch', c_hoch),

    'meldungen', (
      select jsonb_build_object(
        'gesamt', count(*),
        'letzte_7_tage', count(*) filter (where eingegangen_am >= now() - interval '7 days'),
        -- Schnitt je 7-Tage-Fenster ueber die vier Fenster davor
        'schnitt_vorher', round(count(*) filter (
          where eingegangen_am >= now() - interval '35 days' and eingegangen_am < now() - interval '7 days') / 4.0, 1)
      ) from public.meldungen
    ),

    'heatmap', jsonb_build_object(
      'von', von,
      'wochen', p_wochen,
      'tage', (
        select jsonb_agg(jsonb_build_object('tag', d.tag::date, 'anzahl', coalesce(z.anzahl, 0)) order by d.tag)
        from generate_series(von, heute, interval '1 day') as d(tag)
        left join (
          select (eingegangen_am at time zone 'Europe/Berlin')::date as tag, count(*) as anzahl
          from public.meldungen group by 1
        ) z on z.tag = d.tag::date
      ),
      'kategorien', (
        select coalesce(jsonb_agg(jsonb_build_object('woche', w.woche, 'kategorie', w.kategorie, 'anzahl', w.anzahl)
                                  order by w.woche, w.kategorie), '[]'::jsonb)
        from (
          select date_trunc('week', m.eingegangen_am at time zone 'Europe/Berlin')::date as woche,
                 coalesce(k.name, 'ohne Kategorie') as kategorie,
                 count(*) as anzahl
          from public.meldungen m
          join public.geruechte g on g.geruecht_id = m.geruecht_id
          left join public.kategorien k on k.kategorie_id = g.kategorie_id
          where (m.eingegangen_am at time zone 'Europe/Berlin')::date >= von
          group by 1, 2
        ) w
      )
    ),

    'geruechte', (
      select jsonb_build_object(
        'gesamt', count(*),
        'offen', count(*) filter (where status = 'offen'),
        'bearbeitet', count(*) filter (where status <> 'offen'),
        'bestaetigt', count(*) filter (where status = 'bestätigt'),
        'widerlegt', count(*) filter (where status = 'widerlegt'),
        'nicht_pruefbar', count(*) filter (where status = 'nicht prüfbar')
      ) from public.geruechte
    ),

    'risiko', (
      select jsonb_build_object(
        'niedrig', count(*) filter (where risiko < c_mittel),
        'mittel', count(*) filter (where risiko >= c_mittel and risiko < c_hoch),
        'hoch', count(*) filter (where risiko >= c_hoch),
        'ohne_wert', count(*) filter (where risiko is null),
        'hoch_offen', count(*) filter (where risiko >= c_hoch and status = 'offen')
      ) from public.geruechte
    ),

    'kategorien', (
      select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'anzahl', t.anzahl) order by t.anzahl desc, t.name), '[]'::jsonb)
      from (
        select k.name, count(g.geruecht_id) as anzahl
        from public.kategorien k
        left join public.geruechte g on g.kategorie_id = k.kategorie_id
        group by k.name
      ) t
    ),

    'verbreitung', (
      select jsonb_build_object(
        'median', coalesce(percentile_cont(0.5) within group (order by n), 0),
        'maximum', coalesce(max(n), 0)
      ) from (select count(*) as n from public.meldungen group by geruecht_id) x
    ),

    'abweisungen', jsonb_build_object(
      'gesamt', (select count(*) from public.abweisungen),
      'quote', (select case when a.n + m.n = 0 then 0 else round(a.n::numeric / (a.n + m.n), 4) end
                from (select count(*) as n from public.abweisungen) a,
                     (select count(*) as n from public.meldungen) m),
      'gruende', (
        select jsonb_agg(jsonb_build_object('grund', g.grund,
                 'anzahl', (select count(*) from public.abweisungen a where a.grund = g.grund)) order by g.ord)
        from (values ('prompt_injection', 1), ('kein_geruecht', 2), ('beleidigung', 3), ('sonstiges', 4)) as g(grund, ord)
      )
    ),

    'system', jsonb_build_object(
      'tage', (
        select jsonb_agg(jsonb_build_object('tag', d.tag::date, 'aufrufe', coalesce(z.aufrufe, 0), 'fehler', coalesce(z.fehler, 0)) order by d.tag)
        from generate_series(heute - 13, heute, interval '1 day') as d(tag)
        left join (
          select (zeitpunkt at time zone 'Europe/Berlin')::date as tag, count(*) as aufrufe,
                 count(*) filter (where status >= 500) as fehler
          from public.api_aufrufe group by 1
        ) z on z.tag = d.tag::date
      ),
      'aufrufe_7d', (select count(*) from public.api_aufrufe where zeitpunkt >= now() - interval '7 days'),
      'fehler_7d', (select count(*) from public.api_aufrufe where zeitpunkt >= now() - interval '7 days' and status >= 500),
      'anfragefehler_7d', (select count(*) from public.api_aufrufe where zeitpunkt >= now() - interval '7 days' and status between 400 and 499 and status <> 429),
      'antwortzeit_median_ms', (select coalesce(round(percentile_cont(0.5) within group (order by dauer_ms)::numeric), 0)
                                from public.api_aufrufe where zeitpunkt >= now() - interval '7 days'),
      'rate_limit_7d', (select count(*) from public.api_aufrufe where zeitpunkt >= now() - interval '7 days' and status = 429),
      'haengende', (select count(*) from public.haengende_klassifizierungen),
      'risiko_queue', (select count(*) from public.geruechte where risiko_status = 'queue')
    )
  ) into ergebnis;

  return ergebnis;
end;
$$;

revoke execute on function public.dashboard_statistik(int) from public, anon, authenticated;
grant execute on function public.dashboard_statistik(int) to service_role;

comment on function public.dashboard_statistik(int) is
  'Alle Kennzahlen des Dashboards als ein JSON, Tage und Wochen in Berliner Zeit, nur Zaehlungen und nie Texte. Nur fuer die Edge Function statistik (service_role).';

create or replace function public.arbeitsbereich_liste()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'erzeugt_am', now(),
    'grenzen', jsonb_build_object('mittel', 0.40, 'hoch', 0.65),
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
