# Audit Tecnico Operativo — SnapRooms
**Data:** 2026-05-20  
**Focus:** Rate limiting upload · ZIP streaming · Logging API lente · Vercel Functions Duration / Background jobs  
**Regola:** Nessun refactor massivo. Solo patch minime, quick wins e piano di escalation.

---

## 1. Executive Summary

### Stato generale
L’app ha una base solida (streaming ZIP server-side, skip su foto rotte, rate limiter token-bucket esistente) ma presenta **falle operative gravi in quattro aree** che possono causare timeout, memory spike, spam economico e mancanza totale di visibilità sui malfunzionamenti in produzione.

I problemi non sono architetturali di fondo: sono **difetti di confini non imposti** (limiti mancanti, logging assente, throttling per istanza) che si aggravano linearmente con il numero di foto per evento.

### 3 rischi più importanti
1. **Gallery ZIP senza limiti e senza duration logging** — su eventi con 100+ foto la route rischia timeout Vercel (default 10–60s). Non c’è alcuna telemetria che avverta prima che un utente se ne accorga.
2. **Upload chunk pubblico senza session auth né size enforcement cumulativo** — chiunque conosca un `sessionId` può iniettare chunk illimitati fino a riempire disco/storage, bypassando il limite di 25MB dichiarato in init.
3. **Event delete con cleanup storage sequenziale e unbounded** — la cancellazione di eventi grossi scarica tutte le foto in RAM e poi le cancella una a una in storage. Può superare facilmente il timeout della function.

### 3 quick wins più utili
1. **Aggiungere `maxDuration` e un cap massimo foto sulla route gallery download** (3 minuti di lavoro, elimina il rischio timeout su eventi enormi).
2. **Aggiungere un wrapper di timing su tutte le route di upload complete e gallery download** (10 minuti, dà immediata visibilità sui colli di bottiglia).
3. **Aggiungere rate limiting alla cover upload e un controllo cumulativo chunk-size in `uploadChunk`** (15 minuti, chiude le due falle di spam/storage più economicamente pericolose).

---

## 2. Area 1 — Upload Rate Limiting

### Stato attuale
- Esiste un rate limiter in-memory token-bucket in `lib/server/rate-limiter.js`.
- Viene usato su 4 endpoint pubblici: `init`, `blob`, `chunk`, `complete`.
- Limiti attuali (per IP, 10 min window):
  - `upload-init`: 30 req
  - `upload-blob`: 30 req
  - `upload-chunk`: 200 req
  - `upload-complete`: 30 req
- Le route owner (private delivery, cover) e photographer usano lo **stesso bucket IP** oppure **nessun rate limit** (cover).
- Il limiter è in-memory: su Vercel ogni istanza serverless ha il proprio `Map`, quindi il limite reale è molto più debole di quanto scritto nel codice.

### Gap concreti

| # | Gap | Dove |
|---|-----|------|
| G1 | **Guest chunk upload non verifica session ownership** — chiunque conosca/guessi un `sessionId` può uploadare chunk su una sessione altrui. | `POST /api/uploads/chunk` |
| G2 | **Nessun enforcement cumulativo della dimensione chunk** — il client dichiara `fileSize` in init (max 25MB), ma `uploadChunk` accetta chunk fino a 1MB × 1000 chunk = 1GB potenziale, senza controllare la somma. | `POST /api/uploads/chunk` |
| G3 | **Cover upload senza alcun rate limit** — owner autenticato può bombardare Vercel Blob di cover da 10MB l’una. Le cover vecchie non vengono cancellate (storage leak). | `POST /api/owner/events/:slug/cover` |
| G4 | **Complete non idempotente** — chiamare `completeUpload` N volte crea N record `Photo` identici. Stesso problema su private delivery e photographer complete. | `POST .../complete` |
| G5 | **Nessun rate limit per token / per evento / per owner** — un owner legittimo che carica 30 foto in 10 min esaurisce il proprio bucket IP e blocca ogni altro upload dello stesso IP (inclusi guest dello stesso evento). | Tutti gli upload |
| G6 | **Temp file locali mai puliti** — sessioni abbandonate (init senza complete) lasciano `meta.json` e chunk in `data/uploads/tmp/{sessionId}/` per sempre. | `POST /api/uploads/init` + chunk |

