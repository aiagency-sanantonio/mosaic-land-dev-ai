
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Nightly Dropbox sync at 2:00 AM UTC
SELECT cron.schedule(
  'nightly-dropbox-sync',
  '0 2 * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://movtatkeydoydorkzfbi.supabase.co/functions/v1/sync-dropbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Nightly batch index at 2:30 AM UTC
SELECT cron.schedule(
  'nightly-batch-index',
  '30 2 * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://movtatkeydoydorkzfbi.supabase.co/functions/v1/batch-index',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"cron": true}'::jsonb
  ) AS request_id;
  $$
);
