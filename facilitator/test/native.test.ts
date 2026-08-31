import { describe, expect, it, vi } from "vitest";

import type {
  D402BroadcastResult,
  D402PaymentProof,
  D402PaymentRequest,
  D402TxBroadcaster,
  D402TxReceipt,
  SignedTx,
} from "d402/core";
import {
  NativeFacilitator,
  NativeFacilitatorBroadcastError,
} from "../src/index.js";

const payment = {
  version: 0.3,
  resource: "urn:d402:test:resource",
  method: "GET",
  chainId: 8453,
  payeeAddress: "0x2222222222222222222222222222222222222222",
  tokenAddress: null,
  netAmount: "1000",
  settlementTimeUnixSec: "1700000000",
  agreement: { id: "test" },
  expiresAtUnixSec: 1_800_000_000,
} satisfies D402PaymentRequest;

const signedTx = "0xsigned" as SignedTx;
const receipt = {
  txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  status: "success",
  blockNumber: 10,
  blockHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  logs: [],
} satisfies D402TxReceipt;
const proof = {
  dPaymentProof: {
    version: 0.3,
    paymentAddress: "0x3333333333333333333333333333333333333333",
    txHash: receipt.txHash,
    paymentSalt: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  },
} satisfies D402PaymentProof;

function successfulBroadcaster(): {
  broadcaster: D402TxBroadcaster;
  waitForReceipt: ReturnType<typeof vi.fn>;
} {
  const waitForReceipt = vi.fn<() => Promise<D402TxReceipt>>()
    .mockResolvedValue(receipt);
  const result: D402BroadcastResult = {
    ok: true,
    submission: {
      txHash: receipt.txHash,
      waitForReceipt,
    },
  };
  return {
    broadcaster: {
      broadcastTx: vi.fn().mockResolvedValue(result),
    },
    waitForReceipt,
  };
}

describe("NativeFacilitator", () => {
  it("advertises a signed transaction authorization", () => {
    const { broadcaster } = successfulBroadcaster();
    const facilitator = new NativeFacilitator({
      broadcaster,
      proofBuilder: { build: vi.fn() },
    });

    expect(facilitator.advertise(payment)).toEqual({
      description: "Client signs a transaction; the server broadcasts it.",
      authorization: {
        schema: {
          format: "d402-compact",
          schema: {
            fields: { signedTx: "SignedTx" },
            required: ["signedTx"],
          },
        },
      },
    });
  });

  it("broadcasts, waits for receipt, and builds the canonical proof", async () => {
    const { broadcaster, waitForReceipt } = successfulBroadcaster();
    const build = vi.fn().mockResolvedValue(proof);
    const facilitator = new NativeFacilitator({
      broadcaster,
      proofBuilder: { build },
    });

    await expect(facilitator.facilitate(payment, signedTx))
      .resolves.toBe(proof);

    expect(broadcaster.broadcastTx).toHaveBeenCalledWith(signedTx);
    expect(waitForReceipt).toHaveBeenCalledOnce();
    expect(build).toHaveBeenCalledWith({
      payment,
      signedTx,
      receipt,
      txHash: receipt.txHash,
    });
  });

  it("surfaces structured broadcast failures without building a proof", async () => {
    const failure: D402BroadcastResult = {
      ok: false,
      retryable: true,
      reason: "nonce-conflict",
      cause: new Error("nonce conflict"),
    };
    const build = vi.fn();
    const facilitator = new NativeFacilitator({
      broadcaster: {
        broadcastTx: vi.fn().mockResolvedValue(failure),
      },
      proofBuilder: { build },
    });

    await expect(facilitator.facilitate(payment, signedTx))
      .rejects.toBeInstanceOf(NativeFacilitatorBroadcastError);

    expect(build).not.toHaveBeenCalled();
  });
});
