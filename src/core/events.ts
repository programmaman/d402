import type { PreparedTx } from "@rakelabs/dpayments-sdk";

export abstract class D402Event {
  protected constructor() {}
}

export class TransactionPreparedEvent extends D402Event {
  public readonly transaction: Readonly<PreparedTx>;

  public constructor(transaction: PreparedTx) {
    super();
    this.transaction = structuredClone(transaction);
  }
}

export type D402EventHandler = (
  event: D402Event,
) => void | Promise<void>;
