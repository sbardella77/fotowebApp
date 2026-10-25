# Video, "mi piace" e condivisione social — stack, costi, piano

_Stima del 2026-10-25. Prezzi di listino in USD; verificare prima del lancio._

## 1. Stack attuale (verificato nel codice)

| Livello | Tecnologia | Note rilevanti per i video |
|---|---|---|
| App | Next.js 14 (App Router) su Vercel, Node 24 | Funzioni serverless: niente ffmpeg incluso, limiti di durata/memoria |
| DB | Postgres Neon + Prisma 6 | `Photo` ha solo `mimeType`/`size`/`width`/`height`: nessun campo `durationSec`, `posterUrl`, `mediaType` |
| Storage | Vercel Blob (client upload firmato, `lib/server/blob-upload-token.js`) | Upload diretto browser → Blob, nessun passaggio dalla funzione |
| Immagini | `sharp` → derivato "display" 1600px JPEG q82 (`lib/server/display-derivative.js`) | Pipeline solo-immagini; i video andrebbero rifiutati o rotti |
| Limiti | `MAX_FILE_SIZE_BYTES = 25 MB` (`lib/server/schemas.js`) | Un video da telefono di 30 s supera spesso 25 MB |
| Altro | Upstash rate-limit, Stripe, Resend, PostHog, Sentry | Riutilizzabili così come sono |

Piani e conservazione (da `docs/retention-policy.md`): Free 90 giorni / 50 foto, Pro Event €29 12 mesi,
Wedding Pro €49 24 mesi, Professional/Business finché l'abbonamento è attivo.

## 2. Prezzi unitari usati

| Servizio | Storage | Distribuzione | Transcoding |
|---|---|---|---|
| Vercel Blob (Pro) | $0,023 / GB-mese (5 GB inclusi) | $0,05 / GB (100 GB inclusi); upload client gratuito | — |
| Mux (qualità Basic) | ~$0,0024 / min-mese | ~$0,0008 / min visto (100k min/mese gratis) | Gratis |
| Cloudflare Stream | $5 / 1000 min memorizzati | $1 / 1000 min visti | Gratis |

## 3. Ipotesi

- Foto: originale 4 MB + derivato display 0,35 MB.
- Video: durata media 30 s (limite proposto 60 s), originale ~40 MB (1080p/4K HEVC da telefono),
  anteprima 720p ~6 MB / 30 s.
- Ogni ospite apre la galleria 3 volte e carica ~60 miniature per sessione; riproduce il 30% dei video,
  guardandone in media 20 s. L'owner scarica lo ZIP completo una volta.
- Negli scenari B e C l'originale video resta anche su Blob, per lo ZIP e il download in "qualità originale".

## 4. Costo per evento, sull'intera durata di conservazione

| Evento | Ospiti | Foto | Video | Storage foto | Banda foto | **A** Blob MP4 | **B** Mux | **C** CF Stream | Totale foto + B |
|---|---|---|---|---|---|---|---|---|---|
| S festa privata (Free, 3 mesi) | 30 | 150 | 15 (8 min) | $0,04 | $0,12 | $0,10 | $0,16 | $0,23 | **$0,33** |
| M compleanno (Pro Event, 12 mesi) | 80 | 600 | 60 (30 min) | $0,70 | $0,36 | $1,14 | $2,01 | $3,04 | **$3,08** |
| L matrimonio (Wedding Pro, 24 mesi) | 150 | 1500 | 150 (75 min) | $3,52 | $0,75 | $5,33 | $9,65 | $14,78 | **$13,92** |
| XL corporate (Business, 12 mesi) | 500 | 4000 | 400 (200 min) | $4,69 | $2,32 | $17,46 | $26,85 | $37,09 | **$33,86** |

Modello riproducibile: `python3 -I` sullo script indicato nel PR.

Cosa emerge dai numeri:

