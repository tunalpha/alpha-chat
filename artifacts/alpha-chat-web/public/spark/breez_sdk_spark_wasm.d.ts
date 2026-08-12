/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

type ReadableStreamType = "bytes";

/** Serialized tree node. Key fields used by store implementations: id, status, value. */
interface TreeNode {
    id: string;
    tree_id: string;
    value: number;
    status: string;
    [key: string]: unknown;
}

interface Leaves {
    available: TreeNode[];
    notAvailable: TreeNode[];
    availableMissingFromOperators: TreeNode[];
    reservedForPayment: TreeNode[];
    reservedForSwap: TreeNode[];
}

interface LeavesReservation {
    id: string;
    leaves: TreeNode[];
}

type TargetAmounts =
| { type: 'amountAndFee'; amountSats: number; feeSats: number | null }
| { type: 'exactDenominations'; denominations: number[] };

type ReserveResult =
| { type: 'success'; reservation: LeavesReservation }
| { type: 'insufficientFunds' }
| { type: 'waitForPending'; needed: number; available: number; pending: number };

export interface TreeStore {
    addLeaves: (leaves: TreeNode[]) => Promise<void>;
    getLeaves: () => Promise<Leaves>;
    getAvailableBalance: () => Promise<bigint>;
    setLeaves: (leaves: TreeNode[], missingLeaves: TreeNode[], refreshStartedAtMs: number) => Promise<void>;
    cancelReservation: (id: string, leavesToKeep: TreeNode[]) => Promise<void>;
    finalizeReservation: (id: string, newLeaves: TreeNode[] | null) => Promise<void>;
    tryReserveLeaves: (targetAmounts: TargetAmounts | null, exactOnly: boolean, purpose: string) => Promise<ReserveResult>;
    now: () => Promise<number>;
    updateReservation: (reservationId: string, reservedLeaves: TreeNode[], changeLeaves: TreeNode[]) => Promise<LeavesReservation>;
}


interface WasmTokenMetadata {
    identifier: string;
    issuerPublicKey: string;
    name: string;
    ticker: string;
    decimals: number;
    maxSupply: string;
    isFreezable: boolean;
    creationEntityPublicKey: string | null;
}

interface WasmTokenOutput {
    id: string;
    ownerPublicKey: string;
    revocationCommitment: string;
    withdrawBondSats: number;
    withdrawRelativeBlockLocktime: number;
    tokenPublicKey: string | null;
    tokenIdentifier: string;
    tokenAmount: string;
}

interface WasmTokenOutputWithPrevOut {
    output: WasmTokenOutput;
    prevTxHash: string;
    prevTxVout: number;
}

interface WasmTokenOutputs {
    metadata: WasmTokenMetadata;
    outputs: WasmTokenOutputWithPrevOut[];
}

interface WasmTokenOutputsPerStatus {
    metadata: WasmTokenMetadata;
    available: WasmTokenOutputWithPrevOut[];
    reservedForPayment: WasmTokenOutputWithPrevOut[];
    reservedForSwap: WasmTokenOutputWithPrevOut[];
}

interface WasmTokenOutputsReservation {
    id: string;
    tokenOutputs: WasmTokenOutputs;
}

interface WasmTokenBalance {
    metadata: WasmTokenMetadata;
    balance: string;
}

type WasmGetTokenOutputsFilter =
| { type: 'identifier'; identifier: string }
| { type: 'issuerPublicKey'; issuerPublicKey: string };

type WasmReservationTarget =
| { type: 'minTotalValue'; value: string }
| { type: 'maxOutputCount'; value: number };

export interface TokenStore {
    setTokensOutputs: (tokenOutputs: WasmTokenOutputs[], refreshStartedAtMs: number) => Promise<void>;
    listTokensOutputs: () => Promise<WasmTokenOutputsPerStatus[]>;
    getTokenBalances: () => Promise<WasmTokenBalance[]>;
    getTokenOutputs: (filter: WasmGetTokenOutputsFilter) => Promise<WasmTokenOutputsPerStatus>;
    updateTokenOutputs: (outputsToRemove: [string, number][], outputsToAdd: WasmTokenOutputs | null) => Promise<void>;
    reserveTokenOutputs: (
    tokenIdentifier: string,
    target: WasmReservationTarget,
    purpose: string,
    preferredOutputs: WasmTokenOutputWithPrevOut[] | null,
    selectionStrategy: string | null
    ) => Promise<WasmTokenOutputsReservation>;
    cancelReservation: (id: string) => Promise<void>;
    finalizeReservation: (id: string) => Promise<void>;
    now: () => Promise<number>;
}

/**
 * A wallet derived from a passkey.
 */
export interface Wallet {
    /**
     * The derived seed.
     */
    seed: Seed;
    /**
     * The label used for derivation.
     */
    label: string;
}

/**
 * Configuration for MySQL storage connection pool. Targets MySQL 8.0+.
 */
export interface MysqlStorageConfig {
    /**
     * MySQL connection URL (e.g. `mysql://user:pass@host:3306/dbname`).
     */
    connectionString: string;
    /**
     * Maximum number of connections in the pool.
     */
    maxPoolSize: number;
    /**
     * Timeout in seconds for establishing a new connection (0 = no timeout).
     */
    createTimeoutSecs: number;
    /**
     * Timeout in seconds before recycling an idle connection.
     */
    recycleTimeoutSecs: number;
    /**
     * Whether the SDK should run schema migrations on startup. Set to
     * `false` when the embedding service owns and migrates the database
     * schema. Defaults to `true`.
     */
    runMigration?: boolean;
    /**
     * Whether migrations should create database-enforced foreign keys.
     *
     * Use `Disabled` for environments that manage relationships in
     * application code and require schema changes without foreign-key
     * constraints.
     */
    foreignKeyMode?: MysqlForeignKeyMode;
}

/**
 * Configuration for PostgreSQL storage connection pool.
 */
export interface PostgresStorageConfig {
    /**
     * PostgreSQL connection string (URI format).
     */
    connectionString: string;
    /**
     * Maximum number of connections in the pool.
     */
    maxPoolSize: number;
    /**
     * Timeout in seconds for establishing a new connection (0 = no timeout).
     */
    createTimeoutSecs: number;
    /**
     * Timeout in seconds before recycling an idle connection.
     */
    recycleTimeoutSecs: number;
    /**
     * Whether the SDK should run schema migrations on startup. Set to
     * `false` when the embedding service owns and migrates the database
     * schema. Defaults to `true`.
     */
    runMigration?: boolean;
}

/**
 * Controls whether MySQL migrations create database-enforced foreign keys.
 */
export type MysqlForeignKeyMode = "Enforced" | "Disabled";

/**
 * Interface for passkey PRF (Pseudo-Random Function) operations.
 *
 * Implement this interface to provide passkey PRF functionality for seedless wallet restore.
 *
 * @example
 * ```typescript
 * class BrowserPasskeyPrfProvider implements PasskeyPrfProvider {
 *     async derivePrfSeed(salt: string): Promise<Uint8Array> {
 *         const credential = await navigator.credentials.get({
 *             publicKey: {
 *                 challenge: new Uint8Array(32),
 *                 rpId: window.location.hostname,
 *                 allowCredentials: [], // or specific credential IDs
 *                 extensions: {
 *                     prf: { eval: { first: new TextEncoder().encode(salt) } }
 *                 }
 *             }
 *         });
 *         const results = credential.getClientExtensionResults();
 *         return new Uint8Array(results.prf.results.first);
 *     }
 *
 *     async isPrfAvailable(): Promise<boolean> {
 *         return window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.() ?? false;
 *     }
 * }
 * ```
 */
export interface PasskeyPrfProvider {
    /**
     * Derive a 32-byte seed from passkey PRF with the given salt.
     *
     * The platform authenticates the user via passkey and evaluates the PRF extension.
     * The salt is used as input to the PRF to derive a deterministic output.
     *
     * @param salt - The salt string to use for PRF evaluation
     * @returns A Promise resolving to the 32-byte PRF output
     * @throws If authentication fails or PRF is not supported
     */
    derivePrfSeed(salt: string): Promise<Uint8Array>;

    /**
     * Check if a PRF-capable passkey is available on this device.
     *
     * This allows applications to gracefully degrade if passkey PRF is not supported.
     *
     * @returns A Promise resolving to true if PRF-capable passkey is available
     */
    isPrfAvailable(): Promise<boolean>;
}

/**
 * Nostr relay configuration for passkey label operations.
 *
 * Used by `Passkey.listLabels` and `Passkey.storeLabel`.
 */
export interface NostrRelayConfig {
    /**
     * Optional Breez API key for authenticated access to the Breez relay.
     * When provided, the Breez relay is added and NIP-42 authentication is enabled.
     */
    breezApiKey?: string;
    /**
     * Connection timeout in seconds. Defaults to 30 when `None`.
     */
    timeoutSecs?: number;
}

