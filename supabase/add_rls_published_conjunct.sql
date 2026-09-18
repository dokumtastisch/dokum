-- add_rls_published_conjunct: an unpublished Kurs goes dark at the database
-- level, not only in application code (#80, source decision #60, spec #63).
--
-- Apply order: migration.sql → add_audit_log.sql → add_entitlements.sql →
-- add_editor_documents.sql → add_editor_images.sql → add_document_content.sql
-- → THIS FILE.
--
-- ─────────────────────────────────────────────────────────────────────────
-- THE LEAK THIS CLOSES
-- ─────────────────────────────────────────────────────────────────────────
-- add_entitlements.sql replaced four published-inheriting SELECT policies
-- with entitlement-only ones, and in doing so *dropped* the `published`
-- subquery rather than adding to it. Since then, only `kurse` and `units`
-- check published; tasks, documents, document_images and the `pdfs` storage
-- objects check an entitlements row alone.
--
-- No file was ever exposed by this — /api/file and /api/image each re-check
-- kurse.published in application code, with an admin bypass. But the ROWS
-- are readable: an entitled user could still read the titles, descriptions,
-- positions and, since add_document_content.sql, the `content` JSON of every
-- document under a Kurs the operator had archived.
--
-- The archive cutover (#81) is about to make `kurse.published = FALSE` the
-- mechanism that retires the entire legacy world. That mechanism has to hold
-- in the database, not only in two route handlers.
--
-- ─────────────────────────────────────────────────────────────────────────
-- THE CHANGE
-- ─────────────────────────────────────────────────────────────────────────
-- Each of the four child policies becomes `entitled AND published` — the
-- conjunction, not a second OR'd policy. Getting that wrong is the one real
-- hazard here: PostgreSQL OR's multiple permissive SELECT policies together,
-- so a separate "published" policy would GRANT access rather than restrict
-- it, and would hand every published Kurs's content to users who never
-- bought it. Hence: one policy per table, both conditions inside it.
--
-- Admins are untouched. Their policies are unconditional and OR'd with
-- these, so archived content stays fully readable to an admin — which is
-- what makes an unpublished Kurs an archive rather than a black hole.
--
-- `units` and `kurse` are untouched too. Units deliberately stay browseable
-- while their Kurs is published so a non-purchaser can see what to buy.
--
-- ─────────────────────────────────────────────────────────────────────────
-- BLAST RADIUS
-- ─────────────────────────────────────────────────────────────────────────
-- For every Kurs that is published this is a no-op: the added conjunct is
-- true. The only users who read less afterwards are those holding an
-- entitlement for a Unit under an *unpublished* Kurs — which is precisely
-- the case the ticket exists to close.
--
-- Before applying, that set is worth looking at, because it is the exact
-- list of people whose view changes:
--
--   SELECT e.user_id, k.title
--   FROM public.entitlements e
--   JOIN public.units u ON u.id = e.unit_id
--   JOIN public.kurse k ON k.id = u.kurs_id
--   WHERE k.published = FALSE;
--
-- ─────────────────────────────────────────────────────────────────────────
-- VERIFYING IT
-- ─────────────────────────────────────────────────────────────────────────
-- On DEV: run supabase/checks/rls_published_conjunct_check.sql. It proves the
-- guarantee behaviourally — FAILS before this migration, PASSES after.
--
-- On PROD: do NOT run that script. It writes (and rolls back) rows in
-- auth.users and storage.objects, and prod is not the place to discover that
-- a rollback missed something. Verify read-only instead — every child policy
-- that is not the unconditional admin one must mention `published`, and there
-- must be no third policy on any of these tables, because permissive SELECT
-- policies are OR'd:
--
--   SELECT schemaname || '.' || tablename AS tbl, policyname,
--          qual LIKE '%published%' AS has_published_conjunct
--   FROM pg_policies
--   WHERE cmd = 'SELECT'
--     AND ((schemaname = 'public'  AND tablename IN ('tasks','documents','document_images'))
--       OR (schemaname = 'storage' AND tablename = 'objects'))
--   ORDER BY 1, 2;
--
-- Expected: exactly two rows per table — the admin policy (false) and the
-- policy below (true). Any third row is a leak.

-- Every DROP below names THREE policies per table: the pre-entitlements one
-- from migration.sql, the entitlements-era one this replaces, and the new
-- name (so the file is re-runnable). The first is not paranoia. Permissive
-- SELECT policies are OR'd, and migration.sql's "View … of published kurse"
-- policies check `published` WITHOUT an entitlement — so on any database
-- where one survived a partial or out-of-order migration, it would sit
-- alongside the policy below and hand every published Kurs's paid content to
-- any authenticated user. add_entitlements.sql already dropped them; dropping
-- them again costs nothing and closes the case where it did not run cleanly.

-- ─────────────────────────────────────────────
-- 1. tasks
-- ─────────────────────────────────────────────

DROP POLICY IF EXISTS "View tasks of published kurse" ON public.tasks;
DROP POLICY IF EXISTS "View tasks of entitled units" ON public.tasks;
DROP POLICY IF EXISTS "View tasks of entitled units in published kurse" ON public.tasks;
CREATE POLICY "View tasks of entitled units in published kurse"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.entitlements e
      JOIN public.units u ON u.id = e.unit_id
      JOIN public.kurse k ON k.id = u.kurs_id
      WHERE e.unit_id = tasks.unit_id
        AND e.user_id = auth.uid()
        AND k.published = TRUE
    )
  );

-- ─────────────────────────────────────────────
-- 2. documents
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
      JOIN public.entitlements e ON e.unit_id = t.unit_id
      JOIN public.units u ON u.id = t.unit_id
      JOIN public.kurse k ON k.id = u.kurs_id
      WHERE t.id = documents.task_id
        AND e.user_id = auth.uid()
        AND k.published = TRUE
    )
  );

-- ─────────────────────────────────────────────
-- 3. document_images
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
      JOIN public.entitlements e ON e.unit_id = t.unit_id
      JOIN public.units u ON u.id = t.unit_id
      JOIN public.kurse k ON k.id = u.kurs_id
      WHERE d.id = document_images.document_id
        AND e.user_id = auth.uid()
        AND k.published = TRUE
    )
  );

-- ─────────────────────────────────────────────
-- 4. storage.objects (bucket `pdfs`)
-- ─────────────────────────────────────────────
-- Two branches, because an object's path is referenced either by a document
-- (PDF, single image, published PNG snapshot) or by a document_image (a page
-- of an image collection). Both need the same conjunct — a signed URL is
-- minted from this policy, so a gap here is a file gap, not a metadata one.

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
        JOIN public.entitlements e ON e.unit_id = t.unit_id
        JOIN public.units u ON u.id = t.unit_id
        JOIN public.kurse k ON k.id = u.kurs_id
        WHERE d.file_path = storage.objects.name
          AND e.user_id = auth.uid()
          AND k.published = TRUE
      )
      OR EXISTS (
        SELECT 1
        FROM public.document_images di
        JOIN public.documents d ON d.id = di.document_id
        JOIN public.tasks t ON t.id = d.task_id
        JOIN public.entitlements e ON e.unit_id = t.unit_id
        JOIN public.units u ON u.id = t.unit_id
        JOIN public.kurse k ON k.id = u.kurs_id
        WHERE di.file_path = storage.objects.name
          AND e.user_id = auth.uid()
          AND k.published = TRUE
      )
    )
  );
