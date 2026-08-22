import type { EvmLog } from "@rakelabs/dpayments-sdk";
import type { TransactionReceipt } from "ethers";

import type { D402TxReceipt } from "d402/core";
import { assertHex32 } from "./hash.js";

export function normalizeEthersReceipt(
  receipt: TransactionReceipt,
  expectedTxHash?: `0x${string}`,
): D402TxReceipt {
  if (receipt.status !== 0 && receipt.status !== 1) {
    throw new Error("Ethers returned a transaction receipt with an invalid status.");
  }

  if (
    !Number.isSafeInteger(receipt.blockNumber) ||
    receipt.blockNumber < 0
  ) {
    throw new Error("Ethers returned a transaction receipt with an invalid block number.");
  }

  const txHash = assertHex32(receipt.hash, "transaction hash");
  const blockHash = assertHex32(receipt.blockHash, "block hash");

  if (
    expectedTxHash !== undefined &&
    txHash.toLowerCase() !== expectedTxHash.toLowerCase()
  ) {
    throw new Error("Ethers returned a receipt for a different transaction.");
  }

  return {
    txHash,
    status: receipt.status === 1 ? "success" : "reverted",
    blockNumber: receipt.blockNumber,
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
