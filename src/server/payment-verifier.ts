import {
  FACTORY_ADDRESS,
  PaymentEvents,
  PaymentReader,
  PaymentState,
  ZERO_ADDRESS,
} from "@rakelabs/dpayments-sdk";
import { getAddress } from "ethers";
import type { AbstractProvider } from "ethers";
import type { PaymentCreatedEvent } from "@rakelabs/dpayments-sdk";
import type { MulticallConfig } from "@rakelabs/dpayments-sdk";
import {
  D402_CANONICAL_SALT,
  derivePaymentId,
} from "../core/index.js";
import type {
  Address,
  D402BlockReference,
  DPaymentProof,
  D402PaymentRequest,
  Hex32,
} from "../core/index.js";
import type {
  PaymentState as D402PaymentState,
  PaymentVerificationResult,
  PaymentVerifier,
  VerifiedPayment,
} from "./types.js";

type PaymentValidationResult =
  | { ok: true }
  | Extract<PaymentVerificationResult, { ok: false }>;
import { getConnectedChainId } from "../runtime/chain.js";
import { D402_DEFAULT_CONFIRMATIONS } from "../runtime/defaults.js";
import { getDPaymentsMulticallConfig } from "../runtime/multicall.js";
import { findPaymentCreatedEvents } from "../runtime/payment-events.js";

export interface VerifyPaymentInput<Req = Request> {
  request: Req;
  paymentRequest: D402PaymentRequest;
  dPaymentProof: DPaymentProof;
  settlementReference?: D402BlockReference;
  verifier: PaymentVerifier<Req>;
}

type PaymentSaltVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "payment-id-mismatch";
    };

export function verifyPaymentSalt(
  paymentRequest: D402PaymentRequest,
  dPaymentProof: DPaymentProof,
): PaymentSaltVerificationResult {
  if (
    paymentRequest.paymentSalt !== undefined
    && paymentRequest.paymentSalt !== dPaymentProof.paymentSalt
  ) {
    return {
      ok: false,
      reason: "payment-id-mismatch",
    };
  }
  if (
    paymentRequest.paymentSalt === undefined
    && dPaymentProof.paymentSalt === D402_CANONICAL_SALT
  ) {
    return {
      ok: false,
      reason: "payment-id-mismatch",
    };
  }

  return { ok: true };
}

export async function verifyPayment<Req>(
  input: VerifyPaymentInput<Req>,
): Promise<PaymentVerificationResult> {
  const saltResult = verifyPaymentSalt(
    input.paymentRequest,
    input.dPaymentProof,
  );
  if (!saltResult.ok) {
    return saltResult;
  }

  return input.verifier({
    request: input.request,
    paymentRequest: input.paymentRequest,
    dPaymentProof: input.dPaymentProof,
    ...(input.settlementReference !== undefined
      ? { settlementReference: input.settlementReference }
      : {}),
  });
}

export interface DPaymentsVerifierOptions {
  provider: AbstractProvider;
  confirmations?: number;
  settlementWindow?: number;
  /** Trusted private-network or test-chain Multicall3 deployment. */
  multicall?: MulticallConfig;
}

