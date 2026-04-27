/**
 * Stripe server-side client initialization.
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY — Stripe secret key (sk_...)
 */

import Stripe from 'stripe'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY

let stripeInstance = null

export function getStripe() {
  if (!STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  if (!stripeInstance) {
    stripeInstance = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2025-03-31.basil',
    })
  }
  return stripeInstance
}
