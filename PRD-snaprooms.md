# PRD — SnapRooms

## 1. Summary

SnapRooms è una piattaforma web per raccogliere, organizzare e condividere le foto scattate dagli ospiti durante un evento (matrimoni, feste, eventi aziendali), senza che gli ospiti debbano installare un'app o creare un account. Questo documento descrive il prodotto così com'è oggi (analizzato dal sito live snaprooms.app e dal codice sorgente), con l'obiettivo di allineare chi lavora al prodotto su cosa fa, per chi, e dove può migliorare.

## 2. Contacts

| Nome | Ruolo | Commento |
|---|---|---|
| *(da compilare)* | Product Owner | Non ho dati certi su chi ricopre questo ruolo: da confermare |
| *(da compilare)* | Engineering lead | Da confermare |

*Questa sezione è un segnaposto: compilala con i nomi reali prima di condividere il documento.*

## 3. Background

Dopo un evento (matrimonio, festa, meeting aziendale), le foto scattate dagli ospiti restano sparse tra WhatsApp, iMessage, Instagram DM ed email. Chi organizza l'evento deve inseguire ogni singolo ospite per settimane per recuperare i ricordi, e molte foto vengono comunque perse o cancellate prima di essere recuperate.

SnapRooms risolve questo problema centralizzando la raccolta in una galleria unica, accessibile via QR-code o link, senza barriere di accesso per chi carica le foto (nessuna app, nessuna registrazione).

*Perché ora:* la diffusione di smartphone con fotocamere di qualità e la familiarità generale con QR-code (accelerata dal periodo post-2020) rendono questo flusso "scansiona e carica" immediatamente comprensibile per qualunque ospite, di qualunque età.

## 4. Objective

**Obiettivo dichiarato dal prodotto (da sito live):** diventare lo strumento di riferimento per raccogliere le foto di un evento, sia per privati (coppie che si sposano, chi organizza una festa) sia per professionisti (fotografi, event planner) che gestiscono eventi per conto di clienti.

**Come beneficia l'azienda:** un modello freemium con upsell naturale — l'evento è gratis da creare, ma le funzionalità che contano davvero per il "ricordo finale" (download ZIP, nessun watermark, archiviazione più lunga) sono a pagamento. Chi organizza eventi professionalmente (fotografi, planner) diventa un cliente ricorrente multi-evento.

**Come beneficia il cliente:** zero attrito per chi carica le foto (il vincolo più critico, perché sono gli ospiti, non il cliente pagante, a dover agire), e un'unica galleria consegnabile invece di ricostruire l'evento da decine di chat.

**Key Results (bozza — da validare con dati reali):**
- *Non ho accesso in questa sessione a dati reali di traffico, conversione o retention (GA4/Stripe non collegati).* Prima di fissare OKR, servono: tasso di conversione evento-gratuito → evento a pagamento, % di eventi che raggiungono un certo numero di foto caricate, retention dei piani Professional/Business su base mensile.
- Obiettivo proposto (da confermare con chi possiede i dati): aumentare la % di eventi gratuiti che fanno upgrade a un piano a pagamento entro i 90 giorni di archiviazione del piano Free.

## 5. Market Segment(s)

Il prodotto serve chi ha il *problema* di raccogliere foto da un gruppo di persone attorno a un evento, non un singolo gruppo demografico. Tre segmenti distinti emergono dal sito e dal codice (route dedicate per ciascuno: `wedding-photo-sharing`, `for-event-planners`, `private-party-landing-page`, `corporate-landing-page`, `photographers-landing-page`):

1. **Privati che organizzano un evento una tantum** — sposi, chi organizza un compleanno o una festa privata. Non tecnici, pagano una volta per evento, sensibili al prezzo ma disposti a pagare per non perdere i ricordi.
   - *Vincolo:* devono convincere gli ospiti a caricare, quindi la barriera d'accesso per l'ospite deve restare a zero.

2. **Fotografi professionisti** — consegnano le foto scattate dagli ospiti (oltre alle proprie) ai loro clienti. Gestiscono più eventi contemporaneamente, serve loro un workspace multi-evento e la possibilità di consegna privata/esclusiva (feature "Private Delivery" e "link upload fotografo" già presenti nel codice: `app/photographer-upload/[token]`).
   - *Vincolo:* hanno bisogno di white-label (rimozione branding SnapRooms) perché consegnano un servizio a marchio proprio.

3. **Event planner e aziende** — gestiscono eventi per conto terzi su scala maggiore (eventi aziendali, serie di eventi ricorrenti). Serve loro analytics e un piano con volumi/supporto dedicato (piano "Business" a prezzo personalizzato).
   - *Vincolo:* decisioni d'acquisto spesso B2B, con esigenze di fatturazione/supporto diverse da un privato.

## 6. Value Proposition(s)

**Per l'ospite che carica foto (non paga, ma è il collo di bottiglia dell'intero prodotto):**
- Nessuna app, nessun account: scansiona il QR e carica. Qualunque frizione qui fa fallire l'intero evento, perché il valore del prodotto dipende dal numero di persone che effettivamente caricano.

