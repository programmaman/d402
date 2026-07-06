import {
  FACTORY_ADDRESS,
  PaymentEvents,
  PaymentReader,
  PaymentState,
  ZERO_ADDRESS,
} from "@rakelabs/dpayments-sdk";
import type { AbstractProvider } from "ethers";
import type { EvmLog, PaymentCreatedEvent, PaymentInfo } from "@rakelabs/dpayments-sdk";
import type { D402PaymentProof, D402PaymentRequest } from "../core/index.js";
import type {
  PaymentState as D402PaymentState,
  PaymentVerificationResult,
  PaymentVerifier,
  VerifiedPayment,
} from "./types.js";

export interface VerifyPaymentInput<Req = Request> {
  request: Req;
  paymentRequest: D402PaymentRequest;
  proof: D402PaymentProof;
  verifier: PaymentVerifier<Req>;
}

export async function verifyPayment<Req>(
  input: VerifyPaymentInput<Req>,
): Promise<PaymentVerificationResult> {
  const localResult = verifyProofMatchesRequest(input.paymentRequest, input.proof);
  if (!localResult.ok) {
    return localResult;
  }

  return input.verifier({
    request: input.request,
    paymentRequest: input.paymentRequest,
    proof: input.proof,
  });
}

export interface DPaymentsVerifierOptions {
  provider: AbstractProvider;
  minConfirmations?: number;
}

export function createDPaymentsVerifier(
  options: DPaymentsVerifierOptions,
): PaymentVerifier {
  const reader = new PaymentReader(options.provider);
  const events = new PaymentEvents();
  const minConfirmations = options.minConfirmations ?? 0;

  return async function verifyDPaymentsPayment({
    paymentRequest,
    proof,
  }): Promise<PaymentVerificationResult> {
    const chainResult = await verifyChain(paymentRequest, options.provider);
    if (!chainResult.ok) {
      return chainResult;
    }

    const createdEventResult = await verifyPaymentCreatedEvent({
      paymentRequest,
      proof,
      provider: options.provider,
      events,
      minConfirmations,
    });
    if (!createdEventResult.ok) {
      return createdEventResult;
    }

    const paymentInfoResult = await readPaymentInfo(reader, proof.paymentAddress);
    if (!paymentInfoResult.ok) {
      return paymentInfoResult;
    }

    return verifyPaymentInfo(
      paymentRequest,
      proof,
      paymentInfoResult.paymentInfo,
      createdEventResult.confirmations,
    );
  };
}

function verifyProofMatchesRequest(
  paymentRequest: D402PaymentRequest,
  proof: D402PaymentProof,
): PaymentVerificationResult {
  if (proof.paymentId !== paymentRequest.paymentId) {
    return { ok: false, reason: "payment-id-mismatch" };
  }

  return { ok: true };
}

async function verifyChain(
  paymentRequest: D402PaymentRequest,
  provider: AbstractProvider,
): Promise<PaymentVerificationResult> {
  let network: Awaited<ReturnType<AbstractProvider["getNetwork"]>>;
  try {
    network = await provider.getNetwork();
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }

  if (Number(network.chainId) !== paymentRequest.chainId) {
    return { ok: false, reason: "wrong-chain" };
  }

  return { ok: true };
}

async function verifyPaymentCreatedEvent(input: {
  paymentRequest: D402PaymentRequest;
  proof: D402PaymentProof;
  provider: AbstractProvider;
  events: PaymentEvents;
  minConfirmations: number;
}): Promise<
  | { ok: true; confirmations?: number }
  | Extract<PaymentVerificationResult, { ok: false }>
