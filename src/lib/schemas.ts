import { z } from 'zod'
import { MIN_PRICE_CENTS, formatPriceEur } from '@/lib/constants'
import { DocumentJsonSchema } from '@/lib/editor/document-json'
import { LessonJsonSchema } from '@/lib/lessons/lesson-json'

// ── Shared field definitions ────────────────────────────────────────────────

const titleField = z.string().min(1, 'Title is required.').max(200).trim()
const descriptionField = z.string().max(2000).trim().nullable().optional()
  .transform((v) => v ?? null)
const positionField = z.coerce.number().int().min(0).default(0)
const uuidField = z.string().uuid()

// ── Entity schemas ──────────────────────────────────────────────────────────

export const KursFormSchema = z.object({
  title: titleField,
  description: descriptionField,
  position: positionField,
  published: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  // #107. Both default to what every pre-existing Kurs already is, so a form
  // that omits them (or an older cached page) cannot silently retype a Kurs.
  kurs_type: z.enum(['musterloesung', 'lernkurs']).default('musterloesung'),
  sold_as: z.enum(['kurs', 'unit']).default('unit'),
  // Was der ganze Kurs kostet — nur wirksam bei sold_as = 'kurs'.
  //
  // EINGABE IN EURO, GESPEICHERT IN CENT. Wer einen Preis setzt, denkt in
  // Euro; eine verrutschte Null in einem Cent-Feld ist ein Faktor 10 im
  // echten Verkaufspreis. Die Umrechnung passiert hier und nur hier.
  //
  // Die Untergrenze ist Stripes Mindestbetrag: darunter lehnt Stripe die
  // Checkout-Session ab, was sonst als 500 beim Klick auf „Kaufen" ankäme
  // statt als Formularfehler.
  price_euro: z.coerce
    .number({ message: 'Preis muss eine Zahl sein.' })
    .min(MIN_PRICE_CENTS / 100, `Preis muss mindestens ${formatPriceEur(MIN_PRICE_CENTS)} betragen.`)
    .max(10000, 'Preis ist unplausibel hoch.')
    .transform((euro) => Math.round(euro * 100))
    .default(15),
})

// Editing course metadata must not implicitly change visibility. Publishing is
// a separate, explicit action in the course workspace.
export const KursMetadataFormSchema = KursFormSchema.omit({ published: true })

export const KursPublishedSchema = z.object({
  kurs_id: uuidField,
  published: z.boolean(),
})

export const UnitFormSchema = z.object({
  kurs_id: uuidField,
  title: titleField,
  description: descriptionField,
  position: positionField,
})

export const TaskFormSchema = z.object({
  unit_id: uuidField,
  title: titleField,
  description: descriptionField,
  position: positionField,
})

export const DocumentMetaSchema = z.object({
  task_id: uuidField,
  title: titleField,
  description: descriptionField,
  position: positionField,
  doc_type: z.enum(['pdf', 'image', 'image_collection']).default('pdf'),
})

export const DocumentUpdateMetaSchema = z.object({
  title: titleField,
  description: descriptionField,
  position: positionField,
})

// Reordering by dragging in the admin tree. Each schema names the PARENT, so
// its action can prove every id in the list belongs to it — a request listing a
// row from somewhere else must not be able to renumber it.
export const UnitReorderSchema = z.object({
  kurs_id: uuidField,
  unit_ids: z.array(uuidField).min(1, 'Es wurde keine Reihenfolge übergeben.'),
})

export const TaskReorderSchema = z.object({
  unit_id: uuidField,
  task_ids: z.array(uuidField).min(1, 'Es wurde keine Reihenfolge übergeben.'),
})

export const DocumentReorderSchema = z.object({
  task_id: uuidField,
  document_ids: z.array(uuidField).min(1, 'Es wurde keine Reihenfolge übergeben.'),
})

// Editor drafts (PRD #28, slice 7). German messages — the editor UI is
// German end to end. `content` arrives as a JSON string in FormData and is
// validated against the versioned document schema before touching the DB
// (operator story 34).
export const EditorDraftFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Titel ist erforderlich.')
    .max(200, 'Titel darf höchstens 200 Zeichen lang sein.'),
  content: z
    .string()
    .max(3_000_000, 'Der Entwurf ist zu groß.')
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Ungültiges Dokument-JSON.' })
        return z.NEVER
      }
    })
    .pipe(DocumentJsonSchema),
})