/**
 * Settings for `newSharedSdkContext`. `network` is required; all other
 * fields are optional.
 */
export interface WasmSdkContextConfig {
    /**
     * Network the shared resources target. Used to gate the partner JWT
     * header provider — only constructed on Mainnet.
     */
    network: Network;
    /**
     * Breez API key. When set together with `network == Mainnet`, the
     * context constructs a shared partner JWT header provider that all
     * SDKs built from this context will attach to their SO requests.
     */
    apiKey?: string;
    /**
     * Number of gRPC connections per Spark operator. `None` (or `Some(1)`)
     * keeps a single connection per operator (right for most deployments);
     * `Some(n)` opens `n` channels per operator and balances requests.
     */
    connectionsPerOperator?: number;
    /**
     * PostgreSQL backend configuration. When set, SDKs constructed with
     * this context store their data in PostgreSQL via the shared pool.
     */
    postgresConfig?: PostgresStorageConfig;
    /**
     * MySQL backend configuration. When set, SDKs constructed with this
     * context store their data in MySQL via the shared pool.
     */
    mysqlConfig?: MysqlStorageConfig;
}

export interface AddContactRequest {
    name: string;
    paymentIdentifier: string;
}

export interface AesSuccessActionData {
    description: string;
    ciphertext: string;
    iv: string;
}

export interface AesSuccessActionDataDecrypted {
    description: string;
    plaintext: string;
}

export interface Bip21Details {
    amountSat?: number;
    assetId?: string;
    uri: string;
    extras: Bip21Extra[];
    label?: string;
    message?: string;
    paymentMethods: InputType[];
}

export interface Bip21Extra {
    key: string;
    value: string;
}

export interface BitcoinAddressDetails {
    address: string;
    network: BitcoinNetwork;
    source: PaymentRequestSource;
}

export interface BitcoinChainService {
    getAddressUtxos(address: string): Promise<Utxo[]>;
    getTransactionStatus(txid: string): Promise<TxStatus>;
    getTransactionHex(txid: string): Promise<string>;
    broadcastTransaction(tx: string): Promise<void>;
    recommendedFees(): Promise<RecommendedFees>;
}

export interface Bolt11Invoice {
    bolt11: string;
    source: PaymentRequestSource;
}

export interface Bolt11InvoiceDetails {
    amountMsat?: number;
    description?: string;
    descriptionHash?: string;
    expiry: number;
    invoice: Bolt11Invoice;
    minFinalCltvExpiryDelta: number;
    network: BitcoinNetwork;
    payeePubkey: string;
    paymentHash: string;
    paymentSecret: string;
    routingHints: Bolt11RouteHint[];
    timestamp: number;
}

export interface Bolt11RouteHint {
    hops: Bolt11RouteHintHop[];
}

export interface Bolt11RouteHintHop {
    srcNodeId: string;
    shortChannelId: string;
    feesBaseMsat: number;
    feesProportionalMillionths: number;
    cltvExpiryDelta: number;
    htlcMinimumMsat?: number;
    htlcMaximumMsat?: number;
}

export interface Bolt12Invoice {
    invoice: string;
    source: PaymentRequestSource;
}

export interface Bolt12InvoiceDetails {
    amountMsat: number;
    invoice: Bolt12Invoice;
}

export interface Bolt12InvoiceRequestDetails {}

export interface Bolt12Offer {
    offer: string;
    source: PaymentRequestSource;
}

export interface Bolt12OfferBlindedPath {
    blindedHops: string[];
}

export interface Bolt12OfferDetails {
    absoluteExpiry?: number;
    chains: string[];
    description?: string;
    issuer?: string;
    minAmount?: Amount;
    offer: Bolt12Offer;
    paths: Bolt12OfferBlindedPath[];
    signingPubkey?: string;
}

export interface BurnIssuerTokenRequest {
    amount: bigint;
}

export interface BuyBitcoinResponse {
    url: string;
}

export interface CheckLightningAddressRequest {
    username: string;
}

export interface CheckMessageRequest {
    message: string;
    pubkey: string;
    signature: string;
}

export interface CheckMessageResponse {
    isValid: boolean;
}

export interface ClaimDepositRequest {
    txid: string;
    vout: number;
    maxFee?: MaxFee;
}

export interface ClaimDepositResponse {
    payment: Payment;
}

export interface ClaimHtlcPaymentRequest {
    preimage: string;
}

export interface ClaimHtlcPaymentResponse {
    payment: Payment;
}

export interface Config {
    apiKey?: string;
    network: Network;
    syncIntervalSecs: number;
    maxDepositClaimFee?: MaxFee;
    lnurlDomain?: string;
    preferSparkOverLightning: boolean;
    externalInputParsers?: ExternalInputParser[];
    useDefaultExternalInputParsers: boolean;
    realTimeSyncServerUrl?: string;
    privateEnabledDefault: boolean;
    leafOptimizationConfig: LeafOptimizationConfig;
    tokenOptimizationConfig: TokenOptimizationConfig;
    stableBalanceConfig?: StableBalanceConfig;
    /**
     * Maximum number of concurrent transfer claims.
     *
     * Controls how many pending Spark transfers can be claimed in parallel.
     * Default is 4. Increase for server environments with high incoming
     * payment volume to improve throughput.
     */
    maxConcurrentClaims: number;
    sparkConfig?: SparkConfig;
    backgroundTasksEnabled: boolean;
}

export interface ConnectRequest {
    config: Config;
    seed: Seed;
    storageDir: string;
}

export interface Contact {
    id: string;
    name: string;
    paymentIdentifier: string;
    createdAt: number;
    updatedAt: number;
}

export interface ConversionDetails {
    status: ConversionStatus;
    from?: ConversionStep;
    to?: ConversionStep;
}

export interface ConversionEstimate {
    options: ConversionOptions;
    amountIn: bigint;
    amountOut: bigint;
    fee: bigint;
    amountAdjustment?: AmountAdjustmentReason;
}

export interface ConversionInfo {
    poolId: string;
    conversionId: string;
    status: ConversionStatus;
    fee?: string;
    purpose?: ConversionPurpose;
    amountAdjustment?: AmountAdjustmentReason;
}

export interface ConversionOptions {
    conversionType: ConversionType;
    maxSlippageBps?: number;
    completionTimeoutSecs?: number;
}

export interface ConversionStep {
    paymentId: string;
    amount: bigint;
    fee: bigint;
    method: PaymentMethod;
    tokenMetadata?: TokenMetadata;
    amountAdjustment?: AmountAdjustmentReason;
}

export interface CreateIssuerTokenRequest {
    name: string;
    ticker: string;
    decimals: number;
    isFreezable: boolean;
    maxSupply: bigint;
}

export interface Credentials {
    username: string;
    password: string;
}

export interface CurrencyInfo {
    name: string;
    fractionSize: number;
    spacing?: number;
    symbol?: Symbol;
    uniqSymbol?: Symbol;
    localizedName: LocalizedName[];
    localeOverrides: LocaleOverrides[];
}

export interface DepositInfo {
    txid: string;
    vout: number;
    amountSats: number;
    isMature: boolean;
    refundTx?: string;
    refundTxId?: string;
    claimError?: DepositClaimError;
}

export interface EcdsaSignatureBytes {
    bytes: number[];
}

export interface EventListener {
    onEvent: (e: SdkEvent) => void;
}

export interface ExternalAggregateFrostRequest {
    message: number[];
    statechainSignatures: IdentifierSignaturePair[];
    statechainPublicKeys: IdentifierPublicKeyPair[];
    verifyingKey: number[];
    statechainCommitments: IdentifierCommitmentPair[];
    selfCommitment: ExternalSigningCommitments;
    publicKey: number[];
    selfSignature: ExternalFrostSignatureShare;
    adaptorPublicKey?: number[];
}

export interface ExternalEncryptedSecret {
    ciphertext: number[];
}

export interface ExternalFrostCommitments {
    hidingCommitment: number[];
    bindingCommitment: number[];
    noncesCiphertext: number[];
}

export interface ExternalFrostSignature {
    bytes: number[];
}

export interface ExternalFrostSignatureShare {
    bytes: number[];
}

export interface ExternalIdentifier {
    bytes: number[];
}

export interface ExternalInputParser {
    providerId: string;
    inputRegex: string;
    parserUrl: string;
}

export interface ExternalScalar {
    bytes: number[];
}

export interface ExternalSecretShare {
    threshold: number;
    index: ExternalScalar;
    share: ExternalScalar;
}

export interface ExternalSignFrostRequest {
    message: number[];
    publicKey: number[];
    secret: ExternalSecretSource;
    verifyingKey: number[];
    selfNonceCommitment: ExternalFrostCommitments;
    statechainCommitments: IdentifierCommitmentPair[];
    adaptorPublicKey?: number[];
}

