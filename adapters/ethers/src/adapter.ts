import { ABI } from "@rakelabs/dpayments-sdk";
import type { AbiCodec } from "@rakelabs/dpayments-sdk";
import type {
  AbstractProvider,
  Signer,
} from "ethers";

import type {
  D402ErrorDecoder,
  D402RpcClient,
  D402TxSender,
} from "d402/core";
import { decodeEthersError } from "@rakelabs/ethers-adapter";
import { createEthersAbiCodec } from "./codec.js";
import { createEthersRpcClient } from "./rpc-client.js";
import { createEthersTxSender } from "./tx-sender.js";

export interface EthersAdapterOptions {
  provider: AbstractProvider;
  signer?: Signer;
  confirmations?: number;
}

export interface EthersAdapter {
  readonly rpcClient: D402RpcClient;
  readonly codec: AbiCodec;
  readonly errorDecoder: D402ErrorDecoder;
  readonly txSender?: D402TxSender;
}

export function createEthersAdapter(
  options: EthersAdapterOptions,
): EthersAdapter {
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

  const components: {
    rpcClient: D402RpcClient;
    codec: AbiCodec;
    errorDecoder: D402ErrorDecoder;
    txSender?: D402TxSender;
  } = {
    rpcClient,
    codec,
    errorDecoder,
  };

  if (txSender !== undefined) {
    components.txSender = txSender;
  }

  return components;
}
