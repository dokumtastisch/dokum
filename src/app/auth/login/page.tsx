import { LoginForm } from '@/components/auth/LoginForm'
import { authNotice } from '@/lib/auth-notices'

interface Props {
  // A KEY, not a message: see auth-notices.ts for why the page refuses to
  // print whatever a link puts in the URL.
  searchParams: Promise<{ notice?: string }>
}

export default async function LoginPage({ searchParams }: Props) {
  const { notice } = await searchParams

  return (
    <main className="-mx-4 flex flex-col items-center justify-center bg-[#fffdf8] px-4 py-10 sm:-mx-8" style={{ minHeight: 'calc(100svh - 66px)' }}>
      <section className="w-full max-w-[430px]">
        <div className="mb-10 text-center">
          <h1 className="text-[2rem] font-black tracking-tight text-gray-950">Welcome to DOKUM</h1>
          <p className="mt-2 text-sm font-medium text-gray-500">
            Structured practice materials for mastering finance courses
          </p>
        </div>
        {process.env.NEXT_PUBLIC_APP_ENV === 'dev' && (
          <div className="mb-6 rounded-md bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-700 ring-1 ring-amber-200">
            Dev Database
          </div>
        )}
        <LoginForm notice={authNotice(notice)} />
      </section>

      <p className="mt-auto max-w-[430px] pt-10 text-center text-sm leading-snug text-gray-500">
        By signing in, you agree to our{' '}
        <a href="/agb" className="underline underline-offset-2">
          Terms
        </a>{' '}
        and{' '}
        <a href="/datenschutz" className="underline underline-offset-2">
          Privacy policy
        </a>
        .
      </p>
    </main>
  )
}
