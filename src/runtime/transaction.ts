import type { PreparedTx } from "@rakelabs/dpayments-sdk";

import { TransactionPreparedEvent } from "../core/events.js";
import type { D402EventHandler } from "../core/events.js";
import type {
  D402BroadcastedTx,
  D402TxReceipt,
  D402TxSender,
} from "../core/index.js";
import { emitEvent } from "./events.js";

export type BroadcastQueue = <Result>(
  operation: () => Promise<Result>,
) => Promise<Result>;

export interface BroadcastPreparedTransactionInput {
  txSender: D402TxSender;
  tx: PreparedTx;
  onEvent?: D402EventHandler | undefined;
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

export async function broadcastPreparedTransaction(
  input: BroadcastPreparedTransactionInput,
): Promise<D402BroadcastedTx> {
  emitEvent(
    input.onEvent,
    new TransactionPreparedEvent(input.tx),
  );

  return input.txSender.broadcastTransaction(input.tx);
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
