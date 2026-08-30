import type { AbstractProvider, Signer } from "ethers";
import { createD402Client } from "d402/client";
import type {
  CreateD402ClientOptions,
  D402Client,
} from "d402/client";
import { createEthersAdapter } from "./adapter.js";

export interface EthersClientOptions extends Omit<
  CreateD402ClientOptions,
  | "rpcClient"
  | "codec"
  | "errorDecoder"
  | "signer"
  | "broadcaster"
> {
  provider: AbstractProvider;
  signer?: Signer;
  confirmations?: number;
}

/**
 * Ethers-backed convenience constructor.
 *
 * The adapter accepts provider/signer construction inputs and supplies the
 * neutral components consumed by d402 core.
 */
export function createEthersClient(
  options: EthersClientOptions,
): Promise<D402Client> {
  const {
    provider,
    signer,
    confirmations,
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
    ...(adapter.signer === undefined ? {} : { signer: adapter.signer }),
    ...(adapter.broadcaster === undefined
      ? {}
      : { broadcaster: adapter.broadcaster }),
  });
}
