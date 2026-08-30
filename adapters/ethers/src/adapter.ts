import {ABI} from "@rakelabs/dpayments-sdk";
import type { AbstractProvider, Signer } from "ethers";

import type { D402Adapter, D402ErrorDecoder } from "d402/core";
import {decodeEthersError} from "@rakelabs/ethers-adapter";
import {createEthersAbiCodec} from "./codec.js";
import {createEthersRpcClient} from "./rpc-client.js";
import { createEthersSigner } from "./signer.js";
import { createEthersTxBroadcaster } from "./tx-broadcaster.js";

export interface EthersAdapterOptions {
  provider: AbstractProvider;
  signer?: Signer;
  confirmations?: number;
}

export function createEthersAdapter(
  options: EthersAdapterOptions,
): D402Adapter & { readonly errorDecoder: D402ErrorDecoder } {
  const rpcClient = createEthersRpcClient(options.provider);
  const codec = createEthersAbiCodec(ABI);
  const errorDecoder: D402ErrorDecoder = (error) =>
    decodeEthersError(error, codec);

  const broadcaster = createEthersTxBroadcaster({
    provider: options.provider,
    ...(options.confirmations === undefined
      ? {}
      : { confirmations: options.confirmations }),
  });
  const signer = options.signer === undefined
    ? undefined
    : createEthersSigner({
        signer: options.signer,
      });

  return {
    rpcClient,
    codec,
    errorDecoder,
    broadcaster,
    ...(signer === undefined ? {} : { signer }),
  } satisfies D402Adapter;
}