### Rischio reale
- **Spam economico / storage amplification:** un attore con proxy rotation può generare sessioni illimitate, riempire temp locali o Vercel Blob di cover orfane.
- **Integrity corruption:** injection di chunk su sessioni altrui può corrompere file guest.
- **Denial of service owner:** un owner che lavora su più eventi si auto-DoS dopo 30 init in 10 min.

### Patch minime suggerite

**P1A — Session auth su chunk upload (HIGH PRIORITY)**
- In `initUpload`, generare un `sessionSecret` casuale e salvarlo in `meta.json`.
- In `uploadChunk`, richiedere `sessionSecret` nel body e verificarlo contro il file meta. Rifiutare se non matcha.
- *Effort:* low. *Rischio:* low (aggiunge un campo opzionale finché non si rende obbligatorio).

**P1B — Cumulative size enforcement su chunk upload (HIGH PRIORITY)**
- In `uploadChunk`, leggere `meta.json`, sommare le dimensioni dei chunk già ricevuti, rifiutare se il nuovo chunk supererebbe `Math.min(fileSize, MAX_FILE_SIZE_BYTES)`.
- *Effort:* low. *Rischio:* low.

**P1C — Rate limit su cover upload (QUICK WIN)**
- Aggiungere `rateLimit(request, RATE_LIMITS.owner)` o un bucket dedicato `cover-upload:owner:{ownerEmail}` con 10 req / 10 min.
- *Effort:* low. *Rischio:* zero.

**P1D — Idempotency key su complete (MEDIUM PRIORITY)**
- Aggiungere un campo `uploadId` (es. hash del blob pathname o UUID sessione) su `Photo` e `PrivateAsset`.
- In `completeUpload`, fare `upsert` o `findFirst` per quel `uploadId` — se esiste già, ritornare 200 senza duplicare.
- *Effort:* medium. *Rischio:* low.

**P1E — Per-event / per-owner rate limit buckets (MEDIUM PRIORITY)**
- Aggiungere chiavi secondarie:
  - `upload-init:event:{eventSlug}`: 50 req / 10 min (protegge l’evento da flood).
  - `upload-init:owner:{ownerEmail}`: 100 req / 10 min (separa owner da guest).
- Mantenere il bucket IP come rete di sicurezza finale.
- *Effort:* medium. *Rischio:* low.

**P1F — Cleanup temp scaduti (LOW PRIORITY, ma necessario pre-scaling)**
- In `uploadChunk` o in un cron esterno (o al `completeUpload`), cancellare la directory `tmp/{sessionId}` dopo 24h dall’init.
- Quick win: aggiungere `createdAt` in `meta.json` e un semplice cleanup sincrono alla fine di `completeUpload`.
- *Effort:* low. *Rischio:* low.

### Priorità operativa
1. **NOW:** P1A (session auth chunk) + P1B (cumulative size) + P1C (cover rate limit).
2. **SOON:** P1D (idempotency complete) + P1E (per-event/per-owner buckets).
3. **LATER:** P1F (cleanup temp) + migrazione del rate limiter a Redis/Upstash per produzione multi-instance.

---

## 3. Area 2 — ZIP Streaming / Memory Overflow

### Stato attuale
- **Server:** true streaming. Usa `archiver` con `ReadableStream` → `NextResponse` con `data` events piped nel controller.
- **Fetch immagini:** loop `for` sequenziale, una foto alla volta. `getPhotoBuffer` carica l’intera immagine in un `Buffer` via `arrayBuffer()`.
- **Watermark:** se `branded=true`, ogni foto passa per `sharp` (resize badge + composite). CPU-intensive.
- **Error handling:** ogni foto è wrappata in `try/catch`. Se fallisce, viene skippata e il ZIP continua. Se `archive.finalize()` fallisce, viene chiamato `archive.abort()`.
- **Limiti:** nessun limite su numero di foto, dimensione totale ZIP, o max duration della function.
- **Client:** accumula l’intera risposta in `response.blob()` prima di scaricare. Un evento da 500MB scarica 500MB in RAM del browser.

### Gap concreti

