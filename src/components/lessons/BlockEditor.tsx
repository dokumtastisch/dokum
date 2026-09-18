'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  LatestLessonJson,
  LessonBlock,
  LessonLeafBlock,
} from '@/lib/lessons/lesson-json'
import { parseInlineMarkup, serializeInlineMarkup } from '@/lib/lessons/inline-markup'
import { IconPicker } from './IconPicker'
import { PopoverMenu, PopoverMenuLabel } from './PopoverMenu'
import { LessonMath } from './LessonMath'

/**
 * The block editor of a Lernseite (#107).
 *
 * ⚠ IT IS NOT A CONTENTEDITABLE, AND THAT IS THE DESIGN. Rich text lives in a
 * `<textarea>` and goes through `inline-markup.ts` — `**fett**`, `$LaTeX$`,
 * `[[Begriff|Erklärung]]`. This codebase already carries one imperative
 * contenteditable with a selection to save and restore, block cloning to sweep
 * and a golden suite pinning its behaviour; a second one is not the price to
 * pay for getting the first version of this editor working. The MODEL is the
 * durable thing, and a WYSIWYG surface can replace these textareas later
 * without a stored page changing at all.
 *
 * The state lives one level up ({@link LessonWorkspace}), because the save
 * button and the preview need the same page. This component is a controlled
 * view of `lesson.blocks` and its only job is to hand back the next one.
 */
export function BlockEditor({
  lesson,
  onChange,
}: {
  lesson: LatestLessonJson
  onChange: (next: LatestLessonJson) => void
}) {
  const listId = useId()
  const endDropId = `${listId}-drop-at-end`
  const nextBlockId = useRef(lesson.blocks.length)
  const [activePalette, setActivePalette] = useState<LessonBlock['type'] | null>(null)
  const [blockIds, setBlockIds] = useState(() =>
    lesson.blocks.map((_, index) => `${listId}-block-${index}`)
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const setBlocks = (blocks: LessonBlock[]) => onChange({ ...lesson, blocks })

  const update = (index: number, block: LessonBlock) =>
    setBlocks(lesson.blocks.map((b, i) => (i === index ? block : b)))

  const remove = (index: number) => {
    setBlockIds((ids) => ids.filter((_, i) => i !== index))
    setBlocks(lesson.blocks.filter((_, i) => i !== index))
  }

  const insert = (block: LessonBlock, at: number) => {
    const next = [...lesson.blocks]
    next.splice(at, 0, block)
    const id = `${listId}-block-${nextBlockId.current++}`
    setBlockIds((ids) => {
      const nextIds = [...ids]
      nextIds.splice(at, 0, id)
      return nextIds
    })
    setBlocks(next)
  }

  const startDrag = ({ active }: DragStartEvent) => {
    setActivePalette(paletteTypeFromDragId(String(active.id)))
  }

  const finishDrag = ({ active, over }: DragEndEvent) => {
    const paletteType = paletteTypeFromDragId(String(active.id))
    setActivePalette(null)
    if (!over) return

    if (paletteType) {
      const target =
        String(over.id) === endDropId
          ? lesson.blocks.length
          : blockIds.indexOf(String(over.id))
      if (target === -1) return
      insert(blankBlock(paletteType), target)
      return
    }

    if (active.id === over.id) return
    const from = blockIds.indexOf(String(active.id))
    const to =
      String(over.id) === endDropId
        ? Math.max(lesson.blocks.length - 1, 0)
        : blockIds.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    setBlockIds((ids) => arrayMove(ids, from, to))
    setBlocks(arrayMove(lesson.blocks, from, to))
  }

  return (
    <div className="mx-auto w-full max-w-4xl py-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={startDrag}
        onDragCancel={() => setActivePalette(null)}
        onDragEnd={finishDrag}
      >
        <BlockInsertToolbar onAdd={(block) => insert(block, lesson.blocks.length)} />

        <div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
          {lesson.blocks.length === 0 && (
            <p className="py-8 text-sm text-gray-400">
              Noch keine Inhalte. Klicke oben auf einen Block oder ziehe ihn hierher.
            </p>
          )}

          <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
            {lesson.blocks.map((block, index) => (
              <BlockCard
                key={blockIds[index]}
                sortableId={blockIds[index]}
                block={block}
                onChange={(next) => update(index, next)}
                onRemove={() => remove(index)}
              />
            ))}
          </SortableContext>
          <BlockEndDropZone id={endDropId} active={activePalette !== null} />
        </div>
        <DragOverlay dropAnimation={null}>
          {activePalette && <PaletteDragPreview type={activePalette} />}
        </DragOverlay>
      </DndContext>

      <div className="mx-auto w-full max-w-3xl">
        <AddBlockBar onAdd={(block) => insert(block, lesson.blocks.length)} />
      </div>
    </div>
  )
}

// ── One block ───────────────────────────────────────────────────────────────

function BlockCard({
  sortableId,
  block,
  onChange,
  onRemove,
}: {
  sortableId: string
  block: LessonBlock
  onChange: (block: LessonBlock) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: sortableId })

  return (
    <section
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={cn(
        'group relative rounded-md border border-transparent bg-white hover:bg-black/[0.025] focus-within:border-gray-200 focus-within:bg-white focus-within:shadow-sm',
        isOver && !isDragging && 'border-gray-200 bg-gray-50/70',
        isDragging && 'border-gray-200 bg-white opacity-60 shadow-lg'
      )}
    >
      <div className="absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-md border border-gray-200 bg-white p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {block.type === 'heading' ? (
          <select
            aria-label="Überschriftsebene"
            value={block.level}
            onChange={(event) =>
              onChange({ ...block, level: Number(event.target.value) === 3 ? 3 : 2 })
            }
            className="h-6 rounded border-0 bg-gray-100 px-1.5 text-[11px] font-semibold text-gray-600 outline-none focus:ring-1 focus:ring-gray-300"
          >
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
        ) : (
          <span className="px-1.5 text-[10px] font-medium tracking-wide text-gray-400">
            {BLOCK_LABELS[block.type]}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Block verschieben"
            title="Block verschieben"
            className="flex h-6 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
          <IconButton label="Block löschen" onClick={onRemove} danger>
            <Trash2 />
          </IconButton>
        </div>
      </div>

      <div>
        {block.type === 'example' ? (
          <ExampleFields block={block} onChange={onChange} />
        ) : (
          <LeafFields block={block} onChange={onChange} />
        )}
      </div>
    </section>
  )
}

