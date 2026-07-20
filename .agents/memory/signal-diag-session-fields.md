---
name: Signal SessionRecord diagnostic field names
description: The IDB-DIAGNOSTIC in key-manager.ts used underscore-prefixed field names that don't exist in the serialized JSON; now fixed.
---

## Rule
`runSignalDiagnostic()` in `key-manager.ts` reads the raw JSON string from IDB store "sessions".
The correct field names from `SessionRecord.serialize()` (session-record.js) have NO underscore prefix.

## Wrong → Correct mapping (was causing sendIdx/recvIdx = "?")
| Wrong (old) | Correct |
|---|---|
| `sess["_currentRatchet"]` | `sess["currentRatchet"]` |
| `sess["_indexInfo"]` | `sess["indexInfo"]` |
| `sess["_remoteRegistrationId"]` | `sess["registrationId"]` |
| `ratchet["sendingChain"]["index"]` | traverse `chains` for `chainType === 1` → `.chainKey.counter` |
| `ratchet["receivingChain"]["index"]` | traverse `chains` for `chainType === 2` → `.chainKey.counter` |

## SessionRecord JSON schema (from session-record.js serialize())
```
sessions.<baseKey_b64>:
  indexInfo.closed             -1=open | timestamp=archived
  registrationId               number
  currentRatchet
    ephemeralKeyPair.pubKey    base64  ← our DH ratchet key (pub only — privKey NEVER logged)
    lastRemoteEphemeralKey     base64  ← their last DH key we processed
    previousCounter            number  ← counter before last ratchet step
  pendingPreKey                null | { preKeyId, signedKeyId }
  chains.<ephKey_b64>
    chainType                  1=SENDING | 2=RECEIVING
    chainKey.counter           number  ← sendIdx (type 1) / recvIdx (type 2)
    messageKeys.<n>            base64  ← pre-computed keys for out-of-order delivery
```

**Why:** The underscore-prefixed variant was apparently from an older version of the library or a different serialization format. The v0.0.16 library serializes without underscores.
