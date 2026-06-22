/**
 * SnapRooms — client-safe pricing configuration.
 *
 * These values are displayed in the UI. They are NOT used for billing;
 * Stripe prices are always read from server-side environment variables.
 */

export const EXTRA_EVENT_PRICE_LABEL =
  process.env.NEXT_PUBLIC_EXTRA_EVENT_PRICE_LABEL || '€4,99 einmalig'
