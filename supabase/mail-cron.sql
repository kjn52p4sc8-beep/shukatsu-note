-- Run in Supabase SQL Editor after configuring Vault and deploying mail-bridge.
-- Vault names: mail_bridge_url (including ?cron=1), mail_cron_secret.
-- No secret is embedded in cron job text or committed source.
do $$
begin
 if not exists(select 1 from vault.decrypted_secrets where name='mail_bridge_url' and decrypted_secret like 'https://%/functions/v1/mail-bridge?cron=1')
 or not exists(select 1 from vault.decrypted_secrets where name='mail_cron_secret' and length(decrypted_secret)>=32) then
  raise exception 'Vaultにmail_bridge_urlとmail_cron_secretを設定してください';
 end if;
end $$;

select cron.schedule('shukatsu-mail-sync', '* * * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='mail_bridge_url'),
  headers := jsonb_build_object('Content-Type','application/json',
    'x-mail-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='mail_cron_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
 );
$job$);
