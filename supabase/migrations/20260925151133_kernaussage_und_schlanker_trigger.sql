-- Die Kernaussage gehoert zum Geruecht (der Akte). Sie wird zusammen mit der Kategorie
-- vom Klassifizierungs-Workflow aus der ersten Meldung formuliert.
alter table geruechte add column kernaussage text;

comment on column geruechte.kernaussage is
  'Neutrale Kernaussage, leer bis klassifiziert. Wird vom Klassifizierungs-Workflow gesetzt.';

-- Der Klassifizierer braucht nur den Text und die geruecht_id als Ruecksendeadresse,
-- die meldung_id faellt aus dem Aufruf heraus. Sonst unveraendert.
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
  if exists (
    select 1 from public.geruechte g
    where g.geruecht_id = new.geruecht_id and g.kategorie_id is not null
  ) then
    return new;
  end if;

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

  perform net.http_post(
    url := ziel_url,
    body := jsonb_build_object('geruecht_id', new.geruecht_id, 'text', new.text),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', geheimnis
    ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

revoke execute on function public.klassifizierung_anstossen() from public, anon, authenticated;
