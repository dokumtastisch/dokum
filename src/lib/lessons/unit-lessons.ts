/**
 * Which Lernseiten a Unit holds, and what is left over (#107).
 *
 * A Unit's Aufgaben carry two different things now: the Lernseiten of a
 * Lernkurs, and everything a Musterlösungs-Unit has always carried. The
 * student page has to render the first as pages and the second as the
 * accordion, so SPLITTING the tree is a decision with exactly one right answer
 * per document — which makes it a pure function, and testable, rather than a
 * condition spread across JSX.
 *
 * `file_type` decides, never the Task it hangs under. The hidden Task is an
 * implementation detail of where a Lernseite is stored; a stray upload placed
 * there would still be an upload, and a Lernseite moved elsewhere would still
 * be a Lernseite.
 */

import type { Document, DocumentWithImages, Task } from '@/types'

type TaskWithDocs = Task & { documents: DocumentWithImages[] }

export interface UnitLessonSplit {
  /** Lernseiten, in the hierarchy's order, flattened out of their Aufgaben. */
  lessons: DocumentWithImages[]
  /**
   * Everything else, with the Aufgaben that held only Lernseiten removed
   * entirely — an empty „Lernseite" Aufgabe in the accordion would expose the
   * very row the author is never supposed to see.
   */
  tasks: TaskWithDocs[]
}

export function splitUnitLessons(tasks: readonly TaskWithDocs[]): UnitLessonSplit {
  const lessons: DocumentWithImages[] = []
  const rest: TaskWithDocs[] = []

  for (const task of tasks) {
    const taskLessons = task.documents.filter(isLesson)
    const others = task.documents.filter((doc) => !isLesson(doc))
    lessons.push(...taskLessons)
    // A Task keeps its place in the accordion when it still has something to
    // show, OR when it never held a Lernseite at all — an ordinary empty
    // Aufgabe is the author's business and stays visible.
    if (others.length > 0 || taskLessons.length === 0) {
      rest.push({ ...task, documents: others })
    }
  }

  return { lessons, tasks: rest }
}

function isLesson(doc: Pick<Document, 'file_type'>): boolean {
  return doc.file_type === 'lesson'
}
