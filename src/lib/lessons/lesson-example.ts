/**
 * lesson-example — the reference Lernseite („3.3 Portfolio Return, and Hitting
 * a Target") as data (#107).
 *
 * THIS IS THE SPECIFICATION, NOT A FIXTURE. The design was handed over as a
 * picture; this file is that picture transcribed into the model, and it is the
 * reason to believe the model can express it. Every block type in
 * lesson-json.ts appears here at least once, in the arrangement the design puts
 * it in — so a change to the schema that makes the reference page inexpressible
 * fails a test rather than being discovered later against real content.
 *
 * It also feeds „neue Lernseite aus Vorlage" in the workspace, which is why it
 * ships in `src/lib` rather than in a test file.
 *
 * The prose is transcribed verbatim from the design, English included: the page
 * is a mock of a finance course, and translating it would break the one thing
 * this file is for — being comparable to the picture.
 */

import type { LatestLessonJson } from './lesson-json'

export const LESSON_EXAMPLE: LatestLessonJson = {
  version: '1.0',
  badge: 'Core Concept',
  blocks: [
    {
      type: 'paragraph',
      content: [
        "A portfolio's return is the most straightforward quantity in the course: the weighted average of the returns of the assets inside it. If 40% of your money is in one stock and 60% in another, the portfolio return is 40% of the first plus 60% of the second.",
      ],
    },
    {
      type: 'formula',
      latex: 'E[R_P] = x_1\\,E[R_1] + x_2\\,E[R_2] + \\dots',
    },
    {
      type: 'paragraph',
      content: [
        "Each asset's ",
        { type: 'term', label: 'expected return', definition: 'Der Erwartungswert der Rendite eines Wertpapiers — der mit den Eintrittswahrscheinlichkeiten gewichtete Durchschnitt aller möglichen Renditen.' },
        ' ',
        { type: 'math', latex: 'E[R_i]' },
        ' is scaled by how much of it you hold, ',
        { type: 'math', latex: 'x_i' },
        ', and the results are added up.',
      ],
    },
    {
      type: 'example',
      icon: '✏️',
      label: 'A two-stock portfolio',
      blocks: [
        {
          type: 'paragraph',
          content: [
            "Split your money evenly between Apple and Pfizer. Apple's average annual return in this case is 31.14%, Pfizer's is 5.16%.",
          ],
        },
        {
          type: 'calculation',
          latex: 'E[R_P] = 0.5 \\times 31.14\\% + 0.5 \\times 5.16\\% = \\mathbf{18.15\\%}',
        },
        {
          type: 'paragraph',
          content: [
            'The portfolio return lands between the two individual returns, pulled toward whichever asset you weight more heavily — exactly halfway here, since the split is even.',
          ],
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'heading',
      level: 2,
      content: ['Turning the Formula Around'],
    },
    {
      type: 'paragraph',
      content: [
        'The same formula answers the reverse question: instead of "given these weights, what return do I get?", ask "given a target return, what weights do I need?".',
      ],
    },
  ],
}