export interface ExternalSigner {
    identityPublicKey(): PublicKeyBytes;
    derivePublicKey(path: string): Promise<PublicKeyBytes>;
    signEcdsa(message: MessageBytes, path: string): Promise<EcdsaSignatureBytes>;
    signEcdsaRecoverable(message: MessageBytes, path: string): Promise<RecoverableEcdsaSignatureBytes>;
    encryptEcies(message: Uint8Array, path: string): Promise<Uint8Array>;
    decryptEcies(message: Uint8Array, path: string): Promise<Uint8Array>;
    signHashSchnorr(hash: Uint8Array, path: string): Promise<SchnorrSignatureBytes>;
    generateRandomSigningCommitment(): Promise<ExternalFrostCommitments>;
    getPublicKeyForNode(id: ExternalTreeNodeId): Promise<PublicKeyBytes>;
    generateRandomSecret(): Promise<ExternalEncryptedSecret>;
    staticDepositSecretEncrypted(index: number): Promise<ExternalSecretSource>;
    staticDepositSecret(index: number): Promise<SecretBytes>;
    staticDepositSigningKey(index: number): Promise<PublicKeyBytes>;
    subtractSecrets(signingKey: ExternalSecretSource, newSigningKey: ExternalSecretSource): Promise<ExternalSecretSource>;
    splitSecretWithProofs(secret: ExternalSecretToSplit, threshold: number, numShares: number): Promise<ExternalVerifiableSecretShare[]>;
    encryptPrivateKeyForReceiver(privateKey: ExternalEncryptedSecret, receiverPublicKey: PublicKeyBytes): Promise<Uint8Array>;
    publicKeyFromSecret(privateKey: ExternalSecretSource): Promise<PublicKeyBytes>;
    signFrost(request: ExternalSignFrostRequest): Promise<ExternalFrostSignatureShare>;
    aggregateFrost(request: ExternalAggregateFrostRequest): Promise<ExternalFrostSignature>;
    hmacSha256(message: Uint8Array, path: string): Promise<HashedMessageBytes>;
}

export interface ExternalSigningCommitments {
    hiding: number[];
    binding: number[];
}

export interface ExternalTreeNodeId {
    id: string;
}

export interface ExternalVerifiableSecretShare {
    secretShare: ExternalSecretShare;
    proofs: number[][];
}

export interface FetchConversionLimitsRequest {
    conversionType: ConversionType;
    tokenIdentifier?: string;
}

export interface FetchConversionLimitsResponse {
    minFromAmount?: bigint;
    minToAmount?: bigint;
}

export interface FiatCurrency {
    id: string;
    info: CurrencyInfo;
}

export interface FiatService {
    fetchFiatCurrencies(): Promise<FiatCurrency[]>;
    fetchFiatRates(): Promise<Rate[]>;
}

export interface FreezeIssuerTokenRequest {
    address: string;
}

export interface FreezeIssuerTokenResponse {
    impactedOutputIds: string[];
    impactedTokenAmount: bigint;
}

export interface GetInfoRequest {
    ensureSynced?: boolean;
}

export interface GetInfoResponse {
    identityPubkey: string;
    balanceSats: number;
    tokenBalances: Map<string, TokenBalance>;
}

export interface GetPaymentRequest {
    paymentId: string;
}

export interface GetPaymentResponse {
    payment: Payment;
}

export interface GetTokensMetadataRequest {
    tokenIdentifiers: string[];
}

export interface GetTokensMetadataResponse {
    tokensMetadata: TokenMetadata[];
}

export interface HashedMessageBytes {
    bytes: number[];
}

export interface IdentifierCommitmentPair {
    identifier: ExternalIdentifier;
    commitment: ExternalSigningCommitments;
}

export interface IdentifierPublicKeyPair {
    identifier: ExternalIdentifier;
    publicKey: number[];
}

export interface IdentifierSignaturePair {
    identifier: ExternalIdentifier;
    signature: ExternalFrostSignatureShare;
}

export interface IncomingChange {
    newState: Record;
    oldState?: Record;
}

export interface KeySetConfig {
    keySetType: KeySetType;
    useAddressIndex: boolean;
    accountNumber?: number;
}

export interface LeafOptimizationConfig {
    autoEnabled: boolean;
    multiplicity: number;
}

export interface LightningAddressDetails {
    address: string;
    payRequest: LnurlPayRequestDetails;
}

export interface LightningAddressInfo {
    description: string;
    lightningAddress: string;
    lnurl: LnurlInfo;
    username: string;
}

export interface ListContactsRequest {
    offset?: number;
    limit?: number;
}

export interface ListFiatCurrenciesResponse {
    currencies: FiatCurrency[];
}

export interface ListFiatRatesResponse {
    rates: Rate[];
}

export interface ListPaymentsRequest {
    typeFilter?: PaymentType[];
    statusFilter?: PaymentStatus[];
    assetFilter?: AssetFilter;
    paymentDetailsFilter?: PaymentDetailsFilter[];
    fromTimestamp?: number;
    toTimestamp?: number;
    offset?: number;
    limit?: number;
    sortAscending?: boolean;
}

export interface ListPaymentsResponse {
    payments: Payment[];
}

export interface ListUnclaimedDepositsRequest {}

export interface ListUnclaimedDepositsResponse {
    deposits: DepositInfo[];
}

export interface LnurlAuthRequestDetails {
    k1: string;
    action?: string;
    domain: string;
    url: string;
}

export interface LnurlErrorDetails {
    reason: string;
}

export interface LnurlInfo {
    url: string;
    bech32: string;
}

export interface LnurlPayInfo {
    lnAddress?: string;
    comment?: string;
    domain?: string;
    metadata?: string;
    processedSuccessAction?: SuccessActionProcessed;
    rawSuccessAction?: SuccessAction;
}

export interface LnurlPayRequest {
    prepareResponse: PrepareLnurlPayResponse;
    idempotencyKey?: string;
}

export interface LnurlPayRequestDetails {
    callback: string;
    minSendable: number;
    maxSendable: number;
    metadataStr: string;
    commentAllowed: number;
    domain: string;
    url: string;
    address?: string;
    allowsNostr?: boolean;
    nostrPubkey?: string;
}

export interface LnurlPayResponse {
    payment: Payment;
    successAction?: SuccessActionProcessed;
}

export interface LnurlReceiveMetadata {
    nostrZapRequest?: string;
    nostrZapReceipt?: string;
    senderComment?: string;
}

export interface LnurlWithdrawInfo {
    withdrawUrl: string;
}

export interface LnurlWithdrawRequest {
    amountSats: number;
    withdrawRequest: LnurlWithdrawRequestDetails;
    completionTimeoutSecs?: number;
}

export interface LnurlWithdrawRequestDetails {
    callback: string;
    k1: string;
    defaultDescription: string;
    minWithdrawable: number;
    maxWithdrawable: number;
}

export interface LnurlWithdrawResponse {
    paymentRequest: string;
    payment?: Payment;
}

export interface LocaleOverrides {
    locale: string;
    spacing?: number;
    symbol: Symbol;
}

export interface LocalizedName {
    locale: string;
    name: string;
}

export interface LogEntry {
    line: string;
    level: string;
}

export interface Logger {
    log: (l: LogEntry) => void;
}

export interface MessageBytes {
    bytes: number[];
}

export interface MessageSuccessActionData {
    message: string;
}

export interface MintIssuerTokenRequest {
    amount: bigint;
}

export interface OptimizationProgress {
    isRunning: boolean;
    currentRound: number;
    totalRounds: number;
}

export interface OutgoingChange {
    change: RecordChange;
    parent?: Record;
}

export interface Payment {
    id: string;
    paymentType: PaymentType;
    status: PaymentStatus;
    amount: bigint;
    fees: bigint;
    timestamp: number;
    method: PaymentMethod;
    details?: PaymentDetails;
    conversionDetails?: ConversionDetails;
}

export interface PaymentMetadata {
    parentPaymentId?: string;
    lnurlPayInfo?: LnurlPayInfo;
    lnurlWithdrawInfo?: LnurlWithdrawInfo;
    lnurlDescription?: string;
    conversionInfo?: ConversionInfo;
    conversionStatus?: ConversionStatus;
}

export interface PaymentObserver {
    beforeSend: (payments: ProvisionalPayment[]) => Promise<void>;
}

export interface PaymentRequestSource {
    bip21Uri?: string;
    bip353Address?: string;
}

export interface PrepareLnurlPayRequest {
    amount: bigint;
    comment?: string;
    payRequest: LnurlPayRequestDetails;
    validateSuccessActionUrl?: boolean;
    tokenIdentifier?: string;
    conversionOptions?: ConversionOptions;
    feePolicy?: FeePolicy;
}