| # | Gap | Dove |
|---|-----|------|
| G1 | **Nessun limite numero foto / dimensione ZIP** — un evento Pro con 500 foto genera un ZIP potenzialmente di diversi GB. | `GET /api/download/gallery` |
| G2 | **Nessun `maxDuration` configurato** — la route eredita il default Vercel (10s Hobby / 60s Pro). Con 120 foto a 500ms cad = 60s. Timeout garantito. | `GET /api/download/gallery` |
| G3 | **Nessun logging di durata** — non si sa quanto ci mette in produzione. | `GET /api/download/gallery` |
| G4 | **Client accumula intero ZIP in RAM** — `response.blob()` + `URL.createObjectURL`. Tab crash su ZIP grossi. | `room-page-client.jsx` |
| G5 | **Fetch sequenziale troppo lento** — 200 foto sequenziali su Vercel Blob = molti secondi di I/O inutile. Nessuna concorrenza controllata. | `GET /api/download/gallery` |
| G6 | **Assenza di pruning / batching** — non c’è un modo per scaricare solo le ultime N foto o un range. | API + Client |

### Rischio reale
- **Timeout su eventi popolari:** la route è la più probabile a rompersi silenziosamente in produzione su eventi grossi.
- **Memory spike browser:** il verso client è più pericoloso del server. Un utente con 200 foto ad alta risoluzione vede crashare il tab.
- **Costo nascosto:** ogni timeout genera un errore non loggato (la function viene killata), nessuna traccia di quante foto erano nel mezzo.

### Patch minime suggerite

**P2A — Cap operativo immediato (QUICK WIN)**
- Aggiungere un limite hard: se `photos.length > 200`, ritornare `413 Payload Too Large` (o un errore custom) con un messaggio tipo "Gallery too large, contact support".
- Questo elimina subito il rischio timeout su eventi enormi.
- *Effort:* 2 minuti. *Rischio:* zero.

**P2B — `maxDuration` sulla route gallery (QUICK WIN)**
- Aggiungere in `app/api/download/gallery/route.js`:
  ```js
  export const maxDuration = 60 // o 300 se su Enterprise
  ```
- Se non si vuole dipendere dal piano Vercel, impostare `maxDuration = 60` (massimo sicuro su Pro) e documentare che gallery >200 foto richiede background job.
- *Effort:* 1 minuto. *Rischio:* zero.

**P2C — Logging duration + stats (QUICK WIN)**
- Aggiungere all’inizio della route:
  ```js
  const start = Date.now()
  let processed = 0
  let skipped = 0
  let totalBytes = 0
  ```
- Al `finally` (o prima di `return`):
  ```js
  const duration = Date.now() - start
  console.log(`[gallery-zip] event=${event.slug} photos=${photos.length} processed=${processed} skipped=${skipped} bytes=${totalBytes} durationMs=${duration}`)
  ```
- *Effort:* 5 minuti. *Rischio:* zero.

**P2D — Concurrency limit controllato (MEDIUM PRIORITY)**
- Sostituire il `for` sequenziale con un pool di concorrenza limitata (es. `p-limit` o implementazione custom con `Promise.all` su batch di 3–5 foto).
- Trade-off: riduce il wall-clock time ma aumenta leggermente il picco di memoria (3–5 buffer invece di 1).
- Alternativa più sicura: mantenere sequenziale ma aggiungere ** early abort** se `Date.now() - start > 45000` (per lasciare margine prima del timeout).
- *Effort:* medium. *Rischio:* medium (cambia il comportamento I/O).

**P2E — Client streaming / chunked download (LATER / HIGH EFFORT)**
- Sostituire `response.blob()` con `showSaveFilePicker` + `WritableStream` per scaricare direttamente su disco senza bufferare in RAM.
- Fallback per browser non supportati: mantenere `blob()` ma mostrare warning se gallery >50 foto.
- *Effort:* high. *Rischio:* medium (cambia UX download).

### Priorità operativa
1. **NOW:** P2A (cap 200 foto) + P2B (maxDuration) + P2C (logging duration).
2. **SOON:** P2D (early abort a 45s oppure concurrency limitato).
3. **LATER:** P2E (client streaming) + background job per gallery ZIP (vedi Area 4).