function LeafFields({
  block,
  onChange,
}: {
  block: LessonLeafBlock
  onChange: (block: LessonLeafBlock) => void
}) {
  switch (block.type) {
    case 'heading':
      return (
        <RichTextInput
          label="Überschrift"
          appearance={block.level === 2 ? 'heading-2' : 'heading-3'}
          value={block.content}
          onChange={(content) => onChange({ ...block, content })}
        />
      )

    case 'paragraph':
      return (
        <RichTextInput
          label="Absatz"
          appearance="paragraph"
          value={block.content}
          onChange={(content) => onChange({ ...block, content })}
        />
      )

    case 'formula':
    case 'calculation':
      return <FormulaFields block={block} onChange={onChange} />

    case 'video':
      return (
        <div className="flex items-center gap-3 border-2 border-dashed border-gray-300 px-5 py-6 text-sm text-gray-500">
          <span aria-hidden className="text-lg">
            ▶
          </span>
          <input
            type="text"
            aria-label="Videotitel"
            value={block.title ?? ''}
            onChange={(e) => onChange({ ...block, title: e.target.value || undefined })}
            className="min-w-0 flex-1 border-0 bg-transparent px-0 py-1 font-medium outline-none placeholder:font-normal placeholder:text-gray-400 focus:ring-0"
            placeholder="Titel — Videos sind noch nicht angebunden."
          />
        </div>
      )

    case 'divider':
      return <hr className="border-t-2 border-black" />
  }
}

