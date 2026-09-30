-- Zuordnungs-Pruefung (Knuts Entscheidung, 2026-09-30).
-- Anlass: Meldung 234 ("Vertrieb bekommt +7 % Bonus") landete mit 0,809 im Geruecht
-- "Bonus wird halbiert". Die Auswertung zeigte weitere Fehlzusammenlegungen mit zwei
-- Ursachen: das Embedding misst das Thema, nicht die Aussage, und der Vergleich mit der
-- aehnlichsten Einzelmeldung (Single Linkage) erlaubt Ketten.
-- Neu:
--  1. geruecht_kandidaten vergleicht mit dem ganzen Geruecht (Average Linkage).
--  2. Drei Zonen nach dieser Aehnlichkeit (Werte in zuordnung_logik.ts): ab 0,95 sicher,
--     0,75 bis unter 0,95 prueft ein LLM in Thomas' n8n-Workflow, darunter neues Geruecht.
--  3. Scheitert die Pruefung, entsteht kein neues Geruecht: die Meldung bleibt ohne
--     Geruecht im Zustand "offen" und wird nachgeholt (Knut).
-- Die alte Funktion aehnlichstes_geruecht bleibt vorerst stehen, damit die noch deployte
-- Function meldung zwischen db push und Deploy weiterlaeuft. Sie wird spaeter entfernt.

-- 1. Zustand "Zuordnung offen": eine Meldung darf voruebergehend ohne Geruecht sein
alter table public.meldungen alter column geruecht_id drop not null;

alter table public.meldungen drop constraint meldungen_zuordnung_art_check;
alter table public.meldungen add constraint meldungen_zuordnung_art_check
  check (zuordnung_art in ('explizit', 'embedding', 'geprueft', 'neu', 'offen'));

-- Ohne Geruecht nur im Zustand offen, und offen nur ohne Geruecht. Alte Meldungen ohne
-- zuordnung_art (vor 2026-09-27) haben immer ein Geruecht und bestehen die Regel.
alter table public.meldungen add constraint meldungen_offen_genau_ohne_geruecht
  check ((geruecht_id is null) = (zuordnung_art is not distinct from 'offen'));

alter table public.meldungen add column geruecht_aehnlichkeit double precision
  check (geruecht_aehnlichkeit between -1 and 1);

comment on column public.meldungen.geruecht_id is
  'Geruecht der Meldung. Leer nur im Zustand zuordnung_art = offen (Zuordnung gescheitert, wird nachgeholt).';
comment on column public.meldungen.zuordnung_art is
  'explizit = geruecht_id mitgeschickt, embedding = sicher per Aehnlichkeit (ab 0,95), '
  'geprueft = im Graubereich vom LLM bestaetigt, neu = neues Geruecht (unter 0,75 oder LLM: keiner passt), '
  'offen = noch kein Geruecht, weil Embedding, Suche oder Pruefung gescheitert sind. Leer bei Meldungen vor 2026-09-27.';
comment on column public.meldungen.beste_aehnlichkeit is
  'Kosinus-Aehnlichkeit zur aehnlichsten Einzelmeldung (Single Linkage), zum Kalibrieren.';
comment on column public.meldungen.geruecht_aehnlichkeit is
  'Durchschnittliche Kosinus-Aehnlichkeit zum besten Kandidaten-Geruecht (Average Linkage). '
  'Danach richten sich die Zonen. Leer bei expliziter Zuordnung und vor 2026-09-30.';

