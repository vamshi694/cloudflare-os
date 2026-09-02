// The Legal OS mark: a matter file. A rounded folio with the two rules a signed page carries,
// drawn in one stroke weight so it sits beside Phosphor regular glyphs. `solid` paints the
// folio in the current color and the rules in the inverse, for the sign-in and avatar tiles.
export default function BrandMark({
  size = 20,
  className,
  solid = false,
}: {
  size?: number
  className?: string
  solid?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {solid ? (
        <>
          <path d="M5 3.5h9.5L19 8v12.5H5z" fill="currentColor" />
          <path d="M8.5 12.5h7M8.5 16.5h4.5" stroke="var(--color-kumo-base, #fff)" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M5 3.5h9.5L19 8v12.5H5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M14.5 3.5V8H19" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8.5 12.5h7M8.5 16.5h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