function FormulaFields({
  block,
  onChange,
}: {
  block: Extract<LessonLeafBlock, { type: 'formula' | 'calculation' }>
  onChange: (block: LessonLeafBlock) => void
}) {
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const inputId = useId()

  useEffect(() => {
    if (!editing || !input.current) return
    input.current.focus()
    input.current.setSelectionRange(input.current.value.length, input.current.value.length)
  }, [editing])

  return (
    <div>
      <div
        className={cn(
          'relative min-h-12 w-full text-gray-900',
          block.type === 'formula'
            ? 'border-2 border-black bg-[#f4f5fa] px-6 py-7 text-center'
            : 'bg-black/[0.05] px-4 py-3 text-left text-[15px]'
        )}
      >
        {block.latex.trim() ? (
          <LessonMath
            key={`${block.type}:${block.latex}`}
            latex={block.latex}
            display={block.type === 'formula'}
          />
        ) : (
          <span className="text-sm font-normal text-gray-400">Formel eingeben …</span>
        )}
        <button
          type="button"
          aria-label="LaTeX bearbeiten"
          aria-expanded={editing}
          onClick={() => setEditing(true)}
          className="absolute inset-0 h-full w-full transition-colors hover:bg-black/[0.02] focus-visible:ring-2 focus-visible:ring-gray-300 focus-visible:outline-none"
        />
      </div>

      {editing && (
        <div className="mt-2">
          <label className="mb-1 block text-[11px] font-medium text-gray-400" htmlFor={inputId}>
            LaTeX bearbeiten
          </label>
          <textarea
            ref={input}
            id={inputId}
            rows={2}
            value={block.latex}
            onChange={(event) => onChange({ ...block, latex: event.target.value })}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              setEditing(false)
              event.currentTarget.blur()
            }}
            className="w-full resize-y rounded-md border-0 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600 outline-none transition-colors placeholder:text-gray-300 focus:bg-gray-100 focus:ring-2 focus:ring-gray-200"
            placeholder="E[R_P] = x_1\,E[R_1] + \dots"
          />
        </div>
      )}
    </div>
  )
}

