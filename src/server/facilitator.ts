import type {
  D402BroadcastResult,
  D402TxBroadcaster,
  SignedTx,
} from "../core/index.js";

export class Facilitator {
  constructor(
    private readonly broadcaster: D402TxBroadcaster,
  ) {}

  facilitate(
    signedTx: SignedTx,
  ): Promise<D402BroadcastResult> {
    return this.broadcaster.broadcastTx(signedTx);
  }
}
