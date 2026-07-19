
CREATE TABLE IF NOT EXISTS public._rls_audit (
  step text,
  observed text,
  expected text,
  passed boolean
);
TRUNCATE public._rls_audit;

DO $$
DECLARE
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  n1 uuid; n2 uuid;
  v_count int; v_title text; v_ok boolean;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (u1, '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','rls_test_a@example.com',
     crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Alice"}', now(), now()),
    (u2, '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','rls_test_b@example.com',
     crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Bob"}', now(), now());

  INSERT INTO public.negotiations (user_id, title) VALUES (u1, 'Alice move') RETURNING id INTO n1;
  INSERT INTO public.negotiations (user_id, title) VALUES (u2, 'Bob move')   RETURNING id INTO n2;
  INSERT INTO public.job_specs   (negotiation_id, version, specification) VALUES (n1, 1, '{"rooms":3}');
  INSERT INTO public.providers   (negotiation_id, name)   VALUES (n1, 'Alice Movers Inc');
  INSERT INTO public.calls       (negotiation_id, status) VALUES (n1, 'queued');
  INSERT INTO public.agent_events(negotiation_id, agent_name, event_type) VALUES (n1, 'planner', 'created');

  -- Alice
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM public.negotiations;
  INSERT INTO public._rls_audit VALUES ('alice_sees_negotiations', v_count::text, '1', v_count = 1);
  SELECT title INTO v_title FROM public.negotiations LIMIT 1;
  INSERT INTO public._rls_audit VALUES ('alice_sees_title', v_title, 'Alice move', v_title = 'Alice move');

  SELECT count(*) INTO v_count FROM public.job_specs;
  INSERT INTO public._rls_audit VALUES ('alice_job_specs', v_count::text, '1', v_count = 1);
  SELECT count(*) INTO v_count FROM public.providers;
  INSERT INTO public._rls_audit VALUES ('alice_providers', v_count::text, '1', v_count = 1);
  SELECT count(*) INTO v_count FROM public.calls;
  INSERT INTO public._rls_audit VALUES ('alice_calls', v_count::text, '1', v_count = 1);
  SELECT count(*) INTO v_count FROM public.agent_events;
  INSERT INTO public._rls_audit VALUES ('alice_agent_events', v_count::text, '1', v_count = 1);

  BEGIN
    INSERT INTO public.providers (negotiation_id, name) VALUES (n2, 'Sneaky');
    v_ok := false;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_ok := true;
  END;
  INSERT INTO public._rls_audit VALUES ('alice_insert_on_bob_blocked', v_ok::text, 'true', v_ok);

  UPDATE public.negotiations SET title='hacked' WHERE id = n2;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public._rls_audit VALUES ('alice_update_bob_rowcount', v_count::text, '0', v_count = 0);

  DELETE FROM public.negotiations WHERE id = n2;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public._rls_audit VALUES ('alice_delete_bob_rowcount', v_count::text, '0', v_count = 0);

  RESET ROLE;
  SELECT title INTO v_title FROM public.negotiations WHERE id = n2;
  INSERT INTO public._rls_audit VALUES ('bob_title_after_attacks', v_title, 'Bob move', v_title = 'Bob move');

  -- Bob
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u2::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM public.negotiations;
  INSERT INTO public._rls_audit VALUES ('bob_sees_negotiations', v_count::text, '1', v_count = 1);
  SELECT title INTO v_title FROM public.negotiations LIMIT 1;
  INSERT INTO public._rls_audit VALUES ('bob_sees_title', v_title, 'Bob move', v_title = 'Bob move');

  SELECT count(*) INTO v_count FROM public.job_specs    WHERE negotiation_id = n1;
  INSERT INTO public._rls_audit VALUES ('bob_sees_alice_job_specs', v_count::text, '0', v_count = 0);
  SELECT count(*) INTO v_count FROM public.providers    WHERE negotiation_id = n1;
  INSERT INTO public._rls_audit VALUES ('bob_sees_alice_providers', v_count::text, '0', v_count = 0);
  SELECT count(*) INTO v_count FROM public.calls        WHERE negotiation_id = n1;
  INSERT INTO public._rls_audit VALUES ('bob_sees_alice_calls', v_count::text, '0', v_count = 0);
  SELECT count(*) INTO v_count FROM public.agent_events WHERE negotiation_id = n1;
  INSERT INTO public._rls_audit VALUES ('bob_sees_alice_agent_events', v_count::text, '0', v_count = 0);

  RESET ROLE;
  DELETE FROM auth.users WHERE id IN (u1, u2);
END $$;