---

## 4. Area 3 — Logging Tempi API Lente

### Stato attuale
- **Nessun logger strutturato** (Pino, Winston, etc.). Solo `console.log` / `console.error`.
- **Solo una route logga durata:** `GET /api/events/:slug` (getEvent).
- **Analytics:** PostHog fire-and-forget su alcune azioni di business (upload started/completed, checkout, etc.) ma **mai** su performance o errori API.
- **Nessun request ID** propagato tra chiamate.
- **Moltissime route hanno ZERO logging** sul happy path e ZERO logging di durata.

### Gap concreti

| # | Gap | Dove |
|---|-----|------|
| G1 | **Upload pipeline completamente al buio** — init, chunk, complete non loggano mai inizio, fine, durata, sessionId, fileSize. | `/api/uploads/*` |
| G2 | **Gallery download senza durata** — logga solo `photos.length` ma non quanto ci mette. | `/api/download/gallery` |
| G3 | **Event delete senza durata** — serial cleanup di storage può essere lentissimo. Nessuna traccia. | `DELETE /api/events/:slug`, `DELETE /api/owner/events/:slug` |
| G4 | **Owner login token fallback O(n×m) non loggato** — loop su 50 eventi × 100 foto ciascuno. Nessun warning se impiega 10s. | `POST /api/owner/session` |
| G5 | **Catch-all error handler troppo povero** — logga solo `[API Route] Error: message`, senza route, method, eventSlug, IP. | `app/api/[[...path]]/route.js` |
| G6 | **N+1 query su listEvents/listOwnerEvents non loggate** — 11 o 51 query Prisma, nessun avviso. | Repository Prisma |

### Rischio reale
- **Cecità operativa totale** — se un utente segnala "lento" o "timeout", non c’è alcun modo di correlare il problema a una route specifica, un evento, o una soglia temporale.
- **Degradazione silenziosa** — un aumento di 500ms per foto nella gallery diventa un aumento di 50s su 100 foto. Senza logging, lo si scopre solo dai reclami.

### Patch minime suggerite

**P3A — Wrapper `withTiming` universale (QUICK WIN)**
- Creare in `lib/server/timing.js`:
  ```js
  export function withTiming(handlerName, fn) {
    return async (...args) => {
      const start = Date.now()
      try {
        const result = await fn(...args)
        const duration = Date.now() - start
        console.log(`[timing] route=${handlerName} durationMs=${duration} status=success`)
        return result
      } catch (err) {
        const duration = Date.now() - start
        console.error(`[timing] route=${handlerName} durationMs=${duration} status=error error=${err.message}`)
        throw err
      }
    }
  }
  ```
- Applicarlo subito alle route più critiche:
  - `initUpload`, `uploadChunk`, `completeUpload`
  - `downloadGallery`, `downloadPhoto`
  - `deleteEvent`, `deleteOwnerEvent`
  - `loginOwner`
- *Effort:* 15 minuti. *Rischio:* zero.

**P3B — Rich logging sulle route pesanti (QUICK WIN)**
- Per `downloadGallery`:
  ```
  [gallery-zip] eventSlug=xxx photos=123 branded=true billingTier=pro processed=123 skipped=0 durationMs=34201
  ```
- Per `deleteEvent`:
  ```
  [event-delete] eventSlug=xxx photosDeleted=89 assetsDeleted=12 durationMs=8702
  ```
- Per `uploadComplete`:
  ```
  [upload-complete] eventSlug=xxx sessionId=xxx fileSize=2456789 durationMs=1200
  ```
- *Effort:* 10 minuti. *Rischio:* zero.

**P3C — Soglie di allarme nel codice (QUICK WIN)**
- Aggiungere nel wrapper `withTiming`:
  ```js
  if (duration > 5000) console.warn(`[timing-slow] route=${handlerName} durationMs=${duration} threshold=5s`)
  if (duration > 10000) console.error(`[timing-critical] route=${handlerName} durationMs=${duration} threshold=10s`)
  ```
- Questo fa apparire warning/evidenti nei log Vercel senza bisogno di dashboard esterne.
- *Effort:* 5 minuti. *Rischio:* zero.

