---
name: SW update race condition fix
description: controllerchange listener must be at module level, not inside a React effect, to avoid missing the event.
---

## Il bug

`controllerchange` emetteva PRIMA che `initServiceWorker()` venisse chiamata.
`initServiceWorker()` dipende da `auth?.userId` in un `useEffect` → ritardo 200-500ms.
Se il SW si aggiornava in quel lasso di tempo, l'evento era perso → nessun banner.

## Tre fix applicati

### 1. Module-level listener (fix principale)

In `pushManager.ts`, ALL'INIZIO del file, fuori da qualsiasi funzione:

```typescript
let _swUpdateReady = false;
let _hasBeenControlled = false;

if ('serviceWorker' in navigator) {
  _hasBeenControlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_hasBeenControlled) {
      _swUpdateReady = true;
      window.dispatchEvent(new CustomEvent('pwa:update-ready'));
    }
    _hasBeenControlled = true;
  });
}
export function isSwUpdateReady(): boolean { return _swUpdateReady; }
```

**Why:** ES module evaluation è sincrona e avviene prima del primo tick. Nessun controllerchange
può emettere prima che questo codice sia eseguito. initServiceWorker() rimane solo per
la registrazione SW e la gestione pushsubscriptionchange.

### 2. updateViaCache: 'none'

```typescript
navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
```

Senza questa opzione il browser può servire il vecchio sw.js dalla cache HTTP
e non rilevare mai un nuovo deploy.

### 3. SwUpdateBanner — init lazy con isSwUpdateReady()

```typescript
const [visible, setVisible] = useState(() => isSwUpdateReady());
```

Se il componente viene montato DOPO che pwa:update-ready è già stato emesso,
l'inizializzazione lazy mostra subito il banner.

## Scenari coperti

| Scenario | Prima del fix | Dopo |
|---|---|---|
| Prima installazione | ✓ nessun banner | ✓ |
| Deploy con app aperta | ✗ evento perso | ✓ banner immediato |
| Deploy con app chiusa (riaperta dopo) | ✓ nuovo bundle servito | ✓ |
| Mount tardivo del banner | ✗ banner non compare | ✓ lazy init |
| HTTP cache di sw.js | ✗ vecchio SW servito | ✓ updateViaCache:none |
