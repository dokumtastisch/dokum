// Content-only: the Kurs layout (sidebar + background) is already on screen by
// the time this boundary shows, so a skeleton with its own page chrome would
// draw a second one inside the first.
export default function KursLoading() {
  return (
    <div>
      <div className="h-9 w-72 rounded-md bg-gray-100 animate-pulse" />
      <div className="mt-4 h-4 w-full max-w-lg rounded bg-gray-100 animate-pulse" />
      <div className="mt-2 h-4 w-2/3 max-w-md rounded bg-gray-100 animate-pulse" />
      <div className="mt-10 max-w-2xl space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    </div>
  )
}
