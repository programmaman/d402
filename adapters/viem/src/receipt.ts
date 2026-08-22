import type {
  EvmLog,
} from "@rakelabs/dpayments-sdk";
import type { GetTransactionReceiptReturnType } from "viem";

import type { D402TxReceipt } from "d402/core";
import { assertHex32 } from "./hash.js";

export function normalizeViemReceipt(
  receipt: GetTransactionReceiptReturnType,
  expectedTxHash?: `0x${string}`,
): D402TxReceipt {
  if (receipt.status !== "success" && receipt.status !== "reverted") {
    throw new Error("Viem returned a transaction receipt with an invalid status.");
  }

  const blockNumber = Number(receipt.blockNumber);
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
    throw new Error("Viem returned a transaction receipt with an invalid block number.");
  }

  const txHash = assertHex32(receipt.transactionHash, "transaction hash");
  const blockHash = assertHex32(receipt.blockHash, "block hash");

  if (
    expectedTxHash !== undefined &&
    txHash.toLowerCase() !== expectedTxHash.toLowerCase()
  ) {
    throw new Error("Viem returned a receipt for a different transaction.");
  }

  return {
    txHash,
    status: receipt.status === "success" ? "success" : "reverted",
    blockNumber,
    blockHash,
    logs: receipt.logs.map((log): EvmLog => ({
      address: log.address,
      topics: log.topics,
      data: log.data,
      ...(log.transactionHash === undefined
        ? {}
        : { transactionHash: log.transactionHash }),
    })),
  };
}
