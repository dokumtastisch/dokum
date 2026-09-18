import type { LatestLessonJson, LessonBlock, LessonInline, LessonLeafBlock } from '@/lib/lessons/lesson-json'
import {
  formatLessonNumber,
  lessonNumberPath,
  unitNumberPath,
} from '@/lib/lessons/lesson-meta'
import { ANCHOR_SCROLL_OFFSET } from '@/lib/document-anchor'
import { LessonMath } from './LessonMath'

/**
 * The student-facing renderer for a Lernseite (#107).
 *
 * ⚠ IT IS NOT A THIRD IMPERATIVE SURFACE, and that is a deliberate departure
 * from how the other two document renderers in this codebase work. The LaTeX
 * editor and `document-render.ts` own their DOM outright because it holds
 * something React must never throw away — the author's cursor in a
 * contenteditable, the values a student typed into a live document. A Lernseite
 * holds neither: it is prose, formulas and worked examples, with no input
 * anywhere. Making it imperative too would buy nothing and would add a third
 * place where „React must not reconcile in here" has to stay true.
 *
 * So this is ordinary React, server-rendered. The single browser-side piece is
 * {@link LessonMath}, which swaps each formula's LaTeX source for typeset SVG
 * once MathJax has loaded.
 *
 * The header states three things the author never typed: the number comes from
 * the page's position in the Kurs tree, the reading time from its word count,
 * and only the badge is authored. See lesson-meta.ts for why both derived
 * values are derived.
 */
export function LessonView({
  lesson,
  title,
  /**
   * The page's 1-based position in the Kurs tree — `[3, 3]` renders „3.3".
   * Empty for a page that has no place yet (a preview, a draft), which renders
   * the title with no number rather than a stray separator.
   */
  numberPath = [],
  /**
   * How the page announces its own title — or whether it does.
   *
   * `'none'` exists because a Unit that holds exactly ONE Lernseite already has
   * that page's title as its heading: rendering it again would put two `<h1>`s
   * on the page, one above the other, saying the same thing. The badge and the
   * reading time still appear, because those are facts about the page rather
   * than a repetition of its name.
   */
  titleAs = 'h1',
  /** DOM id the sidebar jumps to — see the note below on where it is placed. */
  anchorId,
}: {
  lesson: LatestLessonJson
  title: string
  numberPath?: readonly number[]
  titleAs?: 'h1' | 'h2' | 'none'
  anchorId?: string
}) {
  const number = formatLessonNumber(numberPath)
  const heading = number ? `${number} ${title}` : title

  // ⚠ THE ANCHOR GOES ON THE HEADING ITSELF, not on a wrapper around it. A
  // wrapper's border box is only where the heading is if nothing in between has
  // a margin — and something always eventually does, which is exactly how the
  // jump ended up landing on the first block instead. Putting the id on the
  // element the reader is supposed to see removes the question.
  //
  // When there is no heading (a Unit with a single Lernseite carries the title
  // in its own `<h1>`), the article takes the anchor: its top IS the start of
  // the page in that case.
  const anchorProps = {
    id: anchorId,
    style: { scrollMarginTop: ANCHOR_SCROLL_OFFSET },
  }

  return (
    <article className="max-w-3xl" {...(titleAs === 'none' ? anchorProps : {})}>
      {titleAs === 'h1' && (
        <h1
          {...anchorProps}
          className="text-4xl leading-tight font-black tracking-[-0.01em] text-black"
        >
          {heading}
        </h1>
      )}
      {titleAs === 'h2' && (
        <h2
          {...anchorProps}
          className="text-3xl leading-tight font-black tracking-[-0.01em] text-black"
        >
          {heading}
        </h2>
      )}

      <div className="mt-10 space-y-7">
        {lesson.blocks.map((block, index) => (
          // Blocks have no ids of their own — the index is the only stable
          // identity a positional list has, and this list never reorders at
          // runtime (the editor is a different surface with its own model).
          <Block key={index} block={block} />
        ))}
      </div>
    </article>
  )
}

/** The Unit heading shared by the live course page and the editor preview. */
export function LessonUnitHeader({
  title,
  description,
  unitNumber,
  isLernkurs,
}: {
  title: string
  description: string | null
  unitNumber: number | null
  /** Only a Lernkurs numbers its Einheiten — see `unitNumberPath`. */
  isLernkurs: boolean
}) {
  const unitLabel = formatLessonNumber(unitNumberPath(unitNumber, isLernkurs))

  return (
    <>
      <h1 className="text-4xl font-black tracking-[0] text-black">
        {unitLabel && <span>{unitLabel} </span>}
        {title}
      </h1>
      {description && (
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-gray-600">{description}</p>
      )}
    </>
  )
}

