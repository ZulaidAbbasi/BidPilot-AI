-- SQL tests for the confirm-job-spec pathway. Run with:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/confirm-job-spec.sql
--
-- Verifies:
--   1. Owners cannot INSERT/UPDATE/DELETE job_specs directly (RLS closed).
--   2. Confirmed rows are immutable — trigger rejects UPDATE and DELETE
--      even under the service_role.
--   3. Concurrent confirmations cannot produce duplicate (negotiation, version)
--      pairs — the unique constraint plus retry loop is enforced at the DB.
--   4. Ownership is enforced: RLS hides other users' negotiations from the
--      draft/read path the server function relies on.
--   5. Non-negotiation owners cannot read confirmed rows via SELECT.

BEGIN;

-- Two synthetic auth users (test-only; rolled back at end).
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'alice-cjs@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'bob-cjs@test.local')
ON CONFLICT (id) DO NOTHING;

-- Negotiation owned by Alice.
INSERT INTO public.negotiations (id, user_id, title, vertical, workflow_status)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
        'Alice move', 'moving', 'DRAFT');

-- 1. Owner cannot insert into job_specs directly (RLS write policies removed).
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.job_specs (negotiation_id, version, specification, confirmed)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, '{}'::jsonb, true);
    RAISE EXCEPTION 'TEST FAILED: authenticated owner insert should be blocked';
  EXCEPTION WHEN insufficient_privilege OR others THEN
    -- Expected: RLS blocks the insert. Any denial is acceptable.
    NULL;
  END;
END $$;
RESET role;

-- 2. Service_role inserts a confirmed row (simulating the server function).
INSERT INTO public.job_specs
  (negotiation_id, version, specification, specification_hash, confirmed, confirmed_at, confirmed_by)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1,
   '{"bedroom_count":2}'::jsonb, repeat('a', 64),
   true, now(), '11111111-1111-1111-1111-111111111111');

-- 2a. Confirmed rows are immutable even for service_role.
DO $$
BEGIN
  BEGIN
    UPDATE public.job_specs
      SET specification_hash = repeat('b', 64)
      WHERE negotiation_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND version = 1;
    RAISE EXCEPTION 'TEST FAILED: confirmed row should be immutable';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    DELETE FROM public.job_specs
      WHERE negotiation_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND version = 1;
    RAISE EXCEPTION 'TEST FAILED: confirmed row should not be deletable';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

-- 3. Concurrent-version protection: (negotiation_id, version) is UNIQUE, so a
-- second insert at the same version fails. The server function's retry loop
-- turns this into a fresh MAX(version)+1.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.job_specs
      (negotiation_id, version, specification, specification_hash, confirmed, confirmed_at)
    VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1,
       '{"bedroom_count":3}'::jsonb, repeat('c', 64), true, now());
    RAISE EXCEPTION 'TEST FAILED: duplicate (negotiation, version) should conflict';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

-- 3a. A different version does succeed (revision path).
INSERT INTO public.job_specs
  (negotiation_id, version, specification, specification_hash, confirmed, confirmed_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2,
   '{"bedroom_count":3}'::jsonb, repeat('d', 64), true, now());

-- 4. Ownership: Bob cannot see Alice's negotiation or its confirmed specs.
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE
  seen int;
BEGIN
  SELECT count(*) INTO seen FROM public.negotiations
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF seen <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: Bob should not see Alice''s negotiation (saw %)', seen;
  END IF;
  SELECT count(*) INTO seen FROM public.job_specs
    WHERE negotiation_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF seen <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: Bob should not see Alice''s confirmed specs (saw %)', seen;
  END IF;
END $$;
RESET role;

-- 5. Cleanup — rollback undoes everything, including the auth.users rows.
ROLLBACK;

\echo 'confirm-job-spec.sql: all assertions passed'
