# Alpha Chat Manifesto
### Le 20 Regole che Non Cambieranno Mai
> Versione 1.0 — Luglio 2025
> Queste non sono linee guida. Non sono best practice. Non sono suggerimenti.
> Sono i vincoli entro cui Alpha Chat esiste. Se una decisione viola anche una sola di queste regole, la decisione è sbagliata — non la regola.

---

## Preambolo

Ogni prodotto che diventa grande inizia con una convinzione.

WhatsApp è nata dalla convinzione che la comunicazione debba essere semplice. Signal dalla convinzione che debba essere privata. Telegram dalla convinzione che debba essere potente.

Alpha Chat nasce dalla convinzione che debba essere **tutte e tre** — senza i compromessi di nessuna.

Questa convinzione non si declina in feature. Si declina in regole. Regole che esistono prima del codice, prima del design, prima di qualsiasi decisione tecnica o di prodotto.

Questo documento è il contratto che Alpha Chat stipula con i propri utenti, con il proprio team, e con sé stessa. Non è marketing. Non è un manifesto di intenzioni. È un vincolo operativo: quando una pressione esterna, una opportunità commerciale, o una scorciatoia tecnica entra in conflitto con queste regole, le regole vincono.

---

## Le 20 Regole

---

### Regola 1 — Gli Utenti Sono Proprietari dei Propri Dati

I dati che un utente crea su Alpha Chat — messaggi, media, contatti, conversazioni — appartengono all'utente. Alpha Chat li ospita per suo conto, non li possiede.

Questo significa:
- L'utente può scaricare tutti i propri dati in qualsiasi momento, in formato leggibile da macchina
- L'utente può cancellare tutti i propri dati e Alpha Chat li rimuove entro 30 giorni
- Alpha Chat non usa i dati degli utenti per scopi diversi dalla fornitura del servizio di comunicazione
- Alpha Chat non cede i dati degli utenti a terze parti senza consenso esplicito, eccetto quando obbligata dalla legge — e in quel caso lo comunica all'utente nei limiti di ciò che la legge permette

---

### Regola 2 — La Crittografia Non È Opzionale

Ogni messaggio, ogni media, ogni chiamata deve essere protetto. La crittografia non è una feature premium. Non è un'impostazione. Non è un differenziatore di mercato. È il comportamento di default — per tutti, sempre.

Alpha Chat non indebolisce mai la crittografia per facilitare la moderazione, la sorveglianza, o l'accesso delle autorità. Se una giurisdizione richiede backdoor crittografiche come condizione per operare, Alpha Chat sceglie di non operare in quella giurisdizione piuttosto che tradire i propri utenti.

I protocolli crittografici usati sono esclusivamente standard aperti, pubblicati, e soggetti a scrutinio pubblico. Nessun algoritmo proprietario. Nessuna "crittografia fatta in casa".

---

### Regola 3 — Nessuna Pubblicità, Mai

Alpha Chat non mostra pubblicità. Né nelle chat, né tra le chat, né nei canali, né in nessun'altra superficie del prodotto.

Questo non è un impegno revocabile con la crescita. Non diventa negoziabile quando il prodotto ha 10 milioni di utenti. Non è soggetto a "formati pubblicitari non invasivi" o "pubblicità contestuale rispettosa della privacy".

La pubblicità crea un conflitto di interessi strutturale tra il prodotto e i suoi utenti. Alpha Chat risolve questo conflitto una volta per tutte: il modello di business non dipende mai dall'attenzione degli utenti come risorsa da vendere.

---

### Regola 4 — Nessuna Vendita di Dati

Alpha Chat non vende, non cede, non presta, non condivide a scopo commerciale i dati degli utenti con nessuna terza parte.

Non è una policy che può essere aggiornata. Non è soggetta a "partner fidati" o "ecosistemi di dati anonimi". Non esiste una forma di condivisione dei dati degli utenti che sia compatibile con Alpha Chat.

I dati degli utenti non sono una risorsa da monetizzare. Sono una responsabilità da proteggere.

---

### Regola 5 — Il Wallet È Sempre Opzionale

Il modulo Wallet USDA è una scelta — non un prerequisito per usare Alpha Chat.

L'app funziona completamente senza che il wallet esista. Nessuna funzionalità della chat è condizionata all'attivazione del wallet. Nessun incentivo, reminder, o nudge spinge l'utente verso il wallet se non lo ha scelto esplicitamente.

La comunicazione e i pagamenti sono due prodotti distinti che condividono un'autenticazione. L'utente non deve mai sentire che la propria comunicazione è strumentale a un obiettivo finanziario di Alpha Chat.

---

### Regola 6 — L'Esperienza Utente Viene Prima delle Funzionalità

Aggiungere una funzionalità è facile. Aggiungere una funzionalità che non peggiora l'esperienza di chi non la usa è difficile.

Alpha Chat sceglie il difficile.

