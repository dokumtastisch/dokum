// Content-only — see the Kurs loading boundary: the sidebar and the page
// background belong to the Kurs layout and are already painted.
export default function UnitLoading() {
  return (
    <div>
      <div className="h-9 w-80 rounded-md bg-gray-100 animate-pulse" />
      <div className="mt-4 h-4 w-2/3 max-w-md rounded bg-gray-100 animate-pulse" />
      <div className="mt-8 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 rounded-md bg-gray-100 animate-pulse" />
        ))}
      </div>
    </div>
  )
}
