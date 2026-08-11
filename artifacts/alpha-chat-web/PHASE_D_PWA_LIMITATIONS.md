# Phase D — PWA / iOS Limitations & Security Notes

## Limitazioni note (non risolvibili senza Capacitor nativo)

### 1. `privateKeyHex` — stringa JS non azzerabile

**Problema**: `viem.privateKeyToAccount(hexString)` richiede una stringa hex come input. Le stringhe JavaScript sono immutabili e non possono essere azzerate dopo l'uso. La stringa `privateKeyHex` rimane in memoria fino al Garbage Collector.

**Impatto**: Residuo in memoria temporaneo. Non persistente, non trasmesso, non memorizzato.

**Mitigazione applicata**:
- La Uint8Array della private key viene azzerata (`fill(0)`) nel `finally` block
- La stringa esiste solo nel frame di esecuzione di `signAndBroadcastNativeEvm/Erc20`
- Nessun log, nessun React state, nessun localStorage

**Workaround futuro**: Usare una versione di viem che accetta Uint8Array direttamente, oppure Capacitor Secure Enclave per signing nativo.

---

### 2. HDKey internals — key material in oggetti derivati

**Problema**: `HDKey.fromMasterSeed(seed)` e `root.derive(path)` mantengono internamente copie delle chiavi nei loro campi. Questi oggetti non espongono un metodo `destroy()`.

**Impatto**: Residuo temporaneo in oggetti JavaScript fino al GC. Non persistente.

**Mitigazione applicata**:
- `seed.fill(0)` nel `finally` block dopo derivazione BTC
- Le chiavi derivate vengono copiate in nuovi Uint8Array locali prima del return
- `keyPair.privateKey.fill(0)` nel `finally` del signing

---

### 3. App chiusa durante broadcast (TX già firmata, non trasmessa)

**Scenario**: L'utente inserisce il PIN, l'app firma la TX localmente, poi il browser viene chiuso prima che il backend risponda al broadcast.

**Comportamento attuale**:
- La TX firmata è persa (non è stata persistita)
- L'utente deve ricreare e firmare una nuova TX
- Non c'è rischio di double-spend (la TX non è stata trasmessa)

**Limitazione**: Non implementiamo il "retry broadcast" — lo stato di firma non viene salvato in IDB.

**Documentazione**: Questa è una scelta di sicurezza deliberata. Salvare una TX firmata in IDB aumenterebbe la superficie di attacco. L'utente può sempre ri-firmare con lo stesso nonce.

---

### 4. App chiusa DOPO broadcast (TX in mempool)

**Scenario**: Il broadcast è andato a buon fine, ma l'app viene chiusa prima che la conferma venga ricevuta.

**Comportamento attuale**:
- La TX è in mempool (visibile su explorer)
- Al prossimo avvio, il `txMonitor` la rileverà tramite polling (se ancora in memoria)
- Il saldo si aggiornerà al prossimo refresh

**Limitazione**: Non c'è persistenza del TX hash in attesa tra sessioni. Il txMonitor perde lo stato al reload.

**Workaround**: L'utente può verificare manualmente su explorer usando il proprio address.

---

### 5. Safari / PWA sospesa (background)

**Problema**: iOS Safari sospende i processi JavaScript dopo ~30s di background. Il `txMonitor` si ferma.

**Impatto**: Nessuna notifica di conferma mentre l'app è in background.

**Mitigazione**: Le Web Push Notifications sono già implementate. Il backend può inviare notifiche push anche quando la PWA è in background.

**Limitazione nota**: Le notifiche push richiedono permesso esplicito. Su iOS, le Web Push sono disponibili solo per PWA installate (Add to Home Screen).

---

### 6. IndexedDB non disponibile / storage cancellato

**Scenario**: L'utente cancella i dati del browser, o IDB non è disponibile (modalità privata).

**Comportamento attuale**:
- `loadKeystore()` ritorna `null`
- L'app mostra la schermata di onboarding (creazione nuovo wallet)
- Il seed è PERSO se non è stato fatto il backup

**Mitigazione**: 
- Warning di backup prominente durante l'onboarding
- `BackupConfirmView` richiede conferma esplicita prima di procedere
- Recovery via seed phrase standard BIP-39

---

### 7. RPC cade durante una transazione

**Scenario**: Il gas estimate o il broadcast falliscono per problemi di rete.

**Comportamento attuale**:
- Gas estimate failure → errore mostrato all'utente, nessuna TX firmata
- Broadcast failure → errore mostrato con messaggio leggibile, nessuna TX in mempool
- In entrambi i casi il PIN viene azzerato dallo state React

**Non è mai possibile**: firmare una TX e inviarla parzialmente (firma e broadcast sono operazioni separate e sequenziali).

---

### 8. iOS — Earpiece audio (irrilevante per wallet)

Non applicabile a questa fase. Documentato in `ios-audio-routing-pwa-limit.md`.

---

## Sicurezza — Sommario Garanzie

| Proprietà | Status | Note |
|-----------|--------|------|
| Seed non inviato al backend | ✅ | Verificato nel codice |
| Private key non inviata al backend | ✅ | Solo signed tx hex |
| PIN non inviato al backend | ✅ | Solo decrypt locale |
| Private key azzerata dopo uso | ✅ | `fill(0)` in `finally` |
| Seed azzerato dopo derivazione BTC | ✅ | `fill(0)` in `finally` |
| Private key non in IDB | ✅ | IDB contiene solo keystore cifrato |
| Private key non in React state | ✅ | Solo in variabili locali |
| PIN azzerato dopo firma | ✅ | `setPin("")` su success/error/wrong-PIN |
| PIN azzerato su back navigation | ✅ | Pulito su ritorno a welcome |
| Signed tx è l'unico dato sensibile broadcast | ✅ | Verificato in test |
| Rate limit su broadcast | ✅ | 10 req/min per utente autenticato |
| privateKeyHex stringa non azzerabile | ⚠️ | Limitazione JS inherente, documentata |
| HDKey internals non azzerabili | ⚠️ | Limitazione libreria, documentata |
| TX firmata non persistita | ✅ | Scelta deliberata di sicurezza |
