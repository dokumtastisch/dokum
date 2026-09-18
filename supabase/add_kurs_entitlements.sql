-- add_kurs_entitlements: a Lernkurs is bought whole, a Musterlösung unit by unit.
--
-- Apply order: migration.sql → add_audit_log.sql → add_entitlements.sql →
-- add_editor_documents.sql → add_editor_images.sql → add_document_content.sql
-- → add_rls_published_conjunct.sql → add_lessons.sql → THIS FILE.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT CHANGES
-- ─────────────────────────────────────────────────────────────────────────
-- `kurse.sold_as` has existed since add_lessons.sql and nothing ever read it:
-- every checkout sold a single Unit at the flat €3 price, whatever the column
-- said. This migration makes it real.
--
--   sold_as = 'unit'  → unchanged. One Unit per purchase, flat price.
--   sold_as = 'kurs'  → one purchase for the whole Kurs, at `kurse.price_cents`.
--
-- A whole-Kurs purchase is ONE entitlement row carrying `kurs_id`, not one row
-- per Unit. That is the difference between a Kurs that keeps growing after the
-- sale and one that does not: an Einheit added next month falls under an
-- existing `kurs_id` grant automatically, while a fan-out of unit rows would
-- have left every earlier buyer locked out of it.
--
-- So `entitlements` now grants a Unit XOR a Kurs, and the four content
-- policies have to accept either. Everything else about them is unchanged —
-- see the warning below.
--
-- ─────────────────────────────────────────────────────────────────────────
-- THE HAZARD (unchanged from add_rls_published_conjunct.sql)
-- ─────────────────────────────────────────────────────────────────────────
-- Permissive SELECT policies are OR'd. The `published` conjunct therefore has
-- to stay INSIDE each single policy, and the Kurs grant has to be added as a
-- second disjunct to the entitlement JOIN — never as a second policy, which
-- would grant access rather than widen a condition. Each table keeps exactly
-- two SELECT policies: the unconditional admin one and the one below.
--
-- ─────────────────────────────────────────────────────────────────────────
-- BLAST RADIUS
-- ─────────────────────────────────────────────────────────────────────────
-- Nothing a user can read today becomes unreadable. Every existing
-- entitlement row has a `unit_id` (the column was NOT NULL until this file),
-- so the XOR check below cannot fail on existing data and the first disjunct
-- of every policy is the exact condition that was there before. The second
-- disjunct only ever adds rows, and only for users holding a `kurs_id` row —
-- of which there are none until the first whole-Kurs checkout.
--
-- Pre-flight, if you want it in writing rather than by argument:
--
--   SELECT count(*) AS must_be_zero FROM public.entitlements WHERE unit_id IS NULL;
--
-- ─────────────────────────────────────────────────────────────────────────
-- VERIFYING IT
-- ─────────────────────────────────────────────────────────────────────────
-- On DEV: run supabase/checks/rls_kurs_entitlement_check.sql (the Kurs grant,
-- incl. the Einheit added after the sale) AND
-- supabase/checks/rls_published_conjunct_check.sql (unchanged; the Unit grant
-- and the published conjunct must still hold).
--
-- On PROD: the read-only catalog query from add_rls_published_conjunct.sql
-- still applies — two SELECT policies per table, the non-admin one mentioning
-- `published`. Plus, for this file:
--
--   SELECT conname, pg_get_constraintdef(oid), convalidated
--   FROM pg_constraint
--   WHERE conrelid = 'public.entitlements'::regclass AND contype = 'c';

-- ─────────────────────────────────────────────
-- 1. What a whole Kurs costs
-- ─────────────────────────────────────────────
-- Cents, like Stripe counts, and EUR like UNIT_PRICE_CURRENCY. The default is
-- a placeholder for the Kurse that exist today — it only ever reaches a
-- customer once someone flips that Kurs to sold_as = 'kurs'.
--
-- The floor is Stripe's own minimum charge for EUR (€0.50); below it the
-- Checkout Session is rejected at creation time, which would surface as a 500
-- on a button press rather than as a validation error in the admin form.

ALTER TABLE public.kurse
  ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 1500;

ALTER TABLE public.kurse DROP CONSTRAINT IF EXISTS kurse_price_cents_check;
ALTER TABLE public.kurse
  ADD CONSTRAINT kurse_price_cents_check CHECK (price_cents >= 50);

COMMENT ON COLUMN public.kurse.price_cents IS
  'Price of the whole Kurs in EUR cents. Read only when sold_as = ''kurs''; a sold_as = ''unit'' Kurs sells each Einheit at the flat UNIT_PRICE_CENTS instead.';

-- ─────────────────────────────────────────────
-- 2. An entitlement grants a Unit XOR a Kurs
-- ─────────────────────────────────────────────

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS kurs_id UUID REFERENCES public.kurse(id) ON DELETE CASCADE;

ALTER TABLE public.entitlements ALTER COLUMN unit_id DROP NOT NULL;