Ogni nuova funzionalità deve rispondere a due domande prima di essere sviluppata:
1. Migliora concretamente la vita di chi la usa?
2. Non peggiora la vita di chi non la usa?

Se la risposta a una delle due è "no", la funzionalità non viene sviluppata — indipendentemente da quanto sia richiesta, da quanto la offra un competitor, o da quanto sia semplice da implementare.

---

### Regola 7 — Ogni Funzione di Privacy È Configurabile

Nessuna impostazione di privacy è bloccata. Nessuna è nascosta. Tutte sono raggiungibili senza un percorso labirintico di menu.

Gli utenti hanno il controllo granulare su:
- Chi vede il loro stato online
- Chi vede il loro "ultimo accesso"
- Chi vede le conferme di lettura
- Chi può contattarli
- Chi può aggiungere loro ai gruppi
- Come vengono mostrate le notifiche sullo schermo di blocco

Ogni opzione ha un comportamento di default che privilegia la privacy. L'utente può scegliere di condividere più informazioni — mai meno.

---

### Regola 8 — La Sicurezza Non Si Negozia per Velocità di Sviluppo

Non si skippa un security review per rispettare una scadenza. Non si rilascia una feature con una vulnerability nota con l'intenzione di "fixarla dopo". Non si usa un algoritmo crittografico debole perché quello forte è più complesso da implementare.

Se uno sprint non riesce a completare le feature previste **e** i requisiti di sicurezza, si rimandano le feature. I requisiti di sicurezza non slittano.

Questo vale sempre — in beta, in produzione, sotto pressione di lancio, sotto pressione di investitori.

---

### Regola 9 — Nessuna Dipendenza da Singolo Fornitore per Componenti Critici

Per ogni componente critico dell'infrastruttura, deve esistere almeno un'alternativa praticabile che possa essere adottata entro 90 giorni senza riscrivere il prodotto.

"Critico" significa: se questo fornitore smette di funzionare o cambia i termini in modo inaccettabile, la comunicazione degli utenti è interrotta.

Questo si realizza attraverso:
- Abstraction layer nel codice che isolano la dipendenza dal fornitore
- Contratti di servizio letti e compresi prima dell'adozione
- Alternative documentate per ogni fornitore critico
- Nessun lock-in che non possa essere rimosso con un refactoring, non una riscrittura

---

### Regola 10 — La Trasparenza È un Impegno, Non un'Opzione

Alpha Chat pubblica:
- I risultati degli audit di sicurezza indipendenti (inclusi i problemi trovati e come sono stati risolti)
- Il codice dei componenti crittografici critici (open source)
- Le policy di risposta alle richieste delle autorità governative
- I report di trasparenza annuali su quante e quali richieste sono state ricevute dalle autorità

La fiducia degli utenti non si costruisce con dichiarazioni — si costruisce con la verifica. La trasparenza tecnica è il meccanismo con cui gli utenti possono verificare che Alpha Chat fa quello che dice.

---

### Regola 11 — I Metadati Sono Dati

La crittografia del contenuto dei messaggi non è sufficiente. I metadati — chi parla con chi, quando, quanto spesso, da quale dispositivo, da quale parte del mondo — sono informazioni sensibili che rivelano relazioni, abitudini, e comportamenti.

Alpha Chat minimizza la raccolta e la conservazione dei metadati:
- I metadati di comunicazione (chi parla con chi) non vengono usati per scopi diversi dal delivery del messaggio
- I log di sistema vengono cancellati entro 30 giorni
- I metadati degli IP vengono anonimizzati prima della conservazione (ultimo ottetto rimosso)
- Non viene costruito nessun grafo sociale degli utenti a scopo analitico o commerciale

---

### Regola 12 — Il Numero di Telefono Non È Richiesto

Alpha Chat non richiede il numero di telefono per esistere sulla piattaforma. Il numero di telefono è un PII permanente, difficile da cambiare, collegato all'identità reale. Richiedere il telefono esclude chi non ha SIM, chi vive in paesi con costi SMS proibitivi, chi ha ragioni legittime di privacy.

L'identità su Alpha Chat è l'username — scelto liberamente, cambiabile, separato dall'identità telefonica.

Il numero di telefono è uno strumento opzionale per chi vuole essere trovato dai propri contatti. Non è un requisito di accesso.

---

### Regola 13 — L'App Funziona Quando la Rete È Lenta

La comunicazione non è un lusso riservato a chi ha una connessione veloce. Alpha Chat deve essere utilizzabile su reti 3G, su connessioni instabili, in zone di copertura debole.

Questo significa:
- I messaggi di testo vengono consegnati anche su connessioni degradate
- L'app mostra stati di errore chiari, non si blocca silenziosamente
- Il retry è automatico e trasparente per l'utente
- L'interfaccia è responsiva anche mentre i dati si caricano (skeleton screen, non spinner bloccanti)
- Le operazioni critiche (invio messaggio) non richiedono una connessione perfetta

---

### Regola 14 — L'Accessibilità È Nella Definizione di Done

