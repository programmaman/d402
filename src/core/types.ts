export type Hex32 = `0x${string}`;
export type Address = `0x${string}`;
export type PaymentAddress = Address;
export type DecimalString = `${bigint}`;

export interface D402Agreement {
  id: string;
  hash?: Hex32;
  uri?: string;
}

export interface D402PaymentRequest {
  version: 1;
  resource: string;
  method?: string;
  chainId: number;
  payeeAddress: Address;
  tokenAddress: Address | null;
  netAmount: DecimalString;
  settlementTimeUnixSec: DecimalString;
  agreement: D402Agreement;
  expiresAtUnixSec: number;
  termsHash: Hex32;
  paymentId: Hex32;
}

export interface D402PaymentProof {
  version: 1;
  paymentId: Hex32;
  paymentAddress: PaymentAddress;
  txHash: Hex32;
  /** Must match `PaymentCreated.creator` from the trusted factory receipt. */
  payerAddress: Address;
}

export type D402PaymentTerms = Omit<D402PaymentRequest, "termsHash" | "paymentId">;
