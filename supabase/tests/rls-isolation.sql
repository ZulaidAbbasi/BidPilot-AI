-- BidPilot AI — RLS isolation tests
--
-- Run manually against a NON-production database:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/rls-isolation.sql
--
-- Creates two throwaway auth.users, exercises SELECT/INSERT/UPDATE/DELETE as
-- each, prints NOTICE lines with expected vs observed row counts, then
-- cleans up. Do NOT include this file in the migrations directory — it is a
-- test harness, not a schema change.

BEGIN;

DO $$
DECLARE
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  n1 uuid; n2 uuid;
  v_count int;
  v_title text;
  v_ok boolean;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  VALUES
    (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rls_test_a@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email"}', '{"full_name":"Alice"}', now(), now()),
    (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rls_test_b@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email"}', '{"full_name":"Bob"}', now(), now());

  INSERT INTO public.negotiations (user_id, title) VALUES (u1, 'Alice move') RETURNING id INTO n1;
  INSERT INTO public.negotiations (user_id, title) VALUES (u2, 'Bob move')   RETURNING id INTO n2;
  INSERT INTO public.job_specs   (negotiation_id, version, specification) VALUES (n1, 1, '{"rooms":3}');
  INSERT INTO public.providers   (negotiation_id, name)   VALUES (n1, 'Alice Movers Inc');
  INSERT INTO public.calls       (negotiation_id, status) VALUES (n1, 'queued');
  INSERT INTO public.agent_events(negotiation_id, agent_name, event_type) VALUES (n1, 'planner', 'created');

  RAISE NOTICE '================ Acting as Alice (u1=%) ================', u1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u1::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM public.negotiations;
  RAISE NOTICE 'Alice sees % negotiation(s) — expect 1', v_count;
  SELECT title INTO v_title FROM public.negotiations LIMIT 1;
  RAISE NOTICE 'Alice sees title="%" — expect "Alice move"', v_title;

  SELECT count(*) INTO v_count FROM public.job_specs;    RAISE NOTICE 'Alice job_specs=% (expect 1)',    v_count;
  SELECT count(*) INTO v_count FROM public.providers;    RAISE NOTICE 'Alice providers=% (expect 1)',    v_count;
  SELECT count(*) INTO v_count FROM public.calls;        RAISE NOTICE 'Alice calls=% (expect 1)',        v_count;
  SELECT count(*) INTO v_count FROM public.agent_events; RAISE NOTICE 'Alice agent_events=% (expect 1)', v_count;

  BEGIN
    INSERT INTO public.providers (negotiation_id, name) VALUES (n2, 'Sneaky');
    v_ok := false;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_ok := true;
  END;
  RAISE NOTICE 'Alice INSERT on Bob''s negotiation blocked? % (expect t)', v_ok;

  UPDATE public.negotiations SET title = 'hacked' WHERE id = n2;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Alice UPDATE on Bob''s negotiation affected % row(s) (expect 0)', v_count;

  DELETE FROM public.negotiations WHERE id = n2;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Alice DELETE on Bob''s negotiation affected % row(s) (expect 0)', v_count;

  RESET ROLE;
  SELECT title INTO v_title FROM public.negotiations WHERE id = n2;
  RAISE NOTICE 'Bob''s negotiation title after Alice''s attacks: "%" (expect "Bob move")', v_title;

  RAISE NOTICE '================ Acting as Bob (u2=%) ================', u2;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u2::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM public.negotiations;
  RAISE NOTICE 'Bob sees % negotiation(s) — expect 1', v_count;
  SELECT title INTO v_title FROM public.negotiations LIMIT 1;
  RAISE NOTICE 'Bob sees title="%" — expect "Bob move"', v_title;

  SELECT count(*) INTO v_count FROM public.job_specs    WHERE negotiation_id = n1;
  RAISE NOTICE 'Bob sees % of Alice''s job_specs (expect 0)', v_count;
  SELECT count(*) INTO v_count FROM public.providers    WHERE negotiation_id = n1;
  RAISE NOTICE 'Bob sees % of Alice''s providers (expect 0)', v_count;
  SELECT count(*) INTO v_count FROM public.calls        WHERE negotiation_id = n1;
  RAISE NOTICE 'Bob sees % of Alice''s calls (expect 0)', v_count;
  SELECT count(*) INTO v_count FROM public.agent_events WHERE negotiation_id = n1;
  RAISE NOTICE 'Bob sees % of Alice''s agent_events (expect 0)', v_count;

  RESET ROLE;
  DELETE FROM auth.users WHERE id IN (u1, u2);
  RAISE NOTICE '================ Cleanup complete ================';
END $$;

ROLLBACK;