**P3D — Catch-all error handler arricchito (MEDIUM PRIORITY)**
- Nel catch-all di `app/api/[[...path]]/route.js`, loggare:
  ```js
  console.error(`[API Error] method=${req.method} path=${req.nextUrl.pathname} error=${error.message} ip=${ip}`)
  ```
- *Effort:* 5 minuti. *Rischio:* low (potrebbe esporre dati sensibili se non si fa attenzione al payload — loggare solo path e message, mai body).

### Priorità operativa
1. **NOW:** P3A (wrapper withTiming su route critiche) + P3B (rich logging su gallery, delete, upload complete).
2. **SOON:** P3C (soglie 5s/10s) + P3D (catch-all arricchito).
3. **LATER:** Logger strutturato JSON (Pino) + request ID propagation + integrazione con Vercel Log Drains.

---

## 5. Area 4 — Vercel Functions Duration / Background Jobs

### Stato attuale
- **Nessun `vercel.json`** presente.
- **Nessun `maxDuration`** esportato dalle route.
- **Nessun background job / queue / cron** implementato.
- Tutte le API route usano runtime `nodejs` (default).
- Timeout Vercel di default: ~10s (Hobby), 60s (Pro), 300s (Enterprise).

### Route candidate a picchi di Duration

| Route | Perché rischia | Soglia probabile timeout |
|-------|----------------|--------------------------|
| `GET /api/download/gallery` | Loop sequenziale su N foto + fetch HTTP + sharp watermark | 100+ foto su Hobby; 300+ foto su Pro |
| `DELETE /api/events/:slug` | Serial deletion di ogni foto + ogni private asset in storage | 80+ foto / 20+ assets |
| `DELETE /api/owner/events/:slug` | Idem | Idem |
| `POST /api/owner/session` (token fallback) | Loop su 50 eventi, ognuno carica 100 foto in Prisma | Utenti con tanti eventi |
| `POST /api/stripe/webhook` | DB operations + idempotency checks. Generalmente safe ma se aggiunge logiche future... | Basso rischio ora |

### Cosa monitorare in Vercel Dashboard
- **Vercel Dashboard → Functions → Duration**
  - Filtrare per path: `/api/download/gallery`
  - Guardare il **p95 e p99**, non solo la media.
  - Se il p99 supera i **20s**, inizia a essere un problema operativo.
  - Se ci sono **picchi > 50s**, la transizione a background jobs è obbligatoria (non più ottimizzabile).
- **Functions → Errors**
  - Contare i timeout (errore 504 o function killed).
  - Correlare con gli event slug più attivi.
- **Log Drains (se attivo)**
  - Query su `[timing-critical]` e `[timing-slow]` che verranno emessi dopo le patch P3A–P3C.

### Quando il problema richiede background jobs

| Segnale | Azione |
|---------|--------|
| Picchi occasionali > 30s su gallery | Aggiungere `maxDuration=60` + cap foto. Monitorare. |
| Picchi consistenti > 30s o p99 > 20s | Implementare early abort a 45s + notifica utente. |
| **Picchi > 50s** oppure **utenti che superano il cap foto** | **Background job obbligatorio.** |
| Delete event che timeout regolarmente | Background job per cleanup. |

### Piano di escalation

**Fase 0 — ORA (senza background jobs)**
1. Aggiungere `maxDuration = 60` sulla gallery route.
2. Aggiungere cap foto (200) sulla gallery route.
3. Aggiungere early abort nella gallery: se `Date.now() - start > 45000`, `archive.abort()` e ritornare `504` con messaggio "Gallery too large, try again later".
4. Aggiungere timing logging su tutte le route candidate (P3A).

**Fase 1 — SOON (quando i log lo confermano)**
- Se i log mostrano gallery >150 foto che superano 30s, preparare una tabella `jobs` in Prisma:
  ```sql
  Job { id, type, status, eventId, payload, resultUrl, error, createdAt, updatedAt }
  ```
- Implementare un pattern **"enqueue + poll"** minimale:
  - `POST /api/jobs/gallery-zip` crea un record `Job` e ritorna `jobId`.
  - `GET /api/jobs/:jobId` ritorna lo stato.
  - Un cron esterno (Vercel Cron, GitHub Actions, o QStash) esegue il lavoro pesante fuori dalla HTTP request.