function ExampleFields({
  block,
  onChange,
}: {
  block: Extract<LessonBlock, { type: 'example' }>
  onChange: (block: LessonBlock) => void
}) {
  const listId = useId()
  const nextBlockId = useRef(block.blocks.length)
  const [blockIds, setBlockIds] = useState(() =>
    block.blocks.map((_, index) => `${listId}-example-block-${index}`)
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const setChildren = (blocks: LessonLeafBlock[]) => onChange({ ...block, blocks })

  const removeChild = (index: number) => {
    setBlockIds((ids) => ids.filter((_, i) => i !== index))
    setChildren(block.blocks.filter((_, i) => i !== index))
  }

  const addChild = (added: LessonLeafBlock) => {
    setBlockIds((ids) => [...ids, `${listId}-example-block-${nextBlockId.current++}`])
    setChildren([...block.blocks, added])
  }

  const finishDrag = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = blockIds.indexOf(String(active.id))
    const to = blockIds.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    setBlockIds((ids) => arrayMove(ids, from, to))
    setChildren(arrayMove(block.blocks, from, to))
  }

  return (
    <div className="border-t-4 border-gray-400 bg-[#efeeec] px-6 py-5">
      <div className="flex items-end gap-2">
        <Field label="Symbol (optional)">
          <IconPicker
            value={block.icon}
            onChange={(icon) => onChange({ ...block, icon })}
          />
        </Field>
        <div className="flex-1">
          <Field label="Beschriftung">
            <input
              type="text"
              value={block.label}
              onChange={(e) => onChange({ ...block, label: e.target.value })}
              className="w-full rounded-md border-0 bg-white/70 px-2 py-1.5 text-[11px] font-bold tracking-[0.1em] uppercase outline-none focus:bg-white focus:ring-2 focus:ring-gray-200"
              placeholder="Ein Beispiel mit zwei Aktien"
            />
          </Field>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4 border-l border-gray-300 pl-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finishDrag}>
          <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
            {block.blocks.map((child, index) => (
              <BlockCard
                key={blockIds[index]}
                sortableId={blockIds[index]}
                block={child}
                onChange={(next) =>
                  // A container holds leaf blocks only (lesson-json.ts). The cast
                  // is safe because every control below inserts leaves and
                  // `BlockCard` cannot turn one into an example.
                  setChildren(
                    block.blocks.map((b, i) =>
                      i === index ? (next as LessonLeafBlock) : b
                    )
                  )
                }
                onRemove={() => removeChild(index)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <AddBlockBar
          inContainer
          onAdd={(added) => addChild(added as LessonLeafBlock)}
        />
      </div>
    </div>
  )
}

// ── Adding ──────────────────────────────────────────────────────────────────

const BLOCK_LABELS: Record<LessonBlock['type'], string> = {
  heading: 'Überschrift',
  paragraph: 'Absatz',
  formula: 'Merkformel',
  calculation: 'Rechenschritt',
  example: 'Beispiel',
  divider: 'Trennlinie',
  video: 'Video',
}

const BLOCK_SYMBOLS: Record<LessonBlock['type'], string> = {
  heading: 'H',
  paragraph: '¶',
  formula: '∑',
  calculation: '=',
  example: '▣',
  divider: '—',
  video: '▶',
}

const BLOCK_HINTS: Record<LessonBlock['type'], string> = {
  heading: 'Einen Abschnitt strukturieren',
  paragraph: 'Fließtext und Erklärungen',
  formula: 'Eine hervorgehobene Formel',
  calculation: 'Ein einzelner Rechenschritt',
  example: 'Mehrere Blöcke gruppieren',
  divider: 'Inhalte optisch trennen',
  video: 'Einen Video-Platzhalter setzen',
}

const PALETTE_DRAG_PREFIX = 'new-lesson-block:'

function paletteDragId(type: LessonBlock['type']) {
  return `${PALETTE_DRAG_PREFIX}${type}`
}

function paletteTypeFromDragId(id: string): LessonBlock['type'] | null {
  if (!id.startsWith(PALETTE_DRAG_PREFIX)) return null
  const type = id.slice(PALETTE_DRAG_PREFIX.length)
  return Object.prototype.hasOwnProperty.call(BLOCK_LABELS, type)
    ? (type as LessonBlock['type'])
    : null
}

/** What each button inserts. Kept next to the labels so the two cannot drift. */
function blankBlock(type: LessonBlock['type']): LessonBlock {
  switch (type) {
    case 'heading':
      return { type: 'heading', level: 2, content: [] }
    case 'paragraph':
      return { type: 'paragraph', content: [] }
    case 'formula':
      return { type: 'formula', latex: '' }
    case 'calculation':
      return { type: 'calculation', latex: '' }
    case 'example':
      return { type: 'example', label: 'Beispiel', blocks: [] }
    case 'divider':
      return { type: 'divider' }
    case 'video':
      return { type: 'video' }
  }
}

function AddBlockBar({
  onAdd,
  inContainer = false,
}: {
  onAdd: (block: LessonBlock) => void
  /** Inside an example, `example` is not on offer — containers hold leaves only. */
  inContainer?: boolean
}) {
  const types = (Object.keys(BLOCK_LABELS) as LessonBlock['type'][]).filter(
    (type) => !(inContainer && type === 'example')
  )

  return (
    <div className="mt-2 border-t border-gray-100 px-2 pt-3">
      <PopoverMenu
        label="Block hinzufügen"
        panelClassName="w-72"
        trigger={
          <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-800">
            <Plus className="size-3.5" />
            Block hinzufügen
          </span>
        }
      >
        {(close) => (
          <>
            <PopoverMenuLabel>Blocktyp auswählen</PopoverMenuLabel>
            {types.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onAdd(blankBlock(type))
                  close()
                }}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-gray-100"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100 text-sm font-semibold text-gray-600">
                  {BLOCK_SYMBOLS[type]}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-800">{BLOCK_LABELS[type]}</span>
                  <span className="block truncate text-xs text-gray-400">{BLOCK_HINTS[type]}</span>
                </span>
              </button>
            ))}
          </>
        )}
      </PopoverMenu>
    </div>
  )
}

function BlockInsertToolbar({ onAdd }: { onAdd: (block: LessonBlock) => void }) {
  const types = Object.keys(BLOCK_LABELS) as LessonBlock['type'][]

  return (
    <div
      role="toolbar"
      aria-label="Blöcke einfügen und sortieren"
      className="mb-4 flex items-center gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-white p-1.5 shadow-sm"
    >
      <span className="shrink-0 px-2 text-[11px] font-semibold tracking-wide text-gray-400 uppercase">
        Einfügen
      </span>
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-gray-200" />

      {types.map((type) => (
        <PaletteBlockButton key={type} type={type} onAdd={() => onAdd(blankBlock(type))} />
      ))}

      <span aria-hidden className="mx-1 hidden h-5 w-px shrink-0 bg-gray-200 xl:block" />
      <span className="ml-auto hidden shrink-0 items-center gap-1 px-2 text-[11px] text-gray-400 xl:flex">
        <GripVertical className="size-3.5" />
        Am Griff verschieben
      </span>
    </div>
  )
}

