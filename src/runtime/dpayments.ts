import { DPayments, FACTORY_ADDRESS } from "@rakelabs/dpayments-sdk";
import type { AbiCodec } from "@rakelabs/dpayments-sdk";

import type { D402RpcClient } from "../core/index.js";
import { getConnectedChainId } from "./chain.js";

const quickDisputablePayment = Object.freeze({
  address: "0x2813C7F3c4AABBa045e10f1eFAc835E342DE4E0A",
  name: "Quick Disputable Payment V2",
});

const dpaymentsCache = new WeakMap<
  D402RpcClient,
  Map<string, Promise<DPayments>>
>();

export interface CreatePinnedDPaymentsOptions {
  rpcClient: D402RpcClient;
  codec: AbiCodec;
  walletAddress: string;
}

export async function createPinnedDPayments(
  options: CreatePinnedDPaymentsOptions,
): Promise<DPayments> {
  const chainId = await getConnectedChainId(options.rpcClient);
  const walletAddress = options.walletAddress.toLowerCase();
  let walletCache = dpaymentsCache.get(options.rpcClient);

  if (walletCache === undefined) {
    walletCache = new Map();
    dpaymentsCache.set(options.rpcClient, walletCache);
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
      rpcClient: options.rpcClient,
      codec: options.codec,
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
