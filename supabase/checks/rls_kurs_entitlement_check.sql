-- rls_kurs_entitlement_check: does a whole-Kurs entitlement open exactly its
-- own Kurs — including an Einheit created after the sale — and nothing else?
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS FILE EXISTS
-- ─────────────────────────────────────────────────────────────────────────
-- add_kurs_entitlements.sql widened the entitlement JOIN in four content
-- policies from `e.unit_id = u.id` to `e.unit_id = u.id OR e.kurs_id =
-- u.kurs_id`. A mistake in that second disjunct does not break a feature — it
-- hands paid content to the wrong people, silently, and `npm test` cannot see
-- it because no test seam in this repo reaches Postgres.
--
-- The companion file rls_published_conjunct_check.sql still covers the Unit
-- grant and the `published` conjunct. Run BOTH after touching these policies.
--
-- ─────────────────────────────────────────────────────────────────────────
-- HOW TO RUN
-- ─────────────────────────────────────────────────────────────────────────
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/checks/rls_kurs_entitlement_check.sql
-- or paste it into the Supabase SQL editor.
--
-- PASS  → the final SELECT returns one row reading "PASSED".
-- FAIL  → the run aborts with `KURS ENTITLEMENT CHECK FAILED — <scenario>: …`.
--
-- Everything happens inside a transaction that ends in ROLLBACK. Safe against
-- DEV. Do NOT run it against prod: it writes (and rolls back) rows in
-- auth.users and storage.objects.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT IT ASSERTS
-- ─────────────────────────────────────────────────────────────────────────
-- Two Kurse, each with content. Buyer A holds a `kurs_id` grant on Kurs A,
-- buyer B one on Kurs B. The content of Kurs A hangs under an Einheit that is
-- inserted AFTER the grant — the whole point of granting a Kurs rather than
-- fanning out Unit rows.
--
--   1  Kurs A unpublished, buyer A         → sees nothing   (published conjunct survives)
--   2  Kurs A published,   buyer A         → sees everything (the later Einheit included)
--   3  Kurs A published,   buyer B         → sees nothing   (the grant is scoped)
--   4  Kurs B published,   buyer B         → sees everything (control: B's grant works)
--   5  the XOR constraint rejects both-null and both-set rows
--   6  the partial unique index rejects a second grant for the same pair

BEGIN;

-- ─────────────────────────────────────────────
-- Fixture
-- ─────────────────────────────────────────────
-- Fixed UUIDs, not gen_random_uuid(): the assertions below name these rows
-- explicitly, so a rerun that somehow escaped its rollback collides loudly on
-- the primary key instead of quietly measuring the wrong rows.

INSERT INTO auth.users (id, email) VALUES
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'kurs-check-buyer-a@example.invalid'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'kurs-check-buyer-b@example.invalid');

INSERT INTO public.kurse (id, title, published, position, sold_as, price_cents) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Kurs-Check A', FALSE, 0, 'kurs', 1500),
  ('bbbbbbbb-0000-4000-8000-000000000011', 'Kurs-Check B', TRUE,  0, 'kurs', 1500);

-- The grants are written BEFORE Kurs A has any Einheit at all. That is the
-- ordering the scenario is about: nothing here can have fanned out to Unit
-- rows, because there were no Units to fan out to.
INSERT INTO public.entitlements (user_id, kurs_id, source) VALUES
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-000000000001', 'admin'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000011', 'admin');

-- Kurs A's content, created after the sale.
INSERT INTO public.units (id, kurs_id, title, position) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000002',
   'bbbbbbbb-0000-4000-8000-000000000001', 'Kurs-Check A · späte Einheit', 0);

INSERT INTO public.tasks (id, unit_id, title, position) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000003',
   'bbbbbbbb-0000-4000-8000-000000000002', 'Kurs-Check A · Aufgabe', 0);