export function createDPaymentsVerifier(
  options: DPaymentsVerifierOptions,
): PaymentVerifier {
  const events = new PaymentEvents();
  const confirmations = options.confirmations ?? D402_DEFAULT_CONFIRMATIONS;
  let connectedChainId: Promise<number> | undefined;
  let reader: Promise<PaymentReader> | undefined;
  const inFlightPaymentStateReads = new Map<
    string,
    Promise<PaymentStateReadResult>
  >();

  function getVerifierChainId(): Promise<number> {
    connectedChainId ??= getConnectedChainId(options.provider);
    return connectedChainId;
  }

  function getVerifierReader(): Promise<PaymentReader> {
    reader ??= getVerifierChainId().then((chainId) =>
      new PaymentReader(
        options.provider,
        options.multicall ?? getDPaymentsMulticallConfig(chainId),
      ),
    );
    return reader;
  }

  return async function verifyDPaymentsPayment(input): Promise<PaymentVerificationResult> {
    const { paymentRequest } = input;
    const proof = input.dPaymentProof;
    const chainResult = await verifyChain(
      paymentRequest,
      getVerifierChainId(),
    );
    if (!chainResult.ok) {
      return chainResult;
    }

    const receiptResult = await readTransactionReceipt(
      options.provider,
      proof.txHash,
    );
    if (!receiptResult.ok) return receiptResult;

    const createdEventResult = await verifyPaymentCreatedEvent({
      paymentRequest,
      dPaymentProof: proof,
      receipt: receiptResult.receipt,
      provider: options.provider,
      events,
      confirmations,
    });
    if (!createdEventResult.ok) {
      return createdEventResult;
    }

    const settlementResult = await verifySettlementPolicy({
      paymentRequest,
      ...(input.settlementReference !== undefined
        ? { settlementReference: input.settlementReference }
        : {}),
      receipt: createdEventResult.receipt,
      provider: options.provider,
      ...(options.settlementWindow !== undefined
        ? { settlementWindow: options.settlementWindow }
        : {}),
    });
    if (!settlementResult.ok) return settlementResult;

    // PaymentCreated authenticates the immutable payment data before this
    // mutable state read can use the payment address.
    const paymentStateResult = await getVerifierReader().then((reader) =>
      readPaymentStateOnce(
        reader,
        proof.paymentAddress,
        inFlightPaymentStateReads,
      ),
    );
    if (!paymentStateResult.ok) {
      return paymentStateResult;
    }

    return verifyPaymentState(
      proof,
      paymentStateResult.state,
      createdEventResult.paymentId,
      createdEventResult.payerAddress,
      createdEventResult.receipt,
      createdEventResult.confirmations,
    );
  };
}

async function verifyChain(
  paymentRequest: D402PaymentRequest,
  connectedChainId: Promise<number>,
): Promise<PaymentValidationResult> {
  let chainId: number;
  try {
    chainId = await connectedChainId;
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }

  if (chainId !== paymentRequest.chainId) {
    return { ok: false, reason: "wrong-chain" };
  }

  return { ok: true };
}

type PaymentStateReadResult =
  | { ok: true; state: PaymentState }
  | { ok: false; reason: "provider-error"; cause: unknown };

type TransactionReceipt = NonNullable<
  Awaited<ReturnType<AbstractProvider["getTransactionReceipt"]>>
>;

type TransactionReceiptResult =
  | { ok: true; receipt: TransactionReceipt }
  | {
      ok: false;
      reason: "onchain-payment-not-found" | "provider-error";
      cause?: unknown;
    };

async function readTransactionReceipt(
  provider: AbstractProvider,
  txHash: string,
): Promise<TransactionReceiptResult> {
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt === null) {
      return { ok: false, reason: "onchain-payment-not-found" };
    }

    return { ok: true, receipt };
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }
}

async function verifyPaymentCreatedEvent(input: {
  paymentRequest: D402PaymentRequest;
  dPaymentProof: DPaymentProof;
  receipt: TransactionReceipt;
  provider: AbstractProvider;
  events: PaymentEvents;
  confirmations: number;
}): Promise<
  | {
      ok: true;
      receipt: TransactionReceipt;
      createdEvent: PaymentCreatedEvent;
      paymentId: Hex32;
      payerAddress: Address;
      confirmations?: number;
    }
  | Extract<PaymentVerificationResult, { ok: false }>
