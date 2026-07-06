import { DPayments, FACTORY_ADDRESS } from "@rakelabs/dpayments-sdk";
import type { AbstractProvider } from "ethers";

import { D402_QUICK_DISPUTABLE_PAYMENT } from "../core/index.js";
import { getConnectedChainId } from "./chain.js";

const dpaymentsCache = new WeakMap<
  AbstractProvider,
  Map<string, Promise<DPayments>>
>();

export interface CreatePinnedDPaymentsOptions {
  provider: AbstractProvider;
  walletAddress: string;
}

export async function createPinnedDPayments(
  options: CreatePinnedDPaymentsOptions,
): Promise<DPayments> {
  const chainId = await getConnectedChainId(options.provider);
  const walletAddress = options.walletAddress.toLowerCase();
  let walletCache = dpaymentsCache.get(options.provider);

  if (walletCache === undefined) {
    walletCache = new Map();
    dpaymentsCache.set(options.provider, walletCache);
  }

  const cacheKey = `${chainId}:${walletAddress}`;
  const existing = walletCache.get(cacheKey);
  if (existing !== undefined) {
    return existing;
  }

  const pending = Promise.resolve().then(() =>
    new DPayments({
      chainId,
      factoryAddress: FACTORY_ADDRESS,
      provider: options.provider,
      walletAddress: options.walletAddress,
      impl: D402_QUICK_DISPUTABLE_PAYMENT,
    }),
  );

  walletCache.set(cacheKey, pending);

  return pending.catch((error) => {
    walletCache?.delete(cacheKey);
    throw error;
  });
}
