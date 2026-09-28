-- Anstoss-Protokoll bekommt den Bezug zur Meldung, die den Anstoss ausgeloest hat.
-- Bisher stand dort nur geruecht_id, welche Meldung den Klassifizierer angestossen hat,
-- liess sich nur ueber Zeitstempel erraten.

-- set null statt cascade: wird eine Meldung geloescht, bleibt die Spur des Anstosses erhalten.
-- Das Protokoll verschwindet weiterhin mit dem Geruecht (cascade an geruecht_id).
alter table public.klassifizierung_anstoesse
  add column meldung_id bigint references public.meldungen (meldung_id) on delete set null;

-- Ohne Index muesste Postgres beim Loeschen einer Meldung das ganze Protokoll durchsuchen
create index klassifizierung_anstoesse_meldung on public.klassifizierung_anstoesse (meldung_id);

comment on column public.klassifizierung_anstoesse.meldung_id is
  'Die Meldung, deren Speichern den Anstoss ausgeloest hat, also die erste des Geruechts.';

-- Nachtrag fuer die bestehenden Zeilen. Meldung und Anstoss entstehen in derselben
-- Transaktion, eingegangen_am und angestossen_am sind darum beide exakt dasselbe now().
-- Am 2026-09-28 an der Live-DB geprueft: jede der 6 Zeilen trifft genau eine Meldung.
update public.klassifizierung_anstoesse a
set meldung_id = m.meldung_id
from public.meldungen m
where m.geruecht_id = a.geruecht_id
  and m.eingegangen_am = a.angestossen_am
  and a.meldung_id is null;

-- Der Trigger wie in 20260927140000_anstoss_haertung.sql, einzige Aenderung:
-- das Protokoll speichert new.meldung_id mit.
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
    insert into public.klassifizierung_anstoesse (geruecht_id, meldung_id, request_id, fehler)
      values (new.geruecht_id, new.meldung_id, anfrage, grund);
  exception when others then
    raise warning 'Anstoss-Protokoll fehlgeschlagen: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function public.klassifizierung_anstossen() from public, anon, authenticated;
