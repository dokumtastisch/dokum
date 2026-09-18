# Dokum — Developer Overview

## Project Purpose

**Dokum** is a web application that allows authenticated users to view and access published course materials (Kurse) organized as PDF documents and images. The app features an admin dashboard for content creators to build and manage the course hierarchy.

## Quick Facts

- **Status**: v4.3 (LaTeX editor integrated into the admin panel — PRD #28)
- **Repository**: git (`master` branch is stable; feature work on separate branches)
- **Tech Stack**: Next.js 16 + React 19 + TypeScript 5 + Tailwind CSS 4
- **Backend/Database**: Supabase (PostgreSQL + Auth + Storage)
- **Deployment**: Vercel-ready

## Architecture Overview

### Hierarchy Model

```
Kurs (Course)
  └── Unit                    ← paid unit-of-purchase (see Payments below)
        └── Task
              └── Document (PDF | Image | Image Collection)
                    └── DocumentImage (for collections only)
```

**Key Rules:**
- Only `kurse` has a `published` boolean — everything below it inherits visibility from that one flag
- **Tasks / Documents / DocumentImages / `pdfs` storage objects gate on *entitled AND published*** (or admin role), where *entitled* means an `entitlements` row for the owning Einheit **or** for its Kurs (`add_kurs_entitlements.sql`). `add_entitlements.sql` had *dropped* the `published` subquery from those four policies, leaving the rows readable to an entitled user under an archived Kurs; `add_rls_published_conjunct.sql` (#80) put it back as a conjunct inside the same policy — never as a second policy, since permissive SELECT policies are OR'd and a separate one would *grant* access. The app-level re-checks in `/api/file`, `/api/image` and `/dokumente/[docId]` stay as defence in depth, but the archive no longer depends on them. Any change to these four policies must be re-proved with **both** scripts in `supabase/checks/`.
- All levels support `position` ordering (non-unique integers; ties broken by `created_at ASC`)
- Sorting is applied inside the DAL (`src/lib/dal.ts`) — no manual sorting in page components
- `ON DELETE CASCADE` at every foreign key level

### Payments (one-time, no subscription — per Unit or per Kurs)

- **Model — `kurse.sold_as` decides, per Kurs:** `'unit'` sells each `Unit` once for the flat €3 (test mode price `price_1TWLu0CbBje0sCsEadcen6py`); `'kurs'` sells the whole Kurs once for `kurse.price_cents`. Lifetime entitlement either way. In practice Musterlösungen are `'unit'` and Lernkurse `'kurs'`, but nothing in the code reads `kurs_type` for this — the column is the switch, so an exception costs one admin edit.
- **A Kurs grant covers Einheiten added after the sale.** That is the reason it is one row carrying `kurs_id` rather than a fan-out of unit rows at checkout time (`supabase/add_kurs_entitlements.sql`).
- **`entitlements` table:** `(user_id, unit_id | kurs_id, granted_at, source: 'purchase'|'admin', stripe_session_id)`, exactly one of the two targets set (`entitlements_target_check`). UNIQUE on `(user_id, unit_id)`; partial UNIQUE on `(user_id, kurs_id)` — a plain constraint would be useless there, NULLs being distinct — plus the partial UNIQUE on `stripe_session_id` for webhook idempotency.
- **RLS:** SELECT on tasks/documents/document_images and storage.objects (bucket `pdfs`) requires `EXISTS` in `entitlements` matching the ancestor `unit_id` **or** the ancestor `kurs_id`, **and** the ancestor `kurse.published` — OR admin role.
- **Prices:** the Einheitenpreis is a fixed Stripe Price (`STRIPE_UNIT_PRICE_ID`, mirrored by `UNIT_PRICE_CENTS`); the Kurspreis is an inline `price_data` amount from `kurse.price_cents`, editable in the Kurs form (in euros, stored in cents). `lib/pricing.ts` is the single rule for which of the two a surface shows.
- **Flow:** user clicks "Unlock – €X" → form posts to `/api/checkout/[unitId]` or `/api/checkout/kurs/[kursId]` (each refuses the sale its `sold_as` does not describe, and redirects to the surface that does) → `lib/checkout.ts` creates the Checkout Session, stamping `metadata.unit_id` XOR `metadata.kurs_id` → user pays on Stripe → `/api/checkout/success?session_id=…` eager-inserts the entitlement with the service-role client (idempotent on `stripe_session_id`) → `/api/stripe/webhook` covers the case where the user closes the tab. Both handlers read the target back through `entitlementFromMetadata`, which refuses a session naming neither or both.
- **Admin grants:** insert directly into `entitlements` with `source = 'admin'` (via Supabase dashboard or a future admin action) — audit-log with `action='grant', entity_type='entitlement'`. There is still no admin UI for this.
- **Env requirements:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_UNIT_PRICE_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **CSP:** `connect-src` allows `api.stripe.com`; `frame-src` allows `js.stripe.com`, `hooks.stripe.com`, `checkout.stripe.com`; `form-action` allows `checkout.stripe.com`.
- **Proxy:** `/api/stripe/webhook` bypasses the proxy entirely (Stripe has no cookies).

### Authentication & Authorization

**User Roles:**
- **Regular User**: Authenticated via Supabase Auth (login/register). Can view published content.
- **Admin**: Role stored in `auth.users.raw_app_meta_data` as `{"role": "admin"}`. Can create, edit, and delete content.

**Access Control:**
- Proxy (`src/proxy.ts` — Next.js 16 renamed the `middleware` convention to `proxy`) protects `/admin/*` routes and API proxy routes
- Admin pages do **not** duplicate the auth check — the proxy is the single enforcement point
- File proxy routes (`/api/file`, `/api/image`) verify the document belongs to a published course before serving — unauthenticated or unpublished-content requests return 401/403 at the application layer
- `/api/link-target` (#74) is the only **read** route that answers past RLS (the service-role client is otherwise used by the payment routes, `/api/checkout/success` and `/api/stripe/webhook`, to *write*). It returns a verdict — locked, archived, missing, ok — plus the Einheit an unlock would buy. Never content, never a storage path. See [Unreachable Link Targets](#unreachable-link-targets-74)
- JWT includes role automatically — no extra DB queries needed
- Role grants: `UPDATE auth.users SET raw_app_meta_data = ... WHERE email = '...'` (user must sign out/in to refresh JWT)

### Database Schema

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `profiles` | User metadata | `id` (auth.uid), `email`, `full_name`, `created_at` |
| `kurse` | Courses | `id`, `title`, `description`, **`published`**, `position`, `created_at` |
| `units` | Course sections | `id`, `kurs_id` (FK), `title`, `description`, `position`, `created_at` |
| `tasks` | Unit assignments | `id`, `unit_id` (FK), `title`, `description`, `position`, `created_at` |
| `documents` | PDFs/images/published interactive documents | `id`, `task_id` (FK), `title`, `description`, `file_path`, `file_type` (`pdf`\|`image`\|`image_collection`\|`interactive`, CHECK-constrained), `position`, `created_at`, `content` (JSONB, published document JSON — NULL for legacy rows) |
| `document_images` | Image collection items | `id`, `document_id` (FK CASCADE), `file_path`, `position`, `created_at` |
| `audit_logs` | Admin + purchase action log | `id`, `actor_id` (FK auth.users), `action` (`create`\|`update`\|`delete`\|`grant`\|`revoke`), `entity_type` (incl. `entitlement`, `editor_document`, `editor_image`), `entity_id`, `entity_title`, `metadata` (JSONB), `created_at` |
| `entitlements` | Paid access, per (user, unit) **or** (user, kurs) | `id`, `user_id` (FK auth.users), `unit_id` (FK units, nullable), `kurs_id` (FK kurse, nullable — exactly one of the two, `entitlements_target_check`), `granted_at`, `source` (`purchase`\|`admin`), `stripe_session_id` |
| `editor_documents` | LaTeX-editor drafts (PRD #28; outside the Kurs hierarchy until published) | `id`, `title`, `content` (JSONB, versioned document JSON), `published_document_id` (FK documents, SET NULL), `created_by` (FK auth.users, SET NULL), `created_at`, `updated_at` (trigger-maintained) |
| `editor_images` | Uploaded images of editor drafts (slice 8; never base64 in `content` — blocks store the row id) | `id`, `editor_document_id` (FK CASCADE), `file_path` (in bucket `pdfs` under `editor-images/<draftId>/…`), `created_at` |

### Row-Level Security (RLS)

| Table | Policy | Effect |
|-------|--------|--------|
| `profiles` | SELECT where `id = auth.uid()` | Users see only their own profile |
| `kurse` | SELECT where `published = TRUE` (auth); INSERT/UPDATE/DELETE where role = admin | Published courses visible to all; admins manage |
| `units` | SELECT via subquery to `kurse.published`; INSERT/UPDATE/DELETE where role = admin | Units stay browseable for non-purchasers (so they can see what to buy) |
| `tasks/documents` | SELECT via subquery to `entitlements` **joined up to `kurse.published`** + admin override; INSERT/UPDATE/DELETE where role = admin | Content gated by purchase *and* by the Kurs still being published |
| `document_images` | SELECT via join to `entitlements` **and `kurse.published`** + admin override; INSERT/DELETE where role = admin | Same gate, one level deeper |
| `entitlements` | SELECT own rows or admin; INSERT/DELETE where role = admin (webhook inserts via service-role) | Users see their grants; admins manage |
| `storage.objects` (`pdfs` bucket) | INSERT/DELETE where bucket = `pdfs` and role = admin; **SELECT via two OR'd policies** — an unconditional admin one, and one requiring an entitlement for the unit owning the path **and** a published Kurs | File access matches in-DB access; admins keep archived files |
| `audit_logs` | SELECT/INSERT where role = admin; no UPDATE/DELETE | Immutable audit trail; admin-readable only |
| `editor_documents` | SELECT/INSERT/UPDATE/DELETE where role = admin (not filtered by `created_by`) | Drafts are admin-only; both admins see and edit all drafts |
| `editor_images` | SELECT/INSERT/DELETE where role = admin (no UPDATE — rows are immutable) | Editor images admin-only; the bucket-wide admin storage policies cover their objects (entitlement SELECT never matches these paths) |

## Project Structure

```
src/
├── actions/
│   ├── admin/                      # Admin server actions (split by entity)
│   │   ├── _shared.ts             # Shared helpers (getAdminUser, collectStoragePaths, parseForm)
│   │   ├── kurse.ts               # createKurs, updateKurs, deleteKurs
│   │   ├── units.ts               # createUnit, updateUnit, deleteUnit
│   │   ├── tasks.ts               # createTask, updateTask, deleteTask
│   │   ├── documents.ts           # createDocument, updateDocument, deleteDocument
│   │   ├── editor-documents.ts    # createEditorDraft, updateEditorDraft, deleteEditorDraft
│   │   ├── editor-images.ts       # uploadEditorImage (implicit anchor draft, storage upload)
│   │   ├── editor-publish.ts      # publishEditorDraft (PNG → Document; create / update-in-place)
│   │   ├── link-targets.ts        # listLinkTargetDocuments (#72) — the link picker's lazy fourth level; a READ, so no audit entry and no revalidation
│   │   ├── backlinks.ts           # scanDocumentBacklinks (#75) — what links to a Dokument, scanned on demand for the delete + „Als neues Dokument" warnings; a READ, so no audit entry and no revalidation
│   │   └── index.ts               # Re-exports all actions
│   └── auth.ts                    # signIn, signUp, signOut
├── app/
│   ├── page.tsx                   # Home: grid of published Kurse
│   ├── layout.tsx                 # Root layout (Navbar, Footer)
│   ├── error.tsx                  # Root error boundary (client component)
│   ├── loading.tsx                # Root loading skeleton
│   ├── auth/
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── callback/route.ts      # Supabase auth callback
│   ├── consent/                   # GDPR consent management
│   ├── datenschutz/               # Privacy policy
│   ├── impressum/                 # Legal info
│   ├── kurse/
│   │   └── [kursId]/
│   │       ├── layout.tsx         # Kurs shell (#106): KursSidebar + content column — mounted ONCE for every page below
│   │       ├── page.tsx           # Kurs intro + locked-Einheit teaser (no unit cards any more)
│   │       ├── error.tsx          #   both boundaries are content-only — the shell is already painted
│   │       ├── loading.tsx
│   │       └── units/[unitId]/
│   │           ├── page.tsx       # Unit detail (expandable task/document tree)
│   │           ├── error.tsx
│   │           └── loading.tsx
│   ├── dokumente/[docId]/         # Addressable single-Dokument route (#69) — flat by design
│   │   ├── page.tsx               #   full-page view: loadDocumentSurface → DocumentArticle
│   │   ├── error.tsx
│   │   └── loading.tsx
│   ├── einheiten/[unitId]/        # Flat Einheit URL (#73) — a REDIRECT to /kurse/[kursId]/units/[unitId]
│   │   └── page.tsx               #   supplies the Kurs an Einheit link never stored; RLS decides 404 vs redirect
│   ├── @modal/                    # Overlay slot (#70) — parallel route on the ROOT layout
│   │   ├── default.tsx            #   renders null: what every non-intercepted route falls back to (its absence would 404 them)
│   │   └── (.)dokumente/[docId]/  #   INTERCEPTS the route above on client-side navigation only
│   │       ├── page.tsx           #     dialog shell outside the Suspense boundary, document streamed into it
│   │       └── error.tsx          #     failure keeps the dialog, so the close button still works
│   ├── admin/
│   │   ├── page.tsx               # Admin hub (4-card grid)
│   │   ├── error.tsx
│   │   ├── loading.tsx
│   │   ├── kurse/page.tsx         # „Kurse verwalten" (#108): table of Kurse (Einheiten-Zahl, Art, Veröffentlicht/Privat) + create/edit in a modal
│   │   ├── units/new/page.tsx     # Create/edit Unit
│   │   ├── tasks/new/page.tsx     # Create/edit Task
│   │   ├── documents/new/page.tsx # Create/edit Document
│   │   └── editor/                # LaTeX editor (PRD #28): draft list, editor shell, PNG export, publish
│   │       ├── page.tsx           #   loads draft + target tree via DAL, remounts shell per draftId
│   │       └── editor.css         #   consolidated editor styles (Dokum-red rebrand)
│   │   └── lernseiten/page.tsx    # Lernseiten workspace (#107): whole Kurs tree + block editor + live preview
│   └── api/
│       ├── file/[docId]/route.ts          # Auth-gated file proxy (PDFs/images)
│       ├── image/[imageId]/route.ts       # Auth-gated image collection proxy
│       ├── editor-image/[imageId]/route.ts # Admin-only editor-image proxy (STREAMS, same-origin)
│       └── link-target/[kind]/[id]/route.ts # Link resolver (#74): ok | locked | archived | missing + the Einheit that unlocks it — never content
├── components/
│   ├── admin/
│   │   ├── KursForm.tsx           # Create/edit Kurs form
│   │   ├── UnitForm.tsx           # Create/edit Unit form
│   │   ├── TaskForm.tsx           # Create/edit Task form
│   │   ├── DocumentForm.tsx       # Create/edit Document form
│   │   ├── UnitPageClient.tsx     # Client wrapper for Unit admin page
│   │   ├── TaskPageClient.tsx     # Client wrapper for Task admin page
│   │   ├── DocumentPageClient.tsx # Client wrapper for Document admin page
│   │   ├── AdminTree.tsx          # Generic nested tree visualizer
│   │   ├── AdminSubpageNav.tsx    # Tab navigation for admin subpages
│   │   └── editor/                # LaTeX editor React shell (PRD #28)
│   │       ├── EditorShell.tsx    #   save bar + Term state + imperative mount (controller) + the link picker's promise seam
│   │       ├── EditorToolbar.tsx  #   rich-text toolbar (uncontrolled → controller)
│   │       ├── ExportBar.tsx      #   Kurs/Unit/Task targets, Term, filename, PNG download + publish (size guard)
│   │       ├── LinkTargetPicker.tsx # Link target tree (#72): PUBLISHED Kurse → Einheiten → Aufgaben from the page prop, Dokumente + their Sprungmarken fetched lazily per Aufgabe
│   │       └── DraftList.tsx      #   draft list with open/delete
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   └── RegisterForm.tsx
│   ├── kurse/
│   │   ├── KursCard.tsx
│   │   ├── KursSidebar.tsx         # The Kurs navigation tree (#106) — client component, mounted by the Kurs LAYOUT so it survives navigation
│   │   ├── document-reveal.tsx     # Context from the sidebar to the Einheit accordion (#106): click a Dokument → unfold + scroll to it in the main column, no navigation
│   ├── lessons/                    # Lernseiten (#107) — the second document model, deliberately beside the LaTeX editor rather than inside it
│   │   ├── LessonView.tsx          #   student renderer: ordinary server-rendered React (a lesson holds no state React must not discard)
│   │   ├── LessonMath.tsx          #   the one browser-side piece: swaps LaTeX source for typeset SVG
│   │   ├── BlockEditor.tsx         #   the block list — textareas + inline-markup, NOT a contenteditable
│   │   └── LessonWorkspace.tsx     #   tree left, editor + live preview right; holds the open page's draft in state
│   │   ├── RecentMiniCases.tsx
│   │   └── UnitPaywall.tsx
│   ├── documents/
│   │   ├── DocumentBody.tsx        # A document's body for every file_type — the ONE render path shared by the Unit accordion and the full-page route (callers supply the heading)
│   │   ├── DocumentArticle.tsx     # Breadcrumb + title + description + body at page scale — shared by the full page and the overlay, which differ only in their chrome
│   │   ├── DocumentOverlay.tsx     # The overlay shell (#70): native <dialog>.showModal() for the focus trap, Escape and inert background; every dismissal is router.back()
│   │   ├── DocumentLink.tsx        # The in-app link to a Dokument — carries scroll={false} so opening an overlay cannot discard the source page's reading position
│   │   ├── LinkLockedCard.tsx      # What a link into unbought material opens (#74): the Einheit + its teaser + the unlock button, as UnitPaywall inside a <dialog> — in place, so nothing the student typed is unmounted
│   │   ├── DocumentCard.tsx
│   │   ├── InteractiveDocument.tsx # Live student render of a published document JSON + PNG fallback (error boundary); owns only the MathJax half — typesets the formulas each recompute reports as changed, serialised so a fast typist cannot land a stale one
│   │   ├── DocumentPng.tsx        #   the stored picture: legacy 'image' render AND the interactive fallback
│   │   ├── Watermark.tsx          #   tiled deterrent overlay (pointer-events:none — must not block selection)
│   │   └── interactive-document.css #  student typography/pills/formula blocks + the editable input control (scoped to .dokum-document)
│   ├── consent/
│   ├── datenschutz/
│   ├── UnitDetailClient.tsx       # Unit detail page (expandable tasks + documents)
│   ├── ShareButton.tsx
│   └── layout/
│       ├── Navbar.tsx
│       └── Footer.tsx
├── lib/
│   ├── constants.ts               # Centralized config (bucket, file limits, MIME types)
│   ├── dal.ts                     # Data access layer — all Supabase read queries
│   ├── document-view.ts           # documentViewKind(): which render path a Document takes (interactive | picture | collection | file) — pure, shared by both student surfaces
│   ├── document-access.ts         # isDocumentReadable(): the one app-level access rule (published re-check + admin bypass, nullable view) — pure, tested
│   ├── document-surface.ts        # loadDocumentSurface(): auth + DAL read + access rule + watermark, `cache`d — the single read path behind BOTH student document surfaces
│   ├── link-navigation.ts         # linkHref()/linkOpensOverlay() (#73): a stored link target → a URL, and whether following it opens the overlay. Pure; injected into the renderer so lib/editor never learns this app's routes
│   ├── link-target-state.ts       # describeLinkTarget() (#74): the ok|locked|archived|missing verdict AND what may cross with it, in one function so a field cannot be attached to a verdict that must not carry it. Pure, tested; NOT server-only — the browser parses the same schema
│   ├── unreachable-links.ts       # Browser half of #74: resolves each distinct target once, degrades archived/deleted chips to plain text, re-points locked ones at their Einheit. Fails open — an unresolved chip is left exactly as the renderer built it
│   ├── schemas.ts                 # Zod schemas for server action input validation
│   ├── audit.ts                   # logAdminAction() — fire-and-forget audit log writer
│   ├── editor/                    # LaTeX editor (PRD #28): TWO imperative surfaces (controller.ts for /admin/editor, document-render.ts for the student viewer) + pure modules
│   │   ├── controller.ts          # Imperative contenteditable controller (browser-only)
│   │   ├── document-json.ts       # Versioned Zod schema (discriminated union over `version`: v1.0, v1.1 = block `anchor` + inline `link`) + ported importer + serializer. The inline vocabulary is built PER VERSION, so a v1.0 snapshot carrying a link is refused rather than duck-typed
│   │   ├── document-version.ts    # Upgrade-on-read: pure vN→vN+1 chain + readDocumentJson (the boundary for stored snapshots) — pure
│   │   ├── anchors.ts             # Sprungmarken (#71): the anchor's Zod shape + its block-dataset contract + the registry that resolves ids duplicated by copy/paste. DOM-only (no MathJax, no server), so jsdom-testable — but it WRITES block datasets and remembers who owns which id, so not pure
│   │   ├── links.ts               # Cross-document links (#72): the target union ({kursId}|{unitId}|{docId}|{docId,anchorId}), the v1.1 `link` node's Zod shape, the chip's DOM contract, the kind glyph/label a chip shows (#73), and the picker seam types. DOM-only, no server
│   │   ├── backlinks.ts           # Backlink scan (#75): given every parsed document — published AND draft — which of them link to one Dokument, plus the German warnings the two call sites show. Pure; nothing about links is stored, so the answer is computed at warning time
│   │   ├── document-render.ts     # Student renderer: document JSON → live DOM, reusing the importer + resolver; MathJax-free. Owns the student-editable inputs and the recompute they trigger, and swaps each authoring link chip for a navigable <a> (#73), so it is imperative (owns its DOM, binds listeners) — React must not reconcile inside its container
│   │   ├── publish-plan.ts        # Copy-fresh-then-swap image re-homing plan for publishing (what to copy/rewrite/delete) — pure
│   │   ├── expression-evaluator.ts # CSP-safe math tokenizer/parser — replaces new Function; errors → NaN
│   │   ├── latex-normalise.ts     # LaTeX→expression translation + auto-expression extraction
│   │   ├── field-resolver.ts      # Input/Output field graph: value resolution, cycle → Err, output-as-input rule — pure
│   │   ├── latex-display.ts       # LaTeX display cleanup (cleanupLatex, `*` → `\,\cdot\,`) — pure
│   │   ├── library-sync.ts        # Formula-library entry sync after formula edits — pure
│   │   ├── number-format.ts       # German display formatting (formatValue) + the lossless entry pair a student's input box round-trips through (parseGermanEntry / formatGermanEntry) — pure
│   │   ├── export-filename.ts     # PNG filename builder (Term + 1-based tree ordinals) + Document-title seed — pure
│   │   ├── png-export.ts          # PNG export pipeline → Blob (SVG raster at 2×, html2canvas; browser-only)
│   │   ├── mathjax-loader.ts      # Bundled MathJax loader — config set BEFORE the dynamic tex-svg-full import (full build: color macros need it; browser-only)
│   │   ├── mathjax.d.ts           # Minimal type declarations for the bundled MathJax component
│   │   └── *.test.ts              # Colocated Vitest golden tests (parity contract with the standalone editor)
│   ├── lessons/                   # Lernseiten (#107) — the SECOND document model. Beside lib/editor, never inside it: that schema's parity is pinned by goldens, and a lesson is prose, not a calculation sheet
│   │   ├── lesson-json.ts         # Versioned Zod schema (v1.0): heading/paragraph/formula/calculation/example/divider/video. Blocks nest exactly ONE level — an example holds leaves, so no recursive schema, renderer or drop target
│   │   ├── lesson-version.ts      # Upgrade-on-read + readLessonJson. Reuses upgradeThroughChain from the document ladder rather than copying its subtle parts
│   │   ├── lesson-meta.ts         # The header facts nobody typed: „3.3" from the tree path, „12 min" from the word count (180 wpm; a formula counts as one word)
│   │   ├── lesson-example.ts      # The design's reference page as data — the specification, and the proof the model can express it
│   │   ├── inline-markup.ts       # `**fett**` / `$LaTeX$` / `[[Begriff|Erklärung]]` ⇄ inline nodes. Round-trip-tested, which is what stands between an author and content corrupted on the second save
│   │   ├── lesson-task.ts         # LESSON_TASK_TITLE — the invisible Aufgabe's name. Its own module because a 'use server' file may export only actions, and both halves need one spelling
│   │   ├── unit-lessons.ts        # splitUnitLessons(): which of a Unit's documents are Lernseiten and what is left for the accordion — including removing the hidden Aufgabe. Pure, tested
│   │   └── *.test.ts              # Colocated Vitest tests
│   ├── supabase/
│   │   ├── server.ts              # Supabase SSR client (server/proxy)
│   │   └── client.ts              # Supabase browser client
│   └── utils.ts                   # cn() helper (clsx + tailwind-merge)
├── proxy.ts                       # Request routing, auth enforcement, consent check (Next.js 16 renamed middleware → proxy)
└── types/
    └── index.ts                   # TypeScript interfaces + ActionResult<T> union
```

Outside `src/`: `supabase/` holds the SQL migrations (see [Database Migrations](#database-migrations)), and `latexEditor/` holds the committed standalone reference editor (PRD #28) — the port's behavioral ground truth, still runnable in a plain browser.

## Key Patterns

### Data Access Layer (DAL)

All Supabase data reads go through `src/lib/dal.ts`. Page components and API routes never call `supabase.from()` directly.

```ts
// In a page component:
import { getUnitWithTasks } from '@/lib/dal'
const unit = await getUnitWithTasks(unitId)
if (!unit) notFound()
```

The DAL is marked `import 'server-only'` — importing it in a client component causes a build error. Sorting (position ASC, created_at ASC) is applied inside each DAL function.

**Two reads are memoised with React `cache()`**, and only those two: `getKursNavTree()` and `getKursViewerAccess()` (#106). A layout cannot pass props to the page it wraps, so the Kurs shell and the Kurs page inside it necessarily ask the same two questions in one render; `cache()` is what stops that from being two round trips. It is not a general policy — every other DAL function runs when it is called.

**One read bypasses RLS**, and it is the only one: `getLinkTargetOwnership()` uses the service-role client, because the link resolver (#74) has to tell an *unentitled* student which Einheit to buy — and that is exactly the row `documents` SELECT withholds from them. Three properties keep it safe and all three are in the function: it selects only the columns a refusal may name (no `content`, no `file_path`), it never learns who is asking (no user id, no role — so it cannot leak per-reader data), and its result must pass through `describeLinkTarget()` before crossing to the browser. It has exactly one caller.

### Server Action Result Type

All server actions return `ActionResult<T>` — a discriminated union from `src/types/index.ts`:

```ts
type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }
```

Components check `state?.ok === false` for errors and `state?.ok === true` for success. No more optional `{ error?, success?, id? }` shapes.

### Zod Input Validation

All server actions validate `FormData` through Zod schemas (`src/lib/schemas.ts`) before touching the database. A missing or misnamed form field returns a typed error immediately instead of writing `undefined`/`NaN` to the database.

### Audit Logging

Every admin create, update, and delete calls `logAdminAction()` from `src/lib/audit.ts` after the primary operation succeeds. Audit log failures are logged to console but never block the primary operation.

```ts
await logAdminAction({
  actorId: user.id,
  action: 'delete',
  entityType: 'kurs',
  entityId: kursId,
  metadata: { paths_deleted: paths.length },
})
```

Records are written to the `audit_logs` table with RLS — admins can read, nobody can delete.

### Admin Subpage Layout

**`/admin/kurse` is the exception, and the direction of travel (#108):** a table of what exists, with creating and editing as a modal over it. The old `/admin/kurse/new` put an empty form on the left of the catalogue, so the first thing an admin saw was a form rather than their courses. The table shows Kursname, Einheiten-Zahl, Kursart and a Veröffentlicht/Privat badge; `getAllKurseWithUnits()` already returns every column it needs, so the edit modal opens with values in hand instead of navigating to `?editId=` and re-reading. `?editId=` still works — the admin tree on the other pages links with it — and opens the modal on load.

The remaining three (`/admin/{units,tasks,documents}/new`) still follow the **70/30 two-column grid**:

```
┌─────────────────────────────────────────────────────┐
│ AdminSubpageNav (tab buttons)                       │
├──────────────────┬──────────────────────────────────┤
│   Form (70%)     │   Tree View (30%)                │
│                  │   • Shows current hierarchy      │
│                  │   • Edit/delete buttons          │
│                  │   • Highlights selected item     │
└──────────────────┴──────────────────────────────────┘
```

Pages support both create mode (no `?editId`) and edit mode (`?editId=<uuid>`). The form renders with `defaultValues` pre-filled when editing.

### Kurs Shell (#106)

Everything under `/kurse/[kursId]` renders into a two-column shell owned by `app/kurse/[kursId]/layout.tsx`: the navigation tree on the left, the page on the right.

```
┌───────────────────┬─────────────────────────────────┐
│ KursSidebar       │  page.tsx      → Kurs intro     │
│  Einheit          │                  + locked-unit  │
│   └ Aufgabe       │                    teaser       │
│      └ Dokument   │  units/[unitId] → Aufgaben-     │
│  Einheit    €3    │                   akkordeon     │
└───────────────────┴─────────────────────────────────┘
```

**It is a layout, not a component each page imports**, and that is the whole design: moving between Einheiten re-renders only the content column, so the tree keeps its scroll offset and `getKursNavTree()` does not run again.

**The two levels unfold differently, and neither has a disclosure triangle.** An *Einheit* unfolds purely from the route — the one the student is in (or, while a Dokument overlay is open, the one that Dokument belongs to) shows its Aufgaben; every other Einheit is a single row. There is no control for it, so no gesture can open a branch the student is not in. An *Aufgabe* is the one foldable thing: its row is a `<button>` (there is no Aufgabe route to navigate to) and pressing it toggles its Dokumente, starting folded. That override is layered over a derived default rather than replacing it, so the Aufgabe holding an open document unfolds without a click — otherwise the highlighted row would be hidden inside a collapsed branch.

Three consequences worth knowing before touching it:

- **A locked Einheit has no children in the tree, and RLS is what does that** — `tasks`/`documents` require an entitlement, `units` do not. So an unpaid Einheit is still listed by name (it is the thing being sold, and its page holds the paywall) while its contents are neither readable nor listable. The layout's `locked` flag is display only: a padlock, muted text and a price badge (the Einheitenpreis, or the Kurspreis where the Kurs is sold whole), never enforcement.
- **`getKursNavTree()` selects titles and nothing else.** No `content` — the sidebar renders no document, and `*` would ship every published snapshot in the Kurs on every page load in it.
- **Pages below the shell carry no page chrome of their own** — no background, no width cap, no „back to course" link. Their `error.tsx`/`loading.tsx` are content-only for the same reason. Errors thrown by the *layout* bubble past them to the root boundary.

**Only the Einheit row is a link.** An Aufgabe row is a `<button>` that folds. A Dokument row is a `<button>` too, and it opens nothing: the Dokument is *already rendered* in the main column, so the click unfolds its Aufgabe there and scrolls to it. Nothing navigates, which is the strongest possible version of the #70 guarantee — there is no trip for a student's typed values to survive. The overlay is still one click away, from „Einzelansicht ↗" beside the Dokument itself.

That last gesture needs a channel, because the sidebar lives in the layout and the accordion lives in the page it wraps — sibling route subtrees cannot see each other. `components/kurse/document-reveal.tsx` is that channel: a context the layout puts around *both* columns, holding the accordion's handler in a **ref** so registering it re-renders nothing. `reveal()` is a no-op when no accordion is mounted (the Kurs landing page, a paywalled Einheit), which needs no guard — only the Einheit on screen is unfolded in the tree, so the only clickable Dokumente are the ones that accordion holds.

`?openTask=[taskId]` on the Einheit page still has two producers — the back link on `/dokumente/[docId]` and `RecentMiniCases` — and both are soft navigations that can hit a page whose `UnitDetailClient` is already mounted. That is why it adjusts its open set when the prop changes and not only on mount.

### Lernkurse und Lernseiten (#107)

A Kurs is one of two kinds, recorded in `kurse.kurs_type`:

| Kursart | Was eine Einheit enthält |
|---------|--------------------------|
| `musterloesung` | Ein paar Lösungen — Bilder, PDFs. Das bestehende Aufgaben-Akkordeon. |
| `lernkurs` | Eine Lernseite: Fließtext, Merkformeln, Beispielboxen, Videos. |

**A Lernseite is a `documents` row with `file_type = 'lesson'`, and that is a security decision, not a filing preference.** The obvious shape — a `content` column on `units` — is wrong: `units` SELECT gates on `kurse.published` **alone**, deliberately, so non-purchasers can browse what they might buy. Anything on that row is readable by any logged-in visitor. `documents` SELECT requires an entitlement, so storing the page there inherits the paywall that already exists and adds no policy. `supabase/add_lessons.sql` records this at length so nobody re-proposes the column.

**The invisible Aufgabe** is what that costs. `documents.task_id` is NOT NULL, so every Lernseite hangs under a Task titled `LESSON_TASK_TITLE` (`src/lib/lessons/lesson-task.ts`) that no author ever sees and no student ever sees:

- `getLessonWorkspaceTree()` flattens past it, so the workspace shows Kurs → Einheit → Lernseite.
- `splitUnitLessons()` removes it from what the student accordion renders — a Task that held *only* Lernseiten disappears, one that held both keeps its other documents.

The constant lives in its own module because a `'use server'` file may export nothing but server actions, and both the action that creates the Task and the DAL that hides it need the same spelling.

**Two document models now share `documents.content`**, told apart by `file_type` and never by sniffing the JSON — both are versioned discriminated unions, so a guess would make a malformed lesson look like a malformed document.

| | LaTeX-Editor | Lernseite |
|---|---|---|
| Modul | `src/lib/editor/` | `src/lib/lessons/` |
| Schema | `document-json.ts` (v1.1) | `lesson-json.ts` (v1.0) |
| `file_type` | `interactive` | `lesson` |
| Autorenfläche | `/admin/editor` (imperativ) | `/admin/lernseiten` (React) |

**The lesson renderer is NOT a third imperative surface.** The other two own their DOM because it holds something React must not discard — an author's cursor, a student's typed values. A Lernseite holds neither, so `LessonView` is ordinary server-rendered React; only `LessonMath` touches the DOM, to swap LaTeX source for typeset SVG.

**Rich text is a `<textarea>` plus `inline-markup.ts`** — `**fett**`, `$LaTeX$`, `[[Begriff|Erklärung]]` — not a contenteditable. Both directions are pure and round-trip-tested, which is the property that stands between an author and content silently corrupted on the second save. It is a stage: a WYSIWYG surface can replace the textarea later and produce the same nodes.

**⚠ Saving writes live content.** There is no draft layer yet — a published Kurs shows a save immediately. The course-wide draft mode is the next piece; the workspace says so on screen rather than leaving an author to find out.

**⚠ `kurse.sold_as` is still not an access gate** — but it is now live. It decides what a checkout *offers*: `'kurs'` sells the whole Kurs at `kurse.price_cents` (editable in the Kurs form, in euros), `'unit'` sells each Einheit at the fixed Stripe Price. What a reader may *open* remains `entitlements` + RLS, which accept a Unit grant or a Kurs grant. The Einheitenpreis stays read-only in the form: it lives in Stripe.

### File Serving

Files are stored in the private Supabase Storage bucket `pdfs`. Access is always through authenticated proxy routes:

- `GET /api/file/[docId]` — PDFs and single images
- `GET /api/image/[imageId]` — image collection items
- `GET /api/editor-image/[imageId]` — LaTeX-editor draft images (admin-only)

The document routes verify:
1. User is authenticated
2. If not admin: the document's parent course is published (join query up to `kurse.published`)

Short-lived signed URLs (60s) are generated server-side. The document routes respond with a single 302 redirect to the signed URL (the link dies after 60 s); the editor-image route instead fetches it server-side and **streams** the body, so the browser only ever sees a same-origin response — that is what lets the PNG export (html2canvas) rasterise editor images without CORS handling or canvas tainting. Signed Supabase URLs are never stored, embedded in content, or exposed beyond that one redirect.

### Student Document Routes

A Dokument is addressable at `/dokumente/[docId]` (`documentUrl()`). The segment is **flat on purpose**: a link stores its target's document id and nothing else, so the URL needs no Kurs or Unit in it, and a top-level segment is the shape the overlay's intercepting route needs.

Access reuses the two mechanisms that already exist and adds none. Both surfaces below read through **`loadDocumentSurface()`** so neither can become the laxer of the two:

1. **Entitlement is RLS's job** — `documents` SELECT requires a purchase for the owning Unit *and* a published parent Kurs (or admin), so both an unentitled visitor and a reader of an archived Kurs get no row.
2. **`kurse.published` is re-checked in app code**, with an admin bypass, exactly as `/api/file` does. Since #80 the policy checks it too, so this is now defence in depth rather than the only gate — keep it: it is what lets an *admin* read the row and still be refused the student surface, and the refusal it produces is the one that stays uniform across all three failure modes.

Every failure — unknown id, no entitlement, archived Kurs — collapses into one refusal; distinguishing them would leak which documents exist to someone who cannot read them. The full page turns that into `notFound()`, the overlay into a „nicht gefunden" panel inside the dialog.

**These surfaces still collapse them, and that has not changed.** The link resolver (#74, below) tells the three apart, but only for a target somebody has already *linked to*, only as a verdict plus the Einheit that unlocks it, and never as content — see that section for why the difference has to exist at all.

**One URL, two presentations (#70).** A **hard** navigation — pasted link, bookmark, reload, a mail from a classmate — renders the full page. A **client-side** navigation from inside the app is intercepted by `app/@modal/(.)dokumente/[docId]` and opens the same document as a modal dialog over the current page: centred panel on desktop, full-screen sheet on a phone. Nothing in our code chooses between them; the App Router's interception rule does, and it only fires on soft navigation.

The overlay is not cosmetic. **The viewer holds live student inputs and nothing persists them** — plain navigation would discard whatever the student typed, on the way out and again on the way back. Parallel routing never unmounts the `children` slot, so the source page (accordion state, scroll position, every typed value) is still there underneath and is still there when the overlay closes. Three rules keep that true:

- **Every dismissal is `router.back()`** — close button, Escape and backdrop click all pop the history entry the link pushed, so browser Back and the close button cannot disagree. Escape is intercepted (`onCancel` → `preventDefault`) rather than left to the native close, which would leave the URL pointing at a document no longer on screen.
- **In-app document links carry `scroll={false}`** (that is all `DocumentLink` is for). Without it the router scrolls to the top of the "page" it is navigating to, silently throwing away the reading position of the page underneath.
- **The dialog shell renders outside the Suspense boundary.** It costs no database read, so the overlay is on screen while the document is still loading — and it is the *same* dialog element before and after, which is what keeps focus where `showModal()` put it. A `loading.tsx` at that level would open one dialog and swap it for a second, moving focus mid-navigation.

### Following a Link (#73)

A link inside a document is stored as a target and a label; **turning that into a URL is app knowledge and lives in `lib/link-navigation.ts`**, injected into the student renderer as the `linkHref` adapter. The editor library therefore never learns this app's routes, and the renderer cannot silently disagree with `DocumentLink` about where a document lives.

| Target | URL | Presentation |
|--------|-----|--------------|
| `{ kursId }` | `/kurse/[kursId]` | Ordinary navigation (a real departure) |
| `{ unitId }` | `/einheiten/[unitId]` → redirect | Ordinary navigation |
| `{ docId }` | `/dokumente/[docId]` | Overlay, `scroll: false` |
| `{ docId, anchorId }` | `/dokumente/[docId]#anchorId` | Overlay, scrolled to the marked block |

**`/einheiten/[unitId]` exists because of what a link stores.** An Einheit link carries `{ unitId }` alone while the Einheit is shown under its Kurs, so something must supply the Kurs id. One server-side redirect does it, which keeps the chip's href a pure function of the target — no lookup in the browser and no Kurs id copied into stored content where it could go stale. It adds no access surface: the lookup runs through the DAL under the reader's own RLS (`units` gate on `published`), and everything else is enforced by the Einheit page it hands the student to.

**The chip is a real `<a href>`, built by `document-render.ts` in place of the authoring chip the importer produces.** That is what gives focus order, Enter, and „open in new tab" for free; a plain left click is intercepted and pushed through `router.push` so the source page is never unmounted, while a modified or middle click is left to the browser. `followLink` is handed the href the chip is **wearing**, not the target to re-resolve, so a click cannot travel somewhere other than where the chip says it goes. Without `followLink` the anchor still navigates — worse (typed values are lost), never dead.

Two consequences of it being a raw anchor rather than a `next/link`, both accepted: **a chip does not prefetch** (`DocumentLink` does, which is why the accordion's „Einzelansicht" opens faster than a chip), and nothing about it can be reconciled by React — it lives in DOM the renderer owns.

- **The kind glyph is CSS chrome**, drawn from `data-link-icon` via `attr()`, so it never enters the text a student copies. The one glyph map lives in `lib/editor/links.ts`; the chip's `aria-label` carries the same distinction in words for readers who get no icon.
- **There is no hover behaviour anywhere, deliberately** (spec §6). The peek was dropped: the overlay does it better one click away with state intact, and a hover would make the product quietly different on touch. No preview, no prefetch on mouse-over, and no `title` tooltip.
- **A Sprungmarke travels in the fragment**, never reaching the server, and is resolved against the rendered DOM after the first typeset run (formulas change height when MathJax replaces them). A `hashchange` listener covers a second jump inside a document already on screen.

### Unreachable Link Targets (#74)

A stored link outlives what it points at: the Einheit may be unbought, the Kurs archived, the Dokument deleted. **`GET /api/link-target/[kind]/[id]` is the resolver that tells those apart**, and it exists because RLS cannot: `documents` SELECT is entitlement-gated, so an unentitled student's lookup returns *no row at all* and locked is indistinguishable from deleted in the browser — while „das liegt in Einheit 3, schalte sie frei" needs exactly the data the policy withholds from the reader we want to sell to.

The route is a thin shell: authenticate (same requirement and same `app_metadata.role` bypass as the file proxies), one identity-free privileged read, one entitlement read *under the reader's own RLS*, then the pure decision in `lib/link-target-state.ts`:

| Verdict | When | What crosses to the browser |
|---------|------|-----------------------------|
| `missing` | no such row | nothing but the verdict |
| `archived` | exists, Kurs unpublished | nothing but the verdict |
| `locked` | live, Einheit not bought | the target's title + the Einheit and its teaser |
| `ok` | reachable — and everything that exists, for an admin | nothing but the verdict |

**The order between them is load-bearing: `archived` beats `locked`.** An unentitled reader looking at a link into a retired Kurs must not be offered a €3 unlock for an Einheit that stays dark.

The chips are resolved **eagerly**, one request per *distinct* target, after the document is already on screen — `DocumentRenderResult.links` reports them for exactly this, the same way `renderTargets` reports the formulas the renderer refuses to typeset. Then `lib/unreachable-links.ts` rewrites each one:

- **archived / missing** → no longer a link. The author's words plus a quiet „(nicht mehr verfügbar)", so the sentence still reads. Both say the same thing — which of the two it is belongs to the operator.
- **locked** → still a chip, now amber with a lock glyph. Its href is **re-pointed at the Einheit**, so a middle click, „open in new tab" or our JS not running all land on the paywall rather than a dead end; a plain click opens `LinkLockedCard` in place, which is `UnitPaywall` — the same component the locked Einheit page shows — so the teaser reaches both surfaces by construction.

Two rules that are easy to break: **both rewrites replace the element** rather than mutating it, because the renderer bound a click listener that pushes the target's URL and there is no handle to remove it with — a mutated locked chip would still navigate to the refusal this replaces. And the whole path **fails open**: an unreachable resolver, a non-OK status, or a body that does not parse (what an unauthenticated fetch actually gets is the proxy's HTML login redirect) all leave every chip exactly as the renderer built it. A document must never silently unlink itself because a request failed.

### Error & Loading Boundaries

Every major route segment has scoped `error.tsx` and `loading.tsx` files. A failed Supabase query shows a friendly German error UI instead of a white screen.

**`app/einheiten/[unitId]` has neither**, deliberately: it renders nothing at all — one DAL read, then a `redirect()` or a `notFound()` — so a loading state would flash a boundary for a page that never appears, and a failed read falls through to the root `error.tsx` exactly as it should.

**One deliberate exception:** the overlay slot `app/@modal/(.)dokumente/[docId]` has an `error.tsx` but **no `loading.tsx`** — its page streams the document into a `<Suspense>` inside the dialog it has already opened, and a segment-level loading boundary would open a second dialog and move focus mid-navigation. Both boundaries there render inside `DocumentOverlay` for the same reason: the page underneath is still mounted and the student needs the close button to get back to it.

## Server Actions

### Admin (`src/actions/admin/`)

| Function | File | Description |
|----------|------|-------------|
| `createKurs` | `kurse.ts` | Insert new Kurs |
| `updateKurs` | `kurse.ts` | Update existing Kurs |
| `deleteKurs` | `kurse.ts` | Delete Kurs + all children + storage files |
| `createUnit` | `units.ts` | Insert new Unit |
| `updateUnit` | `units.ts` | Update existing Unit |
| `deleteUnit` | `units.ts` | Delete Unit + all children + storage files |
| `createTask` | `tasks.ts` | Insert new Task |
| `updateTask` | `tasks.ts` | Update existing Task |
| `deleteTask` | `tasks.ts` | Delete Task + all children + storage files |
| `createDocument` | `documents.ts` | Upload file + insert Document record |
| `updateDocument` | `documents.ts` | Update metadata, optionally replace file |
| `deleteDocument` | `documents.ts` | Delete Document record + storage file(s) |
| `createEditorDraft` | `editor-documents.ts` | Insert editor draft (validated document JSON); returns the new id |
| `updateEditorDraft` | `editor-documents.ts` | Update draft title + content; reconciles images (rows/objects the content no longer references are deleted) |
| `deleteEditorDraft` | `editor-documents.ts` | Delete editor draft + its `editor_images` rows (cascade) + storage objects |
| `uploadEditorImage` | `editor-images.ts` | Upload an editor image to storage + insert `editor_images` row; creates the implicit „Unbenannt" anchor draft when no draft exists yet |
| `publishEditorDraft` | `editor-publish.ts` | Publish a draft's rendered PNG as a Document: updates the linked Document's file + title in place by default (same entry for students), or creates + links a new Document (first publish, „Als neues Dokument", dead-link fallback); mirrors the documents.ts upload/rollback pattern and maintains `published_document_id` |
| `listLinkTargetDocuments` | `link-targets.ts` | The link picker's lazy fourth level (#72): the Dokumente of one Aufgabe plus their Sprungmarken, and **only if the Aufgabe's Kurs is published** — the rule that makes „unpublished targets cannot be selected" true at the boundary. Parses the published snapshot server-side so the content itself never crosses to the client |
| `scanDocumentBacklinks` | `backlinks.ts` | What links to a Dokument (#75), across published snapshots **and** unpublished drafts. Backs both warnings — deleting a linked Dokument, and „Als neues Dokument", the one publish path that mints a new id and strands inbound links on the old one. Reads the whole catalogue because nothing about links is persisted; parses server-side, so only source names cross to the client. Keeps „could not read it" apart from „nothing links here": an unparseable snapshot is counted, a failed query returns `{ ok: false }`, and neither blocks the operation |

All MUTATING actions: validate input via Zod → auth check via `getAdminUser()` → database operation → audit log → revalidate cache. `listLinkTargetDocuments` and `scanDocumentBacklinks` are the read-only actions: they validate and auth-check the same way, but write nothing, so they neither audit nor revalidate.

### Auth (`src/actions/auth.ts`)

`signIn`, `signUp`, `signOut`, `acceptConsent`, `withdrawConsent`

## Constants & Configuration

All magic values live in `src/lib/constants.ts`:

| Constant | Value | Used for |
|----------|-------|---------|
| `STORAGE_BUCKET` | `'pdfs'` | All Supabase Storage operations |
| `MAX_FILE_SIZE_BYTES` | `4 * 1024 * 1024` | File upload size limit (4 MB) |
| `SIGNED_URL_EXPIRY_SECONDS` | `60` | Proxy route signed URL TTL |
| `ALLOWED_IMAGE_MIMES` | `['image/jpeg', ...]` | Accepted image types |
| `ALLOWED_FILE_MIMES` | `['application/pdf', ...]` | Accepted file types |
| `MIME_TO_EXT` | `Record<string, string>` | MIME → file extension map |
| `editorImageUrl(imageId)` | `` `/api/editor-image/${imageId}` `` | Single source for editor-image browser URLs (controller, JSON importer, proxy route) |
| `documentUrl(docId, anchorId?)` | `` `/dokumente/${docId}` `` (+ `#anchorId`) | Single source for the addressable Dokument URL (#69). In-app links go through `DocumentLink`, which adds the `scroll={false}` the overlay needs (#70) — the accordion's „Einzelansicht", `DocumentCard`, and the link chips (#73) |
| `kursUrl(kursId)` | `` `/kurse/${kursId}` `` | Where a Kurs link goes (#73) |
| `unitUrl(unitId)` | `` `/einheiten/${unitId}` `` | Where an Einheit link goes (#73) — the flat redirect that supplies the Kurs a link never stored. Also where a **locked** chip is re-pointed (#74), so every path out of it lands on the paywall rather than a dead end |
| `linkTargetUrl(kind, id)` | `` `/api/link-target/${kind}/${id}` `` | The resolver a rendered chip asks whether its target is still reachable (#74). The id is percent-encoded — it is read off a chip's dataset in the browser |

## Dependencies

| Package | Purpose |
|---------|---------|
| `next` 16 | Framework (App Router, Turbopack) |
| `react` 19 | UI with Server Components |
| `typescript` 5 | Type safety (strict mode) |
| `tailwindcss` 4 | Utility-first CSS |
| `@supabase/ssr` | Supabase Auth + DB + Storage |
| `zod` | Runtime schema validation for server actions |
| `server-only` | Build-time guard for server-only modules |
| `yet-another-react-lightbox` | Image gallery/lightbox |
| `clsx` + `tailwind-merge` | Conditional className helpers |
| `mathjax` (exact `3.2.2`) | LaTeX → SVG rendering, bundled + code-split to the editor page (no CDN — CSP) |
| `html2canvas` (exact `1.4.1`) | Editor PNG export rasterizer, bundled + code-split, loaded on first export (no CDN — CSP) |

## Running Locally

### Prerequisites

- Node.js 18+
- Supabase project with: PostgreSQL, Auth, Storage bucket named `pdfs`

### Setup

```bash
npm install

# Create .env.local with:
# NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

npm run dev
```

Visit `http://localhost:3000`

### Tests

Vitest (`vitest.config.ts`) is a dev-only dependency — no runtime impact.

```bash
npm test             # run all unit tests once
npm run test:watch   # watch mode
```

Conventions: tests are colocated `*.test.ts` files next to their modules and assert **external behavior only** (inputs → outputs, no internal call structure). The default environment is plain Node; DOM-dependent suites opt into jsdom per file via a `@vitest-environment jsdom` docblock — currently `document-json.test.ts`, whose importer builds real DOM. The editor-module tests under `src/lib/editor/` are golden cases generated from the standalone reference editor (`latexEditor/*.html`) and double as the React port's parity contract — expected values must not be changed without checking the reference behavior first.

Tests are not confined to `src/lib/editor/`: any pure module is a candidate. `src/lib/document-view.test.ts` pins the render-path rule both student surfaces share, `src/lib/document-access.test.ts` pins the access rule they share, and `src/lib/link-navigation.test.ts` pins where a stored link target actually points (#73). React components have no test seam here (no testing-library, no browser E2E) — component and navigation behaviour is verified by manual QA recorded on the ticket, which is why the overlay of #70 carries a written checklist rather than a suite.

### Two Supabase Projects

The app talks to **two completely separate Supabase projects** — not one project with branches.

| Env | Project ref | Selected by | `NEXT_PUBLIC_APP_ENV` |
|-----|-------------|-------------|------------------------|
| Dev  | `elnupcpwhvfbmbpcbwrc` | `npm run dev` (loads `.env.local`) | `dev` |
| Prod | `pnooldcnqlsqjatbtimz` | `npm run build` / `npm run start` and Vercel (loads `.env.production.local`) | `prod` |

The dev project is a sandbox — fine to wipe and reseed. The prod project holds real users and content; treat it accordingly. Schema changes go to **dev first**, then prod once verified. The Supabase MCP server (`.mcp.json`) is pinned to the **dev project only** (`--project-ref=elnupcpwhvfbmbpcbwrc`); prod is intentionally not reachable via MCP and must be modified manually through the Supabase dashboard or CLI.

### Database Migrations

Migrations live in `supabase/`. Apply them in order — first to dev (Supabase SQL editor, CLI, or `mcp__supabase__apply_migration`), then to prod once verified (Supabase SQL editor or CLI; MCP is dev-only):

| File | Description |
|------|-------------|
| `migration.sql` | Initial schema (all tables, RLS, storage policies) |
| `add_audit_log.sql` | Audit log table and policies |
| `add_entitlements.sql` | `entitlements` table + RLS rewire so tasks/documents/storage require a purchase |
| `add_editor_documents.sql` | `editor_documents` drafts table (admin-only RLS, `updated_at` trigger) + audit `entity_type` extension |
| `add_editor_images.sql` | `editor_images` table (admin-only RLS, cascade with draft) + audit `entity_type` extension (`editor_image`); no storage-policy changes needed |
| `add_document_content.sql` | `documents.content` JSONB (published document snapshot, NULL for legacy rows) + `documents_file_type_check` CHECK adding `interactive`; no RLS changes needed — the row is already entitlement-gated |
| `add_rls_published_conjunct.sql` | Re-adds the `published` conjunct to the four child SELECT policies (tasks, documents, document_images, `pdfs` storage objects) so an archived Kurs goes dark in the database, not only in app code (#80). No-op for published Kurse; admins unaffected |
| `add_lessons.sql` | `kurse.kurs_type` (`musterloesung`/`lernkurs`) + `kurse.sold_as` (`kurs`/`unit`), and `documents.file_type` gains `'lesson'` (#107). Adds NO RLS: a Lernseite is a Document and inherits the entitlement gate that already exists — which is exactly why it is not a column on `units` |
| `add_kurs_entitlements.sql` | `kurse.price_cents`; `entitlements.kurs_id` (+ `unit_id` nullable, XOR CHECK, partial UNIQUE); the four content SELECT policies widened from „entitled for this Einheit" to „…or for its Kurs", `published` conjunct untouched. Makes `kurse.sold_as = 'kurs'` real |

**Verification checks** live in `supabase/checks/` — SQL scripts that prove a guarantee against a real database, for guarantees no Vitest seam can reach. Each one runs inside a transaction that ends in `ROLLBACK`. Run them against **dev**, after applying the migration they belong to:

| File | Proves |
|------|--------|
| `rls_published_conjunct_check.sql` | An unpublished Kurs is unreadable to an entitled non-admin and to anonymous, fully readable to an admin, and unchanged for a published Kurs (#80). Fails before `add_rls_published_conjunct.sql`, passes after |
| `rls_kurs_entitlement_check.sql` | A whole-Kurs grant opens exactly its own Kurs — including an Einheit created after the sale — stays dark while that Kurs is unpublished, and reaches no other Kurs. Also pins the XOR CHECK and the partial UNIQUE. Run it together with the one above after touching those policies |

## Common Tasks

### Grant Admin Access

```sql
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'::jsonb
WHERE email = 'user@example.com';
```

User must sign out and back in for the role change to take effect (JWT refresh).

### Add a New Admin Action

1. Add Zod schema to `src/lib/schemas.ts`
2. Write the action in the relevant `src/actions/admin/*.ts` file
3. Add `logAdminAction(...)` call after the primary operation succeeds
4. Call `revalidatePath(...)` to bust the Next.js cache

### Query Audit Logs

```sql
SELECT al.created_at, al.action, al.entity_type, al.entity_title, u.email
FROM public.audit_logs al
JOIN auth.users u ON u.id = al.actor_id
ORDER BY al.created_at DESC
LIMIT 50;
```

### Enable/Disable a Kurs

Set `published = true/false` in the `kurse` table. Everything beneath it appears/disappears instantly via RLS — Units, Aufgaben, Dokumente, Dokumentbilder and the `pdfs` storage objects alike — and `/api/file` + `/api/image` immediately 403 non-admins.

Since #80 this hides the **rows too**, not only the navigation path and the files: the four child policies read *entitled AND published*, so a user holding an `entitlements` row for a Unit under an archived Kurs reads nothing at all. Admins keep full access to rows and files, which is what makes an unpublished Kurs usable as an archive.

⚠ Unpublishing therefore **revokes reading for people who already paid** for a Unit underneath. That is the intended archive semantics, not a bug — but before flipping a Kurs dark in prod, look at exactly whose view changes:

```sql
SELECT e.user_id, k.title AS kurs, u.title AS einheit
FROM public.entitlements e
JOIN public.units u ON u.id = e.unit_id
JOIN public.kurse k ON k.id = u.kurs_id
WHERE k.id = '<the kurs about to be archived>';
```

## Debugging Tips

| Issue | Likely Cause | Fix |
|-------|--------------|-----|
| Admin page accessible without being admin | Proxy not running | Check `src/proxy.ts` exists at `src/` root (Next.js 16 renamed middleware → proxy) |
| File proxy returns 403 | Course not published | Set `kurse.published = true` for the parent course |
| `/dokumente/[docId]` 404s for a user who can see the document in the accordion | Parent Kurs unpublished — since #80 RLS withholds the row, and the route re-checks `published` in app code as well (admins bypass) | Set `kurse.published = true`, or confirm the 404 is intended (archived Kurs) |
| An entitled user suddenly sees an empty Einheit / a Kurs's content vanished | Its Kurs was unpublished. Since #80 that hides the rows, not just the files | Intended archive behaviour — republish the Kurs, or confirm the archiving was deliberate. Run `supabase/checks/rls_published_conjunct_check.sql` if you suspect the policies themselves |
| `/dokumente/[docId]` 404s for everyone including admins | No such document id | The route deliberately does not distinguish unknown / unentitled / archived — check the id against `documents` |
| An in-app document link navigates full-page instead of opening the overlay | The link is a plain `<a>` or a `Link` outside `DocumentLink`, or `src/app/@modal/default.tsx` was removed | Interception only fires on client-side navigation through `next/link`; route in-app document links through `DocumentLink` |
| Every route 404s after touching the root layout | The `@modal` slot lost its `default.tsx` | A parallel slot without a `default` makes every hard navigation that does not match it a 404 — restore `src/app/@modal/default.tsx` |
| The overlay opens but the source page's typed values are gone | Something unmounted the `children` slot — e.g. a `router.push`/`replace` instead of the intercepted link, or a `key` change on the source tree | Values are held in the renderer's DOM and nothing persists them; the overlay only preserves them by never unmounting the page |
| Zod error on form submit | Field name mismatch | Check form field `name` attributes match schema keys in `schemas.ts` |
| Audit log not writing | `audit_logs` table missing | Apply `supabase/add_audit_log.sql` migration |
| PDF won't open in iPhone Safari | Content-Disposition | Route sets `{ download: false }` in signed URL — ensure it stays |
| Admin role not working after grant | JWT not refreshed | User must sign out and back in |
| TypeScript error on DAL import in client | `server-only` guard | Move the import to a server component or action |
| Editor formulas don't render | MathJax chunk failed or config set too late | `mathjax-loader.ts` must set `window.MathJax` config **before** the dynamic import — check the console for chunk 404s / CSP violations |
| Editor field or formula shows `Err` | Circular reference or invalid expression | By design: the evaluator returns NaN on any parse/eval error and the resolver breaks cycles — fix the expression or reference in the field modal |
| PNG export fails / editor images missing in the PNG | Image not served same-origin | Editor images must load via `/api/editor-image/[imageId]` (streaming route) — any cross-origin URL taints the html2canvas canvas |
| „Als Dokument speichern" disabled | Draft never saved, or image upload in flight | Publishing requires a saved draft; saves (and thus publish) are blocked while uploads are pending |
| Draft content older than the published PNG | Pre-#40 behavior | No longer possible: publish persists the draft first (publish implies save, ExportBar → saveDraft) |
| Color in LaTeX shows an error box | Formula uses the legacy `\textcolor[HTML]{…}` syntax | MathJax v3 has no HTML color model — re-apply color via the toolbar (emits `\textcolor{#HEX}{…}` / `\colorbox{#HEX}{$…$}`) |
| Publish rejected: PNG too large | 2×-rendered PNG exceeds the 4 MB limit | The size guard offers a reduced 1× export; beyond that the document must be shortened or split (Vercel body ceiling — the limit cannot be raised) |
| Typed `[input:x]` stays plain text | Conversion is a 1-second interval sweep | Wait a second; if it still doesn't convert, check the placeholder syntax for typos |
| „Sprungmarke" alerts instead of marking | No cursor in a serializable block | The mark needs a top-level block that survives a save — click into the block first. The alert names which of the two cases it is (#93): „Bitte zuerst den Cursor …" = nothing targeted, „Dieser Block kann keine Sprungmarke tragen" = targeted but not serializable (an image block whose upload hasn't landed, `serializesAsOwnBlock`) |
| ⚓ can't reach a formula or image block | Those blocks hold no caret | Click their ❚❚ drag handle once (#92) — a click, unlike a drag, selects the block (red outline) and ⚓ then acts on the selection. Escape, typing, or moving the caret releases it |
| ⚓ on the very first line of an empty draft | The line is a bare text node, not a block | Handled (#93): the ⚓ button promotes the stray run into the `<p>` the serializer would have folded it into anyway (`promoteStrayRunToBlock`), so the saved document is unchanged and the line becomes markable |
| A pasted block's ⚓ badge keeps the name but the link goes elsewhere | By design (#71) | Copying a marked block re-stamps the copy with a **fresh** id and keeps the label — two blocks may never answer to one link. Rename the copy to tell them apart |
| The ⚓ badge vanishes from the half after an Enter | By design (#71) | A contenteditable Enter clones the block's attributes; the new half is unmarked rather than given a second Sprungmarke under the same name |
| The link picker's tree is empty | No Kurs is published | By design (#72): a link may only point at something a student can reach, so authoring is order-dependent — publish the target Kurs first, then link to it |
| A Dokument is missing from the link picker | Its Kurs is unpublished, or the Aufgabe was never expanded | The document level is fetched per Aufgabe on expand (`listLinkTargetDocuments`), and the server returns nothing at all for an Aufgabe under an unpublished Kurs |
| A published Dokument lists no Sprungmarken | Legacy row, or an unreadable snapshot | Only `content` snapshots carry anchors: a PDF/image document has none, and a snapshot `readDocumentJson` refuses contributes none rather than failing the picker. The document itself stays linkable as a whole |
| Can't put the cursor inside a link chip | By design (#72) | The chip is `contenteditable="false"` so no keystroke can separate a label from its target — **click** the chip to re-target, relabel or remove it |
| „Link entfernen" leaves the words behind | By design (#72) | Unlinking replaces the chip with its own label as plain text; the author asked for the link to go, not the sentence |
| A link chip in a published document is not clickable | The chip is still the authoring `<span>` — the renderer's swap did not run | Only `document-render.ts` turns a chip into an `<a href>`; check the document actually renders live (not the PNG fallback) and that the caller passes the `linkHref` adapter |
| Following a link loses everything the student typed | The click was not intercepted, so the browser navigated | `followLink` must be wired (InteractiveDocument passes it) and the target must be a **Dokument** — a Kurs or Einheit link is a real departure and always unmounts the source |
| A link chip shows no glyph | `data-link-icon` missing, or the `attr()` rule was scoped away | The glyph is CSS chrome (`interactive-document.css`) drawn from the attribute the renderer stamps; it is never part of the label |
| An Einheit link 404s | Its Kurs or the Einheit itself is unpublished | `/einheiten/[unitId]` resolves through the DAL under the reader's RLS — no row, no redirect. Publish the Einheit, or accept the 404 as the archive rule working |
| A link to a Sprungmarke opens the document at the top | The anchor id is not in that document's snapshot | The fragment is matched against `data-anchor-id` in the rendered DOM; a Sprungmarke deleted or re-stamped after the link was made no longer matches (that is #75's warning to add) |
| A chip stays blue and clickable although its target is gone | The resolver was never answered — it **fails open** by design (#74) | Check `/api/link-target/[kind]/[id]` in the network tab: a non-OK status, a thrown fetch, or a body that is not a verdict (an unauthenticated request gets the proxy's HTML login redirect) all leave every chip untouched |
| Every chip in a document degrades at once | Not a resolver verdict — the render failed | A verdict is per target; a document that lost all its links either fell back to the PNG or never rendered. Look for `Rendern fehlgeschlagen` in the console |
| A locked chip navigates instead of opening the card | The element was mutated rather than replaced | The renderer's `followLink` listener has no handle to remove it with, so `applyLinkTargetDescriptor` replaces the anchor with a clone. Mutating it in place leaves that listener attached |
| The unlock card offers an Einheit that cannot be bought | `archived` lost to `locked` in the decision | `describeLinkTarget` checks `kursPublished` **before** the entitlement, on purpose — the test „archived beats locked" pins it |

## File Reference Guide

| What You Need | File(s) |
|---------------|---------|
| Auth flow | `src/actions/auth.ts`, `src/proxy.ts` |
| Admin create/update/delete logic | `src/actions/admin/*.ts` |
| All data read queries | `src/lib/dal.ts` |
| Input validation schemas | `src/lib/schemas.ts` |
| Audit logging | `src/lib/audit.ts` |
| Config / magic values | `src/lib/constants.ts` |
| TypeScript types + ActionResult | `src/types/index.ts` |
| Admin form components | `src/components/admin/{Kurs,Unit,Task,Document}Form.tsx` |
| Admin tree visualizer | `src/components/admin/AdminTree.tsx` |
| File proxy routes | `src/app/api/file/[docId]/route.ts`, `src/app/api/image/[imageId]/route.ts`, `src/app/api/editor-image/[imageId]/route.ts` |
| Student document rendering | `src/lib/document-view.ts`, `src/components/documents/DocumentBody.tsx`, `src/app/dokumente/[docId]/page.tsx` |
| Student document access + shared page-scale view | `src/lib/document-access.ts`, `src/lib/document-surface.ts`, `src/components/documents/DocumentArticle.tsx` |
| Document overlay navigation | `src/app/@modal/*`, `src/components/documents/DocumentOverlay.tsx`, `src/components/documents/DocumentLink.tsx`, `src/app/layout.tsx` |
| Where a link goes | `src/lib/link-navigation.ts`, `src/app/einheiten/[unitId]/page.tsx`, `makeLinksNavigable` in `src/lib/editor/document-render.ts` |
| Whether a link still goes anywhere | `src/lib/link-target-state.ts`, `src/lib/unreachable-links.ts`, `src/app/api/link-target/[kind]/[id]/route.ts`, `getLinkTargetOwnership` in `src/lib/dal.ts`, `src/components/documents/LinkLockedCard.tsx` |
| What links TO a Dokument (delete / „Als neues Dokument" warnings) | `src/lib/editor/backlinks.ts`, `src/actions/admin/backlinks.ts`, `getBacklinkScanRows` in `src/lib/dal.ts`, `handleDelete` in `src/components/admin/AdminTree.tsx`, `confirmOrphaning` in `src/components/admin/editor/ExportBar.tsx` |
| LaTeX editor core (controller + pure modules) | `src/lib/editor/*` |
| LaTeX editor UI (page, shell, toolbar, export, drafts) | `src/app/admin/editor/*`, `src/components/admin/editor/*` |
| Standalone reference editor (parity ground truth) | `latexEditor/*.html` |
| Error/loading boundaries | `src/app/**/error.tsx`, `src/app/**/loading.tsx` |

---

**Last Updated**: 2026-08-10 | **Version**: 4.4
