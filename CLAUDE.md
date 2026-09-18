# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Primary reference

[DEVELOPER_OVERVIEW.md](DEVELOPER_OVERVIEW.md) is the authoritative architecture doc — schema, RLS policies, full file map, debugging table. Read it before any non-trivial change. Keep it in sync when patterns shift.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `dokumtastisch/dokum`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.

## Commands

```bash
npm run dev      # Next.js dev server (Turbopack) on :3000
npm run build    # Production build
npm run start    # Serve the production build
npm run lint     # ESLint (eslint-config-next 16)
npm test         # Vitest (dev-only) — colocated *.test.ts unit tests
```

Tests run via Vitest ([vitest.config.ts](vitest.config.ts)): colocated `*.test.ts` files next to their modules — the editor modules in [src/lib/editor/](src/lib/editor/), plus any other pure module (e.g. [src/lib/document-view.ts](src/lib/document-view.ts)). There is no component or E2E seam; UI behaviour is verified by manual QA on the ticket. Default environment is plain Node; DOM-dependent suites opt into jsdom per file via a `@vitest-environment jsdom` docblock (currently `document-json.test.ts`). The editor-module tests are golden cases derived from the standalone reference editor ([latexEditor/](latexEditor/)) and act as the port's parity contract — don't "fix" expected values without checking the reference behavior.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 5 (strict) · Tailwind 4 · Supabase (Postgres + Auth + Storage) · Zod for input validation.

**UI language is split.** Everything a student sees — the catalogue, the Kurs shell, Einheit pages, the document overlay and their error and paywall states — is **English**, and uses the code's own vocabulary: Unit, Task, Document, Lesson, Course. The **admin** stays **German** („Kurse verwalten", „Aufgabe hinzufügen"), as do the Zod validation messages and the error strings the server actions return. One exception on the student side, deliberate: the legal pages (Impressum, Datenschutz, AGB) stay German because they are legal documents. The `kurs_type` values read „Model Solutions" / „Learning Courses" to students; the admin keeps „Musterlösung" / „Lernkurs".

## Design: [DESIGN.md](DESIGN.md) is binding

**Read [DESIGN.md](DESIGN.md) before touching anything visual.** It describes the design as it should be — the brand and paper colours, the 66px navbar, the tree row, the micro-label, the Lernseiten forms — and it is the reference, not a suggestion.

**Never install a design library.** A shadcn install once rewrote `globals.css` — including `--foreground`, which `body` reads — and a component library silently became the app's design. Buying *behaviour* is fine (`radix-ui`, `@dnd-kit`, `lucide-react`); it gets styled with DESIGN.md's classes in `src/components/ui/`. Buying *looks* is not. Note the failure mode: classes from a removed plugin (`data-open:`, `animate-in`, `bg-popover`) do not error — Tailwind just never generates them, so the component renders unstyled while every check stays green.

**Style is never changed in passing.** Not spacing, colours, sizes, weights, radii, hover or focus states. When a task is „add a column", „make the row clickable", „fix the scroll target", the deliverable is that behaviour and nothing else.

This has gone wrong repeatedly and always the same way: a structural edit — a `<p>` becoming a `<Link>`, a wrapper becoming a `<section>` — arrives carrying classes nobody asked for. **When markup must change for a functional reason, carry the old classes over verbatim.**

The one exception, kept minimal: the accessibility the new behaviour actually needs — a focus ring on a new control, `cursor-pointer` on a newly clickable row. Nothing more. And never harmonise two things that look different; the difference may be intentional.

If a task cannot be done without a visual decision, **ask**. Changing the design is a separate, deliberate act: edit DESIGN.md first, on purpose.

## Architecture invariants

These are load-bearing and easy to violate accidentally:

