-- Logging, Teil 3: jeder Anstoss des n8n-Klassifizierers wird seinem Geruecht zugeordnet
-- und behaelt seine Antwort.
-- Problem bisher: pg_net legt die Antworten in net._http_response ab, loescht sie aber nach
-- der TTL (pg_net.ttl = 6 hours) und kennt die geruecht_id nicht. Scheiterte ein Anstoss
-- (Timeout, 403), blieb das Geruecht still unklassifiziert, ohne Spur.

create table public.klassifizierung_anstoesse (
  anstoss_id          bigint generated always as identity primary key,
  -- Das Protokoll gehoert zum Geruecht und verschwindet mit ihm
  geruecht_id         bigint not null references public.geruechte (geruecht_id) on delete cascade,
  angestossen_am      timestamptz not null default now(),
  request_id          bigint,
  http_status         integer,
  zeitueberschreitung boolean,
  fehler              text,
  antwort_abgeholt_am timestamptz
);

alter table public.klassifizierung_anstoesse enable row level security;

create index klassifizierung_anstoesse_geruecht on public.klassifizierung_anstoesse (geruecht_id);
create index klassifizierung_anstoesse_offen on public.klassifizierung_anstoesse (request_id)
  where antwort_abgeholt_am is null and request_id is not null;

comment on table public.klassifizierung_anstoesse is
  'Ein Eintrag je Aufruf des n8n-Klassifizierers. request_id leer = nicht verschickt (dann steht der Grund in fehler).';
comment on column public.klassifizierung_anstoesse.request_id is 'ID aus net.http_post, verweist auf net._http_response.';
comment on column public.klassifizierung_anstoesse.fehler is
  'Fehlertext von pg_net, bei HTTP-Status ab 400 der Anfang der Antwort, oder der Grund, warum nichts verschickt wurde.';

-- Uebernimmt die Antworten aus net._http_response, solange pg_net sie noch hat.
-- Liefert die Anzahl uebernommener Antworten. Laeuft bei jedem Anstoss mit und laesst
-- sich jederzeit von Hand aufrufen.
create or replace function public.klassifizierung_antworten_abholen()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  anzahl integer;
begin
  update public.klassifizierung_anstoesse a
  set http_status         = r.status_code,
      zeitueberschreitung = r.timed_out,
      fehler              = coalesce(r.error_msg, case when r.status_code >= 400 then left(r.content, 500) end),
      antwort_abgeholt_am = now()
  from net._http_response r
  where r.id = a.request_id
    and a.antwort_abgeholt_am is null;
  get diagnostics anzahl = row_count;
  return anzahl;
end;
$$;

revoke execute on function public.klassifizierung_antworten_abholen() from public, anon, authenticated;

-- Der Trigger wie bisher, dazu das Protokoll. Das Protokoll darf eine Meldung nie
-- verhindern: jeder Fehler darin wird nur als Warnung gemeldet.
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
begin
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
    begin
      insert into public.klassifizierung_anstoesse (geruecht_id, fehler)
        values (new.geruecht_id, 'Webhook nicht konfiguriert, nichts verschickt');
    exception when others then
      raise warning 'Anstoss-Protokoll fehlgeschlagen: %', sqlerrm;
    end;
    return new;
  end if;

  select net.http_post(
    url := ziel_url,
    body := jsonb_build_object('geruecht_id', new.geruecht_id, 'text', new.text),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', geheimnis
    ),
    timeout_milliseconds := 5000
  ) into anfrage;

  begin
    insert into public.klassifizierung_anstoesse (geruecht_id, request_id)
      values (new.geruecht_id, anfrage);
  exception when others then
    raise warning 'Anstoss-Protokoll fehlgeschlagen: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function public.klassifizierung_anstossen() from public, anon, authenticated;

-- Geruechte, die nach 10 Minuten noch keine Kategorie haben, samt letztem Anstoss.
-- Die Antwort kommt aus dem Protokoll oder, falls noch nicht abgeholt, live aus pg_net.
-- security_invoker: die View prueft die Rechte des Aufrufers, nicht die ihres Eigentuemers.
create view public.haengende_klassifizierungen
with (security_invoker = true)
as
select
  g.geruecht_id,
  g.angelegt_am,
  now() - g.angelegt_am as wartet_seit,
  (select count(*) from public.klassifizierung_anstoesse x where x.geruecht_id = g.geruecht_id) as anstoesse,
  l.angestossen_am as letzter_anstoss_am,
  coalesce(l.http_status, r.status_code) as http_status,
  coalesce(l.zeitueberschreitung, r.timed_out) as zeitueberschreitung,
  coalesce(l.fehler, r.error_msg, case when r.status_code >= 400 then left(r.content, 500) end) as fehler
from public.geruechte g
left join lateral (
  select a.*
  from public.klassifizierung_anstoesse a
  where a.geruecht_id = g.geruecht_id
  order by a.angestossen_am desc, a.anstoss_id desc
  limit 1
) l on true
left join net._http_response r on r.id = l.request_id
where g.kategorie_id is null
  and g.angelegt_am < now() - interval '10 minutes';

comment on view public.haengende_klassifizierungen is
  'Geruechte ohne Kategorie, aelter als 10 Minuten, mit dem letzten Anstoss des Klassifizierers und dessen Antwort.';
