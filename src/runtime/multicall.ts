import type { MulticallConfig } from "@rakelabs/dpayments-sdk";

const MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11";
const D402_MULTICALL_ADDRESSES: Record<number, string> = {
  1: MULTICALL3_ADDRESS,
  100: MULTICALL3_ADDRESS,
};

/**
 * Uses Multicall3 for every production chain where dPayments is deployed.
 */
export function getDPaymentsMulticallConfig(
  chainId: number,
): MulticallConfig | undefined {
  const address = D402_MULTICALL_ADDRESSES[chainId];
  if (address === undefined) {
    return undefined;
  }

  return {
    address,
    requireSuccess: true,
  };
}
