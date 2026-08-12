/**
 * Type stub per @breeztech/breez-sdk-spark.
 *
 * Il pacchetto WASM viene caricato SOLO a runtime tramite dynamic import
 * quando spark_lightning_enabled=true. Non è una dipendenza buildtime.
 *
 * Questo stub evita TS2307 durante typecheck e build, senza richiedere
 * l'installazione del pacchetto (7.2MB WASM + multi-threading) nell'app.
 *
 * Quando Spark sarà abilitato in produzione: installare il pacchetto reale,
 * rimuovere questo stub, e aggiungere il plugin WASM a vite.config.ts.
 */
declare module "@breeztech/breez-sdk-spark" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _default: any;
  export default _default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function connect(req: unknown): Promise<any>;
  export function defaultConfig(network: string): Record<string, unknown>;
}
