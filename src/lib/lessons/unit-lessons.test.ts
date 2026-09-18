import { describe, expect, it } from 'vitest'
import type { DocumentWithImages, Task } from '@/types'
import { splitUnitLessons } from './unit-lessons'

type TaskWithDocs = Task & { documents: DocumentWithImages[] }

function doc(id: string, file_type: DocumentWithImages['file_type']): DocumentWithImages {
  return {
    id,
    task_id: 't',
    title: id,
    description: null,
    file_path: null,
    file_type,
    position: 0,
    created_at: '2026-01-01',
    content: null,
    document_images: [],
  }
}

function task(id: string, documents: DocumentWithImages[]): TaskWithDocs {
  return {
    id,
    unit_id: 'u',
    title: id,
    description: null,
    position: 0,
    created_at: '2026-01-01',
    documents,
  }
}

describe('splitUnitLessons', () => {
  it('pulls Lernseiten out and leaves the rest in the accordion', () => {
    const result = splitUnitLessons([
      task('Lernseite', [doc('a', 'lesson'), doc('b', 'lesson')]),
      task('Aufgabe 1', [doc('c', 'pdf')]),
    ])
    expect(result.lessons.map((d) => d.id)).toEqual(['a', 'b'])
    expect(result.tasks.map((t) => t.id)).toEqual(['Aufgabe 1'])
  })

  it('drops an Aufgabe that held nothing but Lernseiten', () => {
    // The hidden Task must never surface — an empty „Lernseite" heading in the
    // accordion would expose the exact row the author is not supposed to see.
    const result = splitUnitLessons([task('Lernseite', [doc('a', 'lesson')])])
    expect(result.tasks).toEqual([])
  })

  it('keeps an Aufgabe that held both, minus its Lernseiten', () => {
    const result = splitUnitLessons([task('Gemischt', [doc('a', 'lesson'), doc('b', 'image')])])
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].documents.map((d) => d.id)).toEqual(['b'])
  })

  it('keeps an ordinary empty Aufgabe', () => {
    // An Aufgabe the author created and has not filled is their business.
    const result = splitUnitLessons([task('Noch leer', [])])
    expect(result.tasks.map((t) => t.id)).toEqual(['Noch leer'])
  })

  it('preserves the order the DAL sorted into', () => {
    const result = splitUnitLessons([
      task('erste', [doc('a', 'lesson')]),
      task('zweite', [doc('b', 'lesson')]),
    ])
    expect(result.lessons.map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('does not mutate its input', () => {
    const input = [task('Gemischt', [doc('a', 'lesson'), doc('b', 'pdf')])]
    const before = JSON.stringify(input)
    splitUnitLessons(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('leaves a Musterlösungs-Unit completely untouched', () => {
    const tasks = [task('Aufgabe 1', [doc('a', 'pdf'), doc('b', 'image_collection')])]
    const result = splitUnitLessons(tasks)
    expect(result.lessons).toEqual([])
    expect(result.tasks).toEqual(tasks)
  })
})
