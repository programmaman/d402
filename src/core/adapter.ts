import type {
  AbiCodec,
  DecodedError,
  EvmLog,
  PreparedTx,
  ReadBlockReference,
  RpcClient,
} from "@rakelabs/dpayments-sdk";

import type { Address, Hex32, SignedTx } from "./types.js";

export type D402ErrorDecoder = (
  error: unknown,
) => DecodedError | undefined;

export interface D402TxReceipt {
  readonly txHash: Hex32;
  readonly status: "success" | "reverted";
  readonly blockNumber: number;
  readonly blockHash: Hex32;
  readonly logs: readonly EvmLog[];
}

/** A transaction broadcast to the network but not necessarily confirmed. */
export interface D402BroadcastedTx {
  readonly txHash: Hex32;
  waitForReceipt(): Promise<D402TxReceipt>;
}

export interface D402BlockInfo {
  readonly number: number;
  readonly timestamp: number;
  readonly hash: Hex32;
}

export interface D402RpcClient extends RpcClient {
  getTransactionReceipt(txHash: Hex32): Promise<D402TxReceipt | null>;
  getBlock(reference: ReadBlockReference): Promise<D402BlockInfo>;
}

export interface D402Signer {
  getAddress(): Promise<Address>;
  signTx(tx: PreparedTx): Promise<SignedTx>;
}

export interface D402TxBroadcaster {
  broadcastTx(tx: SignedTx): Promise<D402BroadcastedTx>;
}

export interface D402Adapter {
  readonly rpcClient: D402RpcClient;
  readonly codec: AbiCodec;
  readonly errorDecoder?: D402ErrorDecoder;
  readonly signer?: D402Signer;
  readonly broadcaster?: D402TxBroadcaster;
}
