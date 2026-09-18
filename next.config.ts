import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Must match MAX_FILE_SIZE_BYTES in src/lib/constants.ts
      bodySizeLimit: '4mb',
    },
  },

  async headers() {
    // Supabase project URL — used to tighten connect-src to the specific project.
    // Falls back to the wildcard if the env var isn't present at build time.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

    const connectSrc = [
      "'self'",
      'https://*.supabase.co',
      'wss://*.supabase.co',
      // Stripe.js + Checkout fetches from the browser
      'https://api.stripe.com',
    ]
    if (supabaseUrl) connectSrc.push(supabaseUrl)

    // Content-Security-Policy notes:
    //   • script-src 'unsafe-inline' — required by Next.js App Router (hydration scripts).
    //     Replace with nonces for a stricter policy in the future.
    //   • script-src 'unsafe-eval' / 'wasm-unsafe-eval' — Turbopack's dev HMR runtime
    //     uses eval() and WebAssembly.compile to load module updates. Dev-only.
    //   • script-src https://js.stripe.com — Stripe.js loader (forward-compat; harmless
    //     for the current redirect-only checkout flow).
    //   • frame-src — Stripe injects iframes from these origins for embedded Elements,
    //     3DS challenges, and post-checkout hooks. 'self' + *.supabase.co additionally
    //     let the admin document preview embed a PDF: it frames /api/file/[docId],
    //     which answers with a 302 to a signed storage URL, and CSP re-checks the
    //     REDIRECT TARGET — so 'self' alone is not enough. Only what this app may
    //     embed; frame-ancestors stays 'none', so nothing may embed this app.
    //   • style-src 'unsafe-inline'  — required by Tailwind v4 and Next.js style injection.
    //   • font-src 'self'            — next/font/google self-hosts fonts at build time;
    //     no external font CDN request is made at runtime.
    //   • form-action — redirect-mode Stripe Checkout is a server 303; including
    //     checkout.stripe.com here keeps form-post fallback paths working too.
    const isDev = process.env.NODE_ENV !== 'production'
    const scriptSrc = ["'self'", "'unsafe-inline'", 'https://js.stripe.com']
    if (isDev) scriptSrc.push("'unsafe-eval'", "'wasm-unsafe-eval'")

    const csp = [
      "default-src 'self'",
      `script-src ${scriptSrc.join(' ')}`,
      "style-src 'self' 'unsafe-inline'",
      `connect-src ${connectSrc.join(' ')}`,
      "font-src 'self'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "frame-src 'self' https://*.supabase.co https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com",
    ].join('; ')

    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent the app from being embedded in iframes (clickjacking defence)
          { key: 'X-Frame-Options', value: 'DENY' },
          // Stop browsers from MIME-sniffing the Content-Type
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Only send the origin as the referrer on cross-origin navigations
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Disable browser features the app does not use
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Enforce HTTPS for 2 years (omit `preload` until the domain is registered
          // at hstspreload.org and you are ready to commit permanently to HTTPS-only)
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ]
  },
};

export default nextConfig;
