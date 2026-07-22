/**
 * providers.tsx — ThirdwebProvider wrapper identico al progetto USDA.
 */

import { ThirdwebProvider } from "thirdweb/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <ThirdwebProvider>{children}</ThirdwebProvider>;
}