export interface PrepareLnurlPayResponse {
    amountSats: number;
    comment?: string;
    payRequest: LnurlPayRequestDetails;
    feeSats: number;
    invoiceDetails: Bolt11InvoiceDetails;
    successAction?: SuccessAction;
    conversionEstimate?: ConversionEstimate;
    feePolicy: FeePolicy;
}

export interface PrepareSendPaymentRequest {
    paymentRequest: string;
    amount?: bigint;
    tokenIdentifier?: string;
    conversionOptions?: ConversionOptions;
    feePolicy?: FeePolicy;
}

export interface PrepareSendPaymentResponse {
    paymentMethod: SendPaymentMethod;
    amount: bigint;
    tokenIdentifier?: string;
    conversionEstimate?: ConversionEstimate;
    feePolicy: FeePolicy;
}

export interface ProvisionalPayment {
    paymentId: string;
    amount: bigint;
    details: ProvisionalPaymentDetails;
}

export interface PublicKeyBytes {
    bytes: number[];
}

export interface Rate {
    coin: string;
    value: number;
}

export interface ReceivePaymentRequest {
    paymentMethod: ReceivePaymentMethod;
}

export interface ReceivePaymentResponse {
    paymentRequest: string;
    fee: bigint;
}

export interface RecommendedFees {
    fastestFee: number;
    halfHourFee: number;
    hourFee: number;
    economyFee: number;
    minimumFee: number;
}

export interface Record {
    id: RecordId;
    revision: number;
    schemaVersion: string;
    data: Map<string, string>;
}

export interface RecordChange {
    id: RecordId;
    schemaVersion: string;
    updatedFields: Map<string, string>;
    localRevision: number;
}

export interface RecordId {
    type: string;
    dataId: string;
}

export interface RecoverableEcdsaSignatureBytes {
    bytes: number[];
}

export interface RefundDepositRequest {
    txid: string;
    vout: number;
    destinationAddress: string;
    fee: Fee;
}

export interface RefundDepositResponse {
    txId: string;
    txHex: string;
}

export interface RegisterLightningAddressRequest {
    username: string;
    description?: string;
}

export interface RegisterWebhookRequest {
    url: string;
    secret: string;
    eventTypes: WebhookEventType[];
}

export interface RegisterWebhookResponse {
    webhookId: string;
}

export interface RestClient {
    getRequest(url: string, headers?: Record<string, string>): Promise<RestResponse>;
    postRequest(url: string, headers?: Record<string, string>, body?: string): Promise<RestResponse>;
    deleteRequest(url: string, headers?: Record<string, string>, body?: string): Promise<RestResponse>;
}

export interface RestResponse {
    status: number;
    body: string;
}

export interface SchnorrSignatureBytes {
    bytes: number[];
}

export interface SecretBytes {
    bytes: number[];
}

export interface SendOnchainFeeQuote {
    id: string;
    expiresAt: number;
    speedFast: SendOnchainSpeedFeeQuote;
    speedMedium: SendOnchainSpeedFeeQuote;
    speedSlow: SendOnchainSpeedFeeQuote;
}

export interface SendOnchainSpeedFeeQuote {
    userFeeSat: number;
    l1BroadcastFeeSat: number;
}

export interface SendPaymentRequest {
    prepareResponse: PrepareSendPaymentResponse;
    options?: SendPaymentOptions;
    idempotencyKey?: string;
}

export interface SendPaymentResponse {
    payment: Payment;
}

export interface Session {
    token: string;
    expiration: number;
}

export interface SessionManager {
    getSession: (serviceIdentityKey: string) => Promise<Session>;
    setSession: (serviceIdentityKey: string, session: Session) => Promise<void>;
}

export interface SetLnurlMetadataItem {
    paymentHash: string;
    senderComment?: string;
    nostrZapRequest?: string;
    nostrZapReceipt?: string;
}

export interface SignMessageRequest {
    message: string;
    compact: boolean;
}

export interface SignMessageResponse {
    pubkey: string;
    signature: string;
}

export interface SilentPaymentAddressDetails {
    address: string;
    network: BitcoinNetwork;
    source: PaymentRequestSource;
}

export interface SparkAddressDetails {
    address: string;
    identityPublicKey: string;
    network: BitcoinNetwork;
    source: PaymentRequestSource;
}

export interface SparkConfig {
    coordinatorIdentifier: string;
    threshold: number;
    signingOperators: SparkSigningOperator[];
    sspConfig: SparkSspConfig;
    expectedWithdrawBondSats: number;
    expectedWithdrawRelativeBlockLocktime: number;
}

export interface SparkHtlcDetails {
    paymentHash: string;
    preimage?: string;
    expiryTime: number;
    status: SparkHtlcStatus;
}

export interface SparkHtlcOptions {
    paymentHash: string;
    expiryDurationSecs: number;
}

export interface SparkInvoiceDetails {
    invoice: string;
    identityPublicKey: string;
    network: BitcoinNetwork;
    amount?: string;
    tokenIdentifier?: string;
    expiryTime?: number;
    description?: string;
    senderPublicKey?: string;
}

export interface SparkInvoicePaymentDetails {
    description?: string;
    invoice: string;
}

export interface SparkSigningOperator {
    id: number;
    identifier: string;
    address: string;
    identityPublicKey: string;
}

export interface SparkSspConfig {
    baseUrl: string;
    identityPublicKey: string;
    schemaEndpoint?: string;
}

export interface SparkStatus {
    status: ServiceStatus;
    lastUpdated: number;
}

export interface StableBalanceConfig {
    tokens: StableBalanceToken[];
    defaultActiveLabel?: string;
    thresholdSats?: number;
    maxSlippageBps?: number;
}

export interface StableBalanceToken {
    label: string;
    tokenIdentifier: string;
}

export interface Storage {
    getCachedItem: (key: string) => Promise<string | null>;
    setCachedItem: (key: string, value: string) => Promise<void>;
    deleteCachedItem: (key: string) => Promise<void>;
    listPayments: (request: StorageListPaymentsRequest) => Promise<Payment[]>;
    insertPayment: (payment: Payment) => Promise<void>;
    insertPaymentMetadata: (paymentId: string, metadata: PaymentMetadata) => Promise<void>;
    getPaymentById: (id: string) => Promise<Payment>;
    getPaymentByInvoice: (invoice: string) => Promise<Payment>;
    addDeposit: (txid: string, vout: number, amount_sats: number, isMature: boolean) => Promise<void>;
    deleteDeposit: (txid: string, vout: number) => Promise<void>;
    listDeposits: () => Promise<DepositInfo[]>;
    updateDeposit: (txid: string, vout: number, payload: UpdateDepositPayload) => Promise<void>;
    setLnurlMetadata: (metadata: SetLnurlMetadataItem[]) => Promise<void>;
    getPaymentsByParentIds: (parentPaymentIds: string[]) => Promise<{ [parentId: string]: RelatedPayment[] }>;
    listContacts: (request: ListContactsRequest) => Promise<Contact[]>;
    getContact: (id: string) => Promise<Contact>;
    insertContact: (contact: Contact) => Promise<void>;
    deleteContact: (id: string) => Promise<void>;
    syncAddOutgoingChange: (record: UnversionedRecordChange) => Promise<number>;
    syncCompleteOutgoingSync: (record: Record) => Promise<void>;
    syncGetPendingOutgoingChanges: (limit: number) => Promise<OutgoingChange[]>;
    syncGetLastRevision: () => Promise<number>;
    syncInsertIncomingRecords: (records: Record[]) => Promise<void>;
    syncDeleteIncomingRecord: (record: Record) => Promise<void>;
    syncGetIncomingRecords: (limit: number) => Promise<IncomingChange[]>;
    syncGetLatestOutgoingChange: () => Promise<OutgoingChange | null>;
    syncUpdateRecordFromIncoming: (record: Record) => Promise<void>;
}

export interface StorageListPaymentsRequest {
    typeFilter?: PaymentType[];
    statusFilter?: PaymentStatus[];
    assetFilter?: AssetFilter;
    paymentDetailsFilter?: StoragePaymentDetailsFilter[];
    fromTimestamp?: number;
    toTimestamp?: number;
    offset?: number;
    limit?: number;
    sortAscending?: boolean;
}

export interface Symbol {
    grapheme?: string;
    template?: string;
    rtl?: boolean;
    position?: number;
}

export interface SyncWalletRequest {}

export interface SyncWalletResponse {}

export interface TokenBalance {
    balance: bigint;
    tokenMetadata: TokenMetadata;
}

export interface TokenMetadata {
    identifier: string;
    issuerPublicKey: string;
    name: string;
    ticker: string;
    decimals: number;
    maxSupply: string;
    isFreezable: boolean;
}