> {
  const { receipt } = input;

  if (receipt.status !== 1) {
    return { ok: false, reason: "failed-transaction" };
  }

  let confirmations: number | undefined;
  if (input.confirmations === 1) {
    // A non-null receipt proves inclusion, which is one confirmation under
    // this verifier's convention. No block-head lookup is needed.
    confirmations = 1;
  } else if (input.confirmations > 1) {
    let blockNumber: number;
    try {
      blockNumber = await input.provider.getBlockNumber();
    } catch (cause) {
      return { ok: false, reason: "provider-error", cause };
    }

    confirmations = blockNumber - receipt.blockNumber + 1;
    if (confirmations < input.confirmations) {
      return { ok: false, reason: "insufficient-confirmations" };
    }
  }

  const createdEvents = findPaymentCreatedEvents({
    logs: receipt.logs,
    factoryAddress: FACTORY_ADDRESS,
    decoder: input.events,
  });

  if (createdEvents.length === 0) {
    return { ok: false, reason: "missing-created-event" };
  }

  const addressedEvents = createdEvents.filter((event) =>
    sameAddress(event.paymentAddress, input.dPaymentProof.paymentAddress),
  );
  if (addressedEvents.length === 0) {
    return { ok: false, reason: "wrong-payment-address" };
  }
  if (addressedEvents.length > 1) {
    return { ok: false, reason: "onchain-payment-mismatch" };
  }

  const createdEvent = addressedEvents[0]!;
  let payerAddress: Address;
  try {
    payerAddress = getAddress(createdEvent.creator).toLowerCase() as Address;
  } catch (cause) {
    return {
      ok: false,
      reason: "onchain-payment-mismatch",
      cause,
    };
  }

  const paymentId = derivePaymentId(
    input.paymentRequest,
    payerAddress,
    input.dPaymentProof.paymentSalt,
  );
  const eventResult = verifyCreatedEvent(
    input.paymentRequest,
    input.dPaymentProof,
    createdEvent,
    paymentId,
  );
  if (!eventResult.ok) {
    return eventResult;
  }

  return {
    ok: true,
    receipt,
    createdEvent,
    paymentId,
    payerAddress,
    ...(confirmations !== undefined ? { confirmations } : {}),
  };
}

async function verifySettlementPolicy(input: {
  paymentRequest: D402PaymentRequest;
  settlementReference?: D402BlockReference;
  receipt: TransactionReceipt;
  provider: AbstractProvider;
  settlementWindow?: number;
}): Promise<PaymentValidationResult> {
  if (input.settlementWindow === undefined || input.settlementReference === undefined) {
    return { ok: true };
  }

  let referenceBlock;
  try {
    referenceBlock = await input.provider.getBlock(input.settlementReference.blockHash);
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }

  if (referenceBlock === null) {
    return { ok: false, reason: "reference-block-mismatch" };
  }

  if (
    referenceBlock.number !== input.settlementReference.blockNumber
    || referenceBlock.hash?.toLowerCase() !== input.settlementReference.blockHash.toLowerCase()
    || referenceBlock.timestamp !== Number(input.settlementReference.blockTimestampUnixSec)
  ) {
    return { ok: false, reason: "reference-block-mismatch" };
  }

  let creationBlock;
  try {
    creationBlock = await input.provider.getBlock(input.receipt.blockNumber);
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }
  if (creationBlock === null) {
    return {
      ok: false,
      reason: "provider-error",
      cause: new Error("Payment creation block is unavailable."),
    };
  }

  if (
    referenceBlock.number > input.receipt.blockNumber
    || referenceBlock.timestamp > creationBlock.timestamp
  ) {
    return { ok: false, reason: "reference-settlement-out-of-bounds" };
  }

  const expectedSettlementTime = BigInt(referenceBlock.timestamp)
    + BigInt(input.settlementWindow);
  if (BigInt(input.paymentRequest.settlementTimeUnixSec) !== expectedSettlementTime) {
    return { ok: false, reason: "reference-settlement-out-of-bounds" };
  }

  return { ok: true };
}

