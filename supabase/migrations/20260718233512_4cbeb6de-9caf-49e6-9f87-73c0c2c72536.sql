
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  window_seconds integer NOT NULL,
  count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_counters_expires_idx
  ON public.rate_limit_counters (expires_at);

GRANT ALL ON public.rate_limit_counters TO service_role;

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: service-role only. Access happens exclusively
-- through the SECURITY DEFINER function below.

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  _bucket text,
  _limit integer,
  _window_seconds integer
) RETURNS TABLE (allowed boolean, current_count integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_expires timestamptz;
  v_count integer;
BEGIN
  IF _limit IS NULL OR _limit <= 0 THEN
    RAISE EXCEPTION 'invalid limit';
  END IF;
  IF _window_seconds IS NULL OR _window_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid window_seconds';
  END IF;

  v_window_start := to_timestamp(
    (floor(extract(epoch FROM v_now)::bigint / _window_seconds) * _window_seconds)::double precision
  );
  v_expires := v_window_start + make_interval(secs => _window_seconds);

  INSERT INTO public.rate_limit_counters AS r
    (bucket_key, window_start, window_seconds, count, expires_at)
  VALUES
    (_bucket, v_window_start, _window_seconds, 1, v_expires)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET count = r.count + 1
  RETURNING r.count INTO v_count;

  -- Opportunistic cleanup (~1% of calls).
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_counters
    WHERE expires_at < v_now - interval '10 minutes';
  END IF;

  IF v_count > _limit THEN
    RETURN QUERY SELECT
      false,
      v_count,
      GREATEST(1, ceil(extract(epoch FROM (v_expires - v_now)))::int);
  ELSE
    RETURN QUERY SELECT true, v_count, 0;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.rate_limit_counters
   WHERE expires_at < now() - interval '10 minutes';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limits() TO service_role;
