export function validatePassword(password) {
  const errors = []
  if (password.length < 12) errors.push('At least 12 characters')
  if (!/[A-Z]/.test(password)) errors.push('One uppercase letter')
  if (!/[a-z]/.test(password)) errors.push('One lowercase letter')
  if (!/[0-9]/.test(password)) errors.push('One number')
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('One symbol')
  return { valid: errors.length === 0, errors }
}

function getRandomInt(max) {
  const arr = new Uint32Array(1)
  const webCrypto = typeof globalThis !== 'undefined' && globalThis.crypto
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(arr)
  } else {
    // Fallback for environments without Web Crypto
    arr[0] = Math.floor(Math.random() * 0xFFFFFFFF)
  }
  return arr[0] % max
}

export function generateStrongPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const numbers = '23456789'
  const symbols = '!@#$%^&*-_+=?'
  const all = upper + lower + numbers + symbols

  let password = ''
  password += upper[getRandomInt(upper.length)]
  password += lower[getRandomInt(lower.length)]
  password += numbers[getRandomInt(numbers.length)]
  password += symbols[getRandomInt(symbols.length)]

  for (let i = 4; i < 16; i++) {
    password += all[getRandomInt(all.length)]
  }

  // Fisher-Yates shuffle using CSPRNG
  const chars = password.split('')
  for (let i = chars.length - 1; i > 0; i--) {
    const j = getRandomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join('')
}
