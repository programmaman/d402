import type {
  D402BroadcastedTx,
  D402TxBroadcaster,
  SignedTx,
} from "../core/index.js";

export class Facilitator {
  constructor(
    private readonly broadcaster: D402TxBroadcaster,
  ) {}

  facilitate(
    signedTx: SignedTx,
  ): Promise<D402BroadcastedTx> {
    return this.broadcaster.broadcastTx(signedTx);
  }
}
