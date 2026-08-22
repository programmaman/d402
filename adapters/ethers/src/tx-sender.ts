import type { PreparedTx } from "@rakelabs/dpayments-sdk";
import type {
  AbstractProvider,
  Signer,
  TransactionRequest,
} from "ethers";
import { isError } from "ethers";
import type { D402TxSender } from "d402/core";

import { assertHex32 } from "./hash.js";
import { normalizeEthersReceipt } from "./receipt.js";

const NONCE_RETRY_LIMIT = 3;
const NONCE_RETRY_BASE_DELAY_MS = 300;

export interface EthersTxSenderOptions {
  provider: AbstractProvider;
  signer: Signer;
  confirmations?: number;
}

export function createEthersTxSender(
  options: EthersTxSenderOptions,
): D402TxSender {
  return {
    getAddress() {
      return options.signer.getAddress() as Promise<`0x${string}`>;
    },

    async broadcastTransaction(transaction) {
      const response = await sendWithNonceRetry(options, transaction);
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

          return normalizeEthersReceipt(
            receipt,
            txHash,
          );
        },
      };
    },
  };
}

async function sendWithNonceRetry(
  options: EthersTxSenderOptions,
  transaction: PreparedTx,
) {
  for (let retry = 0; ; retry++) {
    try {
      const from = await options.signer.getAddress();
      const request = toEthersTransaction(transaction);
      const gasLimit = await options.provider.estimateGas({
        ...request,
        from,
      });

      return await options.signer.sendTransaction({
        ...request,
        gasLimit,
      });
    } catch (error) {
      if (
        !isError(error, "NONCE_EXPIRED") ||
        retry >= NONCE_RETRY_LIMIT
      ) {
        throw error;
      }

      const delayMs =
        NONCE_RETRY_BASE_DELAY_MS * 2 ** retry +
        Math.floor(Math.random() * NONCE_RETRY_BASE_DELAY_MS);
      await delay(delayMs);
    }
  }
}

function toEthersTransaction(
  transaction: PreparedTx,
): TransactionRequest {
  return {
    to: transaction.to,
    data: transaction.data,
    value: BigInt(transaction.value),
    chainId: transaction.chainId,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
