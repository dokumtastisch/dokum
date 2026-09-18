'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createKurs, updateKurs } from '@/actions/admin'
import type { ActionResult, KursSoldAs, KursType } from '@/types'
import { MIN_PRICE_CENTS, UNIT_PRICE_DISPLAY } from '@/lib/constants'

type FormState = ActionResult<{ id?: string }> | null

const initialState: FormState = null

type DefaultValues = {
  title: string
  description: string | null
  position: number
  kurs_type?: KursType
  sold_as?: KursSoldAs
  price_cents?: number
}

export function KursForm({
  editId,
  defaultValues,
  /**
   * Called after a successful save (#108). The table renders this form inside
   * a modal and uses it to close the dialog — which is also why the success
   * panel below stays: without a handler (the standalone page), the panel is
   * still the only feedback there is.
   */
  onSuccess,
}: {
  editId?: string
  defaultValues?: DefaultValues
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const result = editId ? await updateKurs(editId, formData) : await createKurs(formData)
      return result as FormState
    },
    initialState
  )

  useEffect(() => {
    if (state?.ok !== true) return
    router.refresh()
    onSuccess?.()
  }, [state?.ok, router, onSuccess])

  return (
    <form action={action} className="flex flex-col gap-5">
      {state?.ok === false && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {state.error}
        </p>
      )}
      {state?.ok === true && !onSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-3">
          <p className="text-sm font-medium text-green-800">
            {editId ? 'Kurs erfolgreich aktualisiert!' : 'Kurs erfolgreich angelegt!'}
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
                href={`/admin/units/new?kursId=${state.data.id}`}
                className="rounded-md border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5 btn-brand"
              >
                Unit hinzufügen →
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="kurs-title" className="text-sm font-medium text-gray-700">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          id="kurs-title"
          name="title"
          type="text"
          required
          defaultValue={defaultValues?.title ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="kurs-description" className="text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="kurs-description"
          name="description"
          rows={3}
          defaultValue={defaultValues?.description ?? ''}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="kurs-position" className="text-sm font-medium text-gray-700">
          Position
        </label>
        <input
          id="kurs-position"
          name="position"
          type="number"
          defaultValue={defaultValues?.position ?? 0}
          className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <p className="text-xs text-gray-400">Lower numbers appear first. Ties are broken by creation time.</p>
      </div>

      {/* ── Kursart und Verkauf (#107) ───────────────────────────────── */}
      <fieldset className="rounded-md border border-gray-200 px-4 py-3">
        <legend className="px-1 text-xs font-bold tracking-[0.08em] text-gray-400 uppercase">
          Art und Verkauf
        </legend>

        <div className="flex flex-col gap-1">
          <label htmlFor="kurs-type" className="text-sm font-medium text-gray-700">
            Kursart
          </label>
          <select
            id="kurs-type"
            name="kurs_type"
            defaultValue={defaultValues?.kurs_type ?? 'musterloesung'}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
          >
            <option value="musterloesung">Musterlösungen — Einheiten enthalten Lösungen</option>
            <option value="lernkurs">Lernkurs — Einheiten sind Lernseiten</option>
          </select>
        </div>

        <div className="mt-4 flex flex-col gap-1">
          <label htmlFor="kurs-sold-as" className="text-sm font-medium text-gray-700">
            Verkauft wird
          </label>
          <select
            id="kurs-sold-as"
            name="sold_as"
            defaultValue={defaultValues?.sold_as ?? 'unit'}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
          >
            <option value="unit">Einzelne Einheiten</option>
            <option value="kurs">Der ganze Kurs</option>
          </select>
          <p className="text-xs text-gray-400">
            &bdquo;Der ganze Kurs&ldquo;: ein Kauf schaltet alle Einheiten frei &ndash; auch die, die du
            sp&auml;ter hinzuf&uuml;gst.
          </p>
        </div>

        {/* Der Kurspreis ist editierbar, der Einheitenpreis nicht: der h&auml;ngt an
            einer festen Stripe-Price-ID (STRIPE_UNIT_PRICE_ID) und l&auml;sst sich
            nur dort &auml;ndern. */}
        <div className="mt-4 flex gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="kurs-price" className="text-sm font-medium text-gray-700">
              Kurspreis
            </label>
            <input
              id="kurs-price"
              name="price_euro"
              type="number"
              step="0.01"
              min={MIN_PRICE_CENTS / 100}
              defaultValue={(defaultValues?.price_cents ?? 1500) / 100}
              className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
            />
            <p className="text-xs text-gray-400">In Euro.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="unit-price" className="text-sm font-medium text-gray-700">
              Preis je Einheit
            </label>
            <input
              id="unit-price"
              type="text"
              disabled
              value={UNIT_PRICE_DISPLAY}
              className="w-28 cursor-not-allowed rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-400">Fest in Stripe.</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Wirksam ist immer nur einer der beiden: der Kurspreis bei &bdquo;Der ganze Kurs&ldquo;,
          der Einheitenpreis bei &bdquo;Einzelne Einheiten&ldquo;.
        </p>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand/5 disabled:opacity-50 btn-brand"
      >
        {pending ? 'Saving…' : editId ? 'Aktualisieren' : 'Add Kurs'}
      </button>
    </form>
  )
}