**Per chi organizza l'evento (il pagante privato):**
- Guadagna: una galleria unica invece di foto sparse su 5 chat diverse.
- Evita: il lavoro manuale di inseguire ogni ospite per settimane, e la perdita di foto non recuperate in tempo.
- Rispetto ai competitor generici (cartelle condivise Google Photos/Drive): zero necessità che l'ospite abbia un account Google o la app giusta installata.

**Per fotografi ed event planner (il pagante professionale):**
- Guadagna: uno strumento riutilizzabile su ogni evento che gestiscono, con margine di white-label verso i propri clienti.
- Evita: dover costruire/spiegare un proprio sistema di raccolta foto ad ogni evento diverso.
- Differenziatore competitivo: la licenza d'uso commerciale è inclusa nel prezzo (nessuna royalty aggiuntiva dichiarata sul sito), a differenza di strumenti pensati solo per uso personale.

## 7. Solution

### 7.1 UX / Flussi principali (osservati)

- **Flusso ospite:** riceve QR-code/link → apre pagina evento nel browser (nessun login) → scatta/seleziona foto dal telefono → upload diretto. (Implementato via `/api/uploads/init|chunk|complete` e `/api/photographer-upload/[token]/*` nel codice.)
- **Flusso organizzatore privato:** crea evento gratuito → ottiene QR-code da condividere (tavoli, inviti) → segue l'arrivo foto in tempo reale → al termine, scarica la galleria (ZIP solo nei piani a pagamento).
- **Flusso fotografo/planner:** dashboard con più eventi → genera link/QR per ciascun evento → modera le foto caricate → consegna la galleria al cliente finale, eventualmente via "Private Delivery" per consegne esclusive.

### 7.2 Key Features (verificate tra sito e codice)

| Feature | Dove vive nel prodotto |
|---|---|
| Upload senza app/account per gli ospiti | Flusso pubblico evento |
| QR-code / link di condivisione | Generazione evento |
| Galleria in tempo reale | `GET /api/events/:id/photos` |
| Download completo (ZIP) | `GalleryDownloadJob`, piani a pagamento |
| Private Delivery (consegna esclusiva fotografo→cliente) | `app/api/owner/events/:id/private-delivery/*` |
| Link di upload dedicato per fotografi | `app/photographer-upload/[token]` |
| Moderazione foto | `PATCH/DELETE /api/owner/photos`, `/api/admin/photos` |
| Workspace multi-evento con analytics | `app/api/owner/analytics/*`, dashboard owner |
| Pagamenti e upsell (Stripe) | Modelli `StripeWebhookEvent`, `UpsellEvent`, `ExtraFreeEventCheckout` |

### 7.3 Technology (solo dove rilevante)

Next.js (App Router) con un unico handler API catch-all, Prisma/Postgres come storage relazionale (eventi, foto, owner, job di download), upload a chunk verso blob storage, Stripe per pagamenti/abbonamenti. Non è necessario approfondire oltre in un PRD rivolto a stakeholder non tecnici — i dettagli implementativi contano solo dove limitano cosa il prodotto può promettere (es. upload a chunk → upload resiliente anche con connessione instabile a un evento).

### 7.4 Assumptions (da validare)

- **Prezzi non coerenti tra pagine del sito**: la pagina `/pricing` elenca un piano "Professional" a **€79/mese**, mentre la pagina `/for-event-planners` cita un piano "Pro" a **€9/mese** con eventi illimitati. Sono o due piani diversi mal comunicati, o un disallineamento reale da correggere prima che un cliente se ne accorga. *Da verificare con chi gestisce il pricing prima di procedere con qualunque decisione basata su questi numeri.*
- Ho assunto che il pubblico primario degli ospiti non abbia familiarità tecnica: non confermato da ricerche utente, solo dedotto dal design "zero barriere" del prodotto.
- Non ho visibilità su metriche reali (traffico, conversione, churn): le Key Results in sezione 4 sono proposte, non basate su dati.

## 8. Release

Questo documento descrive il prodotto **attualmente in produzione** su snaprooms.app, non una nuova release pianificata. Se l'obiettivo successivo è usarlo come base per pianificare una nuova funzionalità o versione, servirebbe:
- Un brief su cosa cambiare rispetto allo stato attuale qui descritto.
- Allineamento sul disallineamento di prezzo (sezione 7.4) prima di qualunque comunicazione pubblica aggiuntiva.

---

### Note sul metodo

Questo PRD è stato costruito analizzando il sito live (homepage, pricing, pagine segmento matrimoni ed event planner) e incrociando le informazioni con l'implementazione reale nel codice di questo repository (route API, schema Prisma). Non ho avuto accesso a dati di analytics, interviste utente o roadmap interna: le sezioni Contacts, Key Results e parte delle Assumptions sono segnaposto da completare con chi ha questi dati.
