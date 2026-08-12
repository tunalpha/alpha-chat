/**
 * BREEZ SPARK — LIVE ADAPTER
 *
 * Wrappa il reale @breeztech/breez-sdk-spark.
 * Importato SOLO quando VITE_BREEZ_API_KEY è configurata.
 * La private key e il mnemonic non lasciano MAI il browser.
 * Nessun secret nei log.
 */

import type { BreezSparkAdapter } from '../adapter';
import type {
  SparkInfo, SparkBalance, ReceiveRequest, ReceiveResponse,
  PrepareSendRequest, PrepareSendResponse, SendRequest, SendResponse,
  ListPaymentsRequest, SparkPayment, ParsedInput, SparkNetworkStatus,
  WebhookConfig, SparkTxType,
} from '../types';
import { SPARK_STORAGE_DIR, SPARK_TIMEOUTS } from '../constants';
import { calculateAlphaFee } from '../fee-model';

// ─── LiveBreezAdapter ─────────────────────────────────────────────────────────

export class LiveBreezAdapter implements BreezSparkAdapter {
  readonly adapterType = 'live' as const;

  private sdk: unknown = null;

  async connect(apiKey: string | null, mnemonic: string, network: 'mainnet' | 'regtest'): Promise<void> {
    if (!apiKey) throw new Error('LiveBreezAdapter richiede API key — usare MockBreezAdapter quando assente');

    // Import lazy — non carica WASM se API key non presente
    const sdkModule = await import('@breeztech/breez-sdk-spark') as Record<string, unknown>;

    // Inizializza WASM + IDB storage
    if (typeof sdkModule['default'] === 'function') {
      await (sdkModule['default'] as () => Promise<void>)();
    }

    const defaultConfig = sdkModule['defaultConfig'] as (n: string) => Record<string, unknown>;
    const connect = sdkModule['connect'] as (req: unknown) => Promise<unknown>;

    const cfg = defaultConfig(network);
    // API key: non loggare mai il valore
    (cfg as Record<string, unknown>)['apiKey'] = apiKey;

    const connectPromise = connect({
      config: cfg,
      seed: { type: 'mnemonic', mnemonic },
      storageDir: SPARK_STORAGE_DIR,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`connect() timeout ${SPARK_TIMEOUTS.CONNECT_MS}ms`)), SPARK_TIMEOUTS.CONNECT_MS)
    );

    this.sdk = await Promise.race([connectPromise, timeoutPromise]);
    console.log('[LiveBreezAdapter] connected — mnemonic NON trasmesso');
    // SICUREZZA: non loggare apiKey, mnemonic, o private key
  }

  async disconnect(): Promise<void> {
    const sdk = this.sdk as Record<string, unknown> | null;
    if (sdk && typeof sdk['disconnect'] === 'function') {
      await (sdk['disconnect'] as () => Promise<void>)();
    }
    this.sdk = null;
  }

  private requireSdk(): Record<string, unknown> {
    if (!this.sdk) throw new Error('LiveBreezAdapter: not connected — chiamare connect() prima');
    return this.sdk as Record<string, unknown>;
  }

  async getInfo(ensureSynced = false): Promise<SparkInfo> {
    const sdk = this.requireSdk();
    const getInfo = sdk['getInfo'] as (r: { ensureSynced?: boolean }) => Promise<Record<string, unknown>>;
    const raw = await getInfo({ ensureSynced });

    return {
      identityPubkey: (raw['identityPubkey'] as string) ?? '',
      balanceSats: BigInt((raw['balanceSats'] as number | bigint) ?? 0),
      tokenBalances: (raw['tokenBalances'] as Record<string, bigint>) ?? {},
      network: 'mainnet',
      synced: true,
      sparkAddress: (raw['sparkAddress'] as string) ?? '',
    };
  }

  async getBalance(): Promise<SparkBalance> {
    const info = await this.getInfo(false);
    return {
      totalSats: info.balanceSats,
      confirmedSats: info.balanceSats,
      pendingSats: 0n,
    };
  }

  async receive(req: ReceiveRequest): Promise<ReceiveResponse> {
    const sdk = this.requireSdk();
    const receivePayment = sdk['receivePayment'] as (r: unknown) => Promise<{ paymentRequest: string; fee: bigint }>;

    let paymentMethod: Record<string, unknown>;
    if (req.method === 'sparkAddress') {
      paymentMethod = { type: 'sparkAddress' };
    } else {
      paymentMethod = {
        type: 'bolt11Invoice',
        description: req.description ?? 'Alpha Chat payment',
        amountSats: req.amountSats ?? 1000,
        expirySecs: req.expirySecs ?? SPARK_TIMEOUTS.RECEIVE_INVOICE_EXPIRY_SEC,
      };
    }

    const resp = await receivePayment({ paymentMethod });
    return {
      paymentRequest: resp.paymentRequest,
      feeSats: BigInt(resp.fee ?? 0),
      method: req.method,
      qrData: req.method === 'bolt11Invoice'
        ? resp.paymentRequest.toUpperCase()
        : resp.paymentRequest,
    };
  }

  async prepareSend(req: PrepareSendRequest): Promise<PrepareSendResponse> {
    const sdk = this.requireSdk();
    const prepareSendFn = sdk['prepareSendPayment'] as (r: unknown) => Promise<{
      recipientAmountSat?: bigint;
      feesSat?: bigint;
    }>;

    const raw = await prepareSendFn({
      paymentRequest: req.paymentRequest,
      feePolicy: 'feesExcluded',
      ...(req.amountSats ? { amountSats: req.amountSats } : {}),
    });

    const recipientSats = BigInt(raw['recipientAmountSat'] ?? req.amountSats ?? 0n);
    const networkFeeSats = BigInt(raw['feesSat'] ?? 0n);
    const alphaFeeSats = calculateAlphaFee(recipientSats);

    // Rilevamento tipo invio
    const input = req.paymentRequest;
    let sendMethod = 'bolt11' as PrepareSendResponse['sendMethod'];
    if (input.startsWith('lno')) sendMethod = 'bolt12';
    else if (input.includes('@')) sendMethod = 'lightningAddress';
    else if (input.startsWith('lnurl')) sendMethod = 'lnurlPay';
    else if (input.startsWith('sprt') || input.startsWith('sp1')) sendMethod = 'sparkAddress';

    return {
      recipientSats,
      networkFeeSats,
      alphaFeeSats,
      totalSenderSats: recipientSats + networkFeeSats + alphaFeeSats,
      paymentRequest: req.paymentRequest,
      sendMethod,
      _sdkPrepareResponse: raw,
    };
  }

  async send(req: SendRequest): Promise<SendResponse> {
    const sdk = this.requireSdk();
    const sendPayment = sdk['sendPayment'] as (r: unknown) => Promise<{
      payment?: { paymentHash?: string; amountSat?: bigint; feesSat?: bigint };
    }>;

    const raw = await sendPayment({ prepareResponse: req.prepareResponse._sdkPrepareResponse });

    const type: SparkTxType =
      req.prepareResponse.sendMethod === 'sparkAddress' || req.prepareResponse.sendMethod === 'sparkInvoice'
        ? 'spark_sent'
        : 'btc_lightning_sent';

    return {
      paymentId: raw?.payment?.paymentHash ?? `pay_${Date.now()}`,
      status: 'complete',
      feePaidSats: BigInt(raw?.payment?.feesSat ?? 0n),
      paymentHash: raw?.payment?.paymentHash,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  async listPayments(req?: ListPaymentsRequest): Promise<SparkPayment[]> {
    const sdk = this.requireSdk();
    const listFn = sdk['listPayments'] as (r: unknown) => Promise<{ payments: unknown[] }>;

    const raw = await listFn({
      limit: req?.limit ?? 50,
      offset: req?.offset ?? 0,
    });

    return (raw.payments ?? []).map((p: unknown): SparkPayment => {
      const payment = p as Record<string, unknown>;
      const isSent = (payment['paymentType'] as string)?.toLowerCase().includes('send');
      const isLightning = (payment['paymentType'] as string)?.toLowerCase().includes('lightning');
      const isSpark = (payment['paymentType'] as string)?.toLowerCase().includes('spark');

      const type: SparkTxType = isSent
        ? (isSpark ? 'spark_sent' : 'btc_lightning_sent')
        : (isSpark ? 'spark_received' : 'btc_lightning_received');

      return {
        id: (payment['id'] as string) ?? String(Date.now()),
        type,
        amountSats: BigInt((payment['amountSat'] as number | bigint) ?? 0),
        feeSats: BigInt((payment['feesSat'] as number | bigint) ?? 0),
        status: ((payment['status'] as string) ?? 'complete') as 'complete' | 'pending' | 'failed',
        timestamp: Number(payment['timestamp'] ?? 0),
        description: payment['description'] as string | undefined,
        paymentHash: payment['paymentHash'] as string | undefined,
      };
    });
  }

  async sync(): Promise<void> {
    const sdk = this.requireSdk();
    if (typeof sdk['sync'] === 'function') {
      await (sdk['sync'] as () => Promise<void>)();
    }
  }

  async registerWebhook(config: WebhookConfig): Promise<void> {
    const sdk = this.requireSdk();
    if (typeof sdk['registerWebhook'] === 'function') {
      await (sdk['registerWebhook'] as (url: string) => Promise<void>)(config.url);
    }
  }

  async parse(input: string): Promise<ParsedInput> {
    const sdk = this.requireSdk();
    const parseFn = sdk['parse'] as (s: string) => Promise<Record<string, unknown>>;
    const raw = await parseFn(input);

    const typeMap: Record<string, ParsedInput['type']> = {
      bolt11: 'bolt11',
      bolt12Offer: 'bolt12',
      lightningAddress: 'lightningAddress',
      lnurlPay: 'lnurlPay',
      lnurlWithdraw: 'lnurlPay',
      sparkAddress: 'sparkAddress',
      sparkInvoice: 'sparkInvoice',
    };

    const rawType = raw['type'] as string;
    return {
      type: typeMap[rawType] ?? 'bolt11',
      rawInput: input,
      amountSats: raw['amountSats'] !== undefined ? BigInt(raw['amountSats'] as number) : undefined,
      description: raw['description'] as string | undefined,
    };
  }

  async getNetworkStatus(): Promise<SparkNetworkStatus> {
    // CORS blocked nel browser — restituisce unknown
    return {
      status: 'unknown',
      lastUpdated: Math.floor(Date.now() / 1000),
      corsBlocked: true,
    };
  }
}
