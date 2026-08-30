import { createD402Client } from "d402/client";
import type {
  CreateD402ClientOptions,
  D402Client,
} from "d402/client";
import type {
  D402Signer,
  D402TxBroadcaster,
} from "d402/core";
import type { PublicClient, WalletClient } from "viem";
import { createViemAdapter } from "./adapter.js";

export interface ViemClientOptions extends Omit<
  CreateD402ClientOptions,
  "rpcClient" | "codec" | "errorDecoder" | "signer" | "broadcaster"
> {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  confirmations?: number;
  signer?: D402Signer;
  broadcaster?: D402TxBroadcaster;
}

export function createViemClient(
  options: ViemClientOptions,
): Promise<D402Client> {
  const {
    publicClient,
    walletClient,
    confirmations,
    signer,
    broadcaster,
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
    ...((signer ?? adapter.signer) === undefined
      ? {}
      : { signer: signer ?? adapter.signer }),
    ...((broadcaster ?? adapter.broadcaster) === undefined
      ? {}
      : { broadcaster: broadcaster ?? adapter.broadcaster }),
  });
}
