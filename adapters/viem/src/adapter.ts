import {ABI} from "@rakelabs/dpayments-sdk";
import type {PublicClient, WalletClient} from "viem";

import type {D402Adapter, D402ErrorDecoder,} from "d402/core";
import {decodeViemError} from "@rakelabs/viem-adapter";
import {createViemAbiCodec} from "./codec.js";
import {createViemRpcClient} from "./rpc-client.js";
import {createViemSigner} from "./signer.js";
import {createViemTxBroadcaster} from "./tx-broadcaster.js";

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
  const broadcaster = createViemTxBroadcaster({
    publicClient: options.publicClient,
    ...(options.confirmations === undefined
      ? {}
      : { confirmations: options.confirmations }),
  });
  const signer = options.walletClient === undefined
    ? undefined
    : createViemSigner({
        publicClient: options.publicClient,
        walletClient: options.walletClient,
      });

  return {
    rpcClient,
    codec,
    errorDecoder,
    broadcaster,
    ...(signer === undefined ? {} : { signer }),
  } satisfies D402Adapter;
}
