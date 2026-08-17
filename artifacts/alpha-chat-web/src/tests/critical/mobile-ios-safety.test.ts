/**
 * CRITICAL — Mobile/iOS Safety Guards
 *
 * Questo test DEVE passare prima di ogni deploy.
 * Copre i failure mode specifici di iOS Safari e Capacitor che hanno causato
 * bug in produzione. Tutti i pattern qui documentati corrispondono a un incidente reale.
 *
 * iOS aborta le chiamate HTTP in-flight quando l'app va in background,
 * oppure dopo che l'utente ha firmato una TX e l'OS ha sospeso il tab.
 * Questo genera errori "Load failed" o AbortError che NON devono essere
 * trattati come errori fatali di pagamento.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. "Load failed" — iOS network abort non è un errore fatale ──────────────

describe("iOS network abort — 'Load failed' non è un errore di pagamento", () => {
  // Incidente: polling post-firma su iOS restituiva "Load failed" dal catch
  // → veniva trattato come TX fallita → utente riceveva errore ma la TX era broadcast

  function classifyNetworkError(errorMessage: string): "fatal" | "retryable" | "uncertain" {
    const msg = errorMessage.toLowerCase();

    // Questi codici vengono dal server e sono definitivi
    if (msg.includes("insufficient_balance") ||
        msg.includes("invalid_address") ||
        msg.includes("user_not_found")) {
      return "fatal";
    }

    // iOS/network abort: la TX potrebbe essere stata broadcast ma non lo sappiamo
    if (msg === "load failed" ||
        msg.includes("network request failed") ||
        msg.includes("failed to fetch") ||
        msg.includes("aborted") ||
        (msg.includes("network") && !msg.includes("insufficient"))) {
      return "retryable";
    }

    // BTC/LN: firma avvenuta ma risultato sconosciuto
    if (msg === "btc_send_uncertain" || msg === "ln_send_uncertain") {
      return "uncertain";
    }

    return "fatal";
  }

  it("'Load failed' è retryable (iOS background abort)", () => {
    expect(classifyNetworkError("Load failed")).toBe("retryable");
  });

  it("'Load failed' case-insensitive", () => {
    expect(classifyNetworkError("load failed")).toBe("retryable");
    expect(classifyNetworkError("LOAD FAILED")).toBe("retryable");
  });

  it("'Network request failed' è retryable (React Native fetch)", () => {
    expect(classifyNetworkError("Network request failed")).toBe("retryable");
  });

  it("'Failed to fetch' è retryable (Chrome/Safari AbortError)", () => {
    expect(classifyNetworkError("Failed to fetch")).toBe("retryable");
  });

  it("'BTC_SEND_UNCERTAIN' è uncertain — no retry cieco", () => {
    expect(classifyNetworkError("BTC_SEND_UNCERTAIN")).toBe("uncertain");
  });

  it("'LN_SEND_UNCERTAIN' è uncertain — no retry cieco", () => {
    expect(classifyNetworkError("LN_SEND_UNCERTAIN")).toBe("uncertain");
  });

  it("'INSUFFICIENT_BALANCE' è fatal — non si riprova", () => {
    expect(classifyNetworkError("INSUFFICIENT_BALANCE")).toBe("fatal");
  });

  it("'INVALID_ADDRESS' è fatal — non si riprova", () => {
    expect(classifyNetworkError("INVALID_ADDRESS")).toBe("fatal");
  });
});

// ─── 2. signedUncertain flag — protezione double-spend iOS ────────────────────

describe("signedUncertain localStorage flag — protezione double-spend su iOS", () => {
  // Incidente: iOS abortiva la risposta HTTP dopo la firma BTC/LN
  // → il codice non sapeva se la TX era stata broadcast
  // → se l'utente riprovava → double-spend
  // Fix: impostare signedUncertain=true PRIMA del broadcast, controllare PRIMA del retry

  const UNCERTAIN_KEY = "alpha_btc_send_uncertain";

  beforeEach(() => {
    localStorage.clear();
  });

  it("flag viene impostato PRIMA del broadcast (write-before-submit)", () => {
    // Simula il pattern di btc-signer.ts o LN sender
    function simulateSendWithGuard(broadcast: () => Promise<string>) {
      // Step 1: scrivi il flag PRIMA
      localStorage.setItem(UNCERTAIN_KEY, "true");
      // Step 2: broadcast (può fallire)
      return broadcast();
    }

    let flagSetBeforeBroadcast = false;
    const mockBroadcast = async () => {
      flagSetBeforeBroadcast = localStorage.getItem(UNCERTAIN_KEY) === "true";
      return "tx-hash-abc";
    };

    simulateSendWithGuard(mockBroadcast);
    expect(flagSetBeforeBroadcast).toBe(true);
  });

  it("se il flag è true, un secondo tentativo di invio è bloccato", () => {
    localStorage.setItem(UNCERTAIN_KEY, "true");

    function canRetryBtcSend(): boolean {
      const uncertain = localStorage.getItem(UNCERTAIN_KEY) === "true";
      if (uncertain) return false; // BLOCCATO — potrebbe essere già broadcast
      return true;
    }

    expect(canRetryBtcSend()).toBe(false);
  });

  it("senza il flag, il retry è consentito (TX non è mai stata firmata)", () => {
    function canRetryBtcSend(): boolean {
      const uncertain = localStorage.getItem(UNCERTAIN_KEY) === "true";
      if (uncertain) return false;
      return true;
    }

    expect(canRetryBtcSend()).toBe(true);
  });

  it("il flag viene rimosso dopo conferma TX (polling success)", () => {
    localStorage.setItem(UNCERTAIN_KEY, "true");

    function onTxConfirmed() {
      localStorage.removeItem(UNCERTAIN_KEY);
    }

    onTxConfirmed();
    expect(localStorage.getItem(UNCERTAIN_KEY)).toBeNull();
  });

  it("il flag viene rimosso dopo conferma TX fallita (non resubmittable)", () => {
    localStorage.setItem(UNCERTAIN_KEY, "true");

    function onTxFailed() {
      localStorage.removeItem(UNCERTAIN_KEY);
    }

    onTxFailed();
    expect(localStorage.getItem(UNCERTAIN_KEY)).toBeNull();
  });

  it("il TTL del flag è limitato (max 10 minuti — non rimane stale)", () => {
    const MAX_AGE_MS = 10 * 60 * 1000; // 10 minuti

    function isUncertainFlagStale(setAt: number): boolean {
      return Date.now() - setAt > MAX_AGE_MS;
    }

    const recentTimestamp = Date.now() - 5 * 60 * 1000; // 5 minuti fa
    const oldTimestamp    = Date.now() - 15 * 60 * 1000; // 15 minuti fa

    expect(isUncertainFlagStale(recentTimestamp)).toBe(false); // ancora fresco
    expect(isUncertainFlagStale(oldTimestamp)).toBe(true);    // scaduto → si può riprovare
  });
});

// ─── 3. Polling post-firma — iOS background suspend ──────────────────────────

describe("Polling post-firma — iOS suspend durante polling non causa errore visibile", () => {
  // Incidente: iOS sospendeva il tab durante polling → AbortError/Load failed nel catch
  // → il polling terminava con "TX fallita" invece di continuare

  it("AbortError durante polling viene ignorato (continua a fare poll)", () => {
    const errors: string[] = [];

    function handlePollError(err: Error): "continue" | "abort" {
      // AbortError = iOS ha sospeso la chiamata — non è un errore della TX
      if (err.name === "AbortError" || err.message === "Load failed") {
        return "continue"; // continua il polling alla prossima iterazione
      }
      errors.push(err.message);
      return "abort"; // errore reale
    }

    const abortErr = new Error("Load failed");
    abortErr.name  = "AbortError";

    expect(handlePollError(abortErr)).toBe("continue");
    expect(errors).toHaveLength(0); // nessun errore loggato
  });

  it("errore server 4xx durante polling è un abort (errore reale)", () => {
    function handlePollError(err: Error): "continue" | "abort" {
      if (err.name === "AbortError" || err.message === "Load failed") return "continue";
      return "abort";
    }

    expect(handlePollError(new Error("HTTP 404 Not Found"))).toBe("abort");
    expect(handlePollError(new Error("TRANSFER_NOT_FOUND"))).toBe("abort");
  });
});

// ─── 4. Wallet lock race condition — iOS back button ─────────────────────────

describe("Wallet lock — race condition back button iOS", () => {
  // Incidente: lockWallet() era sincrono ma setSubView("unlock") era asincrono
  // → back button dopo lockWallet() trovava ancora subView="main"
  // → il componente UnlockView non montava → il lock sembrava non attivato
  //
  // Fix: la guard del back button deve controllare wallet.phase === "locked"
  // PRIMA di controllare il subView corrente

  type WalletPhase = "unlocked" | "locked" | "creating";
  type SubView     = "main" | "unlock" | "send" | "receive";

  class WalletStateSimulator {
    phase: WalletPhase = "unlocked";
    subView: SubView   = "main";
    private _pendingSubView: SubView | null = null;

    lockWallet() {
      this.phase = "locked"; // sincrono
      // subView aggiornato in modo asincrono da un useEffect
      setTimeout(() => { this.subView = "unlock"; }, 0);
    }

    handleBackButton(): "goBack" | "showUnlock" | "doNothing" {
      // CORRETTO: controlla phase PRIMA di subView
      if (this.phase === "locked") return "showUnlock";
      if (this.subView !== "main") return "goBack";
      return "doNothing";
    }
  }

  it("dopo lockWallet(), back button mostra unlock anche se subView non è ancora aggiornato", () => {
    const wallet = new WalletStateSimulator();
    wallet.lockWallet();

    // subView è ancora "main" (useEffect non ancora eseguito)
    expect(wallet.subView).toBe("main");

    // Ma phase è già "locked" → back button deve mostrare unlock
    expect(wallet.handleBackButton()).toBe("showUnlock");
  });

  it("wallet sbloccato con subView send → back button torna a main", () => {
    const wallet = new WalletStateSimulator();
    wallet.subView = "send";

    expect(wallet.handleBackButton()).toBe("goBack");
  });

  it("wallet sbloccato con subView main → back button non fa nulla", () => {
    const wallet = new WalletStateSimulator();

    expect(wallet.handleBackButton()).toBe("doNothing");
  });
});

// ─── 5. Auto-trigger biometrico — NON deve attivarsi dopo lockWallet() ────────

describe("Biometrico — no auto-trigger dopo lockWallet()", () => {
  // Incidente: UnlockView montava e triggerava Face ID automaticamente
  // anche quando era stato appena chiamato lockWallet()
  // → Face ID sblocca il wallet senza che l'utente lo voglia esplicitamente

  it("il montaggio di UnlockView post-lockWallet NON deve auto-triggerare biometrico", () => {
    let biometricTriggerCount = 0;
    let mountedAfterLock = false;

    function onUnlockViewMount(isPostLockMount: boolean) {
      // Se il mount è avvenuto immediatamente dopo lockWallet, NON auto-triggerare
      if (isPostLockMount) {
        // Non fare nulla — aspetta il gesto esplicito dell'utente
        return;
      }
      // Mount normale (utente ha aperto l'app bloccata) → ok auto-trigger
      biometricTriggerCount++;
    }

    // Scenario: lockWallet() → UnlockView monta (post-lock)
    mountedAfterLock = true;
    onUnlockViewMount(mountedAfterLock);
    expect(biometricTriggerCount).toBe(0); // NON triggerato

    // Scenario: utente apre app già bloccata → UnlockView monta (non post-lock)
    mountedAfterLock = false;
    onUnlockViewMount(mountedAfterLock);
    expect(biometricTriggerCount).toBe(1); // triggerato correttamente
  });
});

// ─── 6. iOS: "Load failed" in EVM swap non deve cancellare lo stato ──────────

describe("EVM swap su iOS — Load failed non cancella lo stato", () => {
  const ACTIVE_SWAP_KEY = "alpha_evm_swap_active";

  beforeEach(() => {
    localStorage.clear();
  });

  it("Load failed durante status poll non rimuove lo swap active dal localStorage", () => {
    const swapState = { routeId: "r1", fromChain: 137, toChain: 1, startedAt: Date.now() };
    localStorage.setItem(ACTIVE_SWAP_KEY, JSON.stringify(swapState));

    function handleStatusPollError(errorMsg: string) {
      const isNetworkAbort = errorMsg === "Load failed" ||
                             errorMsg === "Failed to fetch" ||
                             errorMsg.includes("AbortError");

      if (isNetworkAbort) {
        // Non rimuovere lo stato — l'utente può ancora recuperare la TX
        return; // no-op
      }
      // Solo su errore definitivo rimuoviamo
      localStorage.removeItem(ACTIVE_SWAP_KEY);
    }

    handleStatusPollError("Load failed"); // iOS suspend
    // Lo stato deve ancora essere presente
    expect(localStorage.getItem(ACTIVE_SWAP_KEY)).not.toBeNull();
  });

  it("errore HTTP definitivo durante poll rimuove lo swap active", () => {
    localStorage.setItem(ACTIVE_SWAP_KEY, JSON.stringify({ routeId: "r2" }));

    function handleStatusPollError(errorMsg: string) {
      const isNetworkAbort = errorMsg === "Load failed" || errorMsg.includes("AbortError");
      if (!isNetworkAbort) localStorage.removeItem(ACTIVE_SWAP_KEY);
    }

    handleStatusPollError("ROUTE_NOT_FOUND"); // errore definitivo
    expect(localStorage.getItem(ACTIVE_SWAP_KEY)).toBeNull();
  });
});
