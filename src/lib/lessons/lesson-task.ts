/**
 * The title of the Aufgabe that carries a Unit's Lernseiten (#107) — the one
 * row in the hierarchy no author ever sees.
 *
 * IT LIVES IN ITS OWN MODULE because both halves of the system need it and
 * neither may import the other: the server action creates the Task, the DAL
 * recognises it in order to hide it, and a `'use server'` file may export
 * nothing but server actions. A constant duplicated across those two files
 * would be a silent drift hazard — the author would start seeing a stray
 * „Lernseite" Aufgabe in the student view the day the two spellings diverged.
 *
 * It is a title rather than a column because it records a fact only these two
 * places care about. If Lernseiten ever need to be told apart from ordinary
 * Aufgaben by a query, that is the moment for a real column — not before.
 */
export const LESSON_TASK_TITLE = 'Lernseite'
