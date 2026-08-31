export const D402_VERSION = 0.3;
export const D402_PAYMENT_PROOF_HEADER = "D402-Payment-Proof";
export const D402_PAYMENT_AUTHORIZATION_HEADER = "D402-Payment-Authorization";
export const D402_PAYMENT_REQUEST_CONTENT_TYPE = "application/d402+json";
export const D402_REFUND_REQUEST_CONTENT_TYPE =
  "application/d402-refund+json";

/**
 * Canonical v3 salt derived from keccak256(UTF-8("d402")).
 */
export const D402_CANONICAL_SALT = (
  "0xf70865accd1b69835cd1ac81f96bc4351fa9e88b4cf76f91f0661ce3d15e2ac6"
) as const satisfies `0x${string}`;

export type D402CanonicalSalt =
  typeof D402_CANONICAL_SALT;
