'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { createEditorDraft, updateEditorDraft, uploadEditorImage } from '@/actions/admin'
import { createEditorController, type EditorController } from '@/lib/editor/controller'
import { withDocumentMeta, type LatestEditorDocumentJson } from '@/lib/editor/document-json'
import { readDocumentJson } from '@/lib/editor/document-version'
import type { LinkPickRequest, LinkPickResult } from '@/lib/editor/links'
import type { EditorTargetKurs } from '@/types'
import { EditorToolbar } from './EditorToolbar'
import { ExportBar } from './ExportBar'
import { LinkTargetPicker } from './LinkTargetPicker'

/**
 * React shell of the LaTeX editor (PRD #28, Approach C).
 *
 * React owns only the save bar, the toolbar and the childless mount container
 * below them. The contenteditable surface is created and managed imperatively
 * by the editor controller — the reconciler never sees its subtree, so
 * typing, selection, and user-generated DOM can never be lost to a re-render.
 *
 * Draft persistence (slice 7, #35): the page remounts this component via
 * `key={draftId ?? 'new'}`, so a draft is imported exactly once per mount —
 * `router.refresh()` re-renders (e.g. after a save updates the list) must
 * never re-import over the live editing state. Saving is explicit; there is
 * no autosave (PRD decision). After the FIRST save the page navigates to
 * `?draftId=…` (decision D6): the remount reloads the just-saved content
 * from the DB — dogfooding the export→import round-trip on every first save.
 *
 * Images (slice 8, #36): the controller's `uploadImage` hook is wired to the
 * uploadEditorImage action here. All draft-mutating server calls (uploads AND
 * saves) run strictly serialized through one promise chain: rapid consecutive
 * pastes create the implicit „Unbenannt" anchor draft exactly once, and a
 * save can never interleave with an in-flight upload — otherwise the save's
 * image reconciliation could delete the row the upload just inserted.
 * „Speichern" is additionally disabled while uploads are pending (#36
 * decision D3).
 *
 * PNG export (slice 10, #38): the ExportBar between toolbar and editor
 * surface owns the target selection (real Kurs → Unit → Task tree, DAL-fed
 * through the page) and the filename. Only the free Term field is
 * draft-persisted — the shell owns its state, seeds it from the draft's
 * `meta.term` at mount (frozen like parsedDraft; the key-remount reloads it),
 * and injects it into the save payload via `withDocumentMeta`. The
 * Kurs/Unit/Task selection is ephemeral per session (PRD decision).
 *
 * Publish (slice 11, #39): lives entirely in the ExportBar; the shell only
 * threads the SAVED draft identity down. Publishing requires a saved draft —
 * `draftId` is `initialDraft?.id` (mount identity), deliberately NOT the live
 * draftIdRef: an anchor draft created mid-session by an image upload is not
 * an explicit save, and after the first real save the D6 navigation remounts
 * the shell with an initialDraft anyway. `uploadsPending` mirrors the save
 * button's guard.
 *
 * Publish implies save (#40 parity finding): the ExportBar calls `saveDraft`
 * before exporting, so the published PNG and the stored draft JSON can never
 * drift apart. That save joins the op chain like any other draft mutation;
 * only the PNG export/publish itself stays outside it.
 */

type SaveStatus = { kind: 'idle' | 'saved' | 'error'; text: string }

export interface EditorShellDraft {
  id: string
  title: string
  content: unknown
  publishedDocumentId: string | null
}

