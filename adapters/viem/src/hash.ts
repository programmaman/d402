import type { Hex32 } from "d402/core";

export function assertHex32(value: string, field: string): Hex32 {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Viem returned an invalid ${field}.`);
  }

  return value as Hex32;
}
