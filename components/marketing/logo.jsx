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
 * and a small sparkle accent, in the brand lime — rendered from
 * public/brand/snaprooms-mark.svg, a programmatic derivative of the
 * supplied canonical badge (public/brand/snaprooms-qr-badge.svg) with only
 * its ivory circular backing removed. Single source of truth — do not
 * hand-recreate this per page. The mark carries its own fixed lime fills
 * (not currentColor), so className should only be used for sizing.
 */
export function SnapRoomsIcon({ className = '', 'aria-hidden': ariaHidden = true }) {
  return (
    <img
      src="/brand/snaprooms-mark.svg"
      alt=""
      aria-hidden={ariaHidden}
      className={className}
    />
  )
}

export function SnapRoomsLogo({ variant = 'full', size = 'md', href, className = '' }) {
  const iconSize = ICON_SIZES[size] || ICON_SIZES.md
  const wordmarkSize = WORDMARK_SIZES[size] || WORDMARK_SIZES.md
  const classes = `flex items-center gap-2.5 group ${className}`

  const inner = (
    <>
      <SnapRoomsIcon className={`${iconSize} shrink-0 transition-transform group-hover:scale-105`} />
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
