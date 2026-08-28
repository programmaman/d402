import type { D402RpcClient } from "../core/index.js";

export function getConnectedChainId(
  rpcClient: D402RpcClient,
): Promise<number> {
  return rpcClient.getChainId();
}
