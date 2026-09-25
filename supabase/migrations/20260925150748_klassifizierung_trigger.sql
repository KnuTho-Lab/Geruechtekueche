-- Stoesst den Klassifizierungs-Workflow (n8n) an, sobald ein neues Geruecht seine
-- erste Meldung bekommt. Verschickt wird per pg_net, und zwar erst nach dem Commit:
-- scheitert das Speichern, geht auch kein Aufruf raus.
create extension if not exists pg_net with schema extensions;

-- Ziel-URL und Geheimnis liegen verschluesselt im Supabase Vault, nicht im Code:
--   klassifizierer_webhook_url     Adresse des n8n-Webhooks
--   klassifizierer_webhook_secret  Wert fuer den Header x-webhook-secret
-- Fehlt eines davon, wird nichts verschickt und die Meldung trotzdem gespeichert.
create or replace function public.klassifizierung_anstossen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ziel_url  text;
  geheimnis text;
begin
  -- Nur fuer noch nicht klassifizierte Geruechte ...
  if exists (
    select 1 from public.geruechte g
    where g.geruecht_id = new.geruecht_id and g.kategorie_id is not null
  ) then
    return new;
  end if;

  -- ... und nur bei deren erster Meldung
  if (select count(*) from public.meldungen m where m.geruecht_id = new.geruecht_id) <> 1 then
    return new;
  end if;

  select decrypted_secret into ziel_url
    from vault.decrypted_secrets where name = 'klassifizierer_webhook_url';
  select decrypted_secret into geheimnis
    from vault.decrypted_secrets where name = 'klassifizierer_webhook_secret';

  if ziel_url is null or geheimnis is null then
    raise notice 'Klassifizierer-Webhook nicht konfiguriert, Geruecht % nicht angestossen', new.geruecht_id;
    return new;
  end if;

  -- Bewusst ohne user_id: der Klassifizierer braucht nur den Text
  perform net.http_post(
    url := ziel_url,
    body := jsonb_build_object(
      'geruecht_id', new.geruecht_id,
      'meldung_id', new.meldung_id,
      'text', new.text
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', geheimnis
    ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

-- Nur die Datenbank selbst ruft die Funktion auf, niemand ueber die API
revoke execute on function public.klassifizierung_anstossen() from public, anon, authenticated;

create trigger meldung_klassifizierung_anstossen
  after insert on public.meldungen
  for each row execute function public.klassifizierung_anstossen();
