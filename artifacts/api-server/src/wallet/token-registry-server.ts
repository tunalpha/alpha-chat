/**
 * Server-side token registry helpers.
 *
 * Replica i dati chiave del frontend token-registry.ts sul backend
 * per validare i token senza dipendere dal client.
 *
 * ISOLAMENTO: nessuna dipendenza dal Payment Engine esistente.
 */

// Indirizzi verificati (lowercase per confronto case-insensitive)
const VERIFIED_TOKENS: Array<{ chainId: number; symbol: string; contractAddress: string }> = [
  // Ethereum
  { chainId: 1, symbol: "USDT", contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
  { chainId: 1, symbol: "USDC", contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  // Polygon
  { chainId: 137, symbol: "USDT", contractAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" },
  { chainId: 137, symbol: "USDC", contractAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" },
  { chainId: 137, symbol: "USDA", contractAddress: "0x23396cf899ca06c4472205fc903bdb4de249d6f" },
  // BSC
  { chainId: 56, symbol: "USDT", contractAddress: "0x55d398326f99059ff775485246999027b3197955" },
  { chainId: 56, symbol: "USDC", contractAddress: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" },
];

export function isVerifiedAddress(chainId: number, address: string): boolean {
  const norm = address.toLowerCase();
  return VERIFIED_TOKENS.some(
    t => t.chainId === chainId && t.contractAddress === norm
  );
}

export function isSymbolConflict(chainId: number, symbol: string): boolean {
  const norm = symbol.toUpperCase();
  return VERIFIED_TOKENS.some(
    t => t.chainId === chainId && t.symbol.toUpperCase() === norm
  );
}