- **Hierarchy:** `Kurs → Unit → Task → Document → DocumentImage`. Only `kurse.published` exists — don't add a `published` column anywhere else. Visibility is inherited from it all the way down: `kurse` and `units` gate on `published`; `tasks`, `documents`, `document_images` and the `pdfs` storage objects gate on **an `entitlements` row AND `kurse.published`** (or admin). An entitlement row grants an Einheit **or** a whole Kurs (`kurse.sold_as` decides what is sold; [add_kurs_entitlements.sql](supabase/add_kurs_entitlements.sql)). That conjunct lives *inside each single policy* ([add_rls_published_conjunct.sql](supabase/add_rls_published_conjunct.sql), #80) and must stay there — permissive SELECT policies are OR'd, so expressing `published` as a second policy would grant access instead of restricting it. [/api/file](src/app/api/file/[docId]/route.ts), [/api/image](src/app/api/image/[imageId]/route.ts) and `/dokumente/[docId]` still re-check `kurse.published` in app code; that is now defence in depth, not the only gate. Changes to any of these four policies must be re-proved with BOTH [supabase/checks/rls_published_conjunct_check.sql](supabase/checks/rls_published_conjunct_check.sql) and [supabase/checks/rls_kurs_entitlement_check.sql](supabase/checks/rls_kurs_entitlement_check.sql) — `npm test` cannot see them.
- **DAL is the only read path.** All Supabase reads go through [src/lib/dal.ts](src/lib/dal.ts), which is `import 'server-only'` — importing it from a client component is a build error. Page components and API routes must not call `supabase.from()` directly. Sorting (`position ASC, created_at ASC`) lives inside the DAL; don't re-sort in pages.
- **Proxy is the single auth enforcement point.** [src/proxy.ts](src/proxy.ts) (Next.js 16 renamed the `middleware` convention to `proxy`) protects `/admin/*`, redirects unauthenticated users, and enforces consent. Admin pages must not duplicate the role check. Server actions still call `getAdminUser()` from [src/actions/admin/_shared.ts](src/actions/admin/_shared.ts) as defence in depth.
- **Admin role lives in the JWT** as `auth.users.raw_app_meta_data.role = "admin"`. Read it via `user.app_metadata?.role`. Never query a role table.
- **Server actions return `ActionResult<T>`** — the discriminated union `{ ok: true; data: T } | { ok: false; error: string }` from [src/types/index.ts](src/types/index.ts). Don't introduce ad-hoc `{ error?, success? }` shapes.
- **All server-action input flows through Zod** ([src/lib/schemas.ts](src/lib/schemas.ts)) before touching the DB. Form field `name` attributes must match schema keys exactly.
- **Audit log every admin mutation.** After the primary DB op succeeds, call `logAdminAction()` from [src/lib/audit.ts](src/lib/audit.ts). Failures are logged but never block. The `audit_logs` table is admin-readable and immutable (no UPDATE/DELETE policy).
- **Files are never served directly from Supabase.** Storage bucket `pdfs` is private; access goes through [src/app/api/file/[docId]/route.ts](src/app/api/file/[docId]/route.ts) and [src/app/api/image/[imageId]/route.ts](src/app/api/image/[imageId]/route.ts) (60-second signed URLs generated server-side, exposed only as a single 302 redirect) and [src/app/api/editor-image/[imageId]/route.ts](src/app/api/editor-image/[imageId]/route.ts), which instead **streams** the body so editor images stay same-origin (html2canvas export must not taint the canvas). Never store Supabase URLs in content or hand them to the browser beyond that one redirect.
- **Revalidate after every admin mutation.** Use `revalidateAdminPages()` from `_shared.ts` — it busts all four admin pages plus the root layout. Skipping this leaves stale tree views.
- **Body size limit is duplicated and must stay in sync.** `MAX_FILE_SIZE_BYTES` in [src/lib/constants.ts](src/lib/constants.ts) and `experimental.serverActions.bodySizeLimit` in [next.config.ts](next.config.ts) both say 4 MB. Change both together.
- **CSP is set in [next.config.ts](next.config.ts).** Adding external scripts/styles/fonts/images requires updating `connect-src`/`script-src`/etc. there.
- **The LaTeX editor's surface is imperative.** `/admin/editor` mounts [src/lib/editor/controller.ts](src/lib/editor/controller.ts) once into a contenteditable container; React must never reconcile inside it (it would destroy the cursor and user-typed DOM). Editor drafts (`editor_documents`/`editor_images`) live outside the Kurs hierarchy until published; draft JSON stores image **ids**, never base64. Expressions run through the pure evaluator — no `eval`/`new Function` — and MathJax/html2canvas are bundled exact-pinned (the CSP forbids CDNs and eval).
- **A Sprungmarke's id is opaque, minted once and copied verbatim** ([src/lib/editor/anchors.ts](src/lib/editor/anchors.ts), schema v1.1, #71). Never derive it from position, heading text or content, and never regenerate it — at publish, on rename, or anywhere else — because cross-document links store it. The counterpart rule: **no two blocks may hold one id.** A contenteditable duplicates block attributes on paste, drag-copy and Enter, so every path that can clone a block runs `anchorRegistry.sweep()`; a new one must too.
- **So is the student viewer, for the same reason.** [src/lib/editor/document-render.ts](src/lib/editor/document-render.ts) owns the DOM below its container: it swaps every visible static input for a control, binds the listeners, and re-resolves the whole document on each edit. React mounts the host and nothing more — reconciling inside it would throw away what the student typed. Values a student types are **never persisted** (no storage, no request); they live in the rendered DOM until the page goes away — which is why an in-app document link opens an **overlay** rather than navigating (`src/app/@modal/(.)dokumente/[docId]`, #70). Parallel routing never unmounts the source page, so the typed values survive the trip for free. Keep `src/app/@modal/default.tsx` and route in-app document links through `DocumentLink`; without either, the overlay silently degrades to plain navigation and the values are gone.

## Adding an admin action

1. Add the Zod schema to [src/lib/schemas.ts](src/lib/schemas.ts).
2. Implement the action in the matching `src/actions/admin/{kurse,units,tasks,documents,editor-documents,editor-images,editor-publish}.ts` file. Start with `const { supabase, user } = await getAdminUser()`.
3. Validate FormData via `parseForm(schema, formData, [...fields])`.
4. Call `logAdminAction(...)` after the primary op succeeds.
5. Call `revalidateAdminPages()` (or a narrower `revalidatePath`) before returning.
6. Re-export from [src/actions/admin/index.ts](src/actions/admin/index.ts) if it's a new public action.

## Two Supabase projects (dev + prod)

There are **two separate Supabase projects**, not one project with branches:

| Env | Project ref | Used by | `NEXT_PUBLIC_APP_ENV` |
|-----|-------------|---------|------------------------|
| Dev  | `elnupcpwhvfbmbpcbwrc` | `npm run dev` (reads [.env.local](.env.local)) | `dev` |
| Prod | `pnooldcnqlsqjatbtimz` | `npm run build` / `start` (reads [.env.production.local](.env.production.local)) | `prod` |

The dev project is a free playground — break it freely. The prod project has real users and content.

## Database changes

Migrations are plain SQL in [supabase/](supabase/) — apply via the Supabase SQL editor or CLI. Order matters: `migration.sql`, then `add_audit_log.sql`, then `add_entitlements.sql`, then `add_editor_documents.sql`, then `add_editor_images.sql`, then `add_document_content.sql`, then `add_rls_published_conjunct.sql`, then `add_lessons.sql`, then `add_kurs_entitlements.sql`. There is no migration runner; new migrations must be applied manually.

`supabase/checks/` holds SQL verification scripts for guarantees the Vitest suite cannot reach (RLS, mainly). Each runs inside a transaction ending in `ROLLBACK` and aborts with a `… CHECK FAILED — …` message. Run the relevant one against **dev** after applying the migration it belongs to.

**Workflow for a new migration:** pre-flight any new CHECK against the existing rows (`SELECT DISTINCT col FROM …`) so a constraint failure surfaces before the DDL, apply to **dev first** via `mcp__supabase__apply_migration`, verify by reading the catalog back (see below — `get_advisors` is not available), then have the user apply the same migration to prod manually (MCP cannot reach prod — see below).

## Supabase MCP

A Supabase MCP server is configured (`mcp__supabase__*` tools — see [.mcp.json](.mcp.json)) and is **pinned to the dev project only** via `--project-ref=elnupcpwhvfbmbpcbwrc`. Prod is intentionally unreachable through MCP; any prod change must be made by the user via the Supabase dashboard or CLI. Auth uses `SUPABASE_ACCESS_TOKEN` from the environment.

Use the MCP to inspect and modify the dev project instead of asking the user to run SQL by hand. The server runs with `--features=database,docs`, so the tool set is exactly: `list_tables`, `list_extensions`, `list_migrations`, `apply_migration`, `execute_sql`, `search_docs`.

**Nothing else exists.** In particular there is no `get_advisors`, no `generate_typescript_types`, no `get_logs`, and no edge-function or branch management — don't reach for them and don't plan a step around them. Widening `--features` in [.mcp.json](.mcp.json) is the only way to get them.

- Prefer `apply_migration` over `execute_sql` for schema changes so the change is tracked.
- **Instead of `get_advisors`,** verify a schema change by querying the catalog: `information_schema.columns` for the column's type and nullability, `pg_get_constraintdef(oid)` for a constraint's actual text, `pg_constraint.convalidated` (a CHECK added `NOT VALID` silently skips existing rows — this proves it didn't), and `pg_class.relrowsecurity` + `pg_policies` to confirm RLS and its policies survived. Then run the real query the app will issue.
- **Instead of `generate_typescript_types`,** hand-check [src/types/index.ts](src/types/index.ts) against the migration. Where a TS union mirrors a DB CHECK — `Document['file_type']` and `documents_file_type_check` — the two must list the same values, and nothing enforces that but this step.
- Auth is `SUPABASE_ACCESS_TOKEN`, a user-scope env var interpolated at server **launch**. A stale token shows up as `Unauthorized` on every call; confirm by hitting `https://api.supabase.com/v1/projects/<ref>` with a bearer header. A freshly-set token requires restarting Claude Code — it never reaches the running server process.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
