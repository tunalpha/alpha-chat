/**
 * BREEZ SPARK — MOCK ADAPTER
 *
 * Simulazione locale completa — nessuna dipendenza da @breeztech/breez-sdk-spark.
 * Usato quando VITE_BREEZ_API_KEY non è configurata.
 * NESSUNA transazione reale. NESSUN pagamento reale.
 */

import type { BreezSparkAdapter } from '../adapter';
import type {
  SparkInfo, SparkBalance, ReceiveRequest, ReceiveResponse,
  PrepareSendRequest, PrepareSendResponse, SendRequest, SendResponse,
  ListPaymentsRequest, SparkPayment, ParsedInput, SparkNetworkStatus,
  WebhookConfig, SparkTxType, SendMethod,
} from '../types';
import { SPARK_DERIVATION, SPARK_FEE } from '../constants';
import { calculateAlphaFee } from '../fee-model';

// ─── Dati mock ────────────────────────────────────────────────────────────────

const MOCK_IDENTITY_PUBKEY = '0281363910b0dc0015a4a25e758da30f0e28388ea5252c0e3713936f2d4ef7d3d5';
const MOCK_SPARK_ADDRESS = 'sprt1qw508d6qejxtdg4y5r3zarvary0c5xw7k8txkqf';
const MOCK_BALANCE_SATS = 12_500n;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms = 600): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

function mockBolt11(amountSats: number): string {
  return `lnbc${amountSats}n1pjmock000pp5mock_invoice_${Date.now()}_breez_spark_poc_test_no_real_funds`;
}

function detectSendMethod(input: string): SendMethod {
  if (input.startsWith('lnbc') || input.startsWith('lntbs') || input.startsWith('lnbcrt')) return 'bolt11';
  if (input.startsWith('lno')) return 'bolt12';
  if (input.includes('@') && !input.startsWith('sp')) return 'lightningAddress';
  if (input.startsWith('lnurl')) return 'lnurlPay';
  if (input.startsWith('sprt') || input.startsWith('sp1')) return 'sparkAddress';
  if (input.startsWith('bc1') || input.startsWith('sp')) return 'sparkAddress';
  return 'bolt11';
}

// ─── MockBreezAdapter ─────────────────────────────────────────────────────────

export class MockBreezAdapter implements BreezSparkAdapter {
  readonly adapterType = 'mock' as const;

  private _connected = false;
  private _network: 'mainnet' | 'regtest' = 'mainnet';
  private _identityPubkey = MOCK_IDENTITY_PUBKEY;
  private _payments: SparkPayment[] = [];

  async connect(_apiKey: string | null, _mnemonic: string, network: 'mainnet' | 'regtest'): Promise<void> {
    await delay(800);
    this._network = network;
    this._connected = true;
    console.log('[MockBreezAdapter] connect() — simulazione locale, nessun API key, nessun pagamento reale');
  }

  async disconnect(): Promise<void> {
    await delay(200);
    this._connected = false;
  }

  async getInfo(ensureSynced = false): Promise<SparkInfo> {
    if (!this._connected) throw new Error('MockAdapter: not connected');
    if (ensureSynced) await delay(400);
    return {
      identityPubkey: this._identityPubkey,
      balanceSats: MOCK_BALANCE_SATS,
      tokenBalances: {},
      network: this._network,
      synced: true,
      sparkAddress: MOCK_SPARK_ADDRESS,
    };
  }

  async getBalance(): Promise<SparkBalance> {
    if (!this._connected) throw new Error('MockAdapter: not connected');
    return {
      totalSats: MOCK_BALANCE_SATS,
      confirmedSats: MOCK_BALANCE_SATS - 500n,
      pendingSats: 500n,
    };
  }

  async receive(req: ReceiveRequest): Promise<ReceiveResponse> {
    if (!this._connected) throw new Error('MockAdapter: not connected');
    await delay(400);

    if (req.method === 'sparkAddress') {
      return {
        paymentRequest: MOCK_SPARK_ADDRESS,
        feeSats: 0n,
        method: 'sparkAddress',
        qrData: MOCK_SPARK_ADDRESS,
      };
    }

    // bolt11Invoice
    const amount = req.amountSats ?? 1000;
    const invoice = mockBolt11(amount);
    return {
      paymentRequest: invoice,
      feeSats: 1n,
      method: 'bolt11Invoice',
      qrData: invoice.toUpperCase(), // QR convention
    };
  }

