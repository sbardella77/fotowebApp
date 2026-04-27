/**
 * Regression tests for photo-utils logic.
 * Run with: node lib/photo-utils.test.js
 *
 * These tests verify that the photo normalization layer handles all
 * malformed inputs without throwing, and produces expected outputs.
 *
 * NOTE: The implementations below are inline copies of lib/photo-utils.js
 * so this file can run standalone on older Node versions without ES module support.
 */

var BROWSER_SAFE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

var BLOCKED_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/avif',
])

var VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

var isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development'

function logSkip(photo, reason, extra) {
  extra = extra || {}
  if (isDev) {
    console.warn('[photo-utils] skipping invalid photo:', reason, { photo: photo || null, ...extra })
  } else {
    var safeInfo = {
      reason: reason,
      hasId: Boolean(photo && photo.id),
      idType: photo ? typeof photo.id : 'undefined',
      hasUrl: Boolean(photo && photo.url),
      urlType: photo ? typeof photo.url : 'undefined',
      contentType: photo && typeof photo.mimeType === 'string' ? photo.mimeType : undefined,
      createdAtType: photo ? typeof photo.createdAt : 'undefined',
    }
    console.warn('[photo-utils] skip', safeInfo)
  }
}

function normalizePublicPhoto(photo) {
  if (!photo || typeof photo !== 'object') {
    logSkip(photo, 'not-an-object')
    return null
  }

  var id = photo.id
  if (!id || typeof id !== 'string') {
    logSkip(photo, 'missing-id', { idType: typeof id })
    return null
  }
  if (!VALID_ID_PATTERN.test(id)) {
    logSkip(photo, 'invalid-id-format', { id: id })
    return null
  }

  var url = photo.url
  if (!url || typeof url !== 'string') {
    logSkip(photo, 'missing-url', { urlType: typeof url })
    return null
  }

  var trimmedUrl = url.trim()
  if (trimmedUrl.length === 0) {
    logSkip(photo, 'empty-url')
    return null
  }

  if (
    !trimmedUrl.startsWith('http://') &&
    !trimmedUrl.startsWith('https://') &&
    !trimmedUrl.startsWith('blob:') &&
    !trimmedUrl.startsWith('data:') &&
    !trimmedUrl.startsWith('/')
  ) {
    logSkip(photo, 'suspicious-url-prefix', { urlPrefix: trimmedUrl.slice(0, 40) })
    return null
  }

  var mimeType = typeof photo.mimeType === 'string' ? photo.mimeType.toLowerCase() : ''
  if (mimeType) {
    if (BLOCKED_MIME_TYPES.has(mimeType)) {
      logSkip(photo, 'blocked-format', { mimeType: mimeType })
      return null
    }
  }

  var createdAt = null
  if (photo.createdAt != null) {
    var d = new Date(photo.createdAt)
    if (!isNaN(d.getTime())) {
      createdAt = d.toISOString()
    }
  }

  return {
    id: id,
    url: trimmedUrl,
    originalName: typeof photo.originalName === 'string' ? photo.originalName : '',
    uploaderName: typeof photo.uploaderName === 'string' ? photo.uploaderName : '',
    caption: typeof photo.caption === 'string' ? photo.caption : '',
    mimeType: mimeType,
    size: typeof photo.size === 'number' && !isNaN(photo.size) ? photo.size : 0,
    status: typeof photo.status === 'string' ? photo.status : 'VISIBLE',
    createdAt: createdAt,
  }
}

function getRenderablePhotos(photosInput) {
  if (!photosInput) {
    return []
  }
  if (!Array.isArray(photosInput)) {
    console.warn('[photo-utils] expected array, got', typeof photosInput)
    return []
  }
  return photosInput
    .map(normalizePublicPhoto)
    .filter(function (p) { return Boolean(p) })
}

function safeSortPhotos(photos) {
  if (!Array.isArray(photos)) {
    return []
  }
  try {
    return photos.slice().sort(function (left, right) {
      var leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0
      var rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0
      if (isNaN(leftTime) && isNaN(rightTime)) return 0
      if (isNaN(leftTime)) return 1
      if (isNaN(rightTime)) return -1
      return rightTime - leftTime
    })
  } catch (sortError) {
    console.error('[photo-utils] sort failed, returning unsorted', sortError)
    return photos
  }
}

function getSortedRenderablePhotos(photosInput) {
  var valid = getRenderablePhotos(photosInput)
  return safeSortPhotos(valid)
}

// ── Test harness ──────────────────────────────────────────────────────