-- 2. Kandidatensuche mit Average Linkage. Erst holt der HNSW-Index die naechsten
--    Einzelmeldungen, deren Geruechte sind die Kandidaten. Fuer jeden Kandidaten zaehlt
--    dann der Durchschnitt ueber ALLE seine Meldungen, nicht nur die naechste: so kann
--    sich keine Meldung ueber eine Kette aehnlicher Einzelmeldungen in ein Geruecht hangeln.
--    Offene Meldungen (ohne Geruecht) sind nie Kandidat und zaehlen in keinem Durchschnitt.
create function public.geruecht_kandidaten(
  p_embedding extensions.halfvec,
  p_anzahl integer default 3,
  p_nachbarn integer default 20
)
returns table (
  geruecht_id bigint,
  aehnlichkeit double precision,
  max_aehnlichkeit double precision,
  anzahl_meldungen integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with nachbarn as (
    select m.geruecht_id
    from public.meldungen m
    where m.embedding is not null and m.geruecht_id is not null
    order by m.embedding operator(extensions.<=>) p_embedding
    limit p_nachbarn
  )
  select m.geruecht_id,
         avg(1 - (m.embedding operator(extensions.<=>) p_embedding)) as aehnlichkeit,
         max(1 - (m.embedding operator(extensions.<=>) p_embedding)) as max_aehnlichkeit,
         count(*)::integer as anzahl_meldungen
  from public.meldungen m
  where m.embedding is not null
    and m.geruecht_id in (select n.geruecht_id from nachbarn n)
  group by m.geruecht_id
  order by 2 desc, 1
  limit p_anzahl;
$$;
revoke execute on function public.geruecht_kandidaten(extensions.halfvec, integer, integer)
  from public, anon, authenticated;
comment on function public.geruecht_kandidaten(extensions.halfvec, integer, integer) is
  'Bis zu p_anzahl Kandidaten-Geruechte fuer ein Embedding, sortiert nach durchschnittlicher '
  'Aehnlichkeit ueber alle Meldungen des Geruechts (Average Linkage).';

-- 3. Atomares Zuordnen einer offenen Meldung. Sperrt die Zeile, damit zwei gleichzeitige
--    Nachhol-Versuche dieselbe Meldung nicht doppelt zuordnen. Mit p_geruecht_id null wird
--    im selben Schritt ein neues Geruecht angelegt. Liefert das Geruecht oder null, wenn die
--    Meldung nicht (mehr) offen ist; dann wurde auch nichts angelegt.
create function public.meldung_zuordnen(
  p_meldung_id bigint,
  p_geruecht_id bigint,
  p_art text,
  p_beste_aehnlichkeit double precision,
  p_geruecht_aehnlichkeit double precision
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  ziel bigint := p_geruecht_id;
begin
  if p_art is null or p_art not in ('embedding', 'geprueft', 'neu') then
    raise exception 'Unzulaessige Zuordnungsart: %', p_art using errcode = 'invalid_parameter_value';
  end if;

  perform 1 from public.meldungen
    where meldung_id = p_meldung_id and geruecht_id is null
    for update;
  if not found then
    return null;
  end if;

  if ziel is null then
    insert into public.geruechte default values returning geruecht_id into ziel;
  end if;

  -- Das Update loest den Klassifizierungs-Trigger aus, wenn es die erste Meldung des Geruechts ist
  update public.meldungen
    set geruecht_id = ziel,
        zuordnung_art = p_art,
        beste_aehnlichkeit = p_beste_aehnlichkeit,
        geruecht_aehnlichkeit = p_geruecht_aehnlichkeit
    where meldung_id = p_meldung_id;
  return ziel;
end;
$$;
revoke execute on function public.meldung_zuordnen(bigint, bigint, text, double precision, double precision)
  from public, anon, authenticated;

-- 4. Protokoll jeder Pruefung und jedes gescheiterten Zuordnungsversuchs
create table public.zuordnung_pruefungen (
  pruefung_id bigint generated always as identity primary key,
  meldung_id bigint not null references public.meldungen (meldung_id) on delete cascade,
  geprueft_am timestamptz not null default now(),
  -- [{geruecht_id, aehnlichkeit, max_aehnlichkeit, anzahl_meldungen}], leer, wenn die Suche scheiterte
  kandidaten jsonb not null default '[]'::jsonb,
  ergebnis text not null check (ergebnis in ('gleich', 'keiner', 'fehler')),
  -- Bei 'gleich' das bestaetigte Geruecht. Bewusst ohne Fremdschluessel: das Protokoll soll
  -- das spaetere Entwirren oder Loeschen von Geruechten ueberstehen.
  geruecht_id bigint,
  begruendung text,
  dauer_ms integer check (dauer_ms >= 0),
  fehler text,
  constraint zuordnung_pruefungen_gleich_mit_geruecht check ((ergebnis = 'gleich') = (geruecht_id is not null)),
  constraint zuordnung_pruefungen_fehler_mit_text check ((ergebnis = 'fehler') = (fehler is not null))
);
create index zuordnung_pruefungen_meldung_idx on public.zuordnung_pruefungen (meldung_id, geprueft_am desc);
alter table public.zuordnung_pruefungen enable row level security;
comment on table public.zuordnung_pruefungen is
  'Jede LLM-Pruefung im Graubereich und jeder gescheiterte Zuordnungsversuch (ergebnis fehler).';

-- 5. Offene Meldungen mit Zahl der Versuche und letztem Fehler
create view public.offene_zuordnungen with (security_invoker = true) as
select m.meldung_id,
       m.eingegangen_am,
       now() - m.eingegangen_am as wartet_seit,
       (select count(*) from public.zuordnung_pruefungen p where p.meldung_id = m.meldung_id) as versuche,
       l.geprueft_am as letzter_versuch_am,
       l.ergebnis as letztes_ergebnis,
       l.fehler as letzter_fehler,
       m.embedding_fehler
from public.meldungen m
left join lateral (
  select p.geprueft_am, p.ergebnis, p.fehler
  from public.zuordnung_pruefungen p
  where p.meldung_id = m.meldung_id
  order by p.geprueft_am desc, p.pruefung_id desc
  limit 1
) l on true
where m.zuordnung_art = 'offen';
comment on view public.offene_zuordnungen is
  'Meldungen ohne Geruecht (Zuordnung gescheitert), mit Versuchen und letztem Fehler. Nachholen per POST /zuordnung_nachholen.';

-- 6. Klassifizierung auch anstossen, wenn eine offene Meldung nachtraeglich ihr erstes
--    Geruecht bekommt. Bisher feuerte der Trigger nur beim Einfuegen. Unveraendert aus
--    20260928070000_anstoss_meldung_id bis auf die ersten beiden Pruefungen.
create or replace function public.klassifizierung_anstossen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ziel_url  text;
  geheimnis text;
  anfrage   bigint;
  grund     text;
begin
  -- Offene Meldung: noch kein Geruecht, nichts anzustossen
  if new.geruecht_id is null then
    return new;
  end if;
  -- Beim Update nur der Uebergang von offen zu zugeordnet
  if tg_op = 'UPDATE' and old.geruecht_id is not null then
    return new;
  end if;

  if exists (
    select 1 from public.geruechte g
    where g.geruecht_id = new.geruecht_id and g.kategorie_id is not null
  ) then
    return new;
  end if;

  if (select count(*) from public.meldungen m where m.geruecht_id = new.geruecht_id) <> 1 then
    return new;
  end if;

  -- Nebenbei die Antworten frueherer Anstoesse sichern, bevor pg_net sie loescht
  begin
    perform public.klassifizierung_antworten_abholen();
  exception when others then
    raise warning 'Antworten abholen fehlgeschlagen: %', sqlerrm;
  end;

  select decrypted_secret into ziel_url
    from vault.decrypted_secrets where name = 'klassifizierer_webhook_url';
  select decrypted_secret into geheimnis
    from vault.decrypted_secrets where name = 'klassifizierer_webhook_secret';

  if ziel_url is null or geheimnis is null then
    raise notice 'Klassifizierer-Webhook nicht konfiguriert, Geruecht % nicht angestossen', new.geruecht_id;
    grund := 'Webhook nicht konfiguriert, nichts verschickt';
  else
    -- Auch der Versand selbst darf die Meldung nie verhindern
    begin
      select net.http_post(
        url := ziel_url,
        body := jsonb_build_object('geruecht_id', new.geruecht_id, 'text', new.text),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-webhook-secret', geheimnis
        ),
        timeout_milliseconds := 5000
      ) into anfrage;
    exception when others then
      raise warning 'Klassifizierer-Anstoss fehlgeschlagen: %', sqlerrm;
      grund := 'Versand fehlgeschlagen: ' || left(sqlerrm, 300);
    end;
  end if;

  begin
    insert into public.klassifizierung_anstoesse (geruecht_id, meldung_id, request_id, fehler)
      values (new.geruecht_id, new.meldung_id, anfrage, grund);
  exception when others then
    raise warning 'Anstoss-Protokoll fehlgeschlagen: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function public.klassifizierung_anstossen() from public, anon, authenticated;

drop trigger meldung_klassifizierung_anstossen on public.meldungen;
create trigger meldung_klassifizierung_anstossen
  after insert or update of geruecht_id on public.meldungen
  for each row execute function public.klassifizierung_anstossen();
