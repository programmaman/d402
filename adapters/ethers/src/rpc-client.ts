import type { AbstractProvider } from "ethers";
import { createEthersRpcClient as createAdapterRpcClient } from "@rakelabs/ethers-adapter";
import type { ReadBlockReference } from "@rakelabs/dpayments-sdk";

import type { D402BlockInfo, D402RpcClient, Hex32 } from "d402/core";
import { normalizeEthersReceipt } from "./receipt.js";

export function createEthersRpcClient(
  provider: AbstractProvider,
): D402RpcClient {
  const rpcClient = createAdapterRpcClient(provider);

  return {
    ...rpcClient,
    async getBlock(reference) {
      const block = await provider.getBlock(toEthersBlockTag(reference));
      if (block === null || block.hash === null) {
        throw new Error("Requested block was not found or has no hash.");
      }

      return {
        number: block.number,
        timestamp: block.timestamp,
        hash: block.hash as Hex32,
      } satisfies D402BlockInfo;
    },
    async getTransactionReceipt(txHash) {
      const receipt = await provider.getTransactionReceipt(txHash);

      return receipt === null
        ? null
        : normalizeEthersReceipt(receipt, txHash);
    },
  };
}

function toEthersBlockTag(reference: ReadBlockReference): number | bigint | string {
  if (typeof reference === "object") {
    return "blockNumber" in reference ? reference.blockNumber : reference.blockHash;
  }

  return reference;
}