export interface TokenOptimizationConfig {
    autoEnabled: boolean;
    targetOutputCount: number;
    minOutputsThreshold: number;
}

export interface TxStatus {
    confirmed: boolean;
    blockHeight?: number;
    blockTime?: number;
}

export interface UnfreezeIssuerTokenRequest {
    address: string;
}

export interface UnfreezeIssuerTokenResponse {
    impactedOutputIds: string[];
    impactedTokenAmount: bigint;
}

export interface UnregisterWebhookRequest {
    webhookId: string;
}

export interface UnversionedRecordChange {
    id: RecordId;
    schemaVersion: string;
    updatedFields: Map<string, string>;
}

export interface UpdateContactRequest {
    id: string;
    name: string;
    paymentIdentifier: string;
}

export interface UpdateUserSettingsRequest {
    sparkPrivateModeEnabled?: boolean;
    stableBalanceActiveLabel?: StableBalanceActiveLabel;
}

export interface UrlSuccessActionData {
    description: string;
    url: string;
    matchesCallbackDomain: boolean;
}

export interface UserSettings {
    sparkPrivateModeEnabled: boolean;
    stableBalanceActiveLabel?: string;
}

export interface Utxo {
    txid: string;
    vout: number;
    value: number;
    status: TxStatus;
}

export interface Webhook {
    id: string;
    url: string;
    eventTypes: WebhookEventType[];
}

export type AesSuccessActionDataResult = { type: "decrypted"; data: AesSuccessActionDataDecrypted } | { type: "errorStatus"; reason: string };

export type Amount = { type: "bitcoin"; amountMsat: number } | { type: "currency"; iso4217Code: string; fractionalAmount: number };

export type AmountAdjustmentReason = "flooredToMinLimit" | "increasedToAvoidDust";

export type AssetFilter = { type: "bitcoin" } | { type: "token"; tokenIdentifier?: string };

export type BitcoinNetwork = "bitcoin" | "testnet3" | "testnet4" | "signet" | "regtest";

export type BuyBitcoinRequest = { type: "moonpay"; lockedAmountSat?: number; redirectUrl?: string } | { type: "cashApp"; amountSats: number };

export type ChainApiType = "esplora" | "mempoolSpace";

export type ConversionPurpose = { type: "ongoingPayment"; paymentRequest: string } | { type: "selfTransfer" } | { type: "autoConversion" };

export type ConversionStatus = "pending" | "completed" | "failed" | "refundNeeded" | "refunded";

export type ConversionType = { type: "fromBitcoin" } | { type: "toBitcoin"; fromTokenIdentifier: string };

export type DepositClaimError = { type: "maxDepositClaimFeeExceeded"; tx: string; vout: number; maxFee?: Fee; requiredFeeSats: number; requiredFeeRateSatPerVbyte: number } | { type: "missingUtxo"; tx: string; vout: number } | { type: "generic"; message: string };

export type ExternalSecretSource = { type: "derived"; nodeId: ExternalTreeNodeId } | { type: "encrypted"; key: ExternalEncryptedSecret };

export type ExternalSecretToSplit = { type: "secretSource"; source: ExternalSecretSource } | { type: "preimage"; data: number[] };

export type Fee = { type: "fixed"; amount: number } | { type: "rate"; satPerVbyte: number };

export type FeePolicy = "feesExcluded" | "feesIncluded";

export type InputType = ({ type: "bitcoinAddress" } & BitcoinAddressDetails) | ({ type: "bolt11Invoice" } & Bolt11InvoiceDetails) | ({ type: "bolt12Invoice" } & Bolt12InvoiceDetails) | ({ type: "bolt12Offer" } & Bolt12OfferDetails) | ({ type: "lightningAddress" } & LightningAddressDetails) | ({ type: "lnurlPay" } & LnurlPayRequestDetails) | ({ type: "silentPaymentAddress" } & SilentPaymentAddressDetails) | ({ type: "lnurlAuth" } & LnurlAuthRequestDetails) | ({ type: "url" } & string) | ({ type: "bip21" } & Bip21Details) | ({ type: "bolt12InvoiceRequest" } & Bolt12InvoiceRequestDetails) | ({ type: "lnurlWithdraw" } & LnurlWithdrawRequestDetails) | ({ type: "sparkAddress" } & SparkAddressDetails) | ({ type: "sparkInvoice" } & SparkInvoiceDetails);

export type KeySetType = "default" | "taproot" | "nativeSegwit" | "wrappedSegwit" | "legacy";

export type LnurlCallbackStatus = { type: "ok" } | { type: "errorStatus"; errorDetails: LnurlErrorDetails };

export type MaxFee = { type: "fixed"; amount: number } | { type: "rate"; satPerVbyte: number } | { type: "networkRecommended"; leewaySatPerVbyte: number };

export type Network = "mainnet" | "regtest";

export type OnchainConfirmationSpeed = "fast" | "medium" | "slow";

export type OptimizationEvent = { type: "started"; totalRounds: number } | { type: "roundCompleted"; currentRound: number; totalRounds: number } | { type: "completed" } | { type: "cancelled" } | { type: "failed"; error: string } | { type: "skipped" };

export type PaymentDetails = { type: "spark"; invoiceDetails?: SparkInvoicePaymentDetails; htlcDetails?: SparkHtlcDetails; conversionInfo?: ConversionInfo } | { type: "token"; metadata: TokenMetadata; txHash: string; txType: TokenTransactionType; invoiceDetails?: SparkInvoicePaymentDetails; conversionInfo?: ConversionInfo } | { type: "lightning"; description?: string; invoice: string; destinationPubkey: string; htlcDetails: SparkHtlcDetails; lnurlPayInfo?: LnurlPayInfo; lnurlWithdrawInfo?: LnurlWithdrawInfo; lnurlReceiveMetadata?: LnurlReceiveMetadata } | { type: "withdraw"; txId: string } | { type: "deposit"; txId: string };

export type PaymentDetailsFilter = { type: "spark"; htlcStatus?: SparkHtlcStatus[]; conversionRefundNeeded?: boolean } | { type: "token"; conversionRefundNeeded?: boolean; txHash?: string; txType?: TokenTransactionType } | { type: "lightning"; htlcStatus?: SparkHtlcStatus[] };

export type PaymentMethod = "lightning" | "spark" | "token" | "deposit" | "withdraw" | "unknown";

export type PaymentStatus = "completed" | "pending" | "failed";

export type PaymentType = "send" | "receive";

export type ProvisionalPaymentDetails = { type: "bitcoin"; withdrawalAddress: string } | { type: "lightning"; invoice: string } | { type: "spark"; payRequest: string } | { type: "token"; tokenId: string; payRequest: string };

export type ReceivePaymentMethod = { type: "sparkAddress" } | { type: "sparkInvoice"; amount?: string; tokenIdentifier?: string; expiryTime?: number; description?: string; senderPublicKey?: string } | { type: "bitcoinAddress"; newAddress?: boolean } | { type: "bolt11Invoice"; description: string; amountSats?: number; expirySecs?: number; paymentHash?: string };

export type SdkEvent = { type: "synced" } | { type: "unclaimedDeposits"; unclaimedDeposits: DepositInfo[] } | { type: "claimedDeposits"; claimedDeposits: DepositInfo[] } | { type: "paymentSucceeded"; payment: Payment } | { type: "paymentPending"; payment: Payment } | { type: "paymentFailed"; payment: Payment } | { type: "optimization"; optimizationEvent: OptimizationEvent } | { type: "lightningAddressChanged"; lightningAddress?: LightningAddressInfo } | { type: "newDeposits"; newDeposits: DepositInfo[] };

export type Seed = { type: "mnemonic"; mnemonic: string; passphrase?: string } | ({ type: "entropy" } & number[]);

export type SendPaymentMethod = { type: "bitcoinAddress"; address: BitcoinAddressDetails; feeQuote: SendOnchainFeeQuote } | { type: "bolt11Invoice"; invoiceDetails: Bolt11InvoiceDetails; sparkTransferFeeSats?: number; lightningFeeSats: number } | { type: "sparkAddress"; address: string; fee: string; tokenIdentifier?: string } | { type: "sparkInvoice"; sparkInvoiceDetails: SparkInvoiceDetails; fee: string; tokenIdentifier?: string };

export type SendPaymentOptions = { type: "bitcoinAddress"; confirmationSpeed: OnchainConfirmationSpeed } | { type: "bolt11Invoice"; preferSpark: boolean; completionTimeoutSecs?: number } | { type: "sparkAddress"; htlcOptions?: SparkHtlcOptions };

export type ServiceStatus = "operational" | "degraded" | "partial" | "unknown" | "major";

export type SessionManagerError = { type: "notFound" } | ({ type: "generic" } & string);

export type SparkHtlcStatus = "waitingForPreimage" | "preimageShared" | "returned";