- Alternative serverless-friendly: **QStash** (HTTP-based queue, no infra) o **Inngest** (gestisce durable functions su Vercel).

**Fase 2 — LATER (quando il volume lo giustifica)**
- Spostare in background:
  - Gallery ZIP generation
  - Event deletion cleanup
  - Bulk watermarking / export futuri
  - Private delivery batch workflows

### Priorità operativa
1. **NOW:** Fase 0 (maxDuration, cap foto, early abort, timing logging).
2. **SOON:** Definire schema `Job` e valutare QStash vs Inngest vs Vercel Cron per il primo background worker.
3. **LATER:** Implementazione effettiva dei background jobs solo dopo che i log confermano la necessità.

---

## 6. Tabella Finale Priorità

| Azione | Bucket | Effort | Risk | Impatto |
|--------|--------|--------|------|---------|
| P2A — Cap 200 foto su gallery | **NOW** | 2 min | Zero | Alto (elimina timeout) |
| P2B — `maxDuration=60` su gallery | **NOW** | 1 min | Zero | Alto (protegge da kill) |
| P2C — Logging duration gallery | **NOW** | 5 min | Zero | Alto (visibilità) |
| P3A — Wrapper `withTiming` su route critiche | **NOW** | 15 min | Zero | Alto (telemetria) |
| P1C — Rate limit su cover upload | **NOW** | 5 min | Zero | Medio (previene spam) |
| P1B — Cumulative size check chunk | **NOW** | 10 min | Basso | Alto (chiude bypass storage) |
| P1A — Session auth su chunk upload | **NOW** | 15 min | Basso | Alto (chiude injection) |
| P3B — Rich logging su upload/delete | **NOW** | 10 min | Zero | Medio (debuggabilità) |
| P3C — Soglie allarme 5s/10s | **SOON** | 5 min | Zero | Medio (alert proattivo) |
| P1D — Idempotency su complete | **SOON** | 30 min | Basso | Medio (previene duplicati) |
| P2D — Early abort / concurrency limit | **SOON** | 20 min | Medio | Medio (migliora UX) |
| P1E — Per-event/per-owner rate limits | **SOON** | 30 min | Basso | Medio (DoS prevention) |
| P3D — Catch-all error handler arricchito | **SOON** | 5 min | Basso | Medio (debuggabilità) |
| P1F — Cleanup temp scaduti | **LATER** | 20 min | Basso | Basso (pulizia) |
| Schema `Job` + valutazione QStash/Inngest | **LATER** | 2h | Medio | Alto (preparazione scaling) |
| P2E — Client streaming download | **LATER** | 4h | Medio | Alto (UX browser) |
| Redis rate limiter (Upstash) | **LATER** | 1h | Medio | Medio (rate limit cross-instance) |
| Background jobs effettivi (ZIP, delete) | **LATER** | 1–2 giorni | Alto | Alto (scalabilità) |

---

## 7. Piano di Implementazione Priorizzato

### Patch 1 — Protezione immediata gallery (Low Risk / Low Effort)
- **File:** `app/api/download/gallery/route.js`
- **Cosa fare:**
  1. Dopo la query `photos`, aggiungere:
     ```js
     const MAX_GALLERY_PHOTOS = 200
     if (photos.length > MAX_GALLERY_PHOTOS) {
       return NextResponse.json({ error: 'Gallery too large' }, { status: 413 })
     }
     ```
  2. Aggiungere in cima al file:
     ```js
     export const maxDuration = 60
     ```
  3. Aggiungere timing logging con `start`, `processed`, `skipped`, `durationMs`.
- **Tempo stimato:** 10 minuti.
- **Rischio:** Nessuno. Comporta solo un errore anticipato su eventi enormi.