function PaletteBlockButton({
  type,
  onAdd,
}: {
  type: LessonBlock['type']
  onAdd: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: paletteDragId(type),
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      title={`${BLOCK_HINTS[type]} – klicken oder in den Editor ziehen`}
      onClick={onAdd}
      className={cn(
        'inline-flex h-8 shrink-0 touch-none cursor-grab items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none active:cursor-grabbing',
        isDragging && 'opacity-30'
      )}
      {...attributes}
      {...listeners}
    >
      <span className="flex size-5 items-center justify-center rounded bg-gray-100 text-[11px] font-semibold text-gray-500 group-hover/button:bg-white">
        {BLOCK_SYMBOLS[type]}
      </span>
      {BLOCK_LABELS[type]}
    </button>
  )
}

function BlockEndDropZone({ id, active }: { id: string; active: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mx-8 flex h-8 items-center justify-center rounded-md text-xs transition-colors',
        active ? 'text-gray-400' : 'text-transparent',
        isOver && 'bg-gray-100 text-gray-600 ring-1 ring-gray-300'
      )}
    >
      Hier ablegen, um den Block unten einzufügen
    </div>
  )
}

function PaletteDragPreview({ type }: { type: LessonBlock['type'] }) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-lg">
      <span className="flex size-5 items-center justify-center rounded bg-gray-100 text-[11px] font-semibold text-gray-500">
        {BLOCK_SYMBOLS[type]}
      </span>
      {BLOCK_LABELS[type]}
    </div>
  )
}

// ── Small shared controls ───────────────────────────────────────────────────

/**
 * The textarea that edits rich text. It converts on every keystroke, which is
 * affordable because both directions are pure string work — and it means the
 * preview beside it is never out of date with what has been typed.
 */
function RichTextInput({
  label,
  appearance,
  value,
  onChange,
}: {
  label: string
  appearance: 'heading-2' | 'heading-3' | 'paragraph'
  value: Parameters<typeof serializeInlineMarkup>[0]
  onChange: (content: ReturnType<typeof parseInlineMarkup>) => void
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const serialized = serializeInlineMarkup(value)

  useLayoutEffect(() => {
    const element = textarea.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }, [serialized, appearance])

  return (
    <div className="group/field relative flex-1">
      <textarea
        ref={textarea}
        rows={1}
        aria-label={label}
        value={serialized}
        onChange={(e) => onChange(parseInlineMarkup(e.target.value))}
        placeholder={appearance.startsWith('heading') ? 'Überschrift' : 'Text eingeben …'}
        className={cn(
          'block w-full resize-none overflow-hidden border-0 bg-transparent px-0 outline-none placeholder:text-gray-300 focus:ring-0',
          appearance === 'heading-2' &&
            'pt-2 text-2xl leading-tight font-black tracking-[-0.01em] text-black',
          appearance === 'heading-3' && 'pt-1 text-lg leading-snug font-bold text-black',
          appearance === 'paragraph' && 'py-0 text-[17px] leading-[1.75] text-gray-900'
        )}
      />
      <p className="pointer-events-none absolute top-full left-0 z-20 mt-1 rounded bg-white px-1.5 py-1 text-[11px] text-gray-400 opacity-0 shadow-sm transition-opacity group-focus-within/field:opacity-100">
        <code>**fett**</code> · <code>*kursiv*</code> · <code>$LaTeX$</code> ·{' '}
        <code>[[Begriff|Erklärung]]</code>
      </p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId()
  return (
    <label htmlFor={id} className="block">
      <span className="mb-0.5 block text-[11px] font-medium text-gray-400">{label}</span>
      {children}
    </label>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:pointer-events-none disabled:opacity-20 [&_svg]:size-3.5 ${
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-gray-100 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}
