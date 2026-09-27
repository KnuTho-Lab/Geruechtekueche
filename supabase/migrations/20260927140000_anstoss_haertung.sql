-- Haertung von 20260927120200_klassifizierung_anstoesse.sql nach Code-Review:
-- 1. net.http_post stand ausserhalb eines Exception-Blocks. Wirft pg_net dort (etwa bei
--    einer ungueltigen URL im Vault), rollte die gerade gespeicherte Meldung mit zurueck.
--    Die Luecke gab es schon vor dem Logging. Jetzt: Fehler beim Versand -> Meldung bleibt,
--    der Grund steht im Anstoss-Protokoll.
-- 2. Bei HTTP-Status ab 400 wurde der Anfang der n8n-Antwort ins Protokoll uebernommen.
--    Spiegelt n8n in einer Fehlerantwort den Request, stuende Meldungstext im Protokoll.
--    Jetzt: nur Status, Timeout und die Fehlermeldung von pg_net selbst, nie der Inhalt.

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
      fehler              = r.error_msg,
      antwort_abgeholt_am = now()
  from net._http_response r
  where r.id = a.request_id
    and a.antwort_abgeholt_am is null;
  get diagnostics anzahl = row_count;
  return anzahl;
end;
$$;

revoke execute on function public.klassifizierung_antworten_abholen() from public, anon, authenticated;

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
    insert into public.klassifizierung_anstoesse (geruecht_id, request_id, fehler)
      values (new.geruecht_id, anfrage, grund);
  exception when others then
    raise warning 'Anstoss-Protokoll fehlgeschlagen: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function public.klassifizierung_anstossen() from public, anon, authenticated;

create or replace view public.haengende_klassifizierungen
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
  coalesce(l.fehler, r.error_msg) as fehler
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

comment on column public.klassifizierung_anstoesse.fehler is
  'Fehlermeldung von pg_net oder der Grund, warum nichts verschickt wurde. Nie der Inhalt der Antwort, er koennte Meldungstext spiegeln.';
