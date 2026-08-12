/**
 * Spark API — chiamate al backend Alpha per configurazione Spark.
 * Nessuna chiamata diretta al Breez SDK o agli operatori Spark.
 */

import type { SparkFeeConfig } from "./spark-types";

/** Default safe se il backend non è raggiungibile. */
const SPARK_FEE_DEFAULTS: SparkFeeConfig = {
  fee_bps:            10,
  min_fee_sat:        1,
  quote_validity_sec: 30,
};

/**
 * Legge la platform fee Spark dal backend.
 * Fail-safe: in caso di errore restituisce i default.
 * NON espone la provider fee — quella viene dall'SDK.
 */
export async function apiGetSparkFeeConfig(): Promise<SparkFeeConfig> {
  try {
    const res = await fetch("/api/v1/spark/fee-config", {
      credentials: "include",
      headers:     { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`spark/fee-config → ${res.status}`);
    const { data } = await res.json() as { data: SparkFeeConfig };
    return {
      fee_bps:            data.fee_bps            ?? SPARK_FEE_DEFAULTS.fee_bps,
      min_fee_sat:        data.min_fee_sat        ?? SPARK_FEE_DEFAULTS.min_fee_sat,
      quote_validity_sec: data.quote_validity_sec ?? SPARK_FEE_DEFAULTS.quote_validity_sec,
    };
  } catch {
    return SPARK_FEE_DEFAULTS;
  }
}
