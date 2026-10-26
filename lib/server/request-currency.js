import { headers } from 'next/headers'
import { currencyForCountry } from '@/lib/currency'

/**
 * Display/checkout currency for the current request, from the visitor's
 * country as reported by Vercel's edge (x-vercel-ip-country). Server-only.
 */
export function currencyForHeaders(headerList) {
  return currencyForCountry(headerList?.get('x-vercel-ip-country') || headerList?.get('cf-ipcountry'))
}

export function getRequestCurrency() {
  try {
    return currencyForHeaders(headers())
  } catch {
    return currencyForCountry(null)
  }
}