1. **Il costo è lo storage, non la banda.** Le gallerie private hanno pochi spettatori, quindi la conservazione
   per 12–24 mesi pesa più delle visualizzazioni. Il piano Wedding Pro (24 mesi) è il più esposto.
2. **Margine.** Pro Event €29 contro ~$3, Wedding Pro €49 contro ~$14 (con Mux): margine sano. Il Free costa
   ~$0,33 a evento, ma senza un limite sui video basta un abuso per far salire i costi: **niente video nel Free**,
   oppure al massimo 5 video da 15 s.
3. **Transcoding.** Con Mux e Cloudflare è gratuito. Con l'opzione A serve generare un'anteprima 720p:
   ffmpeg su una Vercel Function costa circa $0,001–0,003 per video da 30 s, che diventano $0,20–1,20 per
   l'evento XL. È trascurabile, ma bisogna gestire coda e timeout.

## 5. Raccomandazione

- **Fase 1 (MVP): opzione A con Vercel Blob.** I video MP4/MOV vengono caricati con il flusso di client upload
  già esistente. Limiti: 60 s, 150 MB, solo nei piani a pagamento. Il poster si genera lato client
  (frame del `<video>` disegnato su un canvas). La riproduzione usa `<video preload="none" playsinline>`.
  Non servono nuovi fornitori.
- **Fase 2: Mux.** Da adottare quando arrivano lamentele su buffering o compatibilità (ad esempio HEVC su
  Android/desktop), oppure quando i video superano il 20% dei media. Le 100k minuti/mese di distribuzione
  gratuita coprono a lungo la scala attuale, e il transcoding è gratuito.
- Cloudflare Stream conviene solo con molte visualizzazioni e poca conservazione, cioè l'opposto del nostro profilo.

Modifiche necessarie per la Fase 1:

- Schema: `Photo.mediaType` (`IMAGE` | `VIDEO`), `durationSec`, `posterUrl`.
- Limite di dimensione separato per i video.
- Bypass del derivato `sharp` per i video.
- Download ZIP già compatibile, perché copia i byte.

## 6. "Mi piace" (cuore) — implementato in questo branch

- Tabella `PhotoLike(photoId, voterId, createdAt)` con vincolo unico `(photoId, voterId)` e contatore
  denormalizzato `Photo.likeCount`.
- `voterId`: UUID anonimo in un cookie httpOnly `sr_voter` emesso dal server, validato con
  `normalizeContributorId`. Niente login per gli ospiti; unicità best-effort (cancellare i cookie = nuovo voto),
  accettabile perché il like è solo visualizzazione.
- API `PUT`/`DELETE /api/events/[slug]/photos/[photoId]/like` (idempotente, transazione riga + contatore,
  controllo same-origin, rate-limit `photoLike`) e `GET /api/events/[slug]/likes` (i like del votante).
- Migrazione `20261025180000_photo_likes` (solo additiva) — da applicare con `npm run db:migrate:preview`
  / `db:migrate:production`.
- UI: cuore nel lightbox, con doppio tap per il like, e contatore sulle miniature.

## 7. Condivisione social (implementata in questo branch)

- Instagram e TikTok **non hanno un URL di condivisione web**. L'unico modo è il menu di condivisione del sistema
  tramite la Web Share API (`navigator.share({ files })`), supportata da Safari iOS e Chrome Android.
- File condiviso: sempre la rappresentazione *standard* di `/api/download/photo`. Non è mai l'originale, quindi
  il paywall resta intatto, e nelle stanze Free il file porta il branding SnapRooms (effetto virale).
- Desktop / senza Web Share: Facebook (sharer), WhatsApp, X tramite il link della stanza, più "copia link".
  Per Instagram/TikTok il file si salva e l'utente lo pubblica dall'app.
- Safari perde il gesto utente durante il download: il file resta in cache e un secondo tap lo condivide.
- Analytics: evento `media_shared` con `channel` e `media_type`.