export function EditorShell({
  initialDraft,
  targetTree,
}: {
  initialDraft?: EditorShellDraft
  targetTree: EditorTargetKurs[]
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<EditorController | null>(null)
  const draftIdRef = useRef<string | null>(initialDraft?.id ?? null)
  const router = useRouter()

  // Frozen at mount via a never-set state (the page's key prop remounts per
  // draft) — a router.refresh() re-render must never re-import over live
  // editing state. Invalid content becomes an error status instead of a
  // broken editor.
  // Upgrade-on-read (#64): a stored draft may carry any supported version;
  // the controller only ever receives the newest. A snapshot that cannot be
  // read is refused whole, with the boundary's own German reason.
  const [parsedDraft] = useState<LatestEditorDocumentJson | { invalid: string } | null>(() => {
    if (!initialDraft) return null
    const parsed = readDocumentJson(initialDraft.content)
    return parsed.ok ? parsed.doc : { invalid: parsed.error }
  })
  const draftError = parsedDraft !== null && 'invalid' in parsedDraft ? parsedDraft.invalid : null
  const draftDocument = parsedDraft !== null && !('invalid' in parsedDraft) ? parsedDraft : null

  const [title, setTitle] = useState(initialDraft?.title ?? 'Unbenannt')
  // ExportBar Term field (slice 10) — the only draft-persisted export state
  // (meta.term). Seeded from the loaded draft; a JSON-modal import cannot
  // reach this state, so an imported meta.term is ignored until the draft is
  // saved and reopened (documented limitation).
  const [term, setTerm] = useState(() =>
    draftDocument?.meta?.term ?? ''
  )
  const [status, setStatus] = useState<SaveStatus>(() =>
    draftError !== null
      ? { kind: 'error', text: `Entwurf konnte nicht geladen werden: ${draftError}` }
      : { kind: 'idle', text: '' }
  )
  const [isPending, startTransition] = useTransition()
  const [pendingUploads, setPendingUploads] = useState(0)
  // Effektive Schriftgröße der aktuellen Editor-Auswahl (#43). Die imperative
  // Steuerung meldet sie bei jedem selectionchange; React spiegelt sie in die
  // Größen-Dropdown der Toolbar. Setzen mit gleichem Wert ist ein No-op-Render.
  const [selectionFontSize, setSelectionFontSize] = useState('')

  // Link picker (#72). The controller awaits a target, so the resolver of that
  // pending promise is held here until the dialog closes one way or another.
  const [linkRequest, setLinkRequest] = useState<LinkPickRequest | null>(null)
  const linkResolveRef = useRef<((result: LinkPickResult | null) => void) | null>(null)

  // Serializes every draft-mutating server call (image uploads and saves).
  // Kept never-rejecting so one failed operation cannot wedge the chain.
  const opChainRef = useRef<Promise<void>>(Promise.resolve())

  function enqueueOp<T>(op: () => Promise<T>): Promise<T> {
    const settled = opChainRef.current.then(op)
    opChainRef.current = settled.then(
      () => undefined,
      () => undefined
    )
    return settled
  }

  // Controller hook (slice 8). Touches only refs and stable setters, so the
  // closure the mount-effect captures never goes stale.
  async function uploadImage(
    file: File
  ): Promise<{ ok: true; imageId: string } | { ok: false; error: string }> {
    setPendingUploads((n) => n + 1)
    try {
      return await enqueueOp(async () => {
        try {
          const formData = new FormData()
          if (draftIdRef.current) formData.set('draft_id', draftIdRef.current)
          formData.set('file', file)
          const result = await uploadEditorImage(formData)
          if (!result.ok) return { ok: false as const, error: result.error }
          const anchorCreated = draftIdRef.current === null
          draftIdRef.current = result.data.draftId
          // Anchor draft „Unbenannt" appears in the list. URL and key are
          // unchanged — no remount, the live editing state is safe.
          if (anchorCreated) router.refresh()
          return { ok: true as const, imageId: result.data.imageId }
        } catch {
          return { ok: false as const, error: 'Netzwerkfehler beim Hochladen.' }
        }
      })
    } finally {
      setPendingUploads((n) => n - 1)
    }
  }

  // Controller hook (#72): the link picker is React because its tree is server
  // data, so the controller asks for a target and waits. Touches only refs and
  // stable setters, like uploadImage — the mount-time closure stays valid.
  function pickLinkTarget(request: LinkPickRequest): Promise<LinkPickResult | null> {
    // A picker already open loses: it can only be a leftover from a request
    // nothing is waiting on any more, and leaving its promise unresolved would
    // wedge the controller's await forever.
    linkResolveRef.current?.(null)
    setLinkRequest(request)
    return new Promise((resolve) => {
      linkResolveRef.current = resolve
    })
  }

  function closeLinkPicker(result: LinkPickResult | null) {
    const resolve = linkResolveRef.current
    linkResolveRef.current = null
    setLinkRequest(null)
    resolve?.(result)
  }

  useEffect(() => {
    if (!mountRef.current) return
    const controller = createEditorController(
      mountRef.current,
      { uploadImage, pickLinkTarget },
      { onSelectionFontSize: setSelectionFontSize }
    )
    controllerRef.current = controller
    if (draftDocument) {
      void controller.loadDocument(draftDocument)
    }
    return () => {
      controller.destroy()
      controllerRef.current = null
    }
    // parsedDraft is stable for the lifetime of this mount (never set), and
    // both hooks read only refs and stable setters — the mount-time closure
    // stays valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedDraft])

  // ── Shared save helpers (used by both handleSave and the publish flow) ──
  function savedStatusText() {
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    return `Gespeichert (${time} Uhr)`
  }

  // Serializes the live editor state + save-time meta (the Term field). Returns
  // null if there is no controller or the content can't be serialized.
  function serializeDraftContent(): string | null {
    const controller = controllerRef.current
    if (!controller) return null
    try {
      return JSON.stringify(withDocumentMeta(controller.exportDocument(), term))
    } catch {
      return null
    }
  }

  function buildDraftFormData(contentJson: string): FormData {
    const formData = new FormData()
    formData.set('title', title.trim() || 'Unbenannt')
    formData.set('content', contentJson)
    return formData
  }

  // Persists the live editor state into the existing draft row. Used by the
  // publish flow (publish implies save); requires the draft to exist already
  // — publish is only enabled once it does. Never rejects: a thrown action
  // becomes an ok:false result so the publish flow can surface it (mirrors
  // uploadImage) — otherwise the rejection would escape handlePublish's
  // try/finally as an unhandled rejection with no error shown.
  async function saveDraftForPublish(): Promise<{ ok: true } | { ok: false; error: string }> {
    const draftId = draftIdRef.current
    if (!controllerRef.current || !draftId) return { ok: false, error: 'Kein gespeicherter Entwurf.' }

    const contentJson = serializeDraftContent()
    if (contentJson === null) return { ok: false, error: 'Inhalt konnte nicht serialisiert werden.' }
    const formData = buildDraftFormData(contentJson)

    return enqueueOp(async () => {
      try {
        const result = await updateEditorDraft(draftId, formData)
        if (!result.ok) return { ok: false as const, error: result.error }
        setStatus({ kind: 'saved', text: savedStatusText() })
        return { ok: true as const }
      } catch {
        return { ok: false as const, error: 'Netzwerkfehler beim Speichern.' }
      }
    })
  }

  function handleSave() {
    if (!controllerRef.current || isPending || pendingUploads > 0) return

    // Save payload = serialized editor state + save-time meta (the Term field,
    // slice 10). The serializer itself stays meta-free.
    const contentJson = serializeDraftContent()
    if (contentJson === null) {
      setStatus({
        kind: 'error',
        text: 'Speichern fehlgeschlagen: Inhalt konnte nicht serialisiert werden.',
      })
      return
    }
    const formData = buildDraftFormData(contentJson)

    // Enqueued behind any in-flight upload (belt to the disabled button's
    // braces): the save's image reconciliation must never run while an
    // upload is still inserting its editor_images row. The action calls are
    // wrapped so a thrown (not returned-error) action — e.g. a network failure
    // — surfaces as an error status instead of a silent no-op (mirrors
    // uploadImage); otherwise the user would keep a stale „Gespeichert".
    startTransition(() =>
      enqueueOp(async () => {
        const draftId = draftIdRef.current
        try {
          if (draftId) {
            const result = await updateEditorDraft(draftId, formData)
            if (!result.ok) {
              setStatus({ kind: 'error', text: `Speichern fehlgeschlagen: ${result.error}` })
              return
            }
            if (!initialDraft) {
              // The draft row was anchor-created by an image upload, so the URL
              // has no draftId yet. Navigate on this first explicit save (D6):
              // the key-driven remount reloads the just-saved content.
              router.replace(`/admin/editor?draftId=${draftId}`)
              return
            }
            setStatus({ kind: 'saved', text: savedStatusText() })
            router.refresh() // draft list shows the fresh updated_at
          } else {
            const result = await createEditorDraft(formData)
            if (!result.ok) {
              setStatus({ kind: 'error', text: `Speichern fehlgeschlagen: ${result.error}` })
              return
            }
            draftIdRef.current = result.data.id
            // First save → draft URL (D6). The key-driven remount reloads the
            // saved content from the DB and refreshes the draft list.
            router.replace(`/admin/editor?draftId=${result.data.id}`)
          }
        } catch {
          setStatus({ kind: 'error', text: 'Speichern fehlgeschlagen: Netzwerkfehler.' })
        }
      })
    )
  }

  return (
    <div className="latex-editor">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor="draftTitle" className="text-sm text-gray-600">
          Titel
        </label>
        <input
          id="draftTitle"
          type="text"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          className="w-72 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || pendingUploads > 0}
          className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {isPending ? 'Wird gespeichert …' : 'Speichern'}
        </button>
        <span
          role="status"
          className={status.kind === 'error' ? 'text-sm text-red-700' : 'text-sm text-gray-500'}
        >
          {pendingUploads > 0 ? 'Bild wird hochgeladen …' : status.text}
        </span>
      </div>
      <EditorToolbar controllerRef={controllerRef} sizeFromSelection={selectionFontSize} />
      <ExportBar
        controllerRef={controllerRef}
        targetTree={targetTree}
        term={term}
        onTermChange={setTerm}
        draftId={initialDraft?.id ?? null}
        publishedDocumentId={initialDraft?.publishedDocumentId ?? null}
        uploadsPending={pendingUploads > 0}
        saveDraft={saveDraftForPublish}
      />
      {/* Imperative mount point — must stay childless in JSX (see PRD #28). */}
      <div ref={mountRef} />
      {/* Keyed by nothing: the dialog is created fresh per request, so its
          label and expansion state never leak from one link to the next. */}
      {linkRequest && (
        <LinkTargetPicker
          request={linkRequest}
          targetTree={targetTree}
          onClose={closeLinkPicker}
        />
      )}
    </div>
  )
}
