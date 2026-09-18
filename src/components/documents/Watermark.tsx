/**
 * The tiled, low-contrast watermark laid over paid document content.
 *
 * A DETERRENT, not a lock — the same stance interactive documents take on
 * text: real selectable, copyable text is the better experience, and the
 * watermark exists to make casual redistribution traceable rather than
 * impossible. It is therefore `pointer-events: none`, so it never gets in the
 * way of selecting the text underneath it (#67).
 */
export function Watermark({ id }: { id: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        userSelect: 'none',
        pointerEvents: 'none',
        cursor: 'default',
      }}
    >
      {Array.from({ length: 24 }, (_, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            top: `${Math.floor(i / 4) * 22 + 5}%`,
            left: `${(i % 4) * 28 - 8}%`,
            transform: 'rotate(-35deg)',
            fontFamily: 'monospace',
            fontSize: '13px',
            fontWeight: 'bold',
            color: 'rgba(0,0,0,0.08)',
            whiteSpace: 'nowrap',
            mixBlendMode: 'multiply',
          }}
        >
          {id}
        </span>
      ))}
    </div>
  )
}
