import type {
  D402BroadcastResult,
  D402TxBroadcaster,
  SignedTx,
} from "d402/core";
import {
  BaseError,
  NonceTooHighError,
  NonceTooLowError,
  type PublicClient,
} from "viem";
import { getNodeError } from "viem/utils";

import { assertHex32 } from "./hash.js";
import { normalizeViemReceipt } from "./receipt.js";

export interface ViemTxBroadcasterOptions {
  publicClient: PublicClient;
  confirmations?: number;
}

export function createViemTxBroadcaster(
  options: ViemTxBroadcasterOptions,
): D402TxBroadcaster {
  return {
    async broadcastTx(
      signedTx: SignedTx,
    ): Promise<D402BroadcastResult> {
      try {
        const txHash =
          await options.publicClient.sendRawTransaction({
            serializedTransaction: signedTx,
          });

        return {
          ok: true,
          submission: {
            txHash: assertHex32(txHash, "transaction hash"),

            async waitForReceipt() {
              const receipt =
                await options.publicClient.waitForTransactionReceipt({
                  hash: txHash,
                  confirmations: options.confirmations,
                });

              return normalizeViemReceipt(receipt, txHash);
            },
          },
        };
      } catch (error) {
        if (isNonceConflict(error)) {
          return {
            ok: false,
            retryable: true,
            reason: "nonce-conflict",
            cause: error,
          };
        }

        return {
          ok: false,
          retryable: false,
          reason: "broadcast-failed",
          cause: error,
        };
      }
    },
  };
}

function isNonceConflict(error: unknown): boolean {
  if (
    error instanceof NonceTooLowError ||
    error instanceof NonceTooHighError
  ) {
    return true;
  }

  if (!(error instanceof BaseError)) {
    return false;
  }

  const normalized = getNodeError(error, {});

  return normalized instanceof NonceTooLowError ||
    normalized instanceof NonceTooHighError;
}