INSERT INTO public.documents (id, task_id, title, file_path, file_type, position) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000004',
   'bbbbbbbb-0000-4000-8000-000000000003', 'Kurs-Check A · Dokument',
   'kurs-check/a-document.pdf', 'pdf', 0);

INSERT INTO public.document_images (id, document_id, file_path, position) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000005',
   'bbbbbbbb-0000-4000-8000-000000000004', 'kurs-check/a-image.png', 0);

-- Both storage rows are needed: the storage policy has two EXISTS branches,
-- one reached through documents.file_path and one through
-- document_images.file_path. Asserting on 2 exercises both.
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('pdfs', 'kurs-check/a-document.pdf'),
  ('pdfs', 'kurs-check/a-image.png');

-- Kurs B's content — the control that keeps scenario 3 honest.
INSERT INTO public.units (id, kurs_id, title, position) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000012',
   'bbbbbbbb-0000-4000-8000-000000000011', 'Kurs-Check B · Einheit', 0);

INSERT INTO public.tasks (id, unit_id, title, position) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000013',
   'bbbbbbbb-0000-4000-8000-000000000012', 'Kurs-Check B · Aufgabe', 0);

-- ─────────────────────────────────────────────
-- 1. Kurs A unpublished, buyer A → nothing
-- ─────────────────────────────────────────────
-- The Kurs grant must not become a way around `published`. It is written as a
-- disjunct of the entitlement JOIN, not of the whole USING clause — this is
-- what proves the difference.

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-00000000000a","role":"authenticated","app_metadata":{"provider":"email"}}';

DO $$
DECLARE t bigint; d bigint; i bigint; o bigint;
BEGIN
  SELECT count(*) INTO t FROM public.tasks           WHERE id = 'bbbbbbbb-0000-4000-8000-000000000003';
  SELECT count(*) INTO d FROM public.documents       WHERE id = 'bbbbbbbb-0000-4000-8000-000000000004';
  SELECT count(*) INTO i FROM public.document_images WHERE id = 'bbbbbbbb-0000-4000-8000-000000000005';
  SELECT count(*) INTO o FROM storage.objects        WHERE bucket_id = 'pdfs' AND name LIKE 'kurs-check/a-%';
  IF (t, d, i, o) IS DISTINCT FROM (0::bigint, 0::bigint, 0::bigint, 0::bigint) THEN
    RAISE EXCEPTION 'KURS ENTITLEMENT CHECK FAILED — unpublished Kurs, Kurs-entitled buyer: expected 0/0/0/0 (task/document/image/storage), got %/%/%/%', t, d, i, o;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 2. Kurs A published, buyer A → everything
-- ─────────────────────────────────────────────
-- The Einheit under test did not exist when the grant was written. A fan-out
-- of Unit rows at checkout time would fail here — which is the reason the
-- schema carries `kurs_id` at all.

RESET ROLE;
UPDATE public.kurse SET published = TRUE WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-00000000000a","role":"authenticated","app_metadata":{"provider":"email"}}';

DO $$
DECLARE t bigint; d bigint; i bigint; o bigint;
BEGIN
  SELECT count(*) INTO t FROM public.tasks           WHERE id = 'bbbbbbbb-0000-4000-8000-000000000003';
  SELECT count(*) INTO d FROM public.documents       WHERE id = 'bbbbbbbb-0000-4000-8000-000000000004';
  SELECT count(*) INTO i FROM public.document_images WHERE id = 'bbbbbbbb-0000-4000-8000-000000000005';
  SELECT count(*) INTO o FROM storage.objects        WHERE bucket_id = 'pdfs' AND name LIKE 'kurs-check/a-%';
  IF (t, d, i, o) IS DISTINCT FROM (1::bigint, 1::bigint, 1::bigint, 2::bigint) THEN
    RAISE EXCEPTION 'KURS ENTITLEMENT CHECK FAILED — published Kurs, Kurs-entitled buyer: expected 1/1/1/2 (task/document/image/storage), got %/%/%/%. Either the Kurs disjunct is missing or it does not reach content added after the sale', t, d, i, o;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 3. Kurs A published, buyer of the OTHER Kurs → nothing
