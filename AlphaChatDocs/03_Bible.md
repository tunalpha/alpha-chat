# Alpha Chat Bible
### La Costituzione del Prodotto — Regole che Non Si Negoziano
> Versione 1.0 — Luglio 2025
> Queste regole governano ogni decisione di engineering, design e prodotto.
> Una funzionalità che viola anche una sola regola non viene rilasciata.
> Un bug che viola una regola è un bug critico — blocca il rilascio.

---

## Come Usare Questo Documento

La Bible non è una lista di desideri. È una lista di vincoli verificabili.

Per ogni regola esiste un **test di accettazione**: un modo concreto per verificare se la regola è soddisfatta. Prima di ogni release, ogni regola viene verificata. Una sola regola non soddisfatta = release bloccata.

Le regole sono organizzate in 10 categorie. Ogni regola ha:
- Un **numero progressivo** (REG-XXX) — il riferimento permanente in code review, ticket, e discussioni
- Una **dichiarazione** — la regola in una frase
- Una **motivazione** — perché esiste questa regola
- Un **test di accettazione** — come si verifica

---

## Indice

1. [Navigazione](#categoria-1--navigazione)
2. [Caricamento e Stati Vuoti](#categoria-2--caricamento-e-stati-vuoti)
3. [Errori](#categoria-3--errori)
4. [Messaggi e Affidabilità](#categoria-4--messaggi-e-affidabilità)
5. [Offline e Connettività](#categoria-5--offline-e-connettività)
6. [Performance](#categoria-6--performance)
7. [Animazioni](#categoria-7--animazioni)
8. [Privacy e Sicurezza](#categoria-8--privacy-e-sicurezza)
9. [Accessibilità](#categoria-9--accessibilità)
10. [Dati e Integrità](#categoria-10--dati-e-integrità)

---

## Categoria 1 — Navigazione

---

### REG-001
**Mai più di 3 tocchi per iniziare una nuova conversazione.**

**Motivazione:** La funzione principale di una chat app è comunicare. Se l'azione più frequente richiede più di 3 tocchi, il prodotto ha un problema di design fondamentale.

**Percorso attuale (3 tocchi):**
1. Tocco sul bottone "+" o "Nuova chat" (Home)
2. Ricerca o selezione contatto
3. Tocco sul contatto → apre la chat

**Test di accettazione:** Partendo dalla home screen con l'app aperta, un tester conta il numero di tocchi per inviare il primo messaggio a un contatto esistente. Il numero deve essere ≤ 3. Se supera 3, il design è non conforme.

---

### REG-002
**Mai più di 2 tocchi per inviare una foto dalla galleria.**

**Motivazione:** L'invio di media è la seconda azione più frequente in una chat. Ogni tocco aggiuntivo è attrito che riduce il tasso di utilizzo.

**Percorso attuale (2 tocchi) — da conversazione aperta:**
1. Tocco sull'icona allegati (o tocco sul campo input → icona galleria)
2. Selezione foto dalla galleria → invio automatico con conferma in-line

**Test di accettazione:** Da una conversazione aperta, un tester conta i tocchi per inviare una foto già presente nella galleria. Il numero deve essere ≤ 2 (escluso il tocco iniziale di apertura della tastiera/input se già visibile). Se supera 2, non conforme.

---

### REG-003
**Mai più di 2 tocchi per silenziare una conversazione.**

**Motivazione:** Il silenzio è una funzione di protezione dell'attenzione. Deve essere immediato.

**Percorso:** Swipe left sulla conversazione nella lista → icona mute → tap. Oppure: long press sulla conversazione → "Silenzia".

**Test di accettazione:** Da lista conversazioni, un tester silenzia una chat in ≤ 2 tocchi.

---

### REG-004
**Ogni schermata ha esattamente un'azione primaria visivamente dominante.**

**Motivazione:** Troppe CTA equivalenti costringono l'utente a decidere cosa fare. Una CTA primaria guida. Le secondarie sono disponibili ma non competono visivamente.

**Test di accettazione:** In ogni schermata, l'azione primaria è identificabile senza ambiguità entro 2 secondi da un tester che vede la schermata per la prima volta. Se un tester indica azioni diverse, la gerarchia non è chiara.

---

### REG-005
**Il tasto Back / swipe indietro funziona sempre, in ogni schermata, in ogni stato.**

**Motivazione:** L'utente non deve mai sentirsi intrappolato in una schermata. Nessun modal, nessun flusso, nessun errore blocca la navigazione indietro.

**Eccezioni ammesse:** Durante una chiamata attiva, il back non termina la chiamata — riduce a overlay. Questo è l'unico caso documentato.

**Test di accettazione:** In ogni schermata dell'app, inclusi modal, bottom sheet, flussi di onboarding e stati di errore, il gesto di swipe back (iOS) o il bottone back (Android) produce navigazione indietro o riduzione a overlay (solo chiamata). Mai un comportamento nullo o un crash.

---

### REG-006
**La lista conversazioni è raggiungibile in 1 tocco da qualsiasi punto dell'app.**

**Motivazione:** La home è il punto di riferimento. L'utente deve poterci tornare immediatamente.

**Implementazione:** Tab bar sempre visibile. Il tap sul tab "Chat" già attivo porta in cima alla lista (scroll top).

**Test di accettazione:** Da qualsiasi schermata dell'app (profilo, impostazioni, chiamata ridotta a overlay, chat aperta), un singolo tocco sul tab Chat porta alla lista conversazioni.

---

### REG-007
**Nessun percorso di navigazione richiede più di 5 tocchi per raggiungere qualsiasi funzione.**

**Motivazione:** Ogni funzione nell'app, per quanto rara, deve essere raggiungibile. 5 tocchi è il massimo accettabile per le funzioni più profonde (impostazioni avanzate di privacy).

**Test di accettazione:** Mappare l'intero albero di navigazione. Nessun nodo deve essere a profondità > 5 dalla home screen.

---

## Categoria 2 — Caricamento e Stati Vuoti

---

### REG-008
**Nessuna schermata rimane mai completamente bianca o vuota.**

**Motivazione:** Una schermata bianca comunica "l'app è rotta". Anche durante il caricamento, l'utente vede struttura — skeleton screen — che comunica "sto caricando".

**Test di accettazione:** Aprire ogni schermata dell'app con connessione lenta simulata (Network Link Conditioner: 3G). Nessuna schermata mostra uno sfondo bianco/scuro senza contenuto o struttura visibile per più di 100ms dopo la transizione.

---

### REG-009
**I skeleton screen rispecchiano esattamente il layout del contenuto che arriverà.**

**Motivazione:** Uno skeleton generico (tre righe orizzontali uguali) non prepara l'occhio al layout reale. Lo skeleton deve essere una "silhouette" del contenuto, così la transizione skeleton → contenuto è fluida e non causa layout shift.

**Test di accettazione:** Sovrapporre uno screenshot del skeleton con uno screenshot del contenuto reale (stessa schermata). La struttura geometrica (posizione avatar, larghezze relative, numero righe) deve coincidere.

---

### REG-010
**Gli empty state comunicano cosa fare, non solo che non c'è nulla.**

**Motivazione:** "Nessun messaggio" è un'opportunità persa. "Nessuna chat ancora — cerca un contatto per iniziare" guida l'azione successiva.

**Struttura ogni empty state:**
- Icona Phosphor Duotone (64px, colore dim)
- Titolo breve (text-md-semibold)
- Sottotitolo con istruzione concreta (text-sm, colore dim)
- CTA opzionale se l'azione è immediata

**Test di accettazione:** Ogni empty state nell'app include: icona, titolo, descrizione con azione suggerita. Verificato su: lista chat vuota, nessun contatto, nessun risultato ricerca, galleria vuota, nessuna notifica.

---

### REG-011
**Mai usare uno spinner rotante come unico indicatore di caricamento per contenuti strutturati.**

**Motivazione:** Lo spinner comunica "aspetta" senza dare informazioni sulla struttura che arriverà. Il skeleton è sempre preferibile per contenuti con layout prevedibile.

**Eccezioni ammesse:** 
- Spinner per operazioni brevi e puntuali (invio form, autenticazione) dove il risultato non ha struttura prevedibile
- Spinner per upload/download con percentuale di progresso
- Loading indicator in navigation bar per operazioni background

**Test di accettazione:** Identificare ogni caso di spinner nell'app. Verificare che non sostituisca un skeleton screen per contenuti strutturati (liste, chat, profili).

---

### REG-012
**Il progresso di ogni operazione lunga è visibile all'utente.**

**Motivazione:** Upload di un file da 50MB senza progress bar = l'utente non sa se l'app sta funzionando.

**Operazioni che richiedono progress indicator:**
- Upload media (barra di progresso lineare sulla preview del media nella bubble)
- Download media (barra circolare sull'icona del documento)
- Backup export (schermata dedicata con percentuale)

**Test di accettazione:** Per ogni upload/download > 5MB, l'utente vede un indicatore di progresso che si aggiorna almeno ogni 500ms.

---

## Categoria 3 — Errori

---

### REG-013
**Ogni messaggio di errore spiega: (1) cosa è successo, (2) cosa può fare l'utente.**

**Motivazione:** Un errore senza azione è una dead end. L'utente non sa se riprovare, attendere, o andarsene.

**Struttura:**
```
[Cosa è successo]: "Messaggio non inviato."
[Cosa fare]: "Riprova" (bottone) o "Controlla la connessione."
```

**Test di accettazione:** Elencare tutti i messaggi di errore nell'app. Verificare che ognuno contenga entrambi i componenti. Qualsiasi errore che mostra solo "Errore" o "Qualcosa è andato storto" senza azione è non conforme.

---

### REG-014
**Mai mostrare codici di errore HTTP, stack trace, o messaggi tecnici all'utente.**

**Motivazione:** "Error 500: Internal Server Error" non significa nulla per un utente. "Qualcosa è andato storto. Riprova tra poco." è comprensibile.

**Implementazione:** Il backend ritorna errori strutturati `{ "error": "message_send_failed", "message": "Messaggio non inviato." }`. Il frontend usa la stringa `message` — mai il codice HTTP, mai il campo `error` tecnico.

**Test di accettazione:** Simulare ogni tipo di errore API (401, 403, 404, 429, 500, timeout, no network). Verificare che l'UI mostri in ogni caso testo comprensibile in italiano, senza codici tecnici.

---

### REG-015
**Gli errori di validazione form indicano esattamente quale campo è sbagliato e perché.**

**Motivazione:** "Email non valida" sotto il campo email è informazione utile. "Dati non validi" sotto un form con 5 campi è inutile.

**Test di accettazione:** In ogni form dell'app (registrazione, cambio password, modifica profilo), inserire dati invalidi. Verificare che l'errore appaia inline sotto il campo specifico, non in un toast generico sopra il form.

---

### REG-016
**Un errore di rete non cancella i dati inseriti dall'utente.**

**Motivazione:** L'utente scrive un messaggio lungo, preme invia, la rete cade — il messaggio sparisce. È uno dei casi più frustranti nell'UX delle app.

**Implementazione:** Il messaggio rimane nel campo input in stato "failed" con pulsante retry. Solo l'utente decide se cancellarlo.

**Test di accettazione:** Scrivere un messaggio, disabilitare la rete, premere invio. Il messaggio rimane visibile nell'input o nella chat come "non inviato" con opzione retry. Non scompare mai silenziosamente.

---

### REG-017
**Gli errori di autenticazione (sessione scaduta) reindirizzano al login senza perdere il contesto.**

**Motivazione:** La sessione scade mentre l'utente stava leggendo una chat. Il sistema lo rimanda al login. Dopo il login, deve tornare esattamente dove era.

**Implementazione:** Deep link della schermata attiva salvato prima del redirect al login. Dopo autenticazione riuscita, redirect al deep link salvato.

**Test di accettazione:** Con un token scaduto artificialmente, aprire una chat specifica. Il sistema mostra la schermata di login. Dopo il login, l'utente si trova nella stessa chat, nello stesso punto di scroll.

---

## Categoria 4 — Messaggi e Affidabilità

---

### REG-018
**Un messaggio inviato non si perde mai.**

**Motivazione:** Questa è la regola più importante della chat. Un sistema di messaging che perde messaggi non è un sistema di messaging.

**Implementazione tecnica:**
- Ogni messaggio ha un `client_message_id` UUID v4 generato dal client prima dell'invio
- Il messaggio è salvato localmente prima di essere inviato al server
- Se l'invio fallisce, il messaggio rimane in stato "non inviato" con retry automatico
- Il retry avviene automaticamente alla prossima connessione disponibile
- Il server è idempotente: lo stesso `client_message_id` produce sempre lo stesso risultato

**Test di accettazione:** Inviare 100 messaggi simulando interruzioni di rete casuali. Tutti i 100 messaggi devono arrivare al destinatario, senza duplicati, nell'ordine corretto.

---

### REG-019
**L'utente vede immediatamente il proprio messaggio dopo l'invio (optimistic update).**

**Motivazione:** Attendere la conferma del server prima di mostrare il messaggio introduce latenza percepita. Il messaggio appare in < 50ms dal tocco "invia".

**Implementazione:** Il messaggio viene aggiunto alla UI localmente con stato "in invio" (icona orologio) prima della risposta del server. Alla conferma del server: transizione a "inviato" (spunta). In caso di errore: transizione a "non inviato" (icona errore + retry).

**Test di accettazione:** Misurare il tempo tra il tocco "invia" e la comparsa del messaggio nella chat. Deve essere < 50ms in ogni condizione di rete (inclusa rete assente — il messaggio appare immediatamente come "in coda").

---

### REG-020
**I messaggi sono sempre nell'ordine corretto, su tutti i device, per tutti gli utenti.**

**Motivazione:** Messaggi in ordine sbagliato rendono la conversazione incomprensibile.

**Implementazione:** Ogni messaggio ha un `sequence_number` monotonic incrementale per conversazione, assegnato dal server. L'ordinamento nella UI usa `sequence_number`, non `created_at`. Due messaggi con lo stesso `sequence_number` non possono esistere (constraint unico in MongoDB su `{conversation_id, sequence_number}`).

**Test di accettazione:** Due utenti inviano messaggi contemporaneamente dalla stessa conversazione per 60 secondi. Verificare che l'ordine dei messaggi sia identico su entrambi i device e non contenga duplicati o gap.

---

### REG-021
**I delivery status (inviato / consegnato / letto) sono sempre accurati.**

**Motivazione:** Una spunta di lettura che appare quando il messaggio non è stato letto è peggio di non averla.

**Definizioni precise:**
- **Inviato** (✓ grigio): il server ha ricevuto e salvato il messaggio
- **Consegnato** (✓✓ grigio): il messaggio è stato scaricato dal device del destinatario
- **Letto** (✓✓ viola): l'utente ha aperto la conversazione e il messaggio era visibile nel viewport

**Test di accettazione:** Verificare ognuno dei tre stati in modo isolato. In particolare: "letto" non appare se l'utente ha ricevuto una push notification ma non ha aperto la chat.

---

### REG-022
**I messaggi eliminati per tutti scompaiono entro 3 secondi su tutti i device connessi.**

**Motivazione:** Un messaggio eliminato che rimane visibile per 30 secondi vanifica la funzionalità.

**Test di accettazione:** Con due device connessi alla stessa conversazione, eliminare un messaggio "per tutti". Misurare il tempo tra la conferma dell'eliminazione e la scomparsa del messaggio sull'altro device. Deve essere < 3 secondi.

---

### REG-023
**I messaggi di risposta (reply) mostrano sempre un'anteprima corretta, anche se il messaggio originale è stato eliminato.**

**Motivazione:** Il contesto della risposta non sparisce con il messaggio originale.

**Comportamento definito:**
- Messaggio originale presente: anteprima con testo/media + nome mittente
- Messaggio originale eliminato "per tutti": anteprima "Messaggio eliminato" in corsivo
- Messaggio originale eliminato "solo per me" dall'utente che legge: anteprima "Messaggio non disponibile" (solo per quell'utente)

**Test di accettazione:** Rispondere a un messaggio, poi eliminarlo "per tutti". Il messaggio di risposta mostra "Messaggio eliminato" — non un riferimento vuoto, non un crash, non il testo del messaggio eliminato.

---

### REG-024
**I messaggi con media mostrano sempre la thumbnail prima che il file sia scaricato.**

**Motivazione:** Una box grigia vuota mentre il video si scarica è peggio di una thumbnail sfocata.

**Implementazione:** Il mittente invia la thumbnail insieme al messaggio (generata lato client prima dell'upload). La thumbnail è visibile istantaneamente per il destinatario. Il media full-res si scarica in background.

**Test di accettazione:** Inviare un video. Sul device del destinatario, la thumbnail del video è visibile entro 2 secondi dall'invio, indipendentemente dalla velocità di download del video completo.

---

## Categoria 5 — Offline e Connettività

---

### REG-025
**L'app è utilizzabile senza connessione per leggere le conversazioni già scaricate.**

**Motivazione:** Essere in aereo, in metro, o in una zona senza segnale non deve rendere l'app inutilizzabile.

**Cosa funziona offline:**
- Lettura di tutte le conversazioni già scaricate
- Scrittura di messaggi (salvati in coda locale)
- Visualizzazione di media già scaricati
- Navigazione tra schermate

**Cosa non funziona offline (e lo comunica chiaramente):**
- Invio messaggi (in coda, inviati alla riconnessione)
- Caricamento nuove conversazioni
- Ricerca globale

**Test di accettazione:** Disabilitare completamente la rete. Aprire l'app. Verificare che le conversazioni già caricate siano leggibili, che sia possibile scrivere messaggi (che appaiono come "in coda"), e che nessuna schermata mostri errori bloccanti.

---

### REG-026
**Il banner "Nessuna connessione" appare entro 3 secondi dalla perdita di rete e scompare entro 2 secondi dal ripristino.**

**Motivazione:** L'utente deve sapere immediatamente quando è offline — non scoprirlo da un errore di invio.

**Design banner:** Striscia sottile (32px) in cima alla chat, colore `--color-warning`, testo "Nessuna connessione" con icona wifi-slash. Appare con slide-down (200ms). Scompare con slide-up (200ms) e mostra brevemente (1s) un banner verde "Connessione ripristinata".

**Test di accettazione:** Con l'app aperta in una conversazione, disabilitare la rete. Il banner arancione appare entro 3 secondi. Riabilitare la rete: il banner scompare entro 2 secondi e appare brevemente il banner verde.

---

### REG-027
**I messaggi in coda offline vengono inviati automaticamente al ripristino della connessione, nell'ordine in cui sono stati scritti.**

**Motivazione:** L'utente ha scritto 5 messaggi offline. Alla riconnessione, tutti e 5 appaiono nell'ordine corretto, senza che l'utente debba fare nulla.

**Test di accettazione:** Scrivere 5 messaggi offline in sequenza. Ripristinare la connessione. Tutti e 5 i messaggi arrivano al destinatario nell'ordine corretto, senza duplicati, entro 10 secondi dal ripristino.

---

### REG-028
**Le chiamate mostrano un feedback esplicito quando la qualità audio/video è degradata.**

**Motivazione:** L'utente non sa se il silenzio è intenzionale o è la rete.

**Soglie e indicatori:**
- Packet loss > 5%: icona segnale degradato (gialla) in corner
- Packet loss > 15%: banner "Connessione instabile — qualità ridotta"
- Packet loss > 30%: banner "Connessione molto debole" + switch automatico a solo audio se era videochiamata

**Test di accettazione:** Simulare packet loss crescente durante una chiamata. Verificare che i tre livelli di feedback appaiano alle soglie corrette.

---

## Categoria 6 — Performance

---

### REG-029
**La lista messaggi scorre a 60fps su iPhone 12 e su un dispositivo Android equivalente (Pixel 6a o superiore).**

**Motivazione:** Lo scroll della chat è l'interazione più frequente dell'app. Deve essere fluido senza eccezioni.

**Implementazione:** Virtualizzazione obbligatoria (`FlashList` di Shopify, che supera `FlatList` in performance). Nessun componente nella lista esegue calcoli pesanti nel thread principale. Le immagini sono pre-caricate nelle dimensioni di display, non ridimensionate al volo.

**Test di accettazione:** Aprire una conversazione con 500+ messaggi (inclusi media). Scorrere velocemente per 30 secondi. Nessun frame drop rilevabile a occhio nudo. Verifica strumentale: FPS medio ≥ 58 durante lo scroll.

---

### REG-030
**L'app raggiunge la schermata home in meno di 2 secondi su 4G (da cold start).**

**Motivazione:** 2 secondi è il threshold oltre il quale gli utenti percepiscono l'app come "lenta".

**Breakdown temporale target:**
- Splash screen: 0ms → 300ms (istantanea)
- Auth check: 300ms → 600ms
- Lista conversazioni (dati locali): 600ms → 1000ms
- Lista conversazioni (aggiornamento server): background, non blocca UI

**Test di accettazione:** Cold start su iPhone 12 e Pixel 6a con connessione 4G (20Mbps down, 10Mbps up, latenza 50ms simulata). Misurare il tempo tra il tap sull'icona e la visibilità della lista conversazioni. Target: < 2000ms. Se > 2000ms: analisi profiling obbligatoria.

---

### REG-031
**Un messaggio di testo inviato appare nella UI del mittente in meno di 50ms dal tocco.**

**Motivazione:** La latenza percepita del messaging è zero. L'utente vede il proprio messaggio immediatamente (optimistic update, REG-019). Questo test misura la performance dell'optimistic update, non il round-trip di rete.

**Test di accettazione:** Con strumenti di profiling (React Native DevTools, Xcode Instruments), misurare il tempo tra l'evento touch sul bottone invia e il re-render della lista con il nuovo messaggio. Target: < 50ms.

---

### REG-032
**Le immagini nella chat caricano la thumbnail in meno di 500ms su 4G.**

**Motivazione:** Una colonna di immagini che si caricano lentamente rende la chat inutilizzabile.

**Implementazione:** Le thumbnail sono < 10KB (JPEG qualità 40, max 200×200px). Sono servite da CDN Cloudflare con cache aggressiva. Il client le fa prefetch durante lo scroll (carica le prossime 5 immagini fuori viewport).

**Test di accettazione:** Aprire una conversazione con 20 immagini. Misurare il tempo di caricamento di ogni thumbnail. Il 95° percentile deve essere < 500ms su 4G simulato.

---

### REG-033
**Le query MongoDB principali hanno P99 < 50ms in produzione.**

**Motivazione:** Le query lente si accumulano e degradano l'esperienza di tutti gli utenti, non solo di chi esegue la query.

**Query monitorate (in ordine di frequenza):**
1. Fetch lista conversazioni per utente
2. Fetch messaggi paginati per conversazione
3. Lookup sessione per refresh token
4. Fetch profilo utente per ID
5. Verifica blocco utente in conversations

**Test di accettazione:** In staging con dataset rappresentativo (10K utenti, 1M messaggi), eseguire le 5 query con MongoDB Atlas Performance Advisor. P99 di ogni query < 50ms. Se una query supera 50ms: aggiungere o ottimizzare l'indice prima del rilascio.

---

## Categoria 7 — Animazioni

---

### REG-034
**Nessuna animazione dura più di 350ms.**

**Motivazione:** Le animazioni esistono per comunicare, non per impressionare. Un'animazione di 600ms è un'interruzione. Una di 200ms è una comunicazione.

**Test di accettazione:** Usare slow-motion (strumenti di profiling o registrazione a 240fps) per verificare la durata di ogni animazione nell'app. Qualsiasi animazione > 350ms è non conforme.

---

### REG-035
**Ogni animazione ha uno scopo comunicativo dichiarato.**

**Motivazione:** "Animazione perché è bella" non è una motivazione accettabile. Ogni animazione deve comunicare: orientamento nello spazio, feedback di un'azione, transizione di stato.

**Tabella di accettazione:**

| Animazione | Scopo dichiarato | Conforme |
|---|---|---|
| Slide chat da lista | Orientamento: sto andando "dentro" | ✅ |
| Bubble messaggio che appare | Feedback: il messaggio è stato inviato | ✅ |
| Shimmer skeleton | Comunicazione: sta caricando | ✅ |
| Logo che ruota 360° al lancio | Nessuno (decorativo) | ❌ |
| Bounce del typing indicator | Comunicazione: l'altro sta scrivendo | ✅ |

**Test di accettazione:** Per ogni animazione, il designer o developer che la ha implementata documenta il suo scopo in una riga. Se non riesce a documentarlo, l'animazione viene rimossa.

---

### REG-036
**Le animazioni non bloccano l'interazione dell'utente.**

**Motivazione:** L'utente non deve aspettare che un'animazione finisca prima di poter toccare qualcosa.

**Implementazione:** Tutte le animazioni usano la UI thread nativa (Reanimated 3 con `useSharedValue`, non `Animated.Value`). Nessuna animazione JS-driven per interazioni critiche.

**Test di accettazione:** Durante qualsiasi animazione in corso nell'app, verificare che tap, swipe e scroll siano responsivi immediatamente. Nessun "blocco" percepibile.

---

### REG-037
**Il typing indicator appare entro 500ms dall'inizio della digitazione dell'interlocutore e scompare entro 3 secondi dall'ultima lettera.**

**Motivazione:** Un typing indicator che appare in ritardo o che rimane visibile a lungo dopo che l'utente ha smesso di scrivere è fastidioso e fuorviante.

**Test di accettazione:** Utente A inizia a scrivere. Sul device di B, il typing indicator appare entro 500ms. Utente A smette di scrivere (senza inviare). Sul device di B, il typing indicator scompare entro 3 secondi.

---

## Categoria 8 — Privacy e Sicurezza

---

### REG-038
**Nessuna informazione privata dell'utente appare in plain text nei log di sistema.**

**Motivazione:** I log di sistema sono accessibili in molti contesti (debugging, crash report, adb logcat). Nessun dato sensibile deve apparirvi.

**Dati che non appaiono mai nei log:**
- Contenuto dei messaggi (anche in debug)
- Token JWT o refresh token
- Password o OTP
- Numeri di telefono
- Email (solo le prime 3 lettere + @ + dominio in debug)
- Chiavi crittografiche

**Test di accettazione:** Con `adb logcat` (Android) o Console.app (iOS) attivi, usare l'app normalmente per 5 minuti includendo login, invio messaggi, invio media. Verificare che nessun dato della lista sopra appaia nei log.

---

### REG-039
**Lo schermo di blocco dell'OS non mostra il contenuto dei messaggi nelle notifiche.**

**Motivazione:** Chiunque veda lo schermo del telefono non deve poter leggere i messaggi privati.

**Default delle notifiche:**
- Schermo bloccato: "Alpha Chat — Nuovo messaggio" (senza mittente, senza testo)
- Schermo sbloccato: nome mittente + "Nuovo messaggio" (senza testo)
- Opzione avanzata (opt-in): "Mostra anteprima testo" — default OFF

**Test di accettazione:** Con notifiche configurate di default, ricevere un messaggio con schermo bloccato. La notifica mostra solo "Alpha Chat — Nuovo messaggio" senza testo o mittente.

---

### REG-040
**La funzione "Blocco screenshot" è attiva di default nelle chat 1-to-1 (opt-out disponibile).**

**Motivazione:** Le conversazioni private hanno un'aspettativa di riservatezza. Il blocco screenshot la protegge almeno da accessi accidentali.

**Nota di implementazione:** Su iOS il blocco completo non è possibile — si oscura solo nel task switcher. Su Android (`FLAG_SECURE`) il blocco è completo. Il comportamento diverso per piattaforma è documentato nell'impostazione UI.

**Test di accettazione:** In una chat 1-to-1 con impostazioni default, tentare uno screenshot su Android → la schermata risulta nera. Tentare lo stesso su iOS → la chat non appare nel task switcher preview.

---

### REG-041
**La sessione scaduta viene rilevata e gestita prima che l'utente veda un errore generico.**

**Motivazione:** "401 Unauthorized" non è un messaggio per l'utente. Il sistema rileva la sessione scaduta, esegue il refresh silenzioso, e se il refresh fallisce reindirizza al login — tutto senza mostrare errori tecnici.

**Implementazione:** Ogni client HTTP intercetta le risposte 401. Prima di mostrare un errore, tenta automaticamente un refresh del token. Solo se il refresh fallisce → redirect al login con messaggio "Sessione scaduta — accedi di nuovo."

**Test di accettazione:** Con un access token scaduto artificialmente e un refresh token valido, eseguire qualsiasi operazione autenticata. Il sistema esegue il refresh silenzioso e l'operazione va a buon fine senza interruzione visibile per l'utente.

---

### REG-042
**L'indicatore E2E è sempre visibile nelle conversazioni cifrate e non può essere nascosto.**

**Motivazione:** L'utente deve poter verificare in qualsiasi momento che la conversazione è protetta.

**Implementazione:** Un'icona lucchetto piccola con tooltip "End-to-end cifrata" è visibile in modo persistente nella navigation bar di ogni conversazione E2E. Toccarla apre una schermata che spiega cosa significa E2E e mostra il numero di sicurezza (safety number) per la verifica dell'identità.

**Test di accettazione:** In ogni conversazione E2E (tutte le 1-to-1 e i gruppi), l'indicatore lucchetto è visibile. Toccandolo, si apre la schermata di spiegazione E2E con il safety number.

---

## Categoria 9 — Accessibilità

---

### REG-043
**Ogni elemento interattivo ha una dimensione touch target di almeno 44×44px.**

**Motivazione:** Apple Human Interface Guidelines e Material Design specificano entrambi 44pt / 48dp come minimo. Elementi più piccoli causano errori di tap frequenti.

**Test di accettazione:** Con strumenti di accessibility audit (Xcode Accessibility Inspector, Android Accessibility Scanner), verificare ogni elemento interattivo. Nessun elemento deve avere hit area < 44×44px.

---

### REG-044
**Ogni elemento dell'interfaccia ha un accessibility label significativo per gli screen reader.**

**Motivazione:** Un'icona senza label è un bottone senza nome per chi usa VoiceOver o TalkBack.

**Standard per le label:**
- Bottoni: descrivono l'azione ("Invia messaggio", non "Bottone")
- Avatar: "Foto profilo di [Nome]"
- Icone di status: "Messaggio letto" (non "doppia spunta viola")
- Toggle: "[Nome impostazione] — [Attivo/Non attivo]"

**Test di accettazione:** Attivare VoiceOver (iOS) o TalkBack (Android). Navigare l'intera app usando solo gli swipe di navigazione da screen reader. Ogni elemento interattivo ha una label che comunica la sua funzione senza ambiguità.

---

### REG-045
**Il rapporto di contrasto colore è ≥ 4.5:1 per il testo normale e ≥ 3:1 per il testo grande.**

**Motivazione:** WCAG 2.1 Level AA. Garantisce leggibilità per utenti con deficit visivi.

**Test di accettazione:** Usare uno strumento di color contrast checking (Colour Contrast Analyser, o plugin Figma) su ogni combinazione testo/sfondo dell'app. Nessuna combinazione in uso attivo nell'interfaccia può avere contrasto < 4.5:1 per testo normale.

---

### REG-046
**L'app è completamente navigabile con Dynamic Type alla dimensione "Accessibility Extra Extra Extra Large" senza perdita di funzionalità.**

**Motivazione:** Gli utenti con ipovisione usano dimensioni di testo molto grandi. Il layout deve adattarsi senza rompere le funzionalità.

**Test di accettazione:** Impostare iOS Dynamic Type su "Accessibility XXXL" (la massima). Navigare l'intera app. Verificare che: nessun testo venga troncato in modo che perda significato, tutti i bottoni siano visibili e usabili, nessun layout si "rompa" sovrapponendo elementi.

---

### REG-047
**Le animazioni rispettano la preferenza "Reduce Motion" del sistema operativo.**

**Motivazione:** Alcune animazioni causano disturbi (vertigini, nausea) in utenti con sensibilità al movimento. Il sistema operativo offre un'impostazione per ridurle — l'app la rispetta.

**Implementazione:** Quando `AccessibilityInfo.isReduceMotionEnabled()` ritorna `true`, tutte le animazioni di slide/scale vengono sostituite con fade (durata 150ms). Le animazioni informative (typing indicator) vengono mantenute ma semplificate.

**Test di accettazione:** Attivare "Reduce Motion" nelle impostazioni di accessibilità del dispositivo. Verificare che tutte le transizioni di navigazione usino fade invece di slide, che le animazioni decorative siano disabilitate.

---

## Categoria 10 — Dati e Integrità

---

### REG-048
**Nessuna operazione di scrittura su database avviene senza validazione Zod del payload.**

**Motivazione:** I dati non validati che entrano nel database sono la causa principale di bug difficili da riprodurre e di vulnerabilità di sicurezza.

**Test di accettazione:** Code review di ogni route API che esegue operazioni di scrittura. Verificare che ogni body, param, e query string sia validato con uno schema Zod prima di raggiungere il layer di accesso ai dati.

---

### REG-049
**I backup del database sono verificati mensilmente con un restore di test.**

**Motivazione:** Un backup che non è mai stato ripristinato non è un backup — è una speranza.

**Procedura mensile:**
1. Selezionare un backup point-in-time casuale degli ultimi 7 giorni
2. Eseguire il restore su un cluster di test (non produzione)
3. Verificare la consistenza dei dati (conteggi, integrità referenziale)
4. Documentare il test nel log di manutenzione

**Test di accettazione:** Il log di manutenzione mostra un restore di test nelle ultime 4 settimane prima di ogni release pubblica.

---

### REG-050
**I dati di un utente che cancella l'account vengono rimossi entro 30 giorni.**

**Motivazione:** GDPR Art. 17 (Right to Erasure). Non è opzionale.

**Cosa viene rimosso:**
- Tutti i messaggi inviati dall'utente (in conversazioni non di gruppo: rimosso il documento; in gruppi: rimane il tombstone "Utente eliminato")
- Profilo utente, avatar, bio
- Token di sessione e prechiavi E2E
- Token push e preferenze notifiche
- Contatti e impostazioni

**Cosa rimane (obbligo legale):**
- Audit log di moderazione (se l'utente era un admin che ha eseguito azioni di moderazione)
- Dati finanziari wallet (obblighi contabili, se il wallet era attivo)

**Test di accettazione:** Creare un account, inviare messaggi, cancellare l'account. Verificare dopo 30 giorni che nessun dato personale identificabile dell'utente sia presente nel database.

---

### REG-051
**I log di sistema non conservano dati per più di 30 giorni.**

**Motivazione:** I log di lunga durata aumentano la superficie di esposizione in caso di breach e possono contenere dati personali (anche parziali).

**Implementazione:** Configurare retention automatica in Sentry (30 giorni), Pino log export (cancellazione automatica), MongoDB logs (Atlas log retention 30 giorni).

**Test di accettazione:** Verificare nelle impostazioni di ogni servizio di logging che la retention sia configurata a ≤ 30 giorni.

---

### REG-052
**Nessun schema MongoDB viene modificato in produzione senza una procedura di migrazione documentata.**

**Motivazione:** MongoDB permette di aggiungere campi senza migration, ma rimuovere, rinominare, o cambiare il tipo di un campo su documenti esistenti richiede attenzione.

**Procedura per ogni modifica schema:**
1. Documentare la modifica in `AlphaChatDocs/05_Database.md`
2. Verificare la compatibilità backward (il codice vecchio funziona con documenti nuovi? Il codice nuovo funziona con documenti vecchi?)
3. Se non backward compatible: implementare la migrazione dati prima del deploy del nuovo codice
4. Testare la migrazione su staging con dataset di dimensione comparabile a produzione

**Test di accettazione:** Ogni PR che modifica uno schema Mongoose include una sezione "Migration Notes" con impatto sui documenti esistenti e procedura di migrazione se necessaria.

---

## Riepilogo — Test di Accettazione per Release

Prima di ogni release pubblica, verificare che tutte le 52 regole siano soddisfatte:

| Categoria | Regole | Critica per release |
|---|---|---|
| Navigazione | REG-001 → REG-007 | ✅ Tutte |
| Caricamento | REG-008 → REG-012 | ✅ Tutte |
| Errori | REG-013 → REG-017 | ✅ Tutte |
| Messaggi | REG-018 → REG-024 | ✅ Tutte |
| Offline | REG-025 → REG-028 | ✅ Tutte |
| Performance | REG-029 → REG-033 | ✅ REG-029, REG-030 (gli altri: warning) |
| Animazioni | REG-034 → REG-037 | ⚠️ REG-034, REG-036 (gli altri: warning) |
| Privacy/Sicurezza | REG-038 → REG-042 | ✅ Tutte |
| Accessibilità | REG-043 → REG-047 | ✅ REG-043, REG-044, REG-045 |
| Dati | REG-048 → REG-052 | ✅ REG-048, REG-050 |

**Legenda:**
- ✅ Critica: una violazione blocca il rilascio
- ⚠️ Warning: una violazione genera un ticket ad alta priorità ma non blocca il rilascio se documentata con piano di fix nella release successiva

---

*Alpha Chat Bible — Versione 1.0 — Luglio 2025*
*Questo documento è la costituzione del prodotto.*
*Nessuna pressione di timeline, nessuna richiesta di feature, nessuna decisione commerciale può sovrascrivere queste regole.*
*Possono essere modificate solo attraverso un processo deliberato, documentato, e comunicato a tutto il team.*
