'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type RefObject } from 'react'
import { publishEditorDraft, scanDocumentBacklinks } from '@/actions/admin'
import { MAX_FILE_SIZE_BYTES } from '@/lib/constants'
import { backlinkRepublishWarning, backlinkScanFailedWarning } from '@/lib/editor/backlinks'
import type { EditorController } from '@/lib/editor/controller'
import {
  buildPngFilename,
  documentTitleFromFilename,
  ensurePngFilename,
} from '@/lib/editor/export-filename'
import type { EditorTargetKurs } from '@/types'

/**
 * Export rows of the LaTeX editor (PRD #28, slice 10 — #38): a port of the
 * reference file's two `.export-row`s (L550–587) with the hardcoded
 * Kurs 1–4 / Unit 1–5 / Mini Case 1–6 dropdowns replaced by the REAL course
 * tree (DAL-fed via the page's server component) and the SS26/WS26 Term
 * select replaced by a free text field. „Als HTML speichern" is not ported —
 * dead code in the reference (`downloadHtml()` was never defined; PRD
 * decision).
 *
 * Semantics (reference parity):
 *  • Any Kurs/Unit/Task/Term change REBUILDS and overwrites the filename
 *    (`updateFilename()`, L1221–1227); manual filename edits persist until
 *    the next such change. Built once on mount when a full selection exists.
 *  • Ordinals are the 1-based index in DAL sort order (what the admin tree
 *    shows), not the raw `position` column.
 *  • Changing a parent select cascades: the child resets to its first entry
 *    (the reference's independent dropdowns had no hierarchy to respect).
 *  • Degenerate trees (Kurs without Units, Unit without Tasks, no Kurse):
 *    child selects are disabled, the filename is left untouched, and the
 *    download still works with the manually editable filename.
 *  • Download: controller.exportToPng() → Blob → temporary object URL →
 *    <a download> (the reference used a data URL; the Blob is the PRD's
 *    shared pipeline for the publish path). Failures alert in German
 *    (reference L1351).
 *
 * Publish (slice 11, #39 — no reference counterpart): „Als Dokument
 * speichern" sends the same 2×-rendered PNG to publishEditorDraft, targeting
 * the LIVE Kurs → Unit → Task selection. The filename (minus `.png`) seeds
 * the Document title on the CREATE paths only (PRD story 27 — no separate
 * title input); an update-in-place leaves the existing title alone, because
 * this field is not persisted with the draft and resets on reload, so
 * applying it would silently rename live content (#85). The title still
 * travels with every request: `mode: 'update'` falls back to creating when
 * the link is dead, and that path needs it. When the
 * draft is linked, the primary button relabels to „Dokument aktualisieren"
 * (update-in-place default; same Document entry for students, story 32) and
 * a secondary „Als neues Dokument" creates + re-links instead. Size guard:
 * the Blob is pre-checked against MAX_FILE_SIZE_BYTES client-side; when the
 * 2× export exceeds it, a confirm offers the reduced 1× export — an
 * oversized request is NEVER sent (Vercel body ceiling, PRD decision).
 * Publishing requires a saved draft (`draftId` = mount identity; hint text
 * otherwise) and starts by persisting the live state through `saveDraft`
 * (publish implies save, #40) so draft JSON and published PNG stay in sync.
 * Download and publish share ONE busy flag: both run the DOM-swapping export
 * pipeline and must never overlap.
 *
 * The Term value is lifted to EditorShell: it persists in the draft JSON as
 * `meta.term` on save (decision D11 reserved it for this slice) and reloads
 * with the draft. The Kurs/Unit/Task selection is deliberately ephemeral per
 * session — only the publish path consumes it live.
 */

const LABEL_STYLE = { fontSize: 13, color: '#374151' } as const

type PublishStatus =
  | { kind: 'idle' }
  | { kind: 'error'; text: string }
  | { kind: 'success'; text: string; documentId: string }

