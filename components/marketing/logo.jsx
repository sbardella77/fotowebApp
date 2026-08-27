const ICON_SIZES = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-12 w-12',
}

const WORDMARK_SIZES = {
  sm: 'text-sm',
  md: 'text-[15px]',
  lg: 'text-xl',
}

/**
 * Canonical SnapRooms mark: rounded camera/frame corner brackets, a lens,
 * and a small sparkle accent, in the brand lime. Single source of truth —
 * do not hand-recreate this per page.
 */
export function SnapRoomsIcon({ className = '', 'aria-hidden': ariaHidden = true }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden={ariaHidden}
    >
      {/* Frame brackets */}
      <path
        d="M5 11V5H11M21 5H27V11M27 21V27H21M11 27H5V21"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Lens */}
      <circle cx="16" cy="16" r="4.5" fill="currentColor" />
      {/* Sparkle */}
      <path
        d="M25 4.2L25.9 6.1L27.2 7L25.9 7.9L25 9.8L24.1 7.9L22.8 7L24.1 6.1Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function SnapRoomsLogo({ variant = 'full', size = 'md', href, className = '' }) {
  const iconSize = ICON_SIZES[size] || ICON_SIZES.md
  const wordmarkSize = WORDMARK_SIZES[size] || WORDMARK_SIZES.md
  const classes = `flex items-center gap-2.5 group ${className}`

  const inner = (
    <>
      <SnapRoomsIcon className={`${iconSize} shrink-0 text-accent-dark transition-transform group-hover:scale-105`} />
      {variant === 'full' && (
        <span className={`font-display ${wordmarkSize} font-bold tracking-tight text-foreground`}>
          SnapRooms
        </span>
      )}
    </>
  )

  if (href) {
    return (
      <a href={href} className={classes} aria-label={variant === 'icon' ? 'SnapRooms' : undefined}>
        {inner}
      </a>
    )
  }

  return <span className={classes}>{inner}</span>
}
