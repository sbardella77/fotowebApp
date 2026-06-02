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
export const EVENT_PRICING_LINK_CLICKED = 'pricing_link_clicked'

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

// Photo download quality
export const EVENT_DOWNLOAD_QUALITY_SELECTED = 'download_quality_selected'
export const EVENT_ORIGINAL_DOWNLOAD_UNLOCK_CLICKED = 'original_download_unlock_clicked'
export const EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_STARTED = 'original_download_checkout_started'
export const EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_COMPLETED = 'original_download_checkout_completed'
export const EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_CANCELLED = 'original_download_checkout_cancelled'

// Gallery download
export const EVENT_GALLERY_DOWNLOAD_CLICKED = 'gallery_download_clicked'
export const EVENT_GALLERY_DOWNLOAD_COMPLETED = 'gallery_download_completed'
export const EVENT_GALLERY_DOWNLOAD_BLOCKED = 'gallery_download_blocked'
export const EVENT_BRANDED_PHOTO_DOWNLOADED = 'branded_photo_downloaded'

// Free plan limits
export const EVENT_FREE_ROOM_LIMIT_HIT = 'free_room_limit_hit'
export const EVENT_FREE_PHOTO_LIMIT_HIT = 'free_photo_limit_hit'

// Private professional delivery
export const EVENT_PRIVATE_DELIVERY_VIEWED = 'private_delivery_viewed'
export const EVENT_PRIVATE_DELIVERY_UPLOAD_STARTED = 'private_delivery_upload_started'
export const EVENT_PRIVATE_DELIVERY_UPLOAD_COMPLETED = 'private_delivery_upload_completed'
export const EVENT_PRIVATE_DELIVERY_DOWNLOADED = 'private_delivery_downloaded'
export const EVENT_PRIVATE_DELIVERY_DELETED = 'private_delivery_deleted'

// Photographer upload link
export const EVENT_PHOTOGRAPHER_UPLOAD_LINK_CREATED = 'photographer_upload_link_created'
export const EVENT_PHOTOGRAPHER_UPLOAD_LINK_COPIED = 'photographer_upload_link_copied'
export const EVENT_PHOTOGRAPHER_UPLOAD_LINK_REVOKED = 'photographer_upload_link_revoked'
export const EVENT_PHOTOGRAPHER_UPLOAD_LINK_REGENERATED = 'photographer_upload_link_regenerated'

// Photographer upload
export const EVENT_PHOTOGRAPHER_UPLOAD_STARTED = 'photographer_upload_started'
export const EVENT_PHOTOGRAPHER_UPLOAD_COMPLETED = 'photographer_upload_completed'
export const EVENT_PHOTOGRAPHER_UPLOAD_FAILED = 'photographer_upload_failed'

// Reliability / safety
export const EVENT_RATE_LIMIT_HIT = 'rate_limit_hit'

// Internationalization
export const EVENT_LANGUAGE_SWITCHED = 'language_switched'

// Install / Add to Home Screen
export const EVENT_INSTALL_CTA_VIEWED = 'install_cta_viewed'
export const EVENT_INSTALL_CTA_CLICKED = 'install_cta_clicked'
export const EVENT_INSTALL_PROMPT_ACCEPTED = 'install_prompt_accepted'
export const EVENT_INSTALL_PROMPT_DISMISSED = 'install_prompt_dismissed'
export const EVENT_ADD_TO_HOME_SCREEN_HELP_OPENED = 'add_to_home_screen_help_opened'

// Upsell funnel
export const EVENT_UPSELL_IMPRESSION = 'upsell_impression'
export const EVENT_UPSELL_CLICK = 'upsell_click'
export const EVENT_UPSELL_CHECKOUT_START = 'upsell_checkout_start'
export const EVENT_UPSELL_CONVERSION = 'upsell_conversion'
