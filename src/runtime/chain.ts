import type { AbstractProvider } from "ethers";

const connectedChainIdCache = new WeakMap<
  AbstractProvider,
  Promise<number>
>();

export function getConnectedChainId(
  provider: AbstractProvider,
): Promise<number> {
  const existing = connectedChainIdCache.get(provider);
  if (existing !== undefined) {
    return existing;
  }

  const pending = provider.getNetwork().then((network) => Number(network.chainId));
  connectedChainIdCache.set(provider, pending);

  return pending.catch((error) => {
    connectedChainIdCache.delete(provider);
    throw error;
  });
}
