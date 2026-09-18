'use client'

import { useState } from 'react'
import { DocumentForm } from '@/components/admin/DocumentForm'
import { AdminTree } from '@/components/admin/AdminTree'
import type { Document as DokumentRow } from '@/types'

type Document = { id: string; title: string; position: number; created_at: string; file_type?: string; document_images?: { id: string }[] }
type Task = { id: string; unit_id: string; title: string; description: string | null; position: number; created_at: string; documents: Document[] }
type Unit = { id: string; kurs_id: string; title: string; description: string | null; position: number; created_at: string; tasks: Task[] }
type KursTree = { id: string; title: string; units: Unit[] }

// `file_type` mirrors the row's union rather than restating it — a third copy
// of the list is a third place to forget when a kind is added (#107).
type DefaultValues = { title: string; description: string | null; position: number; file_path?: string | null; file_type?: DokumentRow['file_type'] }

type Props = {
  kurseTree: KursTree[]
  defaultTaskId: string
  editId?: string
  defaultValues?: DefaultValues
}

export function DocumentPageClient({ kurseTree, defaultTaskId, editId, defaultValues }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState(defaultTaskId)

  // Flatten tasks with unit + kurs labels for the form dropdown
  const tasks = kurseTree.flatMap((kurs) =>
    kurs.units.flatMap((unit) =>
      unit.tasks.map((task) => ({
        ...task,
        units: { ...unit, kurse: { title: kurs.title } },
      }))
    )
  )

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[7fr_3fr]">
      <DocumentForm
        tasks={tasks}
        onTaskChange={setSelectedTaskId}
        defaultTaskId={defaultTaskId}
        editId={editId}
        defaultValues={defaultValues}
      />
      <div>
        <p className="mb-3 text-sm font-medium text-gray-500">Kurs-Übersicht</p>
        <AdminTree kurse={kurseTree} selectedId={selectedTaskId} deleteLevel="document" />
      </div>
    </div>
  )
}
