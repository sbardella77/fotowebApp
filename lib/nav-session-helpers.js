/**
 * SnapRooms — Public nav session helpers.
 *
 * Lightweight utilities used by auth-aware marketing navigation.
 * These helpers are pure and safe to test without a browser.
 */

/**
 * Safely read a fetch Response body as JSON.
 *
 * @param {Response} response
 * @returns {Promise<object>}
 */
export async function safeReadJson(response) {
  try {
    const text = await response.text()
    if (!text) return {}
    return JSON.parse(text)
  } catch {
    return {}
  }
}
