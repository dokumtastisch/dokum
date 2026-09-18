-- rls_published_conjunct_check: does an unpublished Kurs actually go dark at
-- the database level? (#80, spec #63)
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS FILE EXISTS
-- ─────────────────────────────────────────────────────────────────────────
-- This is the spec's second test seam. A regression in these four policies
-- leaks paid content rather than breaking a feature, and it is invisible to
-- the Vitest suite: `npm test` covers pure modules, and no test seam in this
-- repo reaches Postgres. So the guarantee is verified where it actually
-- lives — against the database — by running this file.
--
-- It is deliberately a committed, re-runnable script rather than a console
-- session: the next person to touch RLS needs to be able to prove the same
-- thing without reconstructing the fixture from the ticket.
--
-- ─────────────────────────────────────────────────────────────────────────
-- HOW TO RUN
-- ─────────────────────────────────────────────────────────────────────────
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/checks/rls_published_conjunct_check.sql
-- or paste it into the Supabase SQL editor.
--
-- PASS  → the final SELECT returns one row reading "PASSED".
-- FAIL  → the run aborts with `RLS CHECK FAILED — <scenario>: expected …, got …`.
--
-- Everything happens inside a transaction that ends in ROLLBACK, so the
-- fixture never survives the run. Safe against dev. Do NOT run it against
-- prod: it writes (and rolls back) rows in auth.users and storage.objects,
-- and prod is not a place to find out that a rollback did not reach
-- something. For prod, use the read-only catalog query in the "VERIFYING IT"
-- header of supabase/add_rls_published_conjunct.sql instead.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT IT ASSERTS
-- ─────────────────────────────────────────────────────────────────────────
-- One Kurs → Unit → Aufgabe → Dokument → Dokumentbild chain plus the two
-- storage objects they point at, read back under four identities:
--
--   1  Kurs UNPUBLISHED, entitled non-admin  → sees nothing        (the fix)
--   2  Kurs UNPUBLISHED, admin               → sees everything     (archive stays usable)
--   3  Kurs UNPUBLISHED, anonymous           → sees nothing
--   4  Kurs PUBLISHED,   entitled non-admin  → sees everything     (the change is a no-op today)
--   5  Kurs PUBLISHED,   unentitled user     → sees nothing        (entitlement gate still holds)
--
-- Scenario 4 is what makes the others trustworthy: without it, a fixture
-- that was simply never inserted would pass scenarios 1–3 silently.
--
-- Before add_rls_published_conjunct.sql, scenario 1 FAILS — the child
-- policies gate on entitlement alone. That failure is the point: it is the
-- row leak the migration closes, reproduced.

BEGIN;

-- ─────────────────────────────────────────────
-- Fixture
-- ─────────────────────────────────────────────
-- Fixed UUIDs, not gen_random_uuid(): the assertions below name these rows
-- explicitly, so a rerun that somehow escaped its rollback collides loudly
-- on the primary key instead of quietly measuring the wrong rows.

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'rls-check-entitled@example.invalid'),
  ('aaaaaaaa-0000-4000-8000-00000000000b', 'rls-check-unentitled@example.invalid'),
  ('aaaaaaaa-0000-4000-8000-00000000000c', 'rls-check-admin@example.invalid');

INSERT INTO public.kurse (id, title, published, position) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'RLS-Check Kurs', FALSE, 0);

INSERT INTO public.units (id, kurs_id, title, position) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000002',
   'aaaaaaaa-0000-4000-8000-000000000001', 'RLS-Check Einheit', 0);

INSERT INTO public.tasks (id, unit_id, title, position) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000003',
   'aaaaaaaa-0000-4000-8000-000000000002', 'RLS-Check Aufgabe', 0);

INSERT INTO public.documents (id, task_id, title, file_path, file_type, position) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000004',
   'aaaaaaaa-0000-4000-8000-000000000003', 'RLS-Check Dokument',
   'rls-check/document.pdf', 'pdf', 0);

INSERT INTO public.document_images (id, document_id, file_path, position) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000005',
   'aaaaaaaa-0000-4000-8000-000000000004', 'rls-check/image.png', 0);

-- Both storage rows are needed: the storage policy has two EXISTS branches,
-- one reached through documents.file_path and one through
-- document_images.file_path. Asserting on 2 exercises both.
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('pdfs', 'rls-check/document.pdf'),
  ('pdfs', 'rls-check/image.png');

-- Only user …0a buys the Einheit. …0b is the unentitled control.
INSERT INTO public.entitlements (user_id, unit_id, source) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000000a',
   'aaaaaaaa-0000-4000-8000-000000000002', 'admin');

-- ─────────────────────────────────────────────
-- 1. Kurs unpublished, entitled non-admin → nothing
-- ─────────────────────────────────────────────
-- This is the guarantee the ticket is about. Before the migration it fails
-- with 1/1/1/2.

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","app_metadata":{"provider":"email"}}';

DO $$
DECLARE t bigint; d bigint; i bigint; o bigint;
BEGIN
  SELECT count(*) INTO t FROM public.tasks           WHERE id = 'aaaaaaaa-0000-4000-8000-000000000003';
  SELECT count(*) INTO d FROM public.documents       WHERE id = 'aaaaaaaa-0000-4000-8000-000000000004';
  SELECT count(*) INTO i FROM public.document_images WHERE id = 'aaaaaaaa-0000-4000-8000-000000000005';
  SELECT count(*) INTO o FROM storage.objects        WHERE bucket_id = 'pdfs' AND name LIKE 'rls-check/%';
  IF (t, d, i, o) IS DISTINCT FROM (0::bigint, 0::bigint, 0::bigint, 0::bigint) THEN
    RAISE EXCEPTION 'RLS CHECK FAILED — unpublished Kurs, entitled non-admin: expected 0/0/0/0 (task/document/image/storage), got %/%/%/%', t, d, i, o;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 2. Kurs unpublished, admin → everything
