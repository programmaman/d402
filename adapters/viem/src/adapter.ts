import {ABI} from "@rakelabs/dpayments-sdk";
import type {PublicClient, WalletClient} from "viem";

import type {D402Adapter, D402ErrorDecoder,} from "d402/core";
import {decodeViemError} from "@rakelabs/viem-adapter";
import {createViemAbiCodec} from "./codec.js";
import {createViemRpcClient} from "./rpc-client.js";
import {createViemTxSender} from "./tx-sender.js";

export interface ViemAdapterOptions {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  confirmations?: number;
}

export function createViemAdapter(
  options: ViemAdapterOptions,
): D402Adapter {
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

  return {
      rpcClient,
      codec,
      errorDecoder,
      ...(txSender === undefined ? {} : {txSender}),
  } satisfies D402Adapter;
}