function verifyCreatedEvent(
  paymentRequest: D402PaymentRequest,
  proof: DPaymentProof,
  event: PaymentCreatedEvent,
  expectedPaymentId: Hex32,
): PaymentValidationResult {
  if (!sameHex(event.paymentId, expectedPaymentId)) {
    return { ok: false, reason: "payment-id-mismatch" };
  }

  if (!sameAddress(event.logAddress, FACTORY_ADDRESS)) {
    return { ok: false, reason: "wrong-factory" };
  }

  if (!sameAddress(event.paymentAddress, proof.paymentAddress)) {
    return { ok: false, reason: "wrong-payment-address" };
  }

  if (!sameAddress(event.payee, paymentRequest.payeeAddress)) {
    return { ok: false, reason: "wrong-payee" };
  }

  if (!sameAddress(event.token, tokenAddressForChain(paymentRequest.tokenAddress))) {
    return { ok: false, reason: "wrong-token" };
  }

  if (event.amount < BigInt(paymentRequest.netAmount)) {
    return { ok: false, reason: "wrong-amount" };
  }

  if (event.settlementTime !== BigInt(paymentRequest.settlementTimeUnixSec)) {
    return { ok: false, reason: "wrong-settlement-time" };
  }

  return { ok: true };
}

function readPaymentStateOnce(
  reader: PaymentReader,
  paymentAddress: string,
  inFlightPaymentStateReads: Map<string, Promise<PaymentStateReadResult>>,
): Promise<PaymentStateReadResult> {
  const key = paymentAddress.toLowerCase();
  const existing = inFlightPaymentStateReads.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const pending = readPaymentState(reader, paymentAddress);
  inFlightPaymentStateReads.set(key, pending);

  void pending.then(
    () => {
      if (inFlightPaymentStateReads.get(key) === pending) {
        inFlightPaymentStateReads.delete(key);
      }
    },
    () => {
      if (inFlightPaymentStateReads.get(key) === pending) {
        inFlightPaymentStateReads.delete(key);
      }
    },
  );

  return pending;
}

async function readPaymentState(
  reader: PaymentReader,
  paymentAddress: string,
): Promise<
  | { ok: true; state: PaymentState }
  | { ok: false; reason: "provider-error"; cause: unknown }
> {
  try {
    return { ok: true, state: await reader.readPayment.state(paymentAddress) };
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }
}

function verifyPaymentState(
  proof: DPaymentProof,
  paymentState: PaymentState,
  paymentId: Hex32,
  payerAddress: Address,
  receipt: TransactionReceipt,
  confirmations?: number,
): PaymentVerificationResult {
  const state = toD402PaymentState(paymentState);
  if (!isUsableForAccess(state)) {
    return {
      ok: false,
      reason: state === "disputed" ? "disputed-payment" : "resolved-payment",
    };
  }

  return {
    ok: true,
    payment: buildVerifiedPayment(
      proof,
      state,
      paymentId,
      payerAddress,
      receipt,
      confirmations,
    ),
  };
}

function buildVerifiedPayment(
  proof: DPaymentProof,
  state: D402PaymentState,
  paymentId: Hex32,
  payerAddress: Address,
  receipt: TransactionReceipt,
  confirmations?: number,
): VerifiedPayment {
  return {
    paymentId,
    paymentAddress: proof.paymentAddress,
    txHash: proof.txHash,
    payerAddress,
    state,
    creationBlockNumber: receipt.blockNumber,
    ...(receipt.blockHash !== undefined
      ? { creationBlockHash: receipt.blockHash as Hex32 }
      : {}),
    ...(confirmations !== undefined ? { confirmations } : {}),
  };
}

function toD402PaymentState(state: PaymentState): D402PaymentState {
  if (state === PaymentState.PAID) {
    return "funded";
  }

  if (state === PaymentState.SETTLED) {
    return "settled";
  }

  if (state === PaymentState.DISPUTED) {
    return "disputed";
  }

  return "resolved";
}

function isUsableForAccess(state: D402PaymentState): boolean {
  return state === "funded" || state === "settled";
}

function tokenAddressForChain(tokenAddress: string | null): string {
  return tokenAddress ?? ZERO_ADDRESS;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