Ogni funzionalità rilasciata supporta:
- Screen reader (VoiceOver su iOS, TalkBack su Android)
- Dynamic Type — il testo scala con le impostazioni di sistema
- Contrasto colore minimo AA secondo WCAG 2.1
- Navigazione da tastiera per la versione web
- Nessuna informazione veicolata solo dal colore

L'accessibilità non è un progetto separato. Non è uno sprint dedicato alla fine. È un criterio di accettazione di ogni feature, insieme ai test funzionali.

---

### Regola 15 — Le Chiamate Non Transitano per i Server di Alpha Chat

Le chiamate audio e video sono P2P quando possibile. Quando un relay è necessario (NAT simmetrico, reti enterprise), il relay gestisce byte cifrati che non può decifrare.

Alpha Chat non si posiziona mai come intermediario in grado di intercettare una chiamata. Il contenuto delle chiamate è cifrato end-to-end con DTLS-SRTP — lo standard WebRTC — e la verifica dell'identità avviene tramite scambio di fingerprint crittografici fuori banda.

---

### Regola 16 — Nessun Dark Pattern

Alpha Chat non usa tecniche di design che manipolano gli utenti contro il loro interesse:
- Nessun countdown artificiale per creare urgenza
- Nessun opt-out nascosto in menu profondi
- Nessuna conferma doppia asimmetrica ("sei sicuro?" solo per le azioni che Alpha Chat non vuole che l'utente compia)
- Nessuna notifica progettata per generare FOMO o ansia
- Nessuna sequenza onboarding che convince l'utente a cedere permessi non necessari

Le impostazioni che riguardano la privacy dell'utente sono sempre raggiungibili in massimo 2 tap dal profilo. Nessuna impostazione critica è nascosta.

---

### Regola 17 — Il Codice Critico È Revisionato da Più Persone

Nessun codice che tocca crittografia, autenticazione, autorizzazioni, o gestione dei dati finanziari (wallet) viene mergato senza revisione di almeno due persone.

Questo vale anche quando il team è piccolo. Questa regola non ha eccezioni per scadenze imminenti, per sviluppatori senior, o per modifiche "piccole". Gli errori più costosi nella storia della sicurezza informatica sono stati errori "piccoli" in codice critico revisionato da una sola persona.

---

### Regola 18 — Gli Utenti Vengono Avvisati Prima di Ogni Cambiamento Significativo

Alpha Chat non cambia silenziosamente:
- Come vengono gestiti i dati degli utenti
- Quali permessi richiede
- I termini di servizio o la privacy policy in modo sostanziale
- Le funzionalità di privacy esistenti (non si può rimuovere una protezione già esistente senza preavviso)

I cambiamenti significativi vengono comunicati con almeno 30 giorni di anticipo, in linguaggio chiaro, con la spiegazione del motivo. Gli utenti che non accettano i nuovi termini hanno il diritto di esportare i propri dati e chiudere l'account senza penalità.

---

### Regola 19 — La Crescita Non Giustifica il Tradimento dei Principi

Quando Alpha Chat avrà investitori, la pressione di monetizzare i dati esisterà. Quando avrà milioni di utenti, la pressione di semplificare la sicurezza per scalare esisterà. Quando avrà partner commerciali, la pressione di condividere dati esisterà.

Nessuna di queste pressioni modifica le regole di questo manifesto.

La crescita che richiede di tradire gli utenti non è crescita — è una transizione verso un prodotto diverso. Se Alpha Chat non riesce a crescere rispettando questi principi, il problema è il modello di business, non i principi.

---

### Regola 20 — Questo Manifesto È Pubblico e Non Modificabile Unilateralmente

Questo documento è pubblico. Gli utenti possono leggerlo, citarlo, e tenerci responsabili.

Le regole non possono essere modificate da una decisione interna non comunicata. Qualsiasi modifica a questo manifesto richiede:
1. Annuncio pubblico con almeno 90 giorni di anticipo
2. Spiegazione del motivo del cambiamento
3. La possibilità per gli utenti di esportare i propri dati e chiudere l'account prima che il cambiamento entri in vigore

Una regola non può essere rimossa — può solo essere rafforzata.

---

## Una Nota sull'Implementazione

Queste regole non sono aspirazioni. Sono vincoli.

Ogni decisione tecnica, ogni scelta di design, ogni negoziazione commerciale deve essere verificata contro questo manifesto prima di essere presa. Quando una decisione soddisfa le 20 regole, può essere discussa nel merito. Quando ne viola una, la discussione finisce.

Il team che costruisce Alpha Chat accetta queste regole come condizione del proprio lavoro. I partner commerciali di Alpha Chat accettano queste regole come condizione della partnership. Gli investitori di Alpha Chat accettano queste regole come condizione dell'investimento.

Non perché siano facili — perché sono giuste.

---

*Alpha Chat Manifesto — Versione 1.0 — Luglio 2025*
*Questo documento è pubblico. Chiunque può citarlo. Chiunque può tenerci responsabili.*