var passed = 0
var failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (err) {
    failed++
    console.error('  ✗ ' + name)
    console.error('    ' + err.message)
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg + ': expected ' + expected + ', got ' + actual)
  }
}

function assertTrue(value, msg) {
  if (!value) {
    throw new Error(msg + ': expected true, got ' + value)
  }
}

function assertArrayLength(arr, len, msg) {
  if (!Array.isArray(arr)) {
    throw new Error(msg + ': expected array, got ' + typeof arr)
  }
  if (arr.length !== len) {
    throw new Error(msg + ': expected length ' + len + ', got ' + arr.length)
  }
}

console.log('\nRunning photo-utils regression tests...\n')

// ── normalizePublicPhoto ──────────────────────────────────────────────

console.log('normalizePublicPhoto:')

test('returns null for undefined', function () {
  assertEqual(normalizePublicPhoto(undefined), null, 'undefined')
})

test('returns null for null', function () {
  assertEqual(normalizePublicPhoto(null), null, 'null')
})

test('returns null for string', function () {
  assertEqual(normalizePublicPhoto('not-a-photo'), null, 'string')
})

test('returns null for number', function () {
  assertEqual(normalizePublicPhoto(123), null, 'number')
})

test('returns null for missing id', function () {
  assertEqual(normalizePublicPhoto({ url: 'https://example.com/a.jpg' }), null, 'missing id')
})

test('returns null for missing url', function () {
  assertEqual(normalizePublicPhoto({ id: 'abc123' }), null, 'missing url')
})

test('returns null for url that is not a string', function () {
  assertEqual(normalizePublicPhoto({ id: 'abc', url: 123 }), null, 'url number')
})

test('returns null for empty url string', function () {
  assertEqual(normalizePublicPhoto({ id: 'abc', url: '   ' }), null, 'empty url')
})

test('returns null for suspicious url prefix', function () {
  assertEqual(normalizePublicPhoto({ id: 'abc', url: 'javascript:alert(1)' }), null, 'js url')
})

test('returns null for HEIC mimeType', function () {
  assertEqual(
    normalizePublicPhoto({ id: 'abc', url: 'https://example.com/a.heic', mimeType: 'image/heic' }),
    null,
    'heic blocked'
  )
})

test('returns null for HEIF mimeType', function () {
  assertEqual(
    normalizePublicPhoto({ id: 'abc', url: 'https://example.com/a.heif', mimeType: 'image/heif' }),
    null,
    'heif blocked'
  )
})

test('returns null for AVIF mimeType', function () {
  assertEqual(
    normalizePublicPhoto({ id: 'abc', url: 'https://example.com/a.avif', mimeType: 'image/avif' }),
    null,
    'avif blocked'
  )
})

test('accepts valid JPEG photo', function () {
  var result = normalizePublicPhoto({
    id: 'abc123',
    url: 'https://example.com/a.jpg',
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
    createdAt: '2024-01-15T10:00:00.000Z',
  })
  assertTrue(result !== null, 'result not null')
  assertEqual(result.id, 'abc123', 'id')
  assertEqual(result.url, 'https://example.com/a.jpg', 'url')
  assertEqual(result.originalName, 'photo.jpg', 'originalName')
  assertEqual(result.mimeType, 'image/jpeg', 'mimeType')
  assertEqual(result.size, 1024, 'size')
  assertEqual(result.createdAt, '2024-01-15T10:00:00.000Z', 'createdAt')
})

test('accepts relative url path', function () {
  var result = normalizePublicPhoto({
    id: 'abc',
    url: '/uploads/events/test/photo.jpg',
  })
  assertTrue(result !== null, 'relative url accepted')
})

test('accepts blob url', function () {
  var result = normalizePublicPhoto({
    id: 'abc',
    url: 'blob:https://example.com/uuid',
  })
  assertTrue(result !== null, 'blob url accepted')
})

test('accepts data url', function () {
  var result = normalizePublicPhoto({
    id: 'abc',
    url: 'data:image/png;base64,abc123',
  })
  assertTrue(result !== null, 'data url accepted')
})

test('fills defaults for missing optional fields', function () {
  var result = normalizePublicPhoto({
    id: 'abc',
    url: 'https://example.com/a.jpg',
  })
  assertEqual(result.originalName, '', 'default originalName')
  assertEqual(result.uploaderName, '', 'default uploaderName')
  assertEqual(result.caption, '', 'default caption')
  assertEqual(result.size, 0, 'default size')
  assertEqual(result.status, 'VISIBLE', 'default status')
})

