---
name: Sprint 16 Fase 5 — Identity Verification
description: Safety Number, TOFU trust manager IDB separato, QR, key-change banner, 26 test (18.1-18.7)
---

Sprint 16 Fase 5 è implementata e i test 18.1-18.7 passano. L'audit Sprint 16 (Scenari B-E) rimane aperto — richiede un Playwright stabile.

**Why:** La verifica identità usa Safety Number (hash HKDF di IK keys) mostrato come 12 gruppi da 5 cifre, con QR scannable e badge trust/verified nel profilo.