-- Exactly one of the two. A row with both would be ambiguous about what was
-- paid for; a row with neither would grant nothing and still count as a sale.
ALTER TABLE public.entitlements DROP CONSTRAINT IF EXISTS entitlements_target_check;
ALTER TABLE public.entitlements
  ADD CONSTRAINT entitlements_target_check
  CHECK ((unit_id IS NOT NULL) <> (kurs_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS entitlements_kurs_id_idx ON public.entitlements (kurs_id);

-- The Kurs counterpart of UNIQUE (user_id, unit_id). It has to be a partial
-- index rather than a constraint: NULLs are distinct in a unique constraint,
-- so `UNIQUE (user_id, kurs_id)` would happily accept a thousand unit-grant
-- rows for the same user and then be useless for the rows it is about.
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_user_kurs_idx
  ON public.entitlements (user_id, kurs_id)
  WHERE kurs_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- 3. tasks
-- ─────────────────────────────────────────────
-- The shape of all four: reach the Einheit and its Kurs, then join the
-- entitlement on „this Einheit, or the Kurs it sits in". `published` stays
-- where it was, inside the same policy.

DROP POLICY IF EXISTS "View tasks of published kurse" ON public.tasks;
DROP POLICY IF EXISTS "View tasks of entitled units" ON public.tasks;
DROP POLICY IF EXISTS "View tasks of entitled units in published kurse" ON public.tasks;
CREATE POLICY "View tasks of entitled units in published kurse"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.units u
      JOIN public.kurse k ON k.id = u.kurs_id
      JOIN public.entitlements e
        ON e.user_id = auth.uid()
       AND (e.unit_id = u.id OR e.kurs_id = u.kurs_id)
      WHERE u.id = tasks.unit_id
        AND k.published = TRUE
    )
  );

-- ─────────────────────────────────────────────
-- 4. documents
-- ─────────────────────────────────────────────

DROP POLICY IF EXISTS "View documents of published kurse" ON public.documents;
DROP POLICY IF EXISTS "View documents of entitled units" ON public.documents;
DROP POLICY IF EXISTS "View documents of entitled units in published kurse" ON public.documents;
CREATE POLICY "View documents of entitled units in published kurse"
  ON public.documents FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.units u ON u.id = t.unit_id
      JOIN public.kurse k ON k.id = u.kurs_id
      JOIN public.entitlements e
        ON e.user_id = auth.uid()
       AND (e.unit_id = u.id OR e.kurs_id = u.kurs_id)
      WHERE t.id = documents.task_id
        AND k.published = TRUE
    )
  );

-- ─────────────────────────────────────────────
-- 5. document_images
-- ─────────────────────────────────────────────

DROP POLICY IF EXISTS "View document_images of published kurse" ON public.document_images;
DROP POLICY IF EXISTS "View document_images of entitled units" ON public.document_images;
DROP POLICY IF EXISTS "View document_images of entitled units in published kurse" ON public.document_images;
CREATE POLICY "View document_images of entitled units in published kurse"
  ON public.document_images FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.documents d
      JOIN public.tasks t ON t.id = d.task_id
      JOIN public.units u ON u.id = t.unit_id
      JOIN public.kurse k ON k.id = u.kurs_id
      JOIN public.entitlements e
        ON e.user_id = auth.uid()
       AND (e.unit_id = u.id OR e.kurs_id = u.kurs_id)
      WHERE d.id = document_images.document_id
        AND k.published = TRUE
    )
  );

-- ─────────────────────────────────────────────
-- 6. storage.objects (bucket `pdfs`)
-- ─────────────────────────────────────────────
-- Two branches, because an object's path is referenced either by a document
-- (PDF, single image, published PNG snapshot) or by a document_image (a page
-- of an image collection). Both need the same pair of conditions — a signed
-- URL is minted from this policy, so a gap here is a file gap, not a
-- metadata one.

DROP POLICY IF EXISTS "View PDFs of published kurse" ON storage.objects;
DROP POLICY IF EXISTS "View PDFs of entitled units" ON storage.objects;
DROP POLICY IF EXISTS "View PDFs of entitled units in published kurse" ON storage.objects;
CREATE POLICY "View PDFs of entitled units in published kurse"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'pdfs'
    AND (
      EXISTS (
        SELECT 1
        FROM public.documents d
        JOIN public.tasks t ON t.id = d.task_id
        JOIN public.units u ON u.id = t.unit_id
        JOIN public.kurse k ON k.id = u.kurs_id
        JOIN public.entitlements e
          ON e.user_id = auth.uid()
         AND (e.unit_id = u.id OR e.kurs_id = u.kurs_id)
        WHERE d.file_path = storage.objects.name
          AND k.published = TRUE
      )
      OR EXISTS (
        SELECT 1
        FROM public.document_images di
        JOIN public.documents d ON d.id = di.document_id
        JOIN public.tasks t ON t.id = d.task_id
        JOIN public.units u ON u.id = t.unit_id
        JOIN public.kurse k ON k.id = u.kurs_id
        JOIN public.entitlements e
          ON e.user_id = auth.uid()
         AND (e.unit_id = u.id OR e.kurs_id = u.kurs_id)
        WHERE di.file_path = storage.objects.name
          AND k.published = TRUE
      )
    )
  );