// Editor-image upload (slice 8). Only the optional draft link goes through
// Zod — absent when the upload must create the implicit „Unbenannt" anchor
// draft. The file itself is validated manually in the action (documents.ts
// precedent: MIME allowlist + size limit with German messages).
export const EditorImageUploadSchema = z.object({
  draft_id: uuidField.optional(),
})

// Publish an editor draft as a Document (slice 11, #39). `mode: 'update'`
// updates the linked Document's file in place IF a live link exists, else it
// creates a new Document under `task_id` — that single rule doubles as the
// deleted-link fallback. `mode: 'new'` always creates („Als neues Dokument").
// `title` is seeded client-side from the export filename (PRD story 27). The
// PNG File itself is validated manually in the action (documents.ts
// precedent: MIME + size limit with German messages).
export const EditorPublishSchema = z.object({
  draft_id: uuidField,
  task_id: uuidField,
  title: titleField,
  mode: z.enum(['update', 'new']).default('update'),
})

// Lernseiten (#107). The workspace saves a whole page at once: the block JSON
// arrives as a string in FormData and is validated against the versioned
// lesson schema before it reaches the DB, exactly as an editor draft is.
//
// The two JSON columns are told apart by `file_type` and never by their shape,
// so this schema must be the LESSON one — validating a lesson against
// DocumentJsonSchema (or the reverse) would accept nothing and blame the
// author's content for a wiring mistake.
export const LessonSaveSchema = z.object({
  document_id: uuidField,
  title: titleField,
  content: z
    .string()
    .max(3_000_000, 'Die Lernseite ist zu groß.')
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Ungültiges Lernseiten-JSON.' })
        return z.NEVER
      }
    })
    .pipe(LessonJsonSchema),
})

// Reordering the Lernseiten of one Einheit (#107). The client sends the ids in
// their new order; `position` is derived from the array index, so the two can
// never disagree about what „third" means.
//
// The Einheit rides along so the action can verify that every id named actually
// belongs to it — a request listing a page from somewhere else must not be able
// to renumber it.
export const LessonReorderSchema = z.object({
  unit_id: uuidField,
  document_ids: z.array(uuidField).min(1, 'Es wurde keine Reihenfolge übergeben.'),
})

// Creating the Lernseite of a Unit (#107). Only the Unit is named: the
// invisible Aufgabe and the Document row are the action's business, because
// the author is not supposed to know either exists.
export const LessonCreateSchema = z.object({
  unit_id: uuidField,
  title: titleField,
})

// The link picker's lazy fourth level (#72). Not a FormData action — the
// picker calls it with a plain Task id on expand — but the input is still
// validated before it reaches the DB, like every other server-action input.
export const LinkTargetDocumentsSchema = z.object({
  task_id: uuidField,
})

// The backlink scan (#75). Also not a FormData action — the admin tree and the
// ExportBar both call it with a plain Document id — but the same rule holds:
// nothing reaches the DB unvalidated.
export const BacklinkScanSchema = z.object({
  document_id: uuidField,
})

// ── Auth schemas ────────────────────────────────────────────────────────────

export const SignInSchema = z.object({
  email: z.string().email('Invalid email address.'),
  password: z.string().min(1, 'Password is required.'),
})

export const SignUpSchema = z.object({
  email: z.string().email('Invalid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  full_name: z.string().min(1, 'Full name is required.').max(100).trim().optional(),
})

// ── Inferred types ──────────────────────────────────────────────────────────

export type KursFormData = z.infer<typeof KursFormSchema>
export type KursMetadataFormData = z.infer<typeof KursMetadataFormSchema>
export type UnitFormData = z.infer<typeof UnitFormSchema>
export type TaskFormData = z.infer<typeof TaskFormSchema>
export type DocumentMetaData = z.infer<typeof DocumentMetaSchema>
export type DocumentUpdateMetaData = z.infer<typeof DocumentUpdateMetaSchema>
export type UnitReorderData = z.infer<typeof UnitReorderSchema>
export type TaskReorderData = z.infer<typeof TaskReorderSchema>
export type DocumentReorderData = z.infer<typeof DocumentReorderSchema>
export type EditorDraftFormData = z.infer<typeof EditorDraftFormSchema>
export type EditorImageUploadData = z.infer<typeof EditorImageUploadSchema>
export type EditorPublishData = z.infer<typeof EditorPublishSchema>
export type LessonSaveData = z.infer<typeof LessonSaveSchema>
export type LessonCreateData = z.infer<typeof LessonCreateSchema>
export type LessonReorderData = z.infer<typeof LessonReorderSchema>