-- ─────────────────────────────────────────────
-- The admin policies are unconditional, so archived content stays fully
-- readable to an admin. That is what makes an unpublished Kurs an archive
-- rather than a black hole.

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000c","role":"authenticated","app_metadata":{"role":"admin"}}';

DO $$
DECLARE t bigint; d bigint; i bigint; o bigint;
BEGIN
  SELECT count(*) INTO t FROM public.tasks           WHERE id = 'aaaaaaaa-0000-4000-8000-000000000003';
  SELECT count(*) INTO d FROM public.documents       WHERE id = 'aaaaaaaa-0000-4000-8000-000000000004';
  SELECT count(*) INTO i FROM public.document_images WHERE id = 'aaaaaaaa-0000-4000-8000-000000000005';
  SELECT count(*) INTO o FROM storage.objects        WHERE bucket_id = 'pdfs' AND name LIKE 'rls-check/%';
  IF (t, d, i, o) IS DISTINCT FROM (1::bigint, 1::bigint, 1::bigint, 2::bigint) THEN
    RAISE EXCEPTION 'RLS CHECK FAILED — unpublished Kurs, admin: expected 1/1/1/2 (task/document/image/storage), got %/%/%/%', t, d, i, o;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 3. Kurs unpublished, anonymous → nothing
-- ─────────────────────────────────────────────
-- Every content policy is granted TO authenticated only, so anon matches no
-- policy at all. Asserted anyway: a future policy written TO public would
-- pass scenarios 1 and 2 while opening the content to the internet.

RESET ROLE;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';

DO $$
DECLARE t bigint; d bigint; i bigint; o bigint;
BEGIN
  SELECT count(*) INTO t FROM public.tasks           WHERE id = 'aaaaaaaa-0000-4000-8000-000000000003';
  SELECT count(*) INTO d FROM public.documents       WHERE id = 'aaaaaaaa-0000-4000-8000-000000000004';
  SELECT count(*) INTO i FROM public.document_images WHERE id = 'aaaaaaaa-0000-4000-8000-000000000005';
  SELECT count(*) INTO o FROM storage.objects        WHERE bucket_id = 'pdfs' AND name LIKE 'rls-check/%';
  IF (t, d, i, o) IS DISTINCT FROM (0::bigint, 0::bigint, 0::bigint, 0::bigint) THEN
    RAISE EXCEPTION 'RLS CHECK FAILED — unpublished Kurs, anonymous: expected 0/0/0/0 (task/document/image/storage), got %/%/%/%', t, d, i, o;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 4. Kurs published, entitled non-admin → everything
-- ─────────────────────────────────────────────
-- The no-op proof. While every Kurs is published the migration changes
-- nothing an entitled user reads — and this is also the positive control
-- that keeps scenarios 1, 3 and 5 honest.

RESET ROLE;
UPDATE public.kurse SET published = TRUE WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","app_metadata":{"provider":"email"}}';

DO $$
DECLARE t bigint; d bigint; i bigint; o bigint;
BEGIN
  SELECT count(*) INTO t FROM public.tasks           WHERE id = 'aaaaaaaa-0000-4000-8000-000000000003';
  SELECT count(*) INTO d FROM public.documents       WHERE id = 'aaaaaaaa-0000-4000-8000-000000000004';
  SELECT count(*) INTO i FROM public.document_images WHERE id = 'aaaaaaaa-0000-4000-8000-000000000005';
  SELECT count(*) INTO o FROM storage.objects        WHERE bucket_id = 'pdfs' AND name LIKE 'rls-check/%';
  IF (t, d, i, o) IS DISTINCT FROM (1::bigint, 1::bigint, 1::bigint, 2::bigint) THEN
    RAISE EXCEPTION 'RLS CHECK FAILED — published Kurs, entitled non-admin: expected 1/1/1/2 (task/document/image/storage), got %/%/%/%. The fixture is broken or the published conjunct is over-restrictive', t, d, i, o;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 5. Kurs published, unentitled user → nothing
-- ─────────────────────────────────────────────
-- The other half of the conjunct. Adding `published` must not accidentally
-- turn AND into OR and hand published content to someone who never bought it.

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000b","role":"authenticated","app_metadata":{"provider":"email"}}';

DO $$
DECLARE t bigint; d bigint; i bigint; o bigint;
BEGIN
  SELECT count(*) INTO t FROM public.tasks           WHERE id = 'aaaaaaaa-0000-4000-8000-000000000003';
  SELECT count(*) INTO d FROM public.documents       WHERE id = 'aaaaaaaa-0000-4000-8000-000000000004';
  SELECT count(*) INTO i FROM public.document_images WHERE id = 'aaaaaaaa-0000-4000-8000-000000000005';
  SELECT count(*) INTO o FROM storage.objects        WHERE bucket_id = 'pdfs' AND name LIKE 'rls-check/%';
  IF (t, d, i, o) IS DISTINCT FROM (0::bigint, 0::bigint, 0::bigint, 0::bigint) THEN
    RAISE EXCEPTION 'RLS CHECK FAILED — published Kurs, unentitled user: expected 0/0/0/0 (task/document/image/storage), got %/%/%/%', t, d, i, o;
  END IF;
END $$;

RESET ROLE;

SELECT 'RLS published-conjunct check: PASSED — 5 scenarios, 20 assertions' AS result;

ROLLBACK;
