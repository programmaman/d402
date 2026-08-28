import {
  FACTORY_ADDRESS,
  PaymentEvents,
  PaymentReader,
  PaymentState,
  ZERO_ADDRESS,
} from "@rakelabs/dpayments-sdk";
import { requireAddress } from "@rakelabs/dpayments-sdk";
import type {
  PaymentCreatedEvent,
} from "@rakelabs/dpayments-sdk";
import {
  derivePaymentId,
  validatePaymentSalt,
} from "../core/index.js";
import type {
  Address,
  D402BlockReference,
  DPaymentProof,
  D402PaymentRequest,
  D402PaymentSaltValidation,
  D402RpcClient,
  D402TxReceipt,
  Hex32,
} from "../core/index.js";
import type {
  PaymentState as D402PaymentState,
  AuthenticatedPayment,
  AuthenticatedPaymentContext,
  PaymentConfig,
  PaymentAuthenticator,
  PaymentFailure,
  PaymentObserver,
} from "./types.js";

type PaymentValidationResult =
  | { ok: true }
  | PaymentFailure;
import { getConnectedChainId } from "../runtime/chain.js";
import { D402_DEFAULT_CONFIRMATIONS } from "../runtime/defaults.js";
import { getDPaymentsMulticallConfig } from "../runtime/multicall.js";
import { findPaymentCreatedEvents } from "../runtime/payment-events.js";
import {
  readBlockReference,
  sameBlockReference,
} from "./block-reference.js";

export function verifyPaymentSalt(
  paymentRequest: D402PaymentRequest,
  dPaymentProof: DPaymentProof,
): D402PaymentSaltValidation {
  return validatePaymentSalt(paymentRequest, dPaymentProof.paymentSalt);
}

export function createDPaymentsAuthenticator(
  config: PaymentConfig,
): PaymentAuthenticator {
  const events = new PaymentEvents(config.adapter.codec);
  const confirmations = config.payment.confirmations ?? D402_DEFAULT_CONFIRMATIONS;

  return async function authenticateDPaymentsPayment(input) {
    const { paymentRequest } = input;
    const proof = input.dPaymentProof;
    const chainResult = await verifyChain(
      paymentRequest,
      getConnectedChainId(config.adapter.rpcClient),
    );
    if (!chainResult.ok) {
      return chainResult;
    }

    const receiptResult = await readTransactionReceipt(
      config.adapter.rpcClient,
      proof.txHash,
    );
    if (!receiptResult.ok) return receiptResult;

    const createdEventResult = await verifyPaymentCreatedEvent({
      paymentRequest,
      dPaymentProof: proof,
      receipt: receiptResult.receipt,
      rpcClient: config.adapter.rpcClient,
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
      rpcClient: config.adapter.rpcClient,
      ...(config.payment.settlementWindow !== undefined
        ? { settlementWindow: config.payment.settlementWindow }
        : {}),
    });
    if (!settlementResult.ok) return settlementResult;

    return {
      ok: true,
      payment: buildAuthenticatedPayment(
      proof,
      createdEventResult.paymentId,
      createdEventResult.payerAddress,
      createdEventResult.receipt,
      createdEventResult.confirmations,
      ),
    };
  };
}

export function createDPaymentsObserver(
  config: PaymentConfig,
): PaymentObserver {
  const inFlightPaymentStateReads = new Map<string, Promise<PaymentStateReadResult>>();

  async function getReader(): Promise<PaymentReader> {
    const chainId = await getConnectedChainId(config.adapter.rpcClient);

    return new PaymentReader(
      config.adapter.rpcClient,
      config.adapter.codec,
      config.payment.multicall ?? getDPaymentsMulticallConfig(chainId),
    );
  }

  return async function observeDPaymentsPayment(context: Readonly<AuthenticatedPaymentContext>) {
    const state = await getReader().then((currentReader) =>
      readPaymentStateOnce(currentReader, context.payment.paymentAddress, inFlightPaymentStateReads),
    );
    if (!state.ok) return state;
    return {
      ok: true,
      payment: {
        ...context.payment,
        state: toD402PaymentState(state.state),
      },
    };
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

type TransactionReceipt = D402TxReceipt;

type TransactionReceiptResult =
  | { ok: true; receipt: TransactionReceipt }
  | {
      ok: false;
      reason: "onchain-payment-not-found" | "provider-error";
      cause?: unknown;
    };

async function readTransactionReceipt(
  rpcClient: D402RpcClient,
  txHash: Hex32,
): Promise<TransactionReceiptResult> {
  try {
    const receipt = await rpcClient.getTransactionReceipt(txHash);
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
  rpcClient: D402RpcClient;
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
  | PaymentFailure
> {
  const { receipt } = input;

  if (receipt.status !== "success") {
    return { ok: false, reason: "failed-transaction" };
  }

  let confirmations: number | undefined;
  if (input.confirmations === 1) {
    // A non-null receipt proves inclusion, which is one confirmation under
    // this authenticator's convention. No block-head lookup is needed.
    confirmations = 1;
  } else if (input.confirmations > 1) {
    let blockNumber: number;
    try {
      blockNumber = (await input.rpcClient.getBlock("latest")).number;
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
    payerAddress = requireAddress(createdEvent.creator, "creator").toLowerCase() as Address;
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
  rpcClient: D402RpcClient;
  settlementWindow?: number;
}): Promise<PaymentValidationResult> {
  if (input.settlementWindow === undefined || input.settlementReference === undefined) {
    return { ok: true };
  }

  const referenceResult = await readBlockReference(
    input.rpcClient,
    { blockHash: input.settlementReference.blockHash },
  );
  if (!referenceResult.ok) {
    return referenceResult.reason === "provider-error"
      ? { ok: false, reason: "provider-error", cause: referenceResult.cause }
      : { ok: false, reason: "reference-block-mismatch" };
  }
  if (!sameBlockReference(referenceResult.reference, input.settlementReference)) {
    return { ok: false, reason: "reference-block-mismatch" };
  }

  const creationResult = await readBlockReference(
    input.rpcClient,
    input.receipt.blockNumber,
  );
  if (!creationResult.ok) {
    return {
      ok: false,
      reason: "provider-error",
      cause: creationResult.reason === "provider-error"
        ? creationResult.cause
        : new Error("Payment creation block is unavailable."),
    };
  }

  if (
    referenceResult.reference.blockNumber > input.receipt.blockNumber
    || BigInt(referenceResult.reference.blockTimestampUnixSec)
      > BigInt(creationResult.reference.blockTimestampUnixSec)
  ) {
    return { ok: false, reason: "reference-settlement-out-of-bounds" };
  }

  const expectedSettlementTime = BigInt(
    referenceResult.reference.blockTimestampUnixSec,
  )
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
  if (event.paymentId.toLowerCase() !== expectedPaymentId.toLowerCase()) {
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
): Promise<PaymentStateReadResult> {
  try {
    return { ok: true, state: await reader.readPayment.state(paymentAddress) };
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }
}

function buildAuthenticatedPayment(
  proof: DPaymentProof,
  paymentId: Hex32,
  payerAddress: Address,
  receipt: TransactionReceipt,
  confirmations?: number,
): AuthenticatedPayment {
  return {
    paymentId,
    paymentAddress: proof.paymentAddress,
    txHash: proof.txHash,
    payerAddress,
    creationBlockNumber: receipt.blockNumber,
    ...(receipt.blockHash !== undefined
      ? { creationBlockHash: receipt.blockHash }
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

function tokenAddressForChain(tokenAddress: string | null): string {
  return tokenAddress ?? ZERO_ADDRESS;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
