'use client'

import { PopoverMenu, PopoverMenuLabel } from './PopoverMenu'

/**
 * The symbol of a Beispiel-Block (#107).
 *
 * ⚠ IT CANNOT OPEN THE MACOS EMOJI PICKER, AND NOTHING ON THE WEB CAN. The
 * native picker (⌃⌘Space) is an OS-level window; there is no browser API to
 * summon it, deliberately — a page that could pop system UI on click would be
 * a phishing tool. Every "emoji button" on the web is a picker the page draws
 * itself, which is what this is.
 *
 * What it offers, in the order an author will reach for them:
 *
 * 1. A grid of the symbols a lesson actually uses — one click, no typing, and
 *    the same handful every time so a course stays visually consistent.
 * 2. A free field for anything else. It is also where ⌃⌘Space works: the field
 *    is focused, so the OS picker inserts into it. The hint says so, because
 *    the shortcut is the thing people forget rather than the thing they cannot
 *    do.
 * 3. „Kein Symbol", because `icon` is optional and deleting the last character
 *    of a one-character field is a fiddly way to say so.
 */

/**
 * The curated set. Chosen for what teaching material marks up — a worked
 * example, a warning, a definition, a result — rather than assembled by
 * category. A short list is the feature: it is scannable, and it nudges a
 * course toward using the same symbol for the same kind of box.
 */
const LESSON_ICONS = [
  '✏️', '💡', '⚠️', '📌', '🔍', '✅', '❗', '⭐',
  '📐', '🧮', '📊', '📈', '🎯', '🔑', '📖', '🧠',
  '⏱️', '🔗', '💬', '🚩', '🧩', '⚖️', '🔬', '🏁',
] as const

export function IconPicker({
  value,
  onChange,
}: {
  value: string | undefined
  /** `undefined` clears the symbol — the field is optional in the schema. */
  onChange: (icon: string | undefined) => void
}) {
  return (
    <PopoverMenu
      label={value ? `Symbol ${value} ändern` : 'Symbol wählen'}
      panelClassName="w-64"
      trigger={
        <span className="flex h-9 w-16 items-center justify-center rounded-md bg-white/70 text-lg transition-colors hover:bg-white">
          {value ?? <span className="text-sm text-gray-400">＋</span>}
        </span>
      }
    >
      {(close) => (
        <>
          <PopoverMenuLabel>Symbol</PopoverMenuLabel>

          <div className="grid grid-cols-8 gap-0.5 px-1 pb-1">
            {LESSON_ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                onClick={() => {
                  onChange(icon)
                  close()
                }}
                aria-label={icon}
                aria-pressed={value === icon}
                className={`flex h-7 w-7 items-center justify-center rounded text-base transition-colors hover:bg-gray-100 ${
                  value === icon ? 'bg-gray-200' : ''
                }`}
              >
                {icon}
              </button>
            ))}
          </div>

          <div className="my-1 h-px bg-gray-100" />

          <div className="px-2 pt-1 pb-2">
            <input
              type="text"
              value={value ?? ''}
              onChange={(e) => onChange(e.target.value || undefined)}
              placeholder="eigenes Symbol"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-center text-sm focus:ring-2 focus:ring-brand focus:outline-none"
            />
            <p className="mt-1.5 text-[11px] leading-snug text-gray-400">
              Im Feld öffnet <kbd className="font-sans">⌃⌘Leertaste</kbd> die Emoji-Auswahl von
              macOS.
            </p>
          </div>

          <div className="my-1 h-px bg-gray-100" />

          <button
            type="button"
            onClick={() => {
              onChange(undefined)
              close()
            }}
            disabled={value === undefined}
            className="w-full rounded-md px-2 py-1.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Kein Symbol
          </button>
        </>
      )}
    </PopoverMenu>
  )
}
