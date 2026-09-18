/**
 * lesson-version — upgrade-on-read for the Lernseiten schema (#107).
 *
 * The counterpart to lesson-json.ts, and a deliberate copy of the shape that
 * already works for documents: a total vN→vN+1 record, plus one read boundary
 * every stored page passes through.
 *
 * IT REUSES {@link upgradeThroughChain} RATHER THAN RE-IMPLEMENTING IT. That
 * walker is already generic over „a value with a `version`", already treats the
 * identity step as the load-bearing terminator, and is already covered by its
 * own tests. A second copy would be a second place for the subtle parts — the
 * hop bound, the refusal of a step that fails to advance — to drift.
 *
 * WHERE THIS DIFFERS FROM THE DOCUMENT BOUNDARY, and it matters: a document
 * that fails to read falls back to its stored PNG. A Lernseite has no PNG and
 * no fallback, so a refusal here means the page cannot be shown at all. That
 * makes honest failure MORE important rather than less — a partially accepted
 * lesson would silently drop paragraphs a student paid for, and nothing
 * downstream could tell that anything was missing. Hence the same rule: no
 * repair, no coercion, no page on the failure branch.
 */

import { upgradeThroughChain } from '@/lib/editor/document-version'
import {
  LATEST_LESSON_JSON_VERSION,
  LessonJsonSchema,
  type LatestLessonJson,
  type LessonJson,
  type LessonJsonVersion,
} from './lesson-json'

/** One rung of the ladder: a page at version N → the same page at N+1. */
type UpgradeStep = (lesson: LessonJson) => LessonJson

/**
 * The vN→vN+1 chain, keyed by the version being upgraded FROM. Total over
 * {@link LESSON_JSON_VERSIONS}: the newest version maps to identity, every
 * older one returns the next version's shape.
 *
 * Steps must be pure and must not mutate their input.
 */
export const LESSON_JSON_UPGRADES: Record<LessonJsonVersion, UpgradeStep> = {
  /** Identity — 1.0 is the newest (and so far only) version. */
  '1.0': (lesson) => lesson,
}

/**
 * Migrates a schema-valid page up to {@link LATEST_LESSON_JSON_VERSION}.
 *
 * Throws a German `Error` when the version is outside the supported list or a
 * step fails to advance it. Callers reading storage should use
 * {@link readLessonJson}, which turns both into an honest `ok: false`.
 */
export function upgradeLessonJson(lesson: LessonJson): LatestLessonJson {
  const upgraded = upgradeThroughChain<LessonJson>(
    lesson,
    LESSON_JSON_UPGRADES,
    LATEST_LESSON_JSON_VERSION
  )
  // Sound because the schema ties each `version` literal to its own shape.
  return upgraded as LatestLessonJson
}

/** Outcome of reading a stored page: a usable lesson, or an honest refusal. */
export type LessonJsonReadResult =
  | { ok: true; lesson: LatestLessonJson }
  | { ok: false; error: string }

/**
 * The read boundary for stored lesson JSON — parse, then upgrade.
 *
 * `raw` is whatever came back from the database: unvalidated `unknown`. On
 * success the page is guaranteed to be at the newest version and structurally
 * complete; on failure the caller gets a German message and NO page, which is
 * the signal to show a refusal rather than render something partial.
 */
export function readLessonJson(raw: unknown): LessonJsonReadResult {
  const parsed = LessonJsonSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: describeLessonJsonError(raw) }
  }
  try {
    return { ok: true, lesson: upgradeLessonJson(parsed.data) }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Lernseite konnte nicht aktualisiert werden.',
    }
  }
}

/**
 * A German refusal that names the likely cause instead of dumping Zod's path
 * list. The version is checked FIRST and by hand: a page from a newer build is
 * the one failure a reader can act on („update"), and Zod reports it as an
 * unmatched union member, which reads like a corrupt page.
 */
function describeLessonJsonError(raw: unknown): string {
  const version = (raw as { version?: unknown } | null)?.version
  if (typeof version !== 'string') {
    return 'Lernseite konnte nicht gelesen werden: Es fehlt die Schema-Version.'
  }
  if (!isSupportedVersion(version)) {
    return `Lernseite konnte nicht gelesen werden: Nicht unterstützte Schema-Version "${version}".`
  }
  return 'Lernseite konnte nicht gelesen werden: Der Inhalt entspricht nicht dem erwarteten Format.'
}

function isSupportedVersion(version: string): version is LessonJsonVersion {
  return version in LESSON_JSON_UPGRADES
}
