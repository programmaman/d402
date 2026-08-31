import type {
  D402BroadcastResult,
  D402Facilitator,
  D402FacilitatorAdvertisement,
  D402PaymentProof,
  D402PaymentRequest,
  D402TxBroadcaster,
} from "d402/core";
import type { NativeAuthorization, NativeProofBuilder } from "./native-proof.js";

export interface NativeFacilitatorOptions {
  broadcaster: D402TxBroadcaster;
  proofBuilder: NativeProofBuilder;
}

export class NativeFacilitatorBroadcastError extends Error {
  readonly result: Extract<D402BroadcastResult, { ok: false }>;

  constructor(
    result: Extract<D402BroadcastResult, { ok: false }>,
  ) {
    super(`Native transaction broadcast failed: ${result.reason}.`);
    this.name = "NativeFacilitatorBroadcastError";
    this.result = result;
  }
}

export class NativeFacilitator
  implements D402Facilitator<NativeAuthorization> {
  readonly #broadcaster: D402TxBroadcaster;
  readonly #proofBuilder: NativeProofBuilder;

  constructor(options: NativeFacilitatorOptions) {
    this.#broadcaster = options.broadcaster;
    this.#proofBuilder = options.proofBuilder;
  }

  advertise(): D402FacilitatorAdvertisement {
    return {
      description:
        "Client signs a transaction; the server broadcasts it.",
      authorization: {
        schema: {
          format: "d402-compact",
          schema: {
            fields: {
              signedTx: "SignedTx",
            },
            required: ["signedTx"],
          },
        },
      },
    };
  }

  async facilitate(
    payment: D402PaymentRequest,
    signedTx: NativeAuthorization,
  ): Promise<D402PaymentProof> {
    const result = await this.#broadcaster.broadcastTx(signedTx);

    if (!result.ok) {
      throw new NativeFacilitatorBroadcastError(result);
    }

    const receipt = await result.submission.waitForReceipt();

    return this.#proofBuilder.build({
      payment,
      signedTx,
      receipt,
      txHash: result.submission.txHash,
    });
  }
}
