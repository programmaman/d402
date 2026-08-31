import type {
  D402PaymentProof,
  D402PaymentRequest,
  D402TxReceipt,
  SignedTx,
} from "d402/core";

export type NativeAuthorization = SignedTx;

export interface NativeProofBuilderInput {
  payment: D402PaymentRequest;
  signedTx: SignedTx;
  receipt: D402TxReceipt;
  txHash: D402TxReceipt["txHash"];
}

export interface NativeProofBuilder {
  build(
    input: NativeProofBuilderInput,
  ): D402PaymentProof | Promise<D402PaymentProof>;
}
