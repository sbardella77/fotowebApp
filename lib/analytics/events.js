/**
 * Centralized product analytics event names for SnapRooms.
 *
 * Rules:
 * - snake_case only
 * - Grouped by product area
 * - No PII in event names
 */

// Landing / acquisition
export const EVENT_LANDING_VIEW = 'landing_view'
export const EVENT_HERO_CTA_CLICKED = 'hero_cta_clicked'
export const EVENT_CREATE_ROOM_CLICKED = 'create_room_clicked'

// Room creation
export const EVENT_ROOM_CREATED = 'room_created'
export const EVENT_OWNER_CLAIM_COMPLETED = 'owner_claim_completed'

// Public room / guest
export const EVENT_ROOM_VIEWED = 'room_viewed'
export const EVENT_SNAP_CTA_CLICKED = 'snap_cta_clicked'
export const EVENT_UPLOAD_CTA_CLICKED = 'upload_cta_clicked'
export const EVENT_UPLOAD_STARTED = 'upload_started'
export const EVENT_UPLOAD_COMPLETED = 'upload_completed'
export const EVENT_SECOND_UPLOAD_COMPLETED = 'second_upload_completed'
export const EVENT_UPLOAD_FILE_REJECTED = 'upload_file_rejected'

// Sharing
export const EVENT_WHATSAPP_SHARE_CLICKED = 'whatsapp_share_clicked'
export const EVENT_NATIVE_SHARE_CLICKED = 'native_share_clicked'
export const EVENT_COPY_LINK_CLICKED = 'copy_link_clicked'
export const EVENT_QR_OPENED = 'qr_opened'

// Owner dashboard
export const EVENT_DASHBOARD_VIEWED = 'dashboard_viewed'
export const EVENT_OWNER_LOGGED_IN = 'owner_logged_in'
export const EVENT_ROOM_SELECTED_IN_DASHBOARD = 'room_selected_in_dashboard'
export const EVENT_ROOM_SHARED_FROM_DASHBOARD = 'room_shared_from_dashboard'
export const EVENT_ROOM_QR_OPENED_FROM_DASHBOARD = 'room_qr_opened_from_dashboard'

// Monetization-ready
export const EVENT_UPGRADE_CLICKED = 'upgrade_clicked'
export const EVENT_CHECKOUT_STARTED = 'checkout_started'
export const EVENT_CHECKOUT_COMPLETED = 'checkout_completed'
export const EVENT_CHECKOUT_CANCELLED = 'checkout_cancelled'

// Reliability / safety
export const EVENT_RATE_LIMIT_HIT = 'rate_limit_hit'
