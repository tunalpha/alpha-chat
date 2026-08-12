/**
 * Spark/Lightning — barrel export
 *
 * Import pubblici consigliati:
 *   import type { SparkFeeBreakdown } from '@/lib/spark';
 *   import { calculateSparkFeeBreakdown } from '@/lib/spark';
 *   import { createSparkAdapter } from '@/lib/spark';
 */

export type {
  SparkFeeConfig,
  SparkFeeBreakdown,
  SparkWalletInfo,
  SparkPayment,
  SparkPaymentType,
  SparkPaymentStatus,
  SparkPrepareSendRequest,
  SparkPrepareSendResult,
  SparkSendRequest,
  SparkSendResult,
  SparkReceiveRequest,
  SparkReceiveResult,
  SparkListPaymentsRequest,
  SparkAdapterState,
  SparkAdapterError,
  SparkConnectConfig,
} from "./spark-types";

export {
  calculateSparkFeeBreakdown,
  calculateSparkFeeBreakdownRecipientExact,
  resolveActualProviderFee,
  assertFeeBreakdownConsistent,
} from "./spark-fee-engine";

export type { BreezSparkAdapter } from "./spark-adapter";
export { createSparkAdapter }     from "./spark-adapter";

export { apiGetSparkFeeConfig }   from "./spark-api";
