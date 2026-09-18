import type { KursSoldAs } from '@/types'
import { UNIT_PRICE_CENTS, formatPriceEur } from '@/lib/constants'

/**
 * What ONE purchase of this Kurs costs — the rule behind every price a student
 * sees, in one place.
 *
 * A Kurs sold as a whole is priced by its own `price_cents` column; a Kurs sold
 * Einheit by Einheit is priced by the flat `UNIT_PRICE_CENTS`, which is the
 * amount of the fixed Stripe Price the unit checkout uses. Reading
 * `price_cents` for a `sold_as = 'unit'` Kurs would show a number nobody is
 * ever charged — the column is dormant there.
 */
export function purchasePriceCents(soldAs: KursSoldAs, kursPriceCents: number): number {
  return soldAs === 'kurs' ? kursPriceCents : UNIT_PRICE_CENTS
}

/** The same amount, as it goes on a badge or a button: „€15", „€3". */
export function purchasePriceLabel(soldAs: KursSoldAs, kursPriceCents: number): string {
  return formatPriceEur(purchasePriceCents(soldAs, kursPriceCents))
}
