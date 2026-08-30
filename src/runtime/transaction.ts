import type { PreparedTx } from "@rakelabs/dpayments-sdk";

import { TransactionPreparedEvent } from "../core/events.js";
import type { D402EventHandler } from "../core/events.js";
import type {
  D402BroadcastedTx,
  D402TxReceipt,
  D402Signer,
  D402TxBroadcaster,
} from "../core/index.js";
import { emitEvent } from "./events.js";

export type BroadcastQueue = <Result>(
  operation: () => Promise<Result>,
) => Promise<Result>;

export interface ExecutePreparedTransactionInput {
  signer: D402Signer;
  broadcaster: D402TxBroadcaster;
  tx: PreparedTx;
  onEvent?: D402EventHandler | undefined;
}

const NONCE_RETRY_LIMIT = 3;
const NONCE_RETRY_BASE_DELAY_MS = 300;

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

export async function executePreparedTransaction(
  input: ExecutePreparedTransactionInput,
): Promise<D402BroadcastedTx> {
  emitEvent(
    input.onEvent,
    new TransactionPreparedEvent(input.tx),
  );

  for (let attempt = 0; ; attempt += 1) {
    const signedTx = await input.signer.signTx(input.tx);
    const result = await input.broadcaster.broadcastTx(signedTx);

    if (result.ok) {
      return result.submission;
    }

    if (
      !result.retryable ||
      result.reason !== "nonce-conflict" ||
      attempt >= NONCE_RETRY_LIMIT
    ) {
      throw result.cause;
    }

    await delay(
      NONCE_RETRY_BASE_DELAY_MS * 2 ** attempt +
      Math.floor(Math.random() * NONCE_RETRY_BASE_DELAY_MS),
    );
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function waitForSuccessfulReceipt(
  submission: D402BroadcastedTx,
  failureMessage = "dPayment transaction failed.",
): Promise<D402TxReceipt> {
  const receipt = await submission.waitForReceipt();

  if (receipt.status !== "success") {
    throw new Error(failureMessage);
  }

  return receipt;
}
