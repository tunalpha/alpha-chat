---
name: Spark Monitor WIP — punto di interruzione
description: Stato esatto del lavoro al momento dell'interruzione del sprint Admin Spark Monitoring
---

## Sprint in corso

"ADMIN SPARK / LIGHTNING — POST-DEPLOY MONITORING"
(dal file attached_assets/Pasted-ADMIN-SPARK-LIGHTNING-POST-DEPLOY-MONITORING-Ora-che-il_1786567293604.txt)

## File già scritti ✅

1. `artifacts/api-server/src/controllers/spark-monitoring.controller.ts` — COMPLETO
   - 4 handler: getSparkDashboardHandler, getSparkMovementsHandler, getSparkHealthHandler, getSparkReconciliationHandler
   - Dati reali da alpha_wallet_fee_records (source=spark_lightning)
   - Privacy: VITE_BREEZ_API_KEY verificata come boolean, mai il valore

2. `artifacts/api-server/src/routes/v1/spark.routes.ts` — AGGIORNATO
   - Aggiunte 4 route GET /monitoring/dashboard|movements|health|reconciliation
   - Tutte requireAdmin("read_only")

3. `artifacts/admin-panel/src/lib/spark-monitoring-api.ts` — NUOVO FILE COMPLETO
   - Tipi: SparkDashboardData, SparkMovementsData, SparkHealthData, SparkReconciliationData
   - API: apiGetSparkDashboard, apiGetSparkMovements, apiGetSparkHealth, apiGetSparkReconciliation
   - Formatters: formatSparkFeeAmount, formatSparkDate, sparkStatusLabel, sparkStatusColor, healthStatusBadge

4. `artifacts/admin-panel/src/App.tsx` — aggiunto import SparkMonitor + route /spark-monitor

5. `artifacts/admin-panel/src/components/layout/Sidebar.tsx` — aggiunto BarChart2 import + nav "Spark Monitor" a /spark-monitor

## File ancora da scrivere ❌

6. `artifacts/admin-panel/src/pages/spark-monitor.tsx` — PAGINA PRINCIPALE (da scrivere)
   - Dashboard cards (totali, fee, error rate, last movement)
   - Health section con badge 🟢🟡🔴
   - Movements table con filtri range/status/paginazione
   - Reconciliation card (alert se diff != 0)
   - Kill switch inline (usando apiGetSparkEnabled/apiSetSparkEnabled da spark-api.ts)
   - Sezione privacy/security note
   - Link a spark-lightning-fee.tsx per fee config

7. `artifacts/api-server/src/tests/spark/spark-monitoring.test.ts` — TEST BACKEND (da scrivere)
   - Mock AlphaWalletFeeRecordModel e AdminSettingsModel
   - Test dashboard totals, movements filtering, health status, reconciliation
   - Test requireAdmin protection, API key non esposta

8. `artifacts/admin-panel/src/tests/spark-monitor.test.ts` — TEST ADMIN PANEL (da scrivere)
   - Test formatters (formatSparkFeeAmount, formatSparkDate, sparkStatusLabel, healthStatusBadge)
   - Test API parameter building (MovementsParams)
   - Test reconciliation alert logic

## Poi (dopo i 3 file):
- Build api-server + admin-panel
- Run regression tests (alpha-chat-web 993, admin-panel 56 + nuovi)
- Produrre report finale (come richiesto dal §12)
- NON fare ulteriori modifiche dopo il report senza approvazione

## Regole fondamentali (dal brief)
- NON modificare: BTC on-chain, WalletContext BTC, EVM, USDA, Payment Engine, ChatPage, Signal, fee BTC, Treasury BTC on-chain, logiche invio/ricezione Spark
- Dati reali: NO mock in produzione
- Privacy: mai seed/mnemonic/private_key/API_key Breez nell'admin
- Test: 0 FAIL