export type StableBalanceActiveLabel = { type: "set"; label: string } | { type: "unset" };

export type StoragePaymentDetailsFilter = { type: "spark"; htlcStatus?: SparkHtlcStatus[]; conversionRefundNeeded?: boolean } | { type: "token"; conversionRefundNeeded?: boolean; txHash?: string; txType?: TokenTransactionType } | { type: "lightning"; htlcStatus?: SparkHtlcStatus[] };

export type SuccessAction = { type: "aes"; data: AesSuccessActionData } | { type: "message"; data: MessageSuccessActionData } | { type: "url"; data: UrlSuccessActionData };

export type SuccessActionProcessed = { type: "aes"; result: AesSuccessActionDataResult } | { type: "message"; data: MessageSuccessActionData } | { type: "url"; data: UrlSuccessActionData };

export type TokenTransactionType = "transfer" | "mint" | "burn";

export type UpdateDepositPayload = { type: "claimError"; error: DepositClaimError } | { type: "refund"; refundTxid: string; refundTx: string };

export type WebhookEventType = { type: "lightningReceiveFinished" } | { type: "lightningSendFinished" } | { type: "coopExitFinished" } | { type: "staticDepositFinished" } | ({ type: "unknown" } & string);


/**
 * Rust-built implementation of the JS `BitcoinChainService` interface.
 *
 * Returned by factories like [`new_rest_chain_service`]; users see it as a
 * `BitcoinChainService` and pass it to `withChainService`. Pass the same
 * instance to multiple `SdkBuilder`s to share a single underlying HTTP
 * client (and its connection pool) across SDK instances.
 */
export class BitcoinChainServiceHandle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    broadcastTransaction(tx: string): Promise<void>;
    getAddressUtxos(address: string): Promise<any>;
    getTransactionHex(txid: string): Promise<any>;
    getTransactionStatus(txid: string): Promise<any>;
    recommendedFees(): Promise<any>;
}

export class BreezSdk {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    addContact(request: AddContactRequest): Promise<Contact>;
    addEventListener(listener: EventListener): Promise<string>;
    buyBitcoin(request: BuyBitcoinRequest): Promise<BuyBitcoinResponse>;
    cancelLeafOptimization(): Promise<void>;
    checkLightningAddressAvailable(request: CheckLightningAddressRequest): Promise<boolean>;
    checkMessage(request: CheckMessageRequest): Promise<CheckMessageResponse>;
    claimDeposit(request: ClaimDepositRequest): Promise<ClaimDepositResponse>;
    claimHtlcPayment(request: ClaimHtlcPaymentRequest): Promise<ClaimHtlcPaymentResponse>;
    deleteContact(id: string): Promise<void>;
    deleteLightningAddress(): Promise<void>;
    disconnect(): Promise<void>;
    fetchConversionLimits(request: FetchConversionLimitsRequest): Promise<FetchConversionLimitsResponse>;
    getInfo(request: GetInfoRequest): Promise<GetInfoResponse>;
    getLeafOptimizationProgress(): OptimizationProgress;
    getLightningAddress(): Promise<LightningAddressInfo | undefined>;
    getPayment(request: GetPaymentRequest): Promise<GetPaymentResponse>;
    getTokenIssuer(): TokenIssuer;
    getTokensMetadata(request: GetTokensMetadataRequest): Promise<GetTokensMetadataResponse>;
    getUserSettings(): Promise<UserSettings>;
    listContacts(request: ListContactsRequest): Promise<Contact[]>;
    listFiatCurrencies(): Promise<ListFiatCurrenciesResponse>;
    listFiatRates(): Promise<ListFiatRatesResponse>;
    listPayments(request: ListPaymentsRequest): Promise<ListPaymentsResponse>;
    listUnclaimedDeposits(request: ListUnclaimedDepositsRequest): Promise<ListUnclaimedDepositsResponse>;
    listWebhooks(): Promise<Webhook[]>;
    lnurlAuth(request_data: LnurlAuthRequestDetails): Promise<LnurlCallbackStatus>;
    lnurlPay(request: LnurlPayRequest): Promise<LnurlPayResponse>;
    lnurlWithdraw(request: LnurlWithdrawRequest): Promise<LnurlWithdrawResponse>;
    parse(input: string): Promise<InputType>;
    prepareLnurlPay(request: PrepareLnurlPayRequest): Promise<PrepareLnurlPayResponse>;
    prepareSendPayment(request: PrepareSendPaymentRequest): Promise<PrepareSendPaymentResponse>;
    receivePayment(request: ReceivePaymentRequest): Promise<ReceivePaymentResponse>;
    recommendedFees(): Promise<RecommendedFees>;
    refundDeposit(request: RefundDepositRequest): Promise<RefundDepositResponse>;
    refundPendingConversions(): Promise<void>;
    registerLightningAddress(request: RegisterLightningAddressRequest): Promise<LightningAddressInfo>;
    registerWebhook(request: RegisterWebhookRequest): Promise<RegisterWebhookResponse>;
    removeEventListener(id: string): Promise<boolean>;
    sendPayment(request: SendPaymentRequest): Promise<SendPaymentResponse>;
    signMessage(request: SignMessageRequest): Promise<SignMessageResponse>;
    startLeafOptimization(): Promise<void>;
    syncWallet(request: SyncWalletRequest): Promise<SyncWalletResponse>;
    unregisterWebhook(request: UnregisterWebhookRequest): Promise<void>;
    updateContact(request: UpdateContactRequest): Promise<Contact>;
    updateUserSettings(request: UpdateUserSettingsRequest): Promise<void>;
}

/**
 * A default signer implementation that wraps the core SDK's ExternalSigner.
 * This is returned by `defaultExternalSigner` and can be passed to `connectWithSigner`.
 */
export class DefaultSigner {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    aggregateFrost(request: ExternalAggregateFrostRequest): Promise<ExternalFrostSignature>;
    decryptEcies(message: Uint8Array, path: string): Promise<Uint8Array>;
    derivePublicKey(path: string): Promise<PublicKeyBytes>;
    encryptEcies(message: Uint8Array, path: string): Promise<Uint8Array>;
    encryptPrivateKeyForReceiver(private_key: ExternalEncryptedSecret, receiver_public_key: PublicKeyBytes): Promise<Uint8Array>;
    generateRandomSecret(): Promise<ExternalEncryptedSecret>;
    generateRandomSigningCommitment(): Promise<ExternalFrostCommitments>;
    getPublicKeyForNode(id: ExternalTreeNodeId): Promise<PublicKeyBytes>;
    hmacSha256(message: Uint8Array, path: string): Promise<HashedMessageBytes>;
    identityPublicKey(): PublicKeyBytes;
    publicKeyFromSecret(private_key: ExternalSecretSource): Promise<PublicKeyBytes>;
    signEcdsa(message: MessageBytes, path: string): Promise<EcdsaSignatureBytes>;
    signEcdsaRecoverable(message: MessageBytes, path: string): Promise<RecoverableEcdsaSignatureBytes>;
    signFrost(request: ExternalSignFrostRequest): Promise<ExternalFrostSignatureShare>;
    signHashSchnorr(hash: Uint8Array, path: string): Promise<SchnorrSignatureBytes>;
    splitSecretWithProofs(secret: ExternalSecretToSplit, threshold: number, num_shares: number): Promise<ExternalVerifiableSecretShare[]>;
    staticDepositSecret(index: number): Promise<SecretBytes>;
    staticDepositSecretEncrypted(index: number): Promise<ExternalSecretSource>;
    staticDepositSigningKey(index: number): Promise<PublicKeyBytes>;
    subtractSecrets(signing_key: ExternalSecretSource, new_signing_key: ExternalSecretSource): Promise<ExternalSecretSource>;
}

export class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}

export class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}

export class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}

/**
 * A shareable `MySQL` connection pool. See
 * [`PostgresConnectionPool`](super::postgres_pool::PostgresConnectionPool)
 * for sharing semantics and lifecycle.
 */
