import {
  createViemRpcClient as createAdapterRpcClient,
} from "@rakelabs/viem-adapter";
import type { ReadBlockReference } from "@rakelabs/dpayments-sdk";
import {
  TransactionReceiptNotFoundError,
  type PublicClient,
} from "viem";

import type { D402BlockInfo, D402RpcClient } from "d402/core";
import { assertHex32 } from "./hash.js";
import { normalizeViemReceipt } from "./receipt.js";

export function createViemRpcClient(
  publicClient: PublicClient,
): D402RpcClient {
  const base = createAdapterRpcClient(publicClient);

  return {
    ...base,
    async getBlock(reference) {
      const block = await publicClient.getBlock(toViemBlockReference(reference));
      const number = Number(block.number);
      const timestamp = Number(block.timestamp);

      if (!Number.isSafeInteger(number) || number < 0) {
        throw new Error("Viem returned a block with an invalid block number.");
      }
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new Error("Viem returned a block with an invalid timestamp.");
      }

      return {
        number,
        timestamp,
        hash: assertHex32(block.hash, "block hash"),
      } satisfies D402BlockInfo;
    },
    async getTransactionReceipt(txHash) {
      try {
        const receipt = await publicClient.getTransactionReceipt({
          hash: txHash,
        });

        return normalizeViemReceipt(receipt, txHash);
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) {
          return null;
        }

        throw error;
      }
    },
  };
}

function toViemBlockReference(reference: ReadBlockReference) {
  if (typeof reference === "object") {
    return "blockNumber" in reference
      ? { blockNumber: BigInt(reference.blockNumber) }
      : { blockHash: reference.blockHash };
  }

  if (typeof reference === "number" || typeof reference === "bigint") {
    return { blockNumber: BigInt(reference) };
  }

  return { blockTag: reference };
}
