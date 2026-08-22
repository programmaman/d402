import type { AbstractProvider, Signer } from "ethers";
import { createD402Client } from "d402/client";
import type {
  CreateD402ClientOptions,
  D402Client,
} from "d402/client";
import type { D402TxSender } from "d402/core";
import { createEthersAdapter } from "./adapter.js";

export interface EthersClientOptions extends Omit<
  CreateD402ClientOptions,
  "rpcClient" | "codec" | "errorDecoder"
> {
  provider: AbstractProvider;
  signer?: Signer;
  confirmations?: number;
  txSender?: D402TxSender;
}

/**
 * Ethers-backed compatibility constructor.
 *
 * The adapter accepts provider/signer construction inputs and supplies the
 * neutral components consumed by d402 core.
 */
export function createClient(
  options: EthersClientOptions,
): Promise<D402Client> {
  const {
    provider,
    signer,
    confirmations,
    txSender,
    ...clientOptions
  } = options;
  const adapter = createEthersAdapter({
    provider,
    ...(signer === undefined ? {} : { signer }),
    ...(confirmations === undefined
      ? {}
      : { confirmations }),
  });

  return createD402Client({
    ...clientOptions,
    rpcClient: adapter.rpcClient,
    codec: adapter.codec,
    errorDecoder: adapter.errorDecoder,
    ...(txSender !== undefined
      ? { txSender }
      : adapter.txSender === undefined ? {} : { txSender: adapter.txSender }),
  });
}