/**
 * One Lernseite in its real position below a Unit heading.
 *
 * The anchor is NOT on this element. It is handed to {@link LessonView}, which
 * puts it on the heading itself — a wrapper's border box is only where the
 * heading is if nothing between them has a margin, and that assumption is what
 * made the jump land on the first block twice already.
 */
export function LessonUnitSection({
  lesson,
  title,
  anchorId,
  unitNumber,
  lessonIndex,
  lessonCount,
}: {
  lesson: LatestLessonJson
  title: string
  /** DOM id the sidebar scrolls to. Omitted in the editor preview, which has no sidebar jumps. */
  anchorId?: string
  unitNumber: number | null
  lessonIndex: number
  lessonCount: number
}) {
  return (
    <section className="mt-4">
      <LessonView
        lesson={lesson}
        title={title}
        anchorId={anchorId}
        titleAs={lessonCount === 1 ? 'none' : 'h2'}
        numberPath={lessonNumberPath(unitNumber, lessonIndex, lessonCount)}
      />
    </section>
  )
}

function Block({ block }: { block: LessonBlock }) {
  if (block.type === 'example') {
    return (
      <aside className="border-t-4 border-gray-400 bg-[#efeeec] px-6 py-5">
        <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.1em] text-gray-500 uppercase">
          {block.icon && <span aria-hidden>{block.icon}</span>}
          {block.label}
        </p>
        <div className="mt-4 space-y-4">
          {block.blocks.map((child, index) => (
            <LeafBlock key={index} block={child} />
          ))}
        </div>
      </aside>
    )
  }
  return <LeafBlock block={block} />
}

function LeafBlock({ block }: { block: LessonLeafBlock }) {
  switch (block.type) {
    case 'heading':
      return block.level === 2 ? (
        <h2 className="pt-2 text-2xl font-black tracking-[-0.01em] text-black">
          <RichText content={block.content} />
        </h2>
      ) : (
        <h3 className="pt-1 text-lg font-bold text-black">
          <RichText content={block.content} />
        </h3>
      )

    case 'paragraph':
      return (
        <p className="text-[17px] leading-[1.75] text-gray-900">
          <RichText content={block.content} />
        </p>
      )

    // The framed key formula: a heavy border, because its whole job is to be
    // the thing the eye returns to.
    case 'formula':
      return (
        <div className="border-2 border-black bg-[#f4f5fa] px-6 py-7 text-center">
          <LessonMath latex={block.latex} display />
        </div>
      )

    // One worked step. Quieter than a key formula by design — inside an
    // example the two sit within centimetres of each other and must not read
    // as equally important.
    case 'calculation':
      return (
        <div className="bg-black/[0.05] px-4 py-3 text-[15px]">
          <LessonMath latex={block.latex} />
        </div>
      )

    case 'divider':
      return <hr className="border-t-2 border-black" />

    // Bunny is not wired up yet. The placeholder is visibly unfinished on
    // purpose — an empty grey rectangle would read as a broken video.
    case 'video':
      return (
        <div className="flex items-center gap-3 border-2 border-dashed border-gray-300 px-5 py-6 text-sm text-gray-500">
          <span aria-hidden className="text-lg">
            ▶
          </span>
          <span>
            {block.title ? <span className="font-medium">{block.title}</span> : 'Video'}
            <span className="ml-2 text-gray-400">— Videos sind noch nicht angebunden.</span>
          </span>
        </div>
      )
  }
}

function RichText({ content }: { content: readonly LessonInline[] }) {
  return (
    <>
      {content.map((node, index) => (
        <Inline key={index} node={node} />
      ))}
    </>
  )
}

function Inline({ node }: { node: LessonInline }) {
  if (typeof node === 'string') return <>{node}</>

  if ('text' in node) {
    let element = <>{node.text}</>
    if (node.italic) element = <em>{element}</em>
    if (node.bold) element = <strong className="font-bold">{element}</strong>
    return element
  }

  if (node.type === 'math') {
    return <LessonMath latex={node.latex} className="whitespace-nowrap" />
  }

  // `<abbr>` rather than a styled span: the definition belongs to the term
  // semantically, and the element already carries the native tooltip and the
  // dotted underline the design shows.
  return (
    <abbr
      title={node.definition}
      // `underline` is set explicitly rather than left to the UA's default for
      // `abbr[title]`: that default is exactly the kind of thing a CSS reset
      // removes, and the dotted line is what marks the term as hoverable.
      className="font-bold text-black underline decoration-dotted underline-offset-4"
    >
      {node.label}
    </abbr>
  )
}
