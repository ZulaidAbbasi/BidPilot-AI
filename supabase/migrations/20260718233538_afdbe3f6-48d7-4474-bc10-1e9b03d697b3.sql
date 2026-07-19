
REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_rate_limits() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limits() TO service_role;
