import {ABI} from "@rakelabs/dpayments-sdk";
import type {AbstractProvider, Signer,} from "ethers";

import type {D402Adapter, D402ErrorDecoder,} from "d402/core";
import {decodeEthersError} from "@rakelabs/ethers-adapter";
import {createEthersAbiCodec} from "./codec.js";
import {createEthersRpcClient} from "./rpc-client.js";
import {createEthersTxSender} from "./tx-sender.js";

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

  const txSender = options.signer === undefined
    ? undefined
    : createEthersTxSender({
        provider: options.provider,
        signer: options.signer,
        ...(options.confirmations === undefined
          ? {}
          : { confirmations: options.confirmations }),
      });

  return {
    rpcClient,
    codec,
    errorDecoder,
    ...(txSender === undefined ? {} : {txSender}),
  } satisfies D402Adapter;
}