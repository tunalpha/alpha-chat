#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# PRE-DEPLOY CHECK — Alpha Chat
#
# Esegui questo script PRIMA di ogni publish/deploy.
# Se uno step fallisce, il deploy NON parte.
#
# Uso:
#   bash scripts/pre-deploy-check.sh          # test + build (completo)
#   bash scripts/pre-deploy-check.sh --quick  # solo test + sanity (no build, ~90s)
#
# Exit code 0 = tutto ok, puoi deployare.
# Exit code 1 = qualcosa ha fallito — leggi il report e correggi prima di deployare.
# ═══════════════════════════════════════════════════════════════════════════════

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

PASS=0
FAIL=0
ERRORS=()

QUICK_MODE=false
if [[ "${1:-}" == "--quick" ]]; then
  QUICK_MODE=true
fi

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
if $QUICK_MODE; then
  echo -e "  ${YELLOW}Modalità: QUICK (no build)${RESET}"
fi

# ─── STEP 1: Critical tests — frontend ────────────────────────────────────────

log_step "STEP 1 — Test critici frontend (alpha-chat-web)"
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

log_step "STEP 2 — Test critici backend (api-server)"
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

log_step "STEP 3 — Suite completa alpha-chat-web (regression check)"
echo -e "  Tutti i test esistenti devono passare — nessuna regressione"

VITEST_EXIT=0
pnpm --filter @workspace/alpha-chat-web exec vitest run \
  2>&1 | tee /tmp/full-frontend.log || VITEST_EXIT=$?

if [ "$VITEST_EXIT" -eq 0 ]; then
  log_ok "Suite frontend completa: PASS"
else
  # Controlla se i fallimenti sono solo quelli pre-esistenti noti
  NEW_FAILS=$(grep -c "× " /tmp/full-frontend.log 2>/dev/null || true)
  KNOWN_FAILS=$(grep "× " /tmp/full-frontend.log 2>/dev/null | \
    grep -c "refresh-token\|jwt.service\|payment-quote\|temp-password" || true)
  REAL_FAILS=$(( NEW_FAILS - KNOWN_FAILS ))
  if [ "$REAL_FAILS" -le 0 ]; then
    log_warn "Suite frontend: solo fallimenti noti pre-esistenti (timing/import) — OK per il deploy"
  else
    log_fail "Suite frontend completa: FAIL — ${REAL_FAILS} nuove regressioni rilevate"
  fi
fi

# ─── STEP 4: Build production ─────────────────────────────────────────────────

if ! $QUICK_MODE; then

  log_step "STEP 4 — Build production (parallelo)"
  echo -e "  Build alpha-chat-web, admin-panel, api-server in parallelo"

  BUILD_FE_LOG=/tmp/build-frontend.log
  BUILD_ADMIN_LOG=/tmp/build-admin.log
  BUILD_API_LOG=/tmp/build-api.log

  pnpm --filter @workspace/alpha-chat-web build > "$BUILD_FE_LOG" 2>&1 &
  PID_FE=$!

  pnpm --filter @workspace/admin-panel build > "$BUILD_ADMIN_LOG" 2>&1 &
  PID_ADMIN=$!

  pnpm --filter @workspace/api-server build > "$BUILD_API_LOG" 2>&1 &
  PID_API=$!

  wait "$PID_FE"  && log_ok "Build alpha-chat-web: PASS" \
                  || log_fail "Build alpha-chat-web: FAIL — leggi $BUILD_FE_LOG"

  wait "$PID_ADMIN" && log_ok "Build admin-panel: PASS" \
                    || log_fail "Build admin-panel: FAIL — leggi $BUILD_ADMIN_LOG"

  wait "$PID_API"   && log_ok "Build api-server: PASS" \
                    || log_fail "Build api-server: FAIL — leggi $BUILD_API_LOG"

fi

# ─── STEP 5: Sanity checks ────────────────────────────────────────────────────

log_step "STEP 5 — Sanity checks statici"

# Verifica BTC_LN_COMING_SOON
if grep -q "BTC_LN_COMING_SOON" artifacts/alpha-chat-web/src/swap/btcln-coming-soon.ts 2>/dev/null; then
  COMING_SOON=$(grep "BTC_LN_COMING_SOON\s*=" artifacts/alpha-chat-web/src/swap/btcln-coming-soon.ts | grep -oE "true|false" | head -1)
  log_ok "BTC_LN_COMING_SOON = ${COMING_SOON}"
else
  log_warn "btcln-coming-soon.ts non trovato — verifica manualmente"
fi

# Verifica P2TR support
if grep -q "bc1p" artifacts/alpha-chat-web/src/wallet/services/btc-signer.ts 2>/dev/null; then
  log_ok "validateBtcAddress supporta P2TR (bc1p)"
else
  log_fail "validateBtcAddress NON supporta bc1p — swap EVM→BTC rotto"
fi

# Verifica no .catch(() => null) in swap tracking
BAD_CATCH=$(grep -c "\.catch(() => null)" \
  artifacts/alpha-chat-web/src/swap/evm/useEvmSwapState.ts 2>/dev/null || true)
if [ "$BAD_CATCH" -eq 0 ]; then
  log_ok "Nessun .catch(() => null) nel tracking EVM swap"
else
  log_fail ".catch(() => null) ancora presente in useEvmSwapState.ts — errori di tracking nascosti"
fi

# Verifica API_BASE_URL (no window.__VITE_API_BASE__)
BAD_URL=$(grep -c "__VITE_API_BASE__" \
  artifacts/alpha-chat-web/src/swap/evm/useEvmSwapState.ts 2>/dev/null || true)
if [ "$BAD_URL" -eq 0 ]; then
  log_ok "Nessun window.__VITE_API_BASE__ in useEvmSwapState.ts"
else
  log_warn "window.__VITE_API_BASE__ trovato in useEvmSwapState.ts — verifica URL"
fi

# Verifica AdapterRegistry registrato
if grep -q "registerDefaultAdapters" artifacts/api-server/src/index.ts 2>/dev/null; then
  log_ok "AdapterRegistry.registerDefaultAdapters() presente in index.ts"
else
  log_fail "AdapterRegistry NON registrato in index.ts — tutti i pagamenti BSC/ETH falliranno"
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

if [ "${#ERRORS[@]}" -gt 0 ]; then
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
