import type { AbiCodec } from "@rakelabs/dpayments-sdk";
import {
  createViemAbiCodec as createAdapterAbiCodec,
} from "@rakelabs/viem-adapter";
import type { Abi } from "viem";

export function createViemAbiCodec(
  abi: Abi,
): AbiCodec {
  return createAdapterAbiCodec(abi);
}
