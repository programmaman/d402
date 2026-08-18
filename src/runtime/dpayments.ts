import { ABI, DPayments, FACTORY_ADDRESS } from "@rakelabs/dpayments-sdk";
import {
  createEthersAbiCodec,
  createEthersRpcClient,
} from "@rakelabs/ethers-adapter";
import type { AbstractProvider } from "ethers";

import { getConnectedChainId } from "./chain.js";

const quickDisputablePayment = Object.freeze({
  address: "0x2813C7F3c4AABBa045e10f1eFAc835E342DE4E0A",
  name: "Quick Disputable Payment V2",
});

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
      rpcClient: createEthersRpcClient(options.provider),
      codec: createEthersAbiCodec(ABI),
      walletAddress: options.walletAddress,
      impl: quickDisputablePayment,
    }),
  );

  walletCache.set(cacheKey, pending);

  return pending.catch((error) => {
    walletCache?.delete(cacheKey);
    throw error;
  });
}
