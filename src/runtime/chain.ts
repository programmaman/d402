import type { D402RpcClient } from "../core/index.js";

const connectedChainIdCache = new WeakMap<
  D402RpcClient,
  Promise<number>
>();

export function getConnectedChainId(
  rpcClient: D402RpcClient,
): Promise<number> {
  const existing = connectedChainIdCache.get(rpcClient);
  if (existing !== undefined) {
    return existing;
  }

  const pending = rpcClient.getChainId();
  connectedChainIdCache.set(rpcClient, pending);

  return pending.catch((error) => {
    connectedChainIdCache.delete(rpcClient);
    throw error;
  });
}
