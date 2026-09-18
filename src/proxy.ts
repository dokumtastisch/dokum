import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const { pathname } = request.nextUrl

  // Stripe's servers post here with no cookies and no auth; running the
  // session-refresh + redirect logic on them would 302 the webhook into a
  // login page and break signature verification. Skip the proxy entirely.
  if (pathname === '/api/stripe/webhook') return supabaseResponse

  const isAuthPage = pathname.startsWith('/auth')
  const isAdminPage = pathname.startsWith('/admin')
  const isConsentPage = pathname === '/consent'
  const isPublicPage = pathname === '/' || pathname === '/impressum' || pathname === '/datenschutz' || pathname === '/agb' || isConsentPage
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    if (!isAuthPage && !isPublicPage) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth/login'
      return NextResponse.redirect(url)
    }

    return supabaseResponse
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — must not run any other logic between createServerClient and getUser
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (err) {
    console.error('[proxy] getUser failed:', err instanceof Error ? err.message : String(err))
    // Treat as unauthenticated — safe fallback
  }

  // Unauthenticated user trying to access a protected page → redirect to login
  if (!user && !isAuthPage && !isPublicPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    if (pathname.startsWith('/api/pdf/') || pathname.startsWith('/api/file/') || pathname.startsWith('/api/image/')) {
      url.searchParams.set('notice', 'sign-in-required')
    }
    return NextResponse.redirect(url)
  }

  // Authenticated user without admin role trying to access /admin → redirect to home
  if (user && isAdminPage && user.app_metadata?.['role'] !== 'admin') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Authenticated user visiting auth pages → redirect to courses
  if (user && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/kurse'
    return NextResponse.redirect(url)
  }

  // Authenticated non-admin without consent → redirect to /consent
  if (
    user &&
    !isAuthPage &&
    !isPublicPage &&
    user.app_metadata?.['role'] !== 'admin' &&
    !user.user_metadata?.['consent_accepted_at']
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/consent'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

// Tells Next.js to skip Proxy entirely for static assets.
export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