export function ExportBar({
  controllerRef,
  targetTree,
  term,
  onTermChange,
  draftId,
  publishedDocumentId,
  uploadsPending,
  saveDraft,
}: {
  controllerRef: RefObject<EditorController | null>
  targetTree: EditorTargetKurs[]
  term: string
  onTermChange: (term: string) => void
  /** Saved-draft id (mount identity) — publish is disabled without one. */
  draftId: string | null
  publishedDocumentId: string | null
  uploadsPending: boolean
  /** Persists the live editor state to the draft — publish implies save (#40). */
  saveDraft: () => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const router = useRouter()
  // Reference parity: preselect the first Kurs → Unit → Task; the initial
  // filename is built from that selection (ordinals 1/1/1) when it is
  // complete, else the reference input default `export.png`.
  const [kursId, setKursId] = useState(() => targetTree[0]?.id ?? '')
  const [unitId, setUnitId] = useState(() => targetTree[0]?.units[0]?.id ?? '')
  const [taskId, setTaskId] = useState(() => targetTree[0]?.units[0]?.tasks[0]?.id ?? '')
  const [filename, setFilename] = useState(() =>
    targetTree[0]?.units[0]?.tasks[0] ? buildPngFilename(term, 1, 1, 1) : 'export.png'
  )
  // ONE guard for download AND publish — both swap the editor DOM during
  // export; a concurrent run would corrupt the swap/restore.
  const [busy, setBusy] = useState<false | 'download' | 'publish'>(false)
  // Link state seeded from the DB prop, overwritten from publish results so
  // the „Als neues Dokument" option appears without waiting for the refresh.
  const [publishedDocId, setPublishedDocId] = useState(publishedDocumentId)
  const [publishStatus, setPublishStatus] = useState<PublishStatus>({ kind: 'idle' })

  const kurs = targetTree.find((k) => k.id === kursId)
  const units = kurs?.units ?? []
  const unit = units.find((u) => u.id === unitId)
  const tasks = unit?.tasks ?? []

  const canPublish = !busy && !uploadsPending && draftId !== null && taskId !== ''

  /** Overwrites the filename when the new selection is complete (reference `updateFilename()`). */
  function rebuildFilename(nextKursId: string, nextUnitId: string, nextTaskId: string, nextTerm: string) {
    const built = builtFilename(targetTree, nextKursId, nextUnitId, nextTaskId, nextTerm)
    if (built !== null) setFilename(built)
  }

  function handleKursChange(id: string) {
    const nextKurs = targetTree.find((k) => k.id === id)
    const nextUnitId = nextKurs?.units[0]?.id ?? ''
    const nextTaskId = nextKurs?.units[0]?.tasks[0]?.id ?? ''
    setKursId(id)
    setUnitId(nextUnitId)
    setTaskId(nextTaskId)
    rebuildFilename(id, nextUnitId, nextTaskId, term)
  }

  function handleUnitChange(id: string) {
    const nextUnit = units.find((u) => u.id === id)
    const nextTaskId = nextUnit?.tasks[0]?.id ?? ''
    setUnitId(id)
    setTaskId(nextTaskId)
    rebuildFilename(kursId, id, nextTaskId, term)
  }

  function handleTaskChange(id: string) {
    setTaskId(id)
    rebuildFilename(kursId, unitId, id, term)
  }

  function handleTermChange(value: string) {
    onTermChange(value)
    rebuildFilename(kursId, unitId, taskId, value)
  }

  async function handleDownload() {
    const controller = controllerRef.current
    if (!controller || busy) return
    setBusy('download')
    try {
      const blob = await controller.exportToPng()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = ensurePngFilename(filename)
      link.href = url
      link.click()
      // Defer the revoke: revoking the object URL in the same tick as the
      // click can invalidate the blob before the browser has fetched it,
      // aborting the download in Firefox (and occasionally other browsers).
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (err) {
      // Reference L1351 — restore already ran inside the pipeline.
      window.alert(
        'PNG-Export fehlgeschlagen: ' + (err instanceof Error ? err.message : String(err))
      )
    } finally {
      setBusy(false)
    }
  }

  async function handlePublish(mode: 'update' | 'new') {
    const controller = controllerRef.current
    if (!controller || !canPublish || draftId === null) return
    setBusy('publish')
    setPublishStatus({ kind: 'idle' })
    try {
      // „Als neues Dokument" is the ONE publish path that can strand a link
      // (#75): it mints a new Document and re-links the draft, so everything
      // pointing at the current one keeps pointing there — at a document
      // nothing will update again. Asked FIRST, before the save and the
      // export, so declining costs nothing.
      if (mode === 'new' && publishedDocId && !(await confirmOrphaning(publishedDocId))) return

      // Publish implies save (#40 parity finding): persist the draft BEFORE
      // exporting, so the stored JSON always matches the published PNG.
      const saved = await saveDraft()
      if (!saved.ok) {
        setPublishStatus({
          kind: 'error',
          text: `Veröffentlichen fehlgeschlagen: Entwurf konnte nicht gespeichert werden: ${saved.error}`,
        })
        return
      }

      // Render at the default 2× scale, then the size guard (slice 11): an
      // oversized request must never leave the browser — the Vercel body
      // ceiling makes raising the 4-MB limit impossible (PRD decision).
      let blob: Blob
      try {
        blob = await controller.exportToPng()
        if (blob.size > MAX_FILE_SIZE_BYTES) {
          const proceed = window.confirm(
            `Das PNG ist zu groß (${formatMb(blob.size)} MB, maximal 4 MB). ` +
              'In reduzierter Auflösung (1×) exportieren und veröffentlichen?'
          )
          if (!proceed) return
          blob = await controller.exportToPng({ scale: 1 })
          if (blob.size > MAX_FILE_SIZE_BYTES) {
            setPublishStatus({
              kind: 'error',
              text:
                `Auch in reduzierter Auflösung ist das PNG zu groß (${formatMb(blob.size)} MB, ` +
                'maximal 4 MB). Bitte das Dokument kürzen oder aufteilen.',
            })
            return
          }
        }
      } catch (err) {
        setPublishStatus({
          kind: 'error',
          text: 'PNG-Export fehlgeschlagen: ' + (err instanceof Error ? err.message : String(err)),
        })
        return
      }

      const pngName = ensurePngFilename(filename)
      const formData = new FormData()
      formData.set('draft_id', draftId)
      formData.set('task_id', taskId)
      formData.set('title', documentTitleFromFilename(pngName))
      formData.set('mode', mode)
      formData.set('file', new File([blob], pngName, { type: 'image/png' }))

      let result: Awaited<ReturnType<typeof publishEditorDraft>>
      try {
        result = await publishEditorDraft(formData)
      } catch {
        setPublishStatus({ kind: 'error', text: 'Netzwerkfehler beim Veröffentlichen.' })
        return
      }
      if (!result.ok) {
        setPublishStatus({ kind: 'error', text: `Veröffentlichen fehlgeschlagen: ${result.error}` })
        return
      }
      setPublishedDocId(result.data.documentId)
      setPublishStatus({
        kind: 'success',
        text:
          result.data.mode === 'created'
            ? 'Dokument erstellt.'
            : 'Dokument aktualisiert (Titel unverändert).',
        documentId: result.data.documentId,
      })
      router.refresh() // page props + draft list pick up the fresh link
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="export-row">
        <label htmlFor="selKurs" style={LABEL_STYLE}>
          Kurs:
        </label>
        <select
          id="selKurs"
          value={kursId}
          disabled={targetTree.length === 0}
          onChange={(e) => handleKursChange(e.target.value)}
        >
          {targetTree.map((k, i) => (
            <option key={k.id} value={k.id}>
              {i + 1} — {k.title}
            </option>
          ))}
        </select>
        <label htmlFor="exportTerm" style={LABEL_STYLE}>
          Term:
        </label>
        <input
          id="exportTerm"
          type="text"
          value={term}
          placeholder="z. B. SS26"
          style={{ maxWidth: 120 }}
          onChange={(e) => handleTermChange(e.target.value)}
        />
        <label htmlFor="selUnit" style={LABEL_STYLE}>
          Unit:
        </label>
        <select
          id="selUnit"
          value={unitId}
          disabled={units.length === 0}
          onChange={(e) => handleUnitChange(e.target.value)}
        >
          {units.map((u, i) => (
            <option key={u.id} value={u.id}>
              {i + 1} — {u.title}
            </option>
          ))}
        </select>
        <label htmlFor="selMC" style={LABEL_STYLE}>
          Mini Case:
        </label>
        <select
          id="selMC"
          value={taskId}
          disabled={tasks.length === 0}
          onChange={(e) => handleTaskChange(e.target.value)}
        >
          {tasks.map((t, i) => (
            <option key={t.id} value={t.id}>
              {i + 1} — {t.title}
            </option>
          ))}
        </select>
      </div>

      <div className="export-row">
        <label htmlFor="pngFilename" style={LABEL_STYLE}>
          Dateiname:
        </label>
        <input
          id="pngFilename"
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
        />
        <button type="button" className="primary" disabled={!!busy} onClick={handleDownload}>
          {busy === 'download' ? 'PNG wird erstellt …' : 'Als PNG herunterladen'}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!canPublish}
          onClick={() => handlePublish('update')}
        >
          {busy === 'publish'
            ? 'Wird veröffentlicht …'
            : publishedDocId
              ? 'Dokument aktualisieren'
              : 'Als Dokument speichern'}
        </button>
        {publishedDocId && (
          <button type="button" disabled={!canPublish} onClick={() => handlePublish('new')}>
            Als neues Dokument
          </button>
        )}
        {draftId === null && (
          <span style={LABEL_STYLE}>Zum Veröffentlichen zuerst speichern.</span>
        )}
        <span
          role="status"
          style={
            publishStatus.kind === 'error' ? { fontSize: 13, color: '#b91c1c' } : LABEL_STYLE
          }
        >
          {publishStatus.kind === 'success' && (
            <>
              {publishStatus.text}{' '}
              <Link
                href={`/admin/documents/new?editId=${publishStatus.documentId}`}
                className="text-brand underline"
              >
                Zum Dokument
              </Link>
            </>
          )}
          {publishStatus.kind === 'error' && publishStatus.text}
        </span>
      </div>
    </>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Whether „Als neues Dokument" may proceed: silently true when nothing points
 * at the document being left behind, a confirm otherwise (#75).
 *
 * ⚠ A FAILED SCAN ASKS RATHER THAN ASSUMES, for the same reason it does on the
 * delete path: proceeding silently would let „the check could not run" pass for
 * „nothing links here", and refusing outright would make a broken scan block
 * publishing altogether.
 */
async function confirmOrphaning(previousDocumentId: string): Promise<boolean> {
  let warning: string | null
  try {
    const scan = await scanDocumentBacklinks(previousDocumentId)
    warning = scan.ok
      ? backlinkRepublishWarning(scan.data)
      : backlinkScanFailedWarning('das bisherige Dokument', scan.error)
  } catch {
    warning = backlinkScanFailedWarning('das bisherige Dokument')
  }
  if (!warning) return true
  return window.confirm(`${warning}\n\nTrotzdem als neues Dokument veröffentlichen?`)
}

/**
 * `buildPngFilename` over the 1-based indices of the selection, or null when
 * the selection is incomplete (degenerate tree → filename stays untouched).
 */
function builtFilename(
  tree: EditorTargetKurs[],
  kursId: string,
  unitId: string,
  taskId: string,
  term: string
): string | null {
  const kursIndex = tree.findIndex((k) => k.id === kursId)
  if (kursIndex < 0) return null
  const unitIndex = tree[kursIndex].units.findIndex((u) => u.id === unitId)
  if (unitIndex < 0) return null
  const taskIndex = tree[kursIndex].units[unitIndex].tasks.findIndex((t) => t.id === taskId)
  if (taskIndex < 0) return null
  return buildPngFilename(term, kursIndex + 1, unitIndex + 1, taskIndex + 1)
}

/** MB display for the size-guard messages (documents.ts precedent: toFixed(1)). */
function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}
