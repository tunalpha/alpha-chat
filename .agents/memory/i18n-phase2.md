---
name: i18n Phase 2 — audit hardcoded strings
description: Pattern e componenti per le fasi 2 e 3 dell'internazionalizzazione
---

# i18n Phase 2 & 3 — Completed

## Fase 2 (completata in sessione precedente)
Pattern per sostituire stringhe hardcoded in componenti esistenti:
- `signAndPoll useCallback` richiede `t` in deps array
- `confirmDesc` keys in emergency namespace includono prefisso frase completo

## Fase 3 (completata in questa sessione)
378 chiavi aggiunte a tutti i 10 file lingua (it, en, es, fr, de, pt, ar, ja, ru, zh).

### 16 pagine editate — tutte con `useTranslation("namespace")`
| Pagina | Namespace | Note |
|---|---|---|
| PrivacyPage | privacy | VisibilitySelect ha il proprio hook |
| SecuritySettingsPage | security | — |
| CallSettingsPage | calls | — |
| CallHistoryPage | calls | Status labels in t() |
| GroupInfoPage | group | — |
| RecoverySettingsPage | recovery | — |
| TrustCenterPage | trust | CATEGORY_LABELS + ARCHITECTURE dentro component |
| SecurityTimelinePage | timeline | EVENT_LABELS dentro component |
| DeadManSwitchPage | dms | ACTION_OPTIONS dentro component |
| PhoenixSetupPage | phoenix | — |
| NuclearDestroyPage | nuclear | Solo stringhe italiane; military aesthetic English intenzionalmente invariato |
| RecoveryContactsPage | recoveryContacts | — |
| RecoveryPage | recoveryPage | onNavigate opzionale (LandingPage non lo passa) |
| WalletCenterPage | walletCenter | Usa thirdweb (non @reown/appkit) |
| UsdaSettingsPage | usdaSettings | HOW_SLIDES/GUIDE_STEPS/WALLET_CHIPS dentro component; pagamenti solo da chat |
| PwaGuidePage | pwa | — |

## Decisioni architetturali chiave
- Costanti array/object che usano `t()` devono stare DENTRO il corpo del componente
- `NuclearDestroyPage`: stringhe military-aesthetic restano English by design
- `UsdaSettingsPage`: i pagamenti richiedono `conversation_id` (sono chat-based); la pagina è info+wallet, non un form di invio diretto
- `RecoveryStatus` non ha `recovery_contacts_count` — campo non esposto dall'API
- WalletCenter e UsdaSettings usano `thirdweb/react` (useActiveAccount), non `@reown/appkit`
- `apiUsdaGetHistory` ritorna `{ payments, total }`, non array diretto

## TypeScript — zero errori confermati
`npx tsc --noEmit` → exit 0 dopo fase 3.
