import type { PreparedTx } from "@rakelabs/dpayments-sdk";
import type {
  AbstractProvider,
  Signer,
  TransactionReceipt,
  TransactionRequest,
  TransactionResponse,
} from "ethers";
import { isError } from "ethers";

const NONCE_RETRY_LIMIT = 3;
const NONCE_RETRY_BASE_DELAY_MS = 300;

export type BroadcastQueue = <Result>(
  operation: () => Promise<Result>,
) => Promise<Result>;

export interface TransactionNonceRetry {
  retry: number;
  retryLimit: number;
  delayMs: number;
}

export interface SendPreparedTransactionInput {
  provider: AbstractProvider;
  signer: Signer;
  tx: PreparedTx;
  onNonceRetry?: (retry: TransactionNonceRetry) => void;
}

export function createBroadcastQueue(): BroadcastQueue {
  let queue: Promise<unknown> = Promise.resolve();

  return async function broadcastInQueue<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = queue;
    const current = (async () => {
      await previous.catch(() => {});
      return operation();
    })();

    queue = current;
    return current;
  };
}

export function toTransactionRequest(
  tx: PreparedTx,
): TransactionRequest {
  return {
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value),
    chainId: tx.chainId,
  };
}

export async function sendPreparedTransaction(
  input: SendPreparedTransactionInput,
): Promise<TransactionResponse> {
  async function attempt(): Promise<TransactionResponse> {
    const request = toTransactionRequest(input.tx);
    const from = await input.signer.getAddress();
    const gasLimit = await input.provider.estimateGas({
      ...request,
      from,
    });

    return input.signer.sendTransaction({
      ...request,
      gasLimit,
    });
  }

  for (let retry = 0; ; retry++) {
    try {
      return await attempt();
    } catch (error) {
      if (
        !isError(error, "NONCE_EXPIRED") ||
        retry === NONCE_RETRY_LIMIT
      ) {
        throw error;
      }

      const delayMs =
        NONCE_RETRY_BASE_DELAY_MS * 2 ** retry +
        Math.floor(Math.random() * NONCE_RETRY_BASE_DELAY_MS);
      input.onNonceRetry?.({
        retry: retry + 1,
        retryLimit: NONCE_RETRY_LIMIT,
        delayMs,
      });

      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }
}

export async function waitForSuccessfulReceipt(
  response: TransactionResponse,
  confirmations: number,
  failureMessage = "dPayment transaction failed.",
): Promise<TransactionReceipt> {
  const receipt = await response.wait(confirmations);

  if (receipt === null || receipt.status !== 1) {
    throw new Error(failureMessage);
  }

  return receipt;
}
