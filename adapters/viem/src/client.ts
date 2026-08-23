import { createD402Client } from "d402/client";
import type {
  CreateD402ClientOptions,
  D402Client,
} from "d402/client";
import type { D402TxSender } from "d402/core";
import type { PublicClient, WalletClient } from "viem";
import { createViemAdapter } from "./adapter.js";

export interface ViemClientOptions extends Omit<
  CreateD402ClientOptions,
  "rpcClient" | "codec" | "errorDecoder" | "txSender"
> {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  confirmations?: number;
  txSender?: D402TxSender;
}

export function createViemClient(
  options: ViemClientOptions,
): Promise<D402Client> {
  const {
    publicClient,
    walletClient,
    confirmations,
    txSender,
    ...clientOptions
  } = options;
  const adapter = createViemAdapter({
    publicClient,
    ...(walletClient === undefined ? {} : { walletClient }),
    ...(confirmations === undefined ? {} : { confirmations }),
  });

  return createD402Client({
    ...clientOptions,
    rpcClient: adapter.rpcClient,
    codec: adapter.codec,
    ...(adapter.errorDecoder === undefined
      ? {}
      : { errorDecoder: adapter.errorDecoder }),
    ...(txSender !== undefined
      ? { txSender }
      : adapter.txSender === undefined ? {} : { txSender: adapter.txSender }),
  });
}