  async prepareSend(req: PrepareSendRequest): Promise<PrepareSendResponse> {
    await delay(300);

    const amountSats = req.amountSats ?? 1000n;
    const alphaFeeSats = calculateAlphaFee(amountSats);
    const method = detectSendMethod(req.paymentRequest);

    return {
      recipientSats: amountSats,
      networkFeeSats: 0n, // Sconosciuto — mock ritorna 0 (in produzione viene dall'SDK)
      alphaFeeSats,
      totalSenderSats: amountSats + alphaFeeSats,
      paymentRequest: req.paymentRequest,
      sendMethod: method,
      _sdkPrepareResponse: { mock: true },
    };
  }

  async send(req: SendRequest): Promise<SendResponse> {
    if (!this._connected) throw new Error('MockAdapter: not connected');
    await delay(1000);

    const type: SparkTxType =
      req.prepareResponse.sendMethod === 'sparkAddress' || req.prepareResponse.sendMethod === 'sparkInvoice'
        ? 'spark_sent'
        : 'btc_lightning_sent';

    const payment: SparkPayment = {
      id: `mock_pay_${Date.now()}`,
      type,
      amountSats: req.prepareResponse.recipientSats,
      feeSats: req.prepareResponse.alphaFeeSats,
      status: 'complete',
      timestamp: Math.floor(Date.now() / 1000),
      description: `Mock payment (${req.prepareResponse.sendMethod})`,
      paymentHash: `mock_hash_${Date.now().toString(16)}`,
    };

    this._payments.unshift(payment);

    return {
      paymentId: payment.id,
      status: 'complete',
      feePaidSats: payment.feeSats,
      paymentHash: payment.paymentHash,
      timestamp: payment.timestamp,
    };
  }

  async listPayments(req?: ListPaymentsRequest): Promise<SparkPayment[]> {
    await delay(100);
    let result = [...this._payments];

    if (req?.typeFilter?.includes('sent') && !req?.typeFilter?.includes('received')) {
      result = result.filter(p => p.type.endsWith('_sent'));
    } else if (req?.typeFilter?.includes('received') && !req?.typeFilter?.includes('sent')) {
      result = result.filter(p => p.type.endsWith('_received'));
    }

    if (req?.limit) result = result.slice(req.offset ?? 0, (req.offset ?? 0) + req.limit);
    return result;
  }

  async sync(): Promise<void> {
    await delay(500);
    console.log('[MockBreezAdapter] sync() — simulazione foreground re-sync');
  }

  async registerWebhook(config: WebhookConfig): Promise<void> {
    console.log('[MockBreezAdapter] registerWebhook() — URL:', config.url, '(simulazione)');
    await delay(100);
  }

  async parse(input: string): Promise<ParsedInput> {
    await delay(100);
    const type = detectSendMethod(input);
    return {
      type,
      rawInput: input,
      amountSats: undefined,
      description: `Mock parse — tipo: ${type}`,
    };
  }

  async getNetworkStatus(): Promise<SparkNetworkStatus> {
    return {
      status: 'operational',
      lastUpdated: Math.floor(Date.now() / 1000),
      corsBlocked: true, // sempre true nel browser
    };
  }

  /** Derivation info (mock — documenta la separazione) */
  getDerivationInfo(): Record<string, string> {
    return {
      sparkPurpose: `m/${SPARK_DERIVATION.PURPOSE}'`,
      identityPath: SPARK_DERIVATION.FULL_PATHS.identity,
      btcOnChainPath: SPARK_DERIVATION.BTC_ON_CHAIN_PATH,
      collision: 'NESSUNA — purpose field diversi (8797555 vs 84)',
      accountMainnet: String(SPARK_DERIVATION.ACCOUNT_NUMBER.mainnet),
    };
  }
}
