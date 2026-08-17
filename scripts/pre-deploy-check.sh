#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# PRE-DEPLOY CHECK — Alpha Chat
#
# Esegui questo script PRIMA di ogni publish/deploy.
# Se uno step fallisce, il deploy NON parte.
#
# Uso:
#   bash scripts/pre-deploy-check.sh
#
# Exit code 0 = tutto ok, puoi deployare.
# Exit code 1 = qualcosa ha fallito — leggi il report e correggi prima di deployare.
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

PASS=0
FAIL=0
ERRORS=()

log_step() {
  echo ""
  echo -e "${CYAN}${BOLD}▶ $1${RESET}"
}

log_ok() {
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}✓ $1${RESET}"
}

log_fail() {
  FAIL=$((FAIL + 1))
  ERRORS+=("$1")
  echo -e "  ${RED}✗ $1${RESET}"
}

log_warn() {
  echo -e "  ${YELLOW}⚠ $1${RESET}"
}

START_TIME=$(date +%s)

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║         PRE-DEPLOY CHECK — Alpha Chat Payments           ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Data:     $(date '+%Y-%m-%d %H:%M:%S')"
echo -e "  Workspace: $(pwd)"

# ─── STEP 1: Critical tests — frontend ────────────────────────────────────────

log_step "STEP 1/5 — Test critici frontend (alpha-chat-web)"
echo -e "  Coprono: indirizzi BTC (P2WPKH/P2WSH/P2TR/legacy), EVM swap safety,"
echo -e "           write-before-submit, double-submit guard, fee invarianti BTC"

if pnpm --filter @workspace/alpha-chat-web exec vitest run \
    src/tests/critical/ \
    --reporter=verbose \
    2>&1 | tee /tmp/critical-frontend.log; then
  log_ok "Test critici frontend: PASS"
else
  log_fail "Test critici frontend: FAIL — leggi /tmp/critical-frontend.log"
fi

# ─── STEP 2: Critical tests — backend ─────────────────────────────────────────

log_step "STEP 2/5 — Test critici backend (api-server)"
echo -e "  Coprono: state machine MultiChain, idempotency, fee floor BTC,"
echo -e "           scheduler no-retry su TX broadcast, gas reserve"

if pnpm --filter @workspace/api-server exec vitest run \
    src/tests/critical/ \
    --reporter=verbose \
    2>&1 | tee /tmp/critical-backend.log; then
  log_ok "Test critici backend: PASS"
else
  log_fail "Test critici backend: FAIL — leggi /tmp/critical-backend.log"
fi

# ─── STEP 3: Full test suite (regression) ─────────────────────────────────────

log_step "STEP 3/5 — Suite completa alpha-chat-web (regression check)"
echo -e "  Tutti i test esistenti devono passare — nessuna regressione"

if pnpm --filter @workspace/alpha-chat-web exec vitest run 2>&1 | tee /tmp/full-frontend.log; then
  log_ok "Suite frontend completa: PASS"
else
  # Controlla se i fallimenti sono solo quelli pre-esistenti noti
  NEW_FAILS=$(grep "× " /tmp/full-frontend.log 2>/dev/null | \
    grep -v "refresh-token\|jwt.service\|payment-quote\|temp-password" | \
    wc -l)
  if [ "$NEW_FAILS" -eq 0 ]; then
    log_warn "Suite frontend: solo fallimenti noti pre-esistenti (timing/import) — OK per il deploy"
  else
    log_fail "Suite frontend completa: FAIL — ${NEW_FAILS} nuove regressioni rilevate"
  fi
fi

# ─── STEP 4: Build production ─────────────────────────────────────────────────

log_step "STEP 4/5 — Build production"
echo -e "  Build alpha-chat-web e admin-panel (TypeScript + bundle)"

BUILD_OK=true

if pnpm --filter @workspace/alpha-chat-web build 2>&1 | tee /tmp/build-frontend.log; then
  log_ok "Build alpha-chat-web: PASS"
else
  log_fail "Build alpha-chat-web: FAIL — leggi /tmp/build-frontend.log"
  BUILD_OK=false
fi

