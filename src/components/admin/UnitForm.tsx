'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createUnit, updateUnit } from '@/actions/admin'
import type { Kurs } from '@/types'
import type { ActionResult } from '@/types'

type FormState = ActionResult<{ id?: string }> | null

const initialState: FormState = null

type DefaultValues = {
  title: string
  description: string | null
  position: number
}

export function UnitForm({
  kurse,
  onKursChange,
  defaultKursId = '',
  editId,
  defaultValues,
}: {
  kurse: Pick<Kurs, 'id' | 'title'>[]
  onKursChange?: (kursId: string) => void
  defaultKursId?: string
  editId?: string
  defaultValues?: DefaultValues
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const result = editId ? await updateUnit(editId, formData) : await createUnit(formData)
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
            {editId ? 'Unit erfolgreich aktualisiert!' : 'Unit erfolgreich angelegt!'}
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
                href={`/admin/tasks/new?unitId=${state.data.id}`}
                className="rounded-md border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5 btn-brand"
              >
                Task hinzufügen →
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="unit-kurs" className="text-sm font-medium text-gray-700">
          Kurs <span className="text-red-500">*</span>
        </label>
        <select
          id="unit-kurs"
          name="kurs_id"
          required
          defaultValue={defaultKursId}
          disabled={!!editId}
          onChange={(e) => onKursChange?.(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-50 disabled:text-gray-500"
        >
          <option value="">— Select a Kurs —</option>
          {kurse.map((k) => (
            <option key={k.id} value={k.id}>
              {k.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="unit-title" className="text-sm font-medium text-gray-700">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          id="unit-title"
          name="title"
          type="text"
          required
          defaultValue={defaultValues?.title ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="unit-description" className="text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="unit-description"
          name="description"
          rows={3}
          defaultValue={defaultValues?.description ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      {/* The order is dragged in the tree, not typed here — but `position` is
          still what the schema reads, and `positionField` DEFAULTS TO 0. A form
          that simply left the field out would send every edited Einheit to the
          top of its Kurs. So the current value rides along hidden. */}
      <input type="hidden" name="position" value={defaultValues?.position ?? 0} />

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand/5 disabled:opacity-50 btn-brand"
      >
        {pending ? 'Saving…' : editId ? 'Aktualisieren' : 'Add Unit'}
      </button>
    </form>
  )
}
