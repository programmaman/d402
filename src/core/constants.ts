import type { Hex32 } from "./types.js";

export const D402_VERSION = 0.3;

/**
 * Canonical v3 salt derived from keccak256(UTF-8("d402")).
 */
export const D402_CANONICAL_SALT: Hex32 =
  "0xf70865accd1b69835cd1ac81f96bc4351fa9e88b4cf76f91f0661ce3d15e2ac6";

export const D402_QUICK_DISPUTABLE_PAYMENT = {

    address: "0x85ac6fee5f1f57de2b073e4a93edb2ff897290b8",
    name: "Quick Disputable Payment V1",

} as const;
