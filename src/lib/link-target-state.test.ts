/**
 * link-target-state tests (#74).
 *
 * This is the paywall decision for links, so the suite is written as the
 * questions a reviewer would ask about a paywall rather than as coverage of
 * branches: who may see what, what may cross to the browser, and which rule
 * wins when two of them apply at once.
 */

import { describe, expect, it } from 'vitest'
import {
  LinkTargetDescriptorSchema,
  describeLinkTarget,
  type LinkTargetOwnership,
} from './link-target-state'

const EINHEIT = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Einheit 3 — Bewertung',
  description: 'DCF, Multiples und die Fallstricke dazwischen.',
  // The Kurs the Einheit is sold through — a locked card cannot make an offer
  // without knowing whether the Einheit is even for sale on its own.
  kursId: '11111111-1111-4111-8111-111111111111',
  kursTitle: 'Unternehmensbewertung',
  soldAs: 'unit' as const,
  kursPriceCents: 1500,
}

/** A Dokument: owned by an Einheit, so an entitlement gates it. */
const DOKUMENT: LinkTargetOwnership = {
  title: 'Aufgabe 2 — Herleitung',
  kursPublished: true,
  gatedBy: EINHEIT,
}

/** A Kurs or an Einheit: reachable without buying anything. */
const OPEN: LinkTargetOwnership = {
  title: 'Unternehmensbewertung',
  kursPublished: true,
  gatedBy: null,
}

const STUDENT = { isAdmin: false, entitled: false }
const BUYER = { isAdmin: false, entitled: true }
const ADMIN = { isAdmin: true, entitled: false }

describe('describeLinkTarget — what the student is told', () => {
  it('lets an entitled reader through', () => {
    expect(describeLinkTarget(DOKUMENT, BUYER)).toEqual({ state: 'ok' })
  })

  it('lets anyone through to something nothing has to be bought for', () => {
    // A Kurs page and an Einheit page are readable without a purchase — the
    // Einheit page IS the unlock surface, so sending the student there beats
    // any card this could put in the way.
    expect(describeLinkTarget(OPEN, STUDENT)).toEqual({ state: 'ok' })
  })

  it('offers the unlock for material the reader has not bought', () => {
    expect(describeLinkTarget(DOKUMENT, STUDENT)).toEqual({
      state: 'locked',
      title: DOKUMENT.title,
      unit: EINHEIT,
    })
  })

  it('reports a target that does not exist as gone', () => {
    expect(describeLinkTarget(null, STUDENT)).toEqual({ state: 'missing' })
  })

  it('reports a target behind an archived Kurs as gone', () => {
    expect(describeLinkTarget({ ...DOKUMENT, kursPublished: false }, BUYER)).toEqual({
      state: 'archived',
    })
  })
})

describe('describeLinkTarget — the rules that decide between themselves', () => {
  it('archived beats locked: retired material is never offered for sale', () => {
    // The one ordering that matters. An unentitled reader looking at a link
    // into an archived Kurs must NOT be shown a €3 unlock button for content
    // the operator has taken down — they would pay for a dark Einheit.
    expect(describeLinkTarget({ ...DOKUMENT, kursPublished: false }, STUDENT)).toEqual({
      state: 'archived',
    })
  })

  it('missing beats everything: nothing is described about a row that is not there', () => {
    expect(describeLinkTarget(null, ADMIN)).toEqual({ state: 'missing' })
    expect(describeLinkTarget(null, BUYER)).toEqual({ state: 'missing' })
  })

  it('an admin reaches archived material, exactly as every other reader does', () => {
    // The archive is retained and admins keep opening it (spec #63) — the same
    // bypass /api/file and isDocumentReadable already carry.
    expect(describeLinkTarget({ ...DOKUMENT, kursPublished: false }, ADMIN)).toEqual({ state: 'ok' })
    expect(describeLinkTarget(DOKUMENT, ADMIN)).toEqual({ state: 'ok' })
  })

  it('ignores the entitlement flag where nothing is gated by one', () => {
    expect(describeLinkTarget(OPEN, BUYER)).toEqual(describeLinkTarget(OPEN, STUDENT))
  })
})

describe('describeLinkTarget — what may cross to the browser', () => {
  it('says nothing but the verdict for anything the reader may not have', () => {
    // A student who cannot reach the target learns THAT and nothing else. The
    // title of retired material, and whether a missing id was ever a document,
    // both stay server-side.
    for (const descriptor of [
      describeLinkTarget({ ...DOKUMENT, kursPublished: false }, STUDENT),
      describeLinkTarget(null, STUDENT),
      describeLinkTarget(DOKUMENT, BUYER),
    ]) {
      expect(Object.keys(descriptor)).toEqual(['state'])
    }
  })

  it('carries the Einheit and its teaser only where they are the offer', () => {
    // The locked card has to name what the student would be buying, and the
    // teaser is what sells it (spec #63 user story 52).
    const descriptor = describeLinkTarget(DOKUMENT, STUDENT)
    expect(descriptor).toMatchObject({ unit: { title: EINHEIT.title, description: EINHEIT.description } })
  })

  it('never carries document content, however the reader is placed', () => {
    // The descriptor's shape is the guarantee: there is no field for it, and
    // the schema below is strict, so a future field cannot arrive unnoticed.
    for (const reader of [STUDENT, BUYER, ADMIN]) {
      const json = JSON.stringify(describeLinkTarget(DOKUMENT, reader))
      expect(json).not.toContain('content')
      expect(json).not.toContain('file_path')
    }
  })
})

describe('LinkTargetDescriptorSchema — the wire contract', () => {
  it('accepts every descriptor the decision can produce', () => {
    for (const descriptor of [
      describeLinkTarget(DOKUMENT, STUDENT),
      describeLinkTarget(DOKUMENT, BUYER),
      describeLinkTarget({ ...DOKUMENT, kursPublished: false }, STUDENT),
      describeLinkTarget(null, STUDENT),
    ]) {
      expect(LinkTargetDescriptorSchema.parse(descriptor)).toEqual(descriptor)
    }
  })

  it('refuses a locked verdict with no Einheit to unlock', () => {
    // A locked card that cannot name the Einheit has no offer to make, so the
    // client must not be handed one.
    expect(LinkTargetDescriptorSchema.safeParse({ state: 'locked' }).success).toBe(false)
    expect(
      LinkTargetDescriptorSchema.safeParse({ state: 'locked', title: 'X', unit: null }).success
    ).toBe(false)
  })

  it('refuses a verdict it does not know, rather than passing it through', () => {
    expect(LinkTargetDescriptorSchema.safeParse({ state: 'kaputt' }).success).toBe(false)
    // Strict: a field nobody declared is a field nobody vetted.
    expect(
      LinkTargetDescriptorSchema.safeParse({ state: 'archived', title: 'geheim' }).success
    ).toBe(false)
  })

  it('refuses the login page an unauthenticated fetch would land on', () => {
    // The proxy answers an unauthenticated /api request with a redirect to the
    // login page, so the client's parse is what stops HTML being read as a
    // verdict — and the chip is left alone instead.
    expect(LinkTargetDescriptorSchema.safeParse('<!DOCTYPE html>').success).toBe(false)
    expect(LinkTargetDescriptorSchema.safeParse(null).success).toBe(false)
  })
})