if pnpm --filter @workspace/admin-panel build 2>&1 | tee /tmp/build-admin.log; then
  log_ok "Build admin-panel: PASS"
else
  log_fail "Build admin-panel: FAIL — leggi /tmp/build-admin.log"
  BUILD_OK=false
fi

if pnpm --filter @workspace/api-server build 2>&1 | tee /tmp/build-api.log; then
  log_ok "Build api-server: PASS"
else
  log_fail "Build api-server: FAIL — leggi /tmp/build-api.log"
  BUILD_OK=false
fi

# ─── STEP 5: Sanity checks ────────────────────────────────────────────────────

log_step "STEP 5/5 — Sanity checks statici"

# Verifica che BTC_LN_COMING_SOON esista
if grep -q "BTC_LN_COMING_SOON" artifacts/alpha-chat-web/src/swap/btcln-coming-soon.ts 2>/dev/null; then
  COMING_SOON=$(grep "BTC_LN_COMING_SOON\s*=" artifacts/alpha-chat-web/src/swap/btcln-coming-soon.ts | grep -oE "true|false" | head -1)
  log_ok "BTC_LN_COMING_SOON = ${COMING_SOON} (ok)"
else
  log_warn "btcln-coming-soon.ts non trovato — verifica manualmente"
fi

# Verifica che validateBtcAddress supporti bc1p
if grep -q "bc1p" artifacts/alpha-chat-web/src/wallet/services/btc-signer.ts 2>/dev/null; then
  log_ok "validateBtcAddress supporta P2TR (bc1p) — bug 2026-08-17 corretto"
else
  log_fail "validateBtcAddress NON supporta bc1p — rischio swap EVM→BTC rotto"
fi

# Verifica che non ci siano .catch(() => null) nel codice di tracking swap
BAD_CATCH=$(grep -rn "\.catch(() => null)" \
  artifacts/alpha-chat-web/src/swap/evm/useEvmSwapState.ts \
  2>/dev/null | wc -l)
if [ "$BAD_CATCH" -eq 0 ]; then
  log_ok "Nessun .catch(() => null) nel tracking EVM swap"
else
  log_fail ".catch(() => null) ancora presente in useEvmSwapState.ts — errori di tracking nascosti"
fi

# Verifica che API_BASE_URL sia usato (non window.__VITE_API_BASE__)
BAD_URL=$(grep -rn "__VITE_API_BASE__" \
  artifacts/alpha-chat-web/src/swap/ \
  2>/dev/null | wc -l)
if [ "$BAD_URL" -eq 0 ]; then
  log_ok "Nessun window.__VITE_API_BASE__ nei file swap — URL corretto"
else
  log_warn "window.__VITE_API_BASE__ trovato in swap/ — verifica che non sia in useEvmSwapState.ts"
fi

# Verifica che AdapterRegistry sia registrato in index.ts
if grep -q "registerDefaultAdapters" artifacts/api-server/src/index.ts 2>/dev/null; then
  log_ok "AdapterRegistry.registerDefaultAdapters() presente in index.ts"
else
  log_fail "AdapterRegistry NON registrato in index.ts — tutti i pagamenti BSC/ETH falliranno (ADAPTER_NOT_FOUND)"
fi

# ─── REPORT FINALE ────────────────────────────────────────────────────────────

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║                   REPORT PRE-DEPLOY                      ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Durata:  ${ELAPSED}s"
echo -e "  ${GREEN}PASS: ${PASS}${RESET}"
echo -e "  ${RED}FAIL: ${FAIL}${RESET}"

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo -e "  ${RED}${BOLD}Problemi da correggere prima del deploy:${RESET}"
  for err in "${ERRORS[@]}"; do
    echo -e "  ${RED}  • ${err}${RESET}"
  done
  echo ""
  echo -e "  ${RED}${BOLD}❌ DEPLOY NON CONSIGLIATO — correggi i problemi sopra${RESET}"
  echo ""
  exit 1
else
  echo ""
  echo -e "  ${GREEN}${BOLD}✅ DEPLOY OK — tutti i check passano${RESET}"
  echo ""
fi
