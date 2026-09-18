-- add_document_content: the published interactive document (#65, spec #63).
--
-- Apply order: migration.sql → add_audit_log.sql → add_entitlements.sql →
-- add_editor_documents.sql → add_editor_images.sql → THIS FILE.
--
-- Prepares the Document row to carry a published interactive document.
--
-- ⚠ APPLY THIS BEFORE DEPLOYING THE CODE THAT SHIPS WITH IT. The migration is
-- backwards-compatible with the OLD code, but the new code is NOT
-- backwards-compatible with the old schema: `getUnitWithTasks` names `content`
-- in its select, so until the column exists PostgREST fails the whole query
-- and EVERY student Unit page 404s — not only pages holding an interactive
-- document. `publishEditorDraft` writes `content` on both paths and fails
-- outright. Order is: migrate dev → verify → deploy, and the same for prod.
--
-- Beyond that ordering, nothing a student or author sees changes; this is the
-- database half of the foundation.
--
-- NO RLS WORK IS NEEDED AND NONE IS ADDED, ON PURPOSE: `documents` SELECT is
-- already entitlement-gated, so anything stored on the row inherits that gate
-- with zero new policies. That is exactly why the published JSON lives here
-- and not on `editor_documents`, which is admin-only on all four verbs and
-- whose rows are DRAFTS — serving one would break the snapshot contract (an
-- author mid-edit would silently change what students see).

-- ─────────────────────────────────────────────
-- 1. The published document JSON
-- ─────────────────────────────────────────────

-- NULL for every existing row: legacy PDF and image documents carry no
-- snapshot, and the student renderer treats NULL as "render exactly as it
-- does today". Written by publishEditorDraft (#66), read by the renderer
-- (#67) through the versioned schema — never trusted as-is.
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS content JSONB;

-- ─────────────────────────────────────────────
-- 2. file_type gains 'interactive' and a CHECK
-- ─────────────────────────────────────────────

-- The allowed values have until now lived ONLY in the TypeScript union
-- (src/types/index.ts) — the database has never seen them. Keep the two in
-- sync: this CHECK and `Document['file_type']` must list the same values.
--
-- file_type is deliberately NOT dropped. It is the restoration key for
-- retained legacy rows — the only column recording what an archived row used
-- to be — and `file_type <> 'interactive'` is what makes the archive-selection
-- query of the cutover (#81) possible.
--
-- Pre-flight, if this fails: some row holds a value outside the four below.
--   SELECT DISTINCT file_type FROM public.documents;
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_file_type_check;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_file_type_check
  CHECK (file_type IN ('pdf', 'image', 'image_collection', 'interactive'));

-- ─────────────────────────────────────────────
-- 3. No index on `content`
-- ─────────────────────────────────────────────

-- Deliberate. Nothing queries INTO the JSON: a document is always fetched by
-- primary key, and links resolve by the target's published id (spec #63 §6),
-- which is a single-row PK fetch rather than a search. A GIN index here would
-- be write cost for a read that never happens. The backlink scan (#75) reads
-- content collections in application code, on demand, by design.
