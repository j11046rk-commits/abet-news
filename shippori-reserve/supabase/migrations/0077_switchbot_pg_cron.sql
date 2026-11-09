-- 0077 温度計の読み取りを Supabase の定期実行（pg_cron＋pg_net）から呼ぶ（2026-11-09）
--
--   GitHub Actions の定期実行は夜間に2〜4時間とぶことがあった（11/9 0:10→3:48→7:46）。
--   毎時7分・37分に /api/cron/switchbot を呼ぶ。
--
--   合言葉はこの中で作る（リポジトリにもチャットにも出ない）：
--     平文 → Supabase Vault（switchbot_cron_token）。pg_cron がここから読んで x-api-key に付ける
--     ハッシュ → api_tokens（switchbot_cron）。アプリはハッシュで照合する
--   pg_cron・pg_net の無い環境（ローカルのテスト用DB）では何もしない。

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice '0077: pg_cron / pg_net / vault が無いので飛ばします';
    return;
  end if;

  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute 'create extension if not exists pg_net with schema extensions';

  -- 合言葉（まだ無いときだけ作る）
  if not exists (select 1 from vault.secrets where name = 'switchbot_cron_token') then
    t := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
    perform vault.create_secret(t, 'switchbot_cron_token', '温度計の読み取り（pg_cron → /api/cron/switchbot）の合言葉');
    insert into api_tokens (name, token_hash, created_at)
    values ('switchbot_cron', encode(extensions.digest(t, 'sha256'), 'hex'), now())
    on conflict (name) do update set token_hash = excluded.token_hash, created_at = now(), last_used_at = null;
  end if;

  -- 同じ名前なら上書きされる
  perform cron.schedule(
    'switchbot-poll',
    '7,37 * * * *',
    $job$
      select net.http_get(
        url := 'https://yoyaku.shipporitei.jp/api/cron/switchbot',
        headers := jsonb_build_object(
          'x-api-key', (select decrypted_secret from vault.decrypted_secrets where name = 'switchbot_cron_token')
        ),
        timeout_milliseconds := 55000
      );
    $job$
  );
end $$;