> {
  let receipt: Awaited<ReturnType<AbstractProvider["getTransactionReceipt"]>>;
  try {
    receipt = await input.provider.getTransactionReceipt(input.proof.txHash);
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }

  if (receipt === null) {
    return { ok: false, reason: "onchain-payment-not-found" };
  }

  if (receipt.status !== 1) {
    return { ok: false, reason: "failed-transaction" };
  }

  let confirmations: number | undefined;
  if (input.minConfirmations > 0) {
    let blockNumber: number;
    try {
      blockNumber = await input.provider.getBlockNumber();
    } catch (cause) {
      return { ok: false, reason: "provider-error", cause };
    }

    confirmations = blockNumber - receipt.blockNumber + 1;
    if (confirmations < input.minConfirmations) {
      return { ok: false, reason: "insufficient-confirmations" };
    }
  }

  const createdEvent = receipt.logs
    .map((log) => input.events.tryDecodePaymentCreated(log as EvmLog))
    .find((event): event is PaymentCreatedEvent => event !== undefined);

  if (createdEvent === undefined) {
    return { ok: false, reason: "missing-created-event" };
  }

  const eventResult = verifyCreatedEvent(
    input.paymentRequest,
    input.proof,
    createdEvent,
  );
  if (!eventResult.ok) {
    return eventResult;
  }

  return {
    ok: true,
    ...(confirmations !== undefined ? { confirmations } : {}),
  };
}

function verifyCreatedEvent(
  paymentRequest: D402PaymentRequest,
  proof: D402PaymentProof,
  event: PaymentCreatedEvent,
): PaymentVerificationResult {
  if (!sameHex(event.paymentId, paymentRequest.paymentId)) {
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

  if (
    proof.payerAddress !== undefined &&
    !sameAddress(event.creator, proof.payerAddress)
  ) {
    return { ok: false, reason: "wrong-payer" };
  }

  return { ok: true };
}

async function readPaymentInfo(
  reader: PaymentReader,
  paymentAddress: string,
): Promise<
  | { ok: true; paymentInfo: PaymentInfo }
  | { ok: false; reason: "onchain-payment-not-found" }
> {
  try {
    return { ok: true, paymentInfo: await reader.readPayment(paymentAddress) };
  } catch {
    return { ok: false, reason: "onchain-payment-not-found" };
  }
}

function verifyPaymentInfo(
  paymentRequest: D402PaymentRequest,
  proof: D402PaymentProof,
  paymentInfo: PaymentInfo,
  confirmations?: number,
): PaymentVerificationResult {
  if (!sameAddress(paymentInfo.paymentAddress, proof.paymentAddress)) {
    return { ok: false, reason: "wrong-payment-address" };
  }

  if (!sameAddress(paymentInfo.payee, paymentRequest.payeeAddress)) {
    return { ok: false, reason: "wrong-payee" };
  }

  if (!sameAddress(paymentInfo.token, tokenAddressForChain(paymentRequest.tokenAddress))) {
    return { ok: false, reason: "wrong-token" };
  }

  if (paymentInfo.amount < BigInt(paymentRequest.netAmount)) {
    return { ok: false, reason: "wrong-amount" };
  }

  if (paymentInfo.settlementTime !== BigInt(paymentRequest.settlementTimeUnixSec)) {
    return { ok: false, reason: "wrong-settlement-time" };
  }

  if (
    proof.payerAddress !== undefined &&
    !sameAddress(paymentInfo.payer, proof.payerAddress)
  ) {
    return { ok: false, reason: "wrong-payer" };
  }

  const state = toD402PaymentState(paymentInfo.state);
  if (!isUsableForAccess(state)) {
    return {
      ok: false,
      reason: state === "disputed" ? "disputed-payment" : "resolved-payment",
    };
  }

  return {
    ok: true,
    payment: buildVerifiedPayment(
      paymentRequest,
      proof,
      paymentInfo,
      state,
      confirmations,
    ),
  };
}

function buildVerifiedPayment(
  paymentRequest: D402PaymentRequest,
  proof: D402PaymentProof,
  paymentInfo: PaymentInfo,
  state: D402PaymentState,
  confirmations?: number,
): VerifiedPayment {
  return {
    paymentId: paymentRequest.paymentId,
    paymentAddress: proof.paymentAddress,
    txHash: proof.txHash,
    ...resolvePayerAddress(proof, paymentInfo),
    state,
    ...(confirmations !== undefined ? { confirmations } : {}),
  };
}

function resolvePayerAddress(
  proof: D402PaymentProof,
  paymentInfo: PaymentInfo,
): Pick<VerifiedPayment, "payerAddress"> | Record<string, never> {
  if (proof.payerAddress !== undefined) {
    return { payerAddress: proof.payerAddress };
  }

  if (!sameAddress(paymentInfo.payer, ZERO_ADDRESS)) {
    return { payerAddress: paymentInfo.payer as VerifiedPayment["payerAddress"] };
  }

  return {};
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
