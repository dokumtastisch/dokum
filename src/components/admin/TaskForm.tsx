'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createTask, updateTask } from '@/actions/admin'
import type { Unit, Kurs } from '@/types'
import type { ActionResult } from '@/types'

type FormState = ActionResult<{ id?: string }> | null

const initialState: FormState = null

type UnitWithKurs = Unit & { kurse: Pick<Kurs, 'title'> }

type DefaultValues = {
  title: string
  description: string | null
  position: number
}

export function TaskForm({
  units,
  onUnitChange,
  defaultUnitId = '',
  editId,
  defaultValues,
}: {
  units: UnitWithKurs[]
  onUnitChange?: (unitId: string) => void
  defaultUnitId?: string
  editId?: string
  defaultValues?: DefaultValues
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const result = editId ? await updateTask(editId, formData) : await createTask(formData)
      return result as FormState
    },
    initialState
  )

  useEffect(() => {
    if (state?.ok === true) router.refresh()
  }, [state?.ok, router])

  return (
    <form action={action} className="flex flex-col gap-5">
      {state?.ok === false && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {state.error}
        </p>
      )}
      {state?.ok === true && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-3">
          <p className="text-sm font-medium text-green-800">
            {editId ? 'Task erfolgreich aktualisiert!' : 'Task erfolgreich angelegt!'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/admin"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              ← Zurück zur Übersicht
            </Link>
            {!editId && state.data?.id && (
              <Link
                href={`/admin/documents/new?taskId=${state.data.id}`}
                className="rounded-md border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5 btn-brand"
              >
                Dokument hinzufügen →
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="task-unit" className="text-sm font-medium text-gray-700">
          Unit <span className="text-red-500">*</span>
        </label>
        <select
          id="task-unit"
          name="unit_id"
          required
          defaultValue={defaultUnitId}
          disabled={!!editId}
          onChange={(e) => onUnitChange?.(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-50 disabled:text-gray-500"
        >
          <option value="">— Select a Unit —</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.kurse.title} › {u.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="task-title" className="text-sm font-medium text-gray-700">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          id="task-title"
          name="title"
          type="text"
          required
          defaultValue={defaultValues?.title ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="task-description" className="text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="task-description"
          name="description"
          rows={3}
          defaultValue={defaultValues?.description ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      {/* The order is dragged in the tree, not typed here — but `position` is
          still what the schema reads, and `positionField` DEFAULTS TO 0. A form
          that simply left the field out would send every edited Aufgabe to the
          top of its Einheit. So the current value rides along hidden. */}
      <input type="hidden" name="position" value={defaultValues?.position ?? 0} />

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand/5 disabled:opacity-50 btn-brand"
      >
        {pending ? 'Saving…' : editId ? 'Aktualisieren' : 'Add Task'}
      </button>
    </form>
  )
}
