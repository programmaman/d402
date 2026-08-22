import type { AbiCodec } from "@rakelabs/dpayments-sdk";
import { createEthersAbiCodec as createAdapterAbiCodec } from "@rakelabs/ethers-adapter";
import type { InterfaceAbi } from "ethers";

export function createEthersAbiCodec(
  abi: InterfaceAbi,
): AbiCodec {
  return createAdapterAbiCodec(abi);
}