### Patch 2 — Chiudere falle upload (Low Risk / Low-Medium Effort)
- **File:** `app/api/[[...path]]/route.js` (upload handlers) + `lib/server/rate-limiter.js`
- **Cosa fare:**
  1. In `uploadChunk`: leggere `meta.json`, calcolare `alreadyReceivedSize`, rifiutare se `alreadyReceivedSize + chunkBuffer.length > meta.fileSize`.
  2. In `uploadChunk`: aggiungere check di un `sessionSecret` generato in `initUpload`.
  3. In `uploadEventCover`: aggiungere `rateLimit(request, RATE_LIMITS.cover)` con limite 10/10min per owner.
- **Tempo stimato:** 30 minuti.
- **Rischio:** Basso. Attenzione a non rendere obbligatorio il `sessionSecret` per tutti i client esistenti contemporaneamente — fare rollout graduale o assumere che i client supportino un campo extra nel body.

### Patch 3 — Telemetria operativa (Low Risk / Low Effort)
- **File:** nuovo `lib/server/timing.js` + applicazione in `app/api/[[...path]]/route.js` e `app/api/download/*/route.js`
- **Cosa fare:**
  1. Creare `withTiming`.
  2. Wrappare: `initUpload`, `uploadChunk`, `completeUpload`, `downloadGallery`, `downloadPhoto`, `deleteEvent`, `deleteOwnerEvent`, `loginOwner`.
  3. Aggiungere soglie warn/error nel wrapper.
- **Tempo stimato:** 20 minuti.
- **Rischio:** Zero. Solo aggiunta di log.

### Patch 4 — Idempotency upload complete (Low Risk / Medium Effort)
- **File:** Prisma schema + upload complete handlers
- **Cosa fare:**
  1. Aggiungere `uploadId String? @unique` a `Photo` e `PrivateAsset`.
  2. Generare `uploadId` da `sessionId` (o da blob pathname hash) in `completeUpload`.
  3. Usare `prisma.photo.upsert({ where: { uploadId }, create: {...}, update: {...} })` invece di `create` diretto.
- **Tempo stimato:** 45 minuti.
- **Rischio:** Basso. Richiede migration DB.

### Patch 5 — Preparazione background jobs (Medium Risk / Medium Effort)
- **File:** Prisma schema + nuova route `/api/jobs/*`
- **Cosa fare:**
  1. Aggiungere tabella `Job` al Prisma schema.
  2. Creare route `POST /api/jobs/gallery-zip` che accetta `eventSlug`, crea un `Job` in stato `PENDING`, e ritorna `{ jobId }`.
  3. Creare route `GET /api/jobs/:id` che ritorna stato e `resultUrl`.
  4. Valutare QStash (Vercel integration) o Inngest per l’executor.
- **Tempo stimato:** 3–4 ore di design + implementazione base.
- **Rischio:** Medium. Nuova dipendenza e nuovo flusso asincrono. Da fare solo dopo che i log confermano la necessità.

---

## 8. Patch Minime da Implementare Subito (Next Step)

Se devi spingere una PR oggi, queste sono le 4 righe di codice che massimizzano il ROI:

1. **Cap foto gallery + maxDuration** (`app/api/download/gallery/route.js`)
   ```js
   export const maxDuration = 60
   // dopo prisma query:
   if (photos.length > 200) return NextResponse.json({ error: 'Gallery too large' }, { status: 413 })
   ```

2. **Rate limit cover upload** (`app/api/[[...path]]/route.js` → `uploadEventCover`)
   ```js
   await rateLimit(request, RATE_LIMITS.cover || { requests: 10, windowMs: 60000 })
   ```

3. **Cumulative size check chunk** (`uploadChunk` handler)
   ```js
   const meta = await readUploadMeta(sessionId) // funzione esistente
   const receivedSoFar = await getReceivedChunkSize(sessionId) // somma file esistenti in tmp dir
   if (receivedSoFar + chunkBuffer.length > meta.fileSize) {
     return NextResponse.json({ error: 'Chunk exceeds declared file size' }, { status: 413 })
   }
   ```

4. **Timing logging su gallery** (`app/api/download/gallery/route.js`)
   ```js
   const start = Date.now()
   // ... alla fine ...
   console.log(`[gallery-zip] event=${event.slug} photos=${photos.length} durationMs=${Date.now() - start}`)
   ```

**Stima totale next-step:** < 45 minuti di lavoro, zero rischi di rottura, copertura immediata dei 3 rischi più gravi.
