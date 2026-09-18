import { describe, expect, it } from 'vitest'
import { formatPriceEur } from '@/lib/constants'
import { purchasePriceCents, purchasePriceLabel } from '@/lib/pricing'

describe('formatPriceEur', () => {
  it('drops the decimals on whole euros', () => {
    expect(formatPriceEur(300)).toBe('€3')
    expect(formatPriceEur(1500)).toBe('€15')
  })

  it('keeps two decimals otherwise', () => {
    expect(formatPriceEur(1250)).toBe('€12.50')
    expect(formatPriceEur(50)).toBe('€0.50')
    expect(formatPriceEur(1234)).toBe('€12.34')
  })
})

describe('purchasePrice', () => {
  it('prices a whole-Kurs sale from the Kurs', () => {
    expect(purchasePriceCents('kurs', 1500)).toBe(1500)
    expect(purchasePriceLabel('kurs', 1500)).toBe('€15')
  })

  // The column is dormant for these Kurse — the flat Stripe Price is what the
  // buyer is actually charged, so showing price_cents would be a lie.
  it('ignores the Kurs price when Einheiten are sold one by one', () => {
    expect(purchasePriceCents('unit', 9900)).toBe(300)
    expect(purchasePriceLabel('unit', 9900)).toBe('€3')
  })
})
