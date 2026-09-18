-- add_lessons: Lernkurse und Lernseiten (#107).
--
-- Apply order: migration.sql → add_audit_log.sql → add_entitlements.sql →
-- add_editor_documents.sql → add_editor_images.sql → add_document_content.sql →
-- add_rls_published_conjunct.sql → THIS FILE.
--
-- ⚠ APPLY THIS BEFORE DEPLOYING THE CODE THAT SHIPS WITH IT, for the same
-- reason add_document_content.sql says so: `getKursNavTree` and the Kurs form
-- name `kurs_type` in their selects, so until the column exists PostgREST
-- fails the whole query and every Kurs page 404s. Order is: migrate dev →
-- verify → deploy, and the same for prod.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A LERNSEITE IS A `documents` ROW AND NOT A COLUMN ON `units`
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Putting the lesson JSON on `units` was the obvious shape and is WRONG, in a
-- way worth recording so nobody re-proposes it: `units` SELECT gates on
-- `kurse.published` ALONE and deliberately not on an entitlement — a Unit stays
-- browseable for non-purchasers so they can see what to buy. Anything stored on
-- that row inherits that openness. A Lernkurs's teaching material would have
-- been readable, in full, by any logged-in visitor: the paywall would have been
-- a title and a price badge in front of an unlocked page.
--
-- `documents` already gates on an entitlement AND `kurse.published` (#80), so a
-- Lernseite stored there is paywalled by the policies that already exist. This
-- migration therefore adds NO RLS and touches none: the gate is inherited, the
-- same way the interactive snapshot inherited it in add_document_content.sql.
--
-- The invisible Aufgabe is the other half of that decision. `documents.task_id`
-- is NOT NULL, so every Lernseite hangs under a Task the author never sees and
-- never names — the UI hides it, the schema keeps it, and every existing query,
-- policy, cascade delete and storage sweep keeps working untouched.

-- ─────────────────────────────────────────────
-- 1. Kursart
-- ─────────────────────────────────────────────

-- Which of the two kinds of Kurs this is:
--   'musterloesung' — a Unit holds a handful of solutions (images, PDFs).
--   'lernkurs'      — a Unit is a Lernseite: prose, formulas, worked examples.
--
-- The default is 'musterloesung' because that is what every existing Kurs IS.
-- A NOT NULL column with a default backfills every row in one statement and
-- leaves no nullable third state for callers to interpret.
ALTER TABLE public.kurse
  ADD COLUMN IF NOT EXISTS kurs_type TEXT NOT NULL DEFAULT 'musterloesung';

-- Pre-flight, if this fails: some row already holds another value.
--   SELECT DISTINCT kurs_type FROM public.kurse;
-- Keep this list and `Kurs['kurs_type']` (src/types/index.ts) in sync — nothing
-- enforces that but the hand-check the CLAUDE.md workflow prescribes.
ALTER TABLE public.kurse DROP CONSTRAINT IF EXISTS kurse_kurs_type_check;
ALTER TABLE public.kurse
  ADD CONSTRAINT kurse_kurs_type_check
  CHECK (kurs_type IN ('musterloesung', 'lernkurs'));

-- ─────────────────────────────────────────────
-- 2. Verkaufseinheit
-- ─────────────────────────────────────────────

-- Whether this Kurs is sold whole or by the Unit. Lernkurse are bought as a
-- course, Musterlösungen by the Unit — but it is a per-Kurs SETTING rather
-- than a consequence of the type, because that was the explicit requirement.
--
-- ⚠ THIS COLUMN IS NOT AN ACCESS GATE AND MUST NEVER BECOME ONE BY ITSELF. It
-- says what a checkout SELLS. What a reader may open is decided by
-- `entitlements` + the RLS policies, and the scoped entitlement that makes a
-- whole-course purchase real is NOT in this migration — it is the next one.
-- Until then a Kurs set to 'kurs' can be authored and displayed, and its
-- checkout is the disabled UI it is meant to be.
ALTER TABLE public.kurse
  ADD COLUMN IF NOT EXISTS sold_as TEXT NOT NULL DEFAULT 'unit';

ALTER TABLE public.kurse DROP CONSTRAINT IF EXISTS kurse_sold_as_check;
ALTER TABLE public.kurse
  ADD CONSTRAINT kurse_sold_as_check
  CHECK (sold_as IN ('kurs', 'unit'));

-- ─────────────────────────────────────────────
-- 3. file_type gains 'lesson'
-- ─────────────────────────────────────────────

-- A Lernseite is a Document whose `content` holds lesson JSON instead of
-- editor-document JSON. `file_type` is what tells the two apart on read —
-- there is no sniffing of the JSON's shape anywhere, and there must not be:
-- both schemas are versioned discriminated unions, and guessing which one a
-- blob is would make a malformed lesson look like a malformed document.
--
-- Pre-flight, if this fails: some row holds a value outside the five below.
--   SELECT DISTINCT file_type FROM public.documents;
--
-- Keep this list and `Document['file_type']` (src/types/index.ts) in sync.
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_file_type_check;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_file_type_check
  CHECK (file_type IN ('pdf', 'image', 'image_collection', 'interactive', 'lesson'));

-- ─────────────────────────────────────────────
-- 4. Kein Index, keine RLS-Änderung
-- ─────────────────────────────────────────────

-- No index on `content` for a Lernseite either — the reasoning of
-- add_document_content.sql §3 is unchanged: a page is always fetched by
-- primary key or through its Task, never searched into.
--
-- No policy is added, dropped or altered by this file. If a future change here
-- ever does touch one of the four published-conjunct policies, it must be
-- re-proved with supabase/checks/rls_published_conjunct_check.sql — `npm test`
-- cannot see them.