test('handles invalid createdAt gracefully', function () {
  var result = normalizePublicPhoto({
    id: 'abc',
    url: 'https://example.com/a.jpg',
    createdAt: 'not-a-date',
  })
  assertTrue(result !== null, 'result not null')
  assertEqual(result.createdAt, null, 'invalid date becomes null')
})

test('handles null createdAt gracefully', function () {
  var result = normalizePublicPhoto({
    id: 'abc',
    url: 'https://example.com/a.jpg',
    createdAt: null,
  })
  assertTrue(result !== null, 'result not null')
  assertEqual(result.createdAt, null, 'null date stays null')
})

// ── getRenderablePhotos ───────────────────────────────────────────────

console.log('\ngetRenderablePhotos:')

test('returns empty array for undefined', function () {
  assertArrayLength(getRenderablePhotos(undefined), 0, 'undefined')
})

test('returns empty array for null', function () {
  assertArrayLength(getRenderablePhotos(null), 0, 'null')
})

test('returns empty array for non-array', function () {
  assertArrayLength(getRenderablePhotos('oops'), 0, 'string')
  assertArrayLength(getRenderablePhotos({}), 0, 'object')
  assertArrayLength(getRenderablePhotos(123), 0, 'number')
})

test('returns empty array for empty array', function () {
  assertArrayLength(getRenderablePhotos([]), 0, 'empty')
})

test('filters out invalid photos and keeps valid ones', function () {
  var result = getRenderablePhotos([
    { id: 'a', url: 'https://example.com/a.jpg' },
    null,
    { id: 'b', url: 'https://example.com/b.png' },
    { id: 'c' },
    { id: 'd', url: 'https://example.com/d.webp', mimeType: 'image/heic' },
  ])
  assertArrayLength(result, 2, 'mixed valid/invalid')
  assertEqual(result[0].id, 'a', 'first valid')
  assertEqual(result[1].id, 'b', 'second valid')
})

// ── safeSortPhotos ────────────────────────────────────────────────────

console.log('\nsafeSortPhotos:')

test('returns empty array for non-array', function () {
  assertArrayLength(safeSortPhotos(undefined), 0, 'undefined')
  assertArrayLength(safeSortPhotos(null), 0, 'null')
  assertArrayLength(safeSortPhotos('oops'), 0, 'string')
})

test('sorts valid photos newest first', function () {
  var photos = [
    { id: 'old', createdAt: '2024-01-10T10:00:00.000Z' },
    { id: 'new', createdAt: '2024-01-15T10:00:00.000Z' },
    { id: 'mid', createdAt: '2024-01-12T10:00:00.000Z' },
  ]
  var sorted = safeSortPhotos(photos)
  assertEqual(sorted[0].id, 'new', 'newest first')
  assertEqual(sorted[1].id, 'mid', 'middle second')
  assertEqual(sorted[2].id, 'old', 'oldest last')
})

test('handles photos with missing createdAt', function () {
  var photos = [
    { id: 'a', createdAt: '2024-01-15T10:00:00.000Z' },
    { id: 'b' },
    { id: 'c', createdAt: null },
  ]
  var sorted = safeSortPhotos(photos)
  assertEqual(sorted[0].id, 'a', 'dated first')
})

test('handles photos with invalid createdAt', function () {
  var photos = [
    { id: 'a', createdAt: '2024-01-15T10:00:00.000Z' },
    { id: 'b', createdAt: 'not-a-date' },
  ]
  var sorted = safeSortPhotos(photos)
  assertEqual(sorted[0].id, 'a', 'valid date first')
})

// ── getSortedRenderablePhotos ─────────────────────────────────────────

console.log('\ngetSortedRenderablePhotos:')

test('full pipeline with mixed input', function () {
  var result = getSortedRenderablePhotos([
    { id: 'old', url: 'https://x.com/old.jpg', createdAt: '2024-01-10T10:00:00.000Z' },
    null,
    { id: 'new', url: 'https://x.com/new.jpg', createdAt: '2024-01-15T10:00:00.000Z' },
    { id: 'bad' },
    { id: 'heic', url: 'https://x.com/h.heic', mimeType: 'image/heic' },
  ])
  assertArrayLength(result, 2, 'pipeline result length')
  assertEqual(result[0].id, 'new', 'newest valid first')
  assertEqual(result[1].id, 'old', 'oldest valid second')
})

// ── Summary ───────────────────────────────────────────────────────────

console.log('\n' + passed + ' passed, ' + failed + ' failed')
if (failed > 0) {
  process.exit(1)
}