export class MysqlConnectionPool {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

/**
 * Passkey-based wallet operations using WebAuthn PRF extension.
 *
 * Wraps a `PasskeyPrfProvider` and optional relay configuration to provide
 * wallet derivation and label management via Nostr relays.
 */
export class Passkey {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Derive a wallet for a given label.
     *
     * Uses the passkey PRF to derive a `Wallet` containing the seed and resolved label.
     *
     * @param label - Optional label string (defaults to "Default")
     */
    getWallet(label?: string | null): Promise<Wallet>;
    /**
     * Check if passkey PRF is available on this device.
     */
    isAvailable(): Promise<boolean>;
    /**
     * List all labels published to Nostr for this passkey's identity.
     *
     * Requires 1 PRF call (for Nostr identity derivation).
     */
    listLabels(): Promise<string[]>;
    /**
     * Create a new `Passkey` instance.
     *
     * @param prfProvider - Platform implementation of passkey PRF operations
     * @param relayConfig - Optional configuration for Nostr relay connections
     */
    constructor(prf_provider: PasskeyPrfProvider, relay_config?: NostrRelayConfig | null);
    /**
     * Publish a label to Nostr relays for this passkey's identity.
     *
     * Idempotent: if the label already exists, it is not published again.
     * Requires 1 PRF call.
     */
    storeLabel(label: string): Promise<void>;
}

/**
 * A shareable Postgres connection pool.
 *
 * Construct via [`create_postgres_connection_pool`] and pass the same handle to multiple
 * `SdkBuilder`s via `withPostgresConnectionPool` to share connections across SDKs.
 * Per-tenant scoping is derived from each SDK's seed.
 *
 * The pool's lifecycle is controlled by the integrator: it stays alive as
 * long as any reference is held. `disconnect()` does **not** close the pool.
 */
export class PostgresConnectionPool {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

export class SdkBuilder {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    build(): Promise<BreezSdk>;
    static new(config: Config, seed: Seed): SdkBuilder;
    static newWithSigner(config: Config, signer: ExternalSigner): SdkBuilder;
    withChainService(chain_service: BitcoinChainService): SdkBuilder;
    withDefaultStorage(storage_dir: string): Promise<SdkBuilder>;
    withFiatService(fiat_service: FiatService): SdkBuilder;
    withKeySet(config: KeySetConfig): SdkBuilder;
    withLnurlClient(lnurl_client: RestClient): SdkBuilder;
    /**
     * **Deprecated.** Call `createMysqlConnectionPool(config)` and
     * `withMysqlConnectionPool(pool)` instead.
     */
    withMysqlBackend(config: MysqlStorageConfig): SdkBuilder;
    /**
     * Sets a shared `MySQL` connection pool as the backend for all stores.
     *
     * If the same builder also receives a `WasmSdkContext` carrying a MySQL
     * pool, `build()` returns an error — pick one source.
     */
    withMysqlConnectionPool(pool: MysqlConnectionPool): SdkBuilder;
    withPaymentObserver(payment_observer: PaymentObserver): SdkBuilder;
    /**
     * **Deprecated.** Call `createPostgresConnectionPool(config)` and
     * `withPostgresConnectionPool(pool)` instead.
     */
    withPostgresBackend(config: PostgresStorageConfig): SdkBuilder;
    /**
     * Sets a shared Postgres connection pool as the backend for all stores.
     *
     * If the same builder also receives a `WasmSdkContext` carrying a
     * Postgres pool, `build()` returns an error — pick one source.
     */
    withPostgresConnectionPool(pool: PostgresConnectionPool): SdkBuilder;
    withRestChainService(url: string, api_type: ChainApiType, credentials?: Credentials | null): SdkBuilder;
    /**
     * Threads a shared [`WasmSdkContext`] into the builder.
     *
     * Construct the context once via `newSharedSdkContext` and pass the same
     * handle to every `SdkBuilder` whose SDKs should share its resources
     * (operator gRPC channels, SSP HTTP client, database pool).
     */
    withSharedContext(context: WasmSdkContext): SdkBuilder;
    withStorage(storage: Storage): SdkBuilder;
}

export class TokenIssuer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    burnIssuerToken(request: BurnIssuerTokenRequest): Promise<Payment>;
    createIssuerToken(request: CreateIssuerTokenRequest): Promise<TokenMetadata>;
    freezeIssuerToken(request: FreezeIssuerTokenRequest): Promise<FreezeIssuerTokenResponse>;
    getIssuerTokenBalance(): Promise<TokenBalance>;
    getIssuerTokenMetadata(): Promise<TokenMetadata>;
    mintIssuerToken(request: MintIssuerTokenRequest): Promise<Payment>;
    unfreezeIssuerToken(request: UnfreezeIssuerTokenRequest): Promise<UnfreezeIssuerTokenResponse>;
}

/**
 * Process-shared resources backing one or more `BreezSdk` instances on WASM.
 *
 * Construct once via `newSharedSdkContext` and pass the handle to every
 * `SdkBuilder` whose SDKs should share its operator gRPC channels, SSP HTTP
 * client, and (optionally) database connection pool.
 */
export class WasmSdkContext {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

export function connect(request: ConnectRequest): Promise<BreezSdk>;

export function connectWithSigner(config: Config, signer: ExternalSigner, storage_dir: string): Promise<BreezSdk>;

/**
 * Creates a shareable `MySQL` connection pool from the given config.
 */
export function createMysqlConnectionPool(config: MysqlStorageConfig): MysqlConnectionPool;

/**
 * Creates a shareable Postgres connection pool from the given config.
 */
export function createPostgresConnectionPool(config: PostgresStorageConfig): PostgresConnectionPool;

export function defaultConfig(network: Network): Config;

export function defaultExternalSigner(mnemonic: string, passphrase: string | null | undefined, network: Network, key_set_config?: KeySetConfig | null): DefaultSigner;

/**
 * Creates a default MySQL storage configuration with sensible defaults.
 *
 * Default values:
 * - `maxPoolSize`: 10
 * - `createTimeoutSecs`: 0 (no timeout)
 * - `recycleTimeoutSecs`: 10
 * - `foreignKeyMode`: `Enforced`
 */
export function defaultMysqlStorageConfig(connection_string: string): MysqlStorageConfig;

/**
 * Creates a default PostgreSQL storage configuration with sensible defaults.
 *
 * Default values (from pg.Pool):
 * - `maxPoolSize`: 10
 * - `createTimeoutSecs`: 0 (no timeout)
 * - `recycleTimeoutSecs`: 10 (10 seconds idle before disconnect)
 */
export function defaultPostgresStorageConfig(connection_string: string): PostgresStorageConfig;

export function defaultServerConfig(network: Network): Config;

/**
 * Creates a default external signer from a mnemonic phrase.
 *
 * This creates a signer that can be used with `connectWithSigner` or `SdkBuilder.newWithSigner`.
 */
export function getSparkStatus(): Promise<SparkStatus>;

export function initLogging(logger: Logger, filter?: string | null): Promise<void>;

/**
 * Constructs a shareable REST-based Bitcoin chain service.
 *
 * Pass the returned chain service to multiple `SdkBuilder`s via
 * `withChainService` to reuse one HTTP client across SDK instances. All
 * SDKs sharing the chain service must use the same `network`.
 *
 * For one-off, non-shared use, prefer `withRestChainService`.
 */
export function newRestChainService(url: string, network: Network, api_type: ChainApiType, credentials?: Credentials | null): Promise<BitcoinChainService>;

/**
 * Constructs a [`WasmSdkContext`] from a `WasmSdkContextConfig`.
 */
export function newSharedSdkContext(config: WasmSdkContextConfig): Promise<WasmSdkContext>;

/**
 * Entry point invoked by JavaScript in a worker.
 */
export function task_worker_entry_point(ptr: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_bitcoinchainservicehandle_free: (a: number, b: number) => void;
    readonly __wbg_breezsdk_free: (a: number, b: number) => void;
    readonly __wbg_defaultsigner_free: (a: number, b: number) => void;
    readonly __wbg_mysqlconnectionpool_free: (a: number, b: number) => void;
    readonly __wbg_passkey_free: (a: number, b: number) => void;
    readonly __wbg_postgresconnectionpool_free: (a: number, b: number) => void;
    readonly __wbg_sdkbuilder_free: (a: number, b: number) => void;
    readonly __wbg_tokenissuer_free: (a: number, b: number) => void;
    readonly __wbg_wasmsdkcontext_free: (a: number, b: number) => void;
    readonly bitcoinchainservicehandle_broadcastTransaction: (a: number, b: number, c: number) => any;
    readonly bitcoinchainservicehandle_getAddressUtxos: (a: number, b: number, c: number) => any;
    readonly bitcoinchainservicehandle_getTransactionHex: (a: number, b: number, c: number) => any;
    readonly bitcoinchainservicehandle_getTransactionStatus: (a: number, b: number, c: number) => any;
    readonly bitcoinchainservicehandle_recommendedFees: (a: number) => any;
    readonly breezsdk_addContact: (a: number, b: any) => any;
    readonly breezsdk_addEventListener: (a: number, b: any) => any;
    readonly breezsdk_buyBitcoin: (a: number, b: any) => any;
    readonly breezsdk_cancelLeafOptimization: (a: number) => any;
    readonly breezsdk_checkLightningAddressAvailable: (a: number, b: any) => any;
    readonly breezsdk_checkMessage: (a: number, b: any) => any;
    readonly breezsdk_claimDeposit: (a: number, b: any) => any;
    readonly breezsdk_claimHtlcPayment: (a: number, b: any) => any;
    readonly breezsdk_deleteContact: (a: number, b: number, c: number) => any;
    readonly breezsdk_deleteLightningAddress: (a: number) => any;
    readonly breezsdk_disconnect: (a: number) => any;
    readonly breezsdk_fetchConversionLimits: (a: number, b: any) => any;
    readonly breezsdk_getInfo: (a: number, b: any) => any;
    readonly breezsdk_getLeafOptimizationProgress: (a: number) => any;
    readonly breezsdk_getLightningAddress: (a: number) => any;
    readonly breezsdk_getPayment: (a: number, b: any) => any;
    readonly breezsdk_getTokenIssuer: (a: number) => number;
    readonly breezsdk_getTokensMetadata: (a: number, b: any) => any;
    readonly breezsdk_getUserSettings: (a: number) => any;
    readonly breezsdk_listContacts: (a: number, b: any) => any;
    readonly breezsdk_listFiatCurrencies: (a: number) => any;
    readonly breezsdk_listFiatRates: (a: number) => any;
    readonly breezsdk_listPayments: (a: number, b: any) => any;
    readonly breezsdk_listUnclaimedDeposits: (a: number, b: any) => any;
    readonly breezsdk_listWebhooks: (a: number) => any;
    readonly breezsdk_lnurlAuth: (a: number, b: any) => any;
    readonly breezsdk_lnurlPay: (a: number, b: any) => any;
    readonly breezsdk_lnurlWithdraw: (a: number, b: any) => any;
    readonly breezsdk_parse: (a: number, b: number, c: number) => any;
    readonly breezsdk_prepareLnurlPay: (a: number, b: any) => any;
    readonly breezsdk_prepareSendPayment: (a: number, b: any) => any;
    readonly breezsdk_receivePayment: (a: number, b: any) => any;
    readonly breezsdk_recommendedFees: (a: number) => any;
    readonly breezsdk_refundDeposit: (a: number, b: any) => any;
    readonly breezsdk_refundPendingConversions: (a: number) => any;
    readonly breezsdk_registerLightningAddress: (a: number, b: any) => any;
    readonly breezsdk_registerWebhook: (a: number, b: any) => any;
    readonly breezsdk_removeEventListener: (a: number, b: number, c: number) => any;
    readonly breezsdk_sendPayment: (a: number, b: any) => any;
    readonly breezsdk_signMessage: (a: number, b: any) => any;
    readonly breezsdk_startLeafOptimization: (a: number) => any;
    readonly breezsdk_syncWallet: (a: number, b: any) => any;
    readonly breezsdk_unregisterWebhook: (a: number, b: any) => any;
    readonly breezsdk_updateContact: (a: number, b: any) => any;
    readonly breezsdk_updateUserSettings: (a: number, b: any) => any;
    readonly connect: (a: any) => any;
    readonly connectWithSigner: (a: any, b: any, c: number, d: number) => any;
    readonly createMysqlConnectionPool: (a: any) => [number, number, number];
    readonly createPostgresConnectionPool: (a: any) => [number, number, number];
    readonly defaultConfig: (a: any) => any;
    readonly defaultExternalSigner: (a: number, b: number, c: number, d: number, e: any, f: number) => [number, number, number];
    readonly defaultMysqlStorageConfig: (a: number, b: number) => any;
    readonly defaultPostgresStorageConfig: (a: number, b: number) => any;
    readonly defaultServerConfig: (a: any) => any;
    readonly defaultsigner_aggregateFrost: (a: number, b: any) => any;
    readonly defaultsigner_decryptEcies: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly defaultsigner_derivePublicKey: (a: number, b: number, c: number) => any;
    readonly defaultsigner_encryptEcies: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly defaultsigner_encryptPrivateKeyForReceiver: (a: number, b: any, c: any) => any;
    readonly defaultsigner_generateRandomSecret: (a: number) => any;
    readonly defaultsigner_generateRandomSigningCommitment: (a: number) => any;
    readonly defaultsigner_getPublicKeyForNode: (a: number, b: any) => any;
    readonly defaultsigner_hmacSha256: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly defaultsigner_identityPublicKey: (a: number) => [number, number, number];
    readonly defaultsigner_publicKeyFromSecret: (a: number, b: any) => any;
    readonly defaultsigner_signEcdsa: (a: number, b: any, c: number, d: number) => any;
    readonly defaultsigner_signEcdsaRecoverable: (a: number, b: any, c: number, d: number) => any;
    readonly defaultsigner_signFrost: (a: number, b: any) => any;
    readonly defaultsigner_signHashSchnorr: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly defaultsigner_splitSecretWithProofs: (a: number, b: any, c: number, d: number) => any;
    readonly defaultsigner_staticDepositSecret: (a: number, b: number) => any;
    readonly defaultsigner_staticDepositSecretEncrypted: (a: number, b: number) => any;
    readonly defaultsigner_staticDepositSigningKey: (a: number, b: number) => any;
    readonly defaultsigner_subtractSecrets: (a: number, b: any, c: any) => any;
    readonly getSparkStatus: () => any;
    readonly initLogging: (a: any, b: number, c: number) => any;
    readonly newRestChainService: (a: number, b: number, c: any, d: any, e: number) => any;
    readonly newSharedSdkContext: (a: any) => any;
    readonly passkey_getWallet: (a: number, b: number, c: number) => any;
    readonly passkey_isAvailable: (a: number) => any;
    readonly passkey_listLabels: (a: number) => any;
    readonly passkey_new: (a: any, b: number) => number;
    readonly passkey_storeLabel: (a: number, b: number, c: number) => any;
    readonly sdkbuilder_build: (a: number) => any;
    readonly sdkbuilder_new: (a: any, b: any) => number;
    readonly sdkbuilder_newWithSigner: (a: any, b: any) => number;
    readonly sdkbuilder_withChainService: (a: number, b: any) => number;
    readonly sdkbuilder_withDefaultStorage: (a: number, b: number, c: number) => any;
    readonly sdkbuilder_withFiatService: (a: number, b: any) => number;
    readonly sdkbuilder_withKeySet: (a: number, b: any) => number;
    readonly sdkbuilder_withLnurlClient: (a: number, b: any) => number;
    readonly sdkbuilder_withMysqlBackend: (a: number, b: any) => [number, number, number];
    readonly sdkbuilder_withMysqlConnectionPool: (a: number, b: number) => number;
    readonly sdkbuilder_withPaymentObserver: (a: number, b: any) => number;
    readonly sdkbuilder_withPostgresBackend: (a: number, b: any) => [number, number, number];
    readonly sdkbuilder_withPostgresConnectionPool: (a: number, b: number) => number;
    readonly sdkbuilder_withRestChainService: (a: number, b: number, c: number, d: any, e: number) => number;
    readonly sdkbuilder_withSharedContext: (a: number, b: number) => number;
    readonly sdkbuilder_withStorage: (a: number, b: any) => number;
    readonly tokenissuer_burnIssuerToken: (a: number, b: any) => any;
    readonly tokenissuer_createIssuerToken: (a: number, b: any) => any;
    readonly tokenissuer_freezeIssuerToken: (a: number, b: any) => any;
    readonly tokenissuer_getIssuerTokenBalance: (a: number) => any;
    readonly tokenissuer_getIssuerTokenMetadata: (a: number) => any;
    readonly tokenissuer_mintIssuerToken: (a: number, b: any) => any;
    readonly tokenissuer_unfreezeIssuerToken: (a: number, b: any) => any;
    readonly rustsecp256k1_v0_10_0_context_create: (a: number) => number;
    readonly rustsecp256k1_v0_10_0_context_destroy: (a: number) => void;
    readonly rustsecp256k1_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
    readonly task_worker_entry_point: (a: number) => [number, number];
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
    readonly intounderlyingbytesource_cancel: (a: number) => void;
    readonly intounderlyingbytesource_pull: (a: number, b: any) => any;
    readonly intounderlyingbytesource_start: (a: number, b: any) => void;
    readonly intounderlyingbytesource_type: (a: number) => number;
    readonly intounderlyingsink_abort: (a: number, b: any) => any;
    readonly intounderlyingsink_close: (a: number) => any;
    readonly intounderlyingsink_write: (a: number, b: any) => any;
    readonly intounderlyingsource_cancel: (a: number) => void;
    readonly intounderlyingsource_pull: (a: number, b: any) => any;
    readonly wasm_bindgen__convert__closures_____invoke__h013a98c02f3b4b21: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h013a98c02f3b4b21_4: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h013a98c02f3b4b21_5: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h013a98c02f3b4b21_6: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h013a98c02f3b4b21_7: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h41057d61edf43a32: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h4819aba3eed2db57: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h4819aba3eed2db57_2: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h4819aba3eed2db57_3: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h124479769cd429fd: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
