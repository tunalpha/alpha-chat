/**
 * Setup globale per i test — eseguito prima di ogni test file.
 * Imposta le env vars che sovrascrivono i default di produzione.
 */

// Silenzia pino durante i test per output pulito
process.env["LOG_LEVEL"] = "silent";
// NODE_ENV viene già settato a "test" da Vitest automaticamente
