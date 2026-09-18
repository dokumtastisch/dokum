/**
 * The messages the login page is allowed to show, and their keys.
 *
 * ⚠ THE URL CARRIES A KEY, NEVER THE TEXT. `/auth/login?notice=confirm-email`
 * is looked up here; `?notice=<anything else>` renders nothing. The page used
 * to print `?message=` verbatim, which meant any link — in an email, in a
 * forum post — could put arbitrary words in a box on our sign-in page, next to
 * our logo, in the app's own voice. That is a phishing surface for the price
 * of a query string, and it exists for no reason: every producer of these
 * messages is code in this repo.
 *
 * `tone` picks between the two boxes the form already has. It is not a new
 * style — „your account is ready" and „that did not work" simply must not look
 * the same.
 *
 * English, like the rest of the student-facing UI (CLAUDE.md). The one German
 * exception on that side is the legal pages, and this is not one.
 */
export type AuthNoticeTone = 'notice' | 'error'

export interface AuthNotice {
  text: string
  tone: AuthNoticeTone
}

const NOTICES = {
  'confirm-email': {
    tone: 'notice',
    text: 'Account created. We sent you a confirmation link — open it, then sign in here. Check your spam folder if it has not arrived.',
  },
  'sign-in-required': {
    tone: 'notice',
    text: 'Sign in or create an account to open this document.',
  },
  'sign-in-to-buy-unit': {
    tone: 'notice',
    text: 'Sign in to unlock this unit.',
  },
  'sign-in-to-buy-kurs': {
    tone: 'notice',
    text: 'Sign in to unlock this course.',
  },
  'account-deleted': {
    tone: 'notice',
    text: 'Your account has been deleted.',
  },
  'consent-withdrawn': {
    tone: 'notice',
    text: 'Consent withdrawn. To request deletion of your data, write to us — the address is on the Impressum page.',
  },
  'oauth-failed': {
    tone: 'error',
    text: 'Social sign-in could not be started. Try again, or use your email and password.',
  },
} as const satisfies Record<string, AuthNotice>

export type AuthNoticeKey = keyof typeof NOTICES

/**
 * `null` for an unknown or missing key — nothing is shown rather than guessed.
 *
 * `Object.hasOwn`, not a plain lookup: `NOTICES['__proto__']` is
 * `Object.prototype`, which is perfectly truthy and would have put an empty
 * box on the page for anyone who typed `?notice=__proto__`.
 */
export function authNotice(key: string | undefined): AuthNotice | null {
  if (!key || !Object.hasOwn(NOTICES, key)) return null
  return (NOTICES as Record<string, AuthNotice>)[key]
}
