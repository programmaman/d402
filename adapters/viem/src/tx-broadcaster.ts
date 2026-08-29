import type {
  D402BroadcastedTx,
  D402TxBroadcaster,
  SignedTx,
} from "d402/core";
import type { PublicClient } from "viem";

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
    ): Promise<D402BroadcastedTx> {
      const txHash =
        await options.publicClient.sendRawTransaction({
          serializedTransaction: signedTx,
        });

      return {
        txHash: assertHex32(txHash, "transaction hash"),

        async waitForReceipt() {
          const receipt =
            await options.publicClient.waitForTransactionReceipt({
              hash: txHash,
              confirmations: options.confirmations,
            });

          return normalizeViemReceipt(receipt, txHash);
        },
      };
    },
  };
}