-- ─────────────────────────────────────────────
-- The over-grant scenario: a Kurs grant that joined on the wrong column, or
-- on none, turns every buyer into a buyer of everything.

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated","app_metadata":{"provider":"email"}}';

DO $$
DECLARE t bigint; d bigint; i bigint; o bigint;
BEGIN
  SELECT count(*) INTO t FROM public.tasks           WHERE id = 'bbbbbbbb-0000-4000-8000-000000000003';
  SELECT count(*) INTO d FROM public.documents       WHERE id = 'bbbbbbbb-0000-4000-8000-000000000004';
  SELECT count(*) INTO i FROM public.document_images WHERE id = 'bbbbbbbb-0000-4000-8000-000000000005';
  SELECT count(*) INTO o FROM storage.objects        WHERE bucket_id = 'pdfs' AND name LIKE 'kurs-check/a-%';
  IF (t, d, i, o) IS DISTINCT FROM (0::bigint, 0::bigint, 0::bigint, 0::bigint) THEN
    RAISE EXCEPTION 'KURS ENTITLEMENT CHECK FAILED — published Kurs, buyer of a DIFFERENT Kurs: expected 0/0/0/0 (task/document/image/storage), got %/%/%/%', t, d, i, o;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 4. Kurs B published, buyer B → its Aufgabe
-- ─────────────────────────────────────────────
-- The positive control for scenario 3: buyer B's own grant does work, so the
-- zeros above are about scoping and not about a buyer whose grant never took
-- effect at all.

DO $$
DECLARE t bigint;
BEGIN
  SELECT count(*) INTO t FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000013';
  IF t <> 1 THEN
    RAISE EXCEPTION 'KURS ENTITLEMENT CHECK FAILED — own published Kurs, Kurs-entitled buyer: expected 1 task, got %', t;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 5. An entitlement grants a Unit XOR a Kurs
-- ─────────────────────────────────────────────
-- Written as inserts that must FAIL. A CHECK added to a table that already
-- had rows can be `NOT VALID` without anyone noticing; this notices.

RESET ROLE;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.entitlements (user_id, unit_id, kurs_id, source)
    VALUES ('bbbbbbbb-0000-4000-8000-00000000000b',
            'bbbbbbbb-0000-4000-8000-000000000002',
            'bbbbbbbb-0000-4000-8000-000000000001', 'admin');
    RAISE EXCEPTION 'KURS ENTITLEMENT CHECK FAILED — entitlements_target_check: a row with BOTH unit_id and kurs_id was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.entitlements (user_id, source) VALUES
      ('bbbbbbbb-0000-4000-8000-00000000000b', 'admin');
    RAISE EXCEPTION 'KURS ENTITLEMENT CHECK FAILED — entitlements_target_check: a row with NEITHER unit_id nor kurs_id was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

-- ─────────────────────────────────────────────
-- 6. One Kurs grant per user and Kurs
-- ─────────────────────────────────────────────
-- UNIQUE (user_id, unit_id) does not cover these rows — their unit_id is
-- NULL, and NULLs are distinct. The partial index is what stands in for it,
-- and it is what makes the checkout handlers' idempotent insert idempotent.

DO $$
BEGIN
  BEGIN
    INSERT INTO public.entitlements (user_id, kurs_id, source) VALUES
      ('bbbbbbbb-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-000000000001', 'purchase');
    RAISE EXCEPTION 'KURS ENTITLEMENT CHECK FAILED — entitlements_user_kurs_idx: a duplicate Kurs grant was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

RESET ROLE;

SELECT 'RLS Kurs-entitlement check: PASSED — 6 scenarios, 16 assertions' AS result;

ROLLBACK;
