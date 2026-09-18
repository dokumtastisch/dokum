import { describe, expect, it } from 'vitest'
import { authNotice } from '@/lib/auth-notices'

describe('authNotice', () => {
  it('resolves a known key to its text and tone', () => {
    expect(authNotice('confirm-email')).toMatchObject({ tone: 'notice' })
    expect(authNotice('confirm-email')?.text).toContain('confirmation link')
    expect(authNotice('oauth-failed')).toMatchObject({ tone: 'error' })
  })

  // The whole point of the key indirection: a link can no longer put words of
  // its own choosing into a box on our sign-in page.
  it('shows nothing for an unknown key, a crafted message or none at all', () => {
    expect(authNotice('Your account was suspended, call +49…')).toBeNull()
    expect(authNotice('__proto__')).toBeNull()
    expect(authNotice('')).toBeNull()
    expect(authNotice(undefined)).toBeNull()
  })
})
