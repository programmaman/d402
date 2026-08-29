import type {
  D402BroadcastedTx,
  D402TxBroadcaster,
  SignedTx,
} from "d402/core";
import type { AbstractProvider } from "ethers";

import { assertHex32 } from "./hash.js";
import { normalizeEthersReceipt } from "./receipt.js";

export interface EthersTxBroadcasterOptions {
  provider: AbstractProvider;
  confirmations?: number;
}

export function createEthersTxBroadcaster(
  options: EthersTxBroadcasterOptions,
): D402TxBroadcaster {
  return {
    async broadcastTx(
      signedTx: SignedTx,
    ): Promise<D402BroadcastedTx> {
      const response = await options.provider.broadcastTransaction(signedTx);
      const txHash = assertHex32(response.hash, "transaction hash");

      return {
        txHash,
        async waitForReceipt() {
          const receipt = await response.wait(options.confirmations ?? 1);

          if (receipt === null) {
            throw new Error(
              "The transaction was not mined and no receipt was returned.",
            );
          }

          return normalizeEthersReceipt(receipt, txHash);
        },
      };
    },
  };
}
