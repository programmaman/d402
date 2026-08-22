import { ABI } from "@rakelabs/dpayments-sdk";
import type { AbiCodec } from "@rakelabs/dpayments-sdk";
import type { PublicClient, WalletClient } from "viem";

import type {
  D402ErrorDecoder,
  D402RpcClient,
  D402TxSender,
} from "d402/core";
import { decodeViemError } from "@rakelabs/viem-adapter";
import { createViemAbiCodec } from "./codec.js";
import { createViemRpcClient } from "./rpc-client.js";
import { createViemTxSender } from "./tx-sender.js";

export interface ViemAdapterOptions {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  confirmations?: number;
}

export interface ViemAdapter {
  readonly rpcClient: D402RpcClient;
  readonly codec: AbiCodec;
  readonly errorDecoder: D402ErrorDecoder;
  readonly txSender?: D402TxSender;
}

export function createViemAdapter(
  options: ViemAdapterOptions,
): ViemAdapter {
  const rpcClient = createViemRpcClient(options.publicClient);
  const codec = createViemAbiCodec(ABI);
  const errorDecoder: D402ErrorDecoder = (error) =>
    decodeViemError(error, codec);
  const txSender = options.walletClient === undefined
    ? undefined
    : createViemTxSender({
        publicClient: options.publicClient,
        walletClient: options.walletClient,
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
