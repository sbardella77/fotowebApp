# Watermark font

`NotoSans-Regular-latin.ttf` is Noto Sans (Latin subset), © Google LLC,
licensed under the SIL Open Font License 1.1
(https://openfontlicense.org). Copied from the copy Next.js ships in
`next/dist/compiled/@vercel/og/`.

It is used server-side only, by `lib/server/photographer-watermark-render.js`,
to turn watermark text into glyph outlines. Changing this file changes the
rendered output: bump `WATERMARK_FONT_ID` in
`lib/server/photographer-watermark-config.js` when you do.
