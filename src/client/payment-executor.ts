import {
  PaymentEvents,
  ZERO_ADDRESS,
} from "@rakelabs/dpayments-sdk";
import type {
  DPayments,
  PrepareCreateErc20Result,
} from "@rakelabs/dpayments-sdk";
import type {
  PreparedTx,
} from "@rakelabs/dpayments-sdk";
import type {
  AbstractProvider,
  Signer,
  TransactionReceipt,
  TransactionRequest,
  TransactionResponse,
} from "ethers";
import {
  hexlify,
  isError,
  randomBytes,
} from "ethers";

import {
  D402_CANONICAL_SALT,
  derivePaymentId,
} from "../core/index.js";
import type {
  Address,
  D402PaymentRequest,
  Hex32,
  PaymentAddress,
} from "../core/index.js";
import {
  D402ConfigurationError,
} from "./errors.js";
import { D402_DEFAULT_CONFIRMATIONS } from "../runtime/defaults.js";
import { createPinnedDPayments } from "../runtime/dpayments.js";
import { emitLog, NoopLogger } from "../runtime/logger.js";
import {
  normalizePaymentExecutionError,
} from "../runtime/payment-execution-error.js";
import type {
  D402PaymentExecutionError,
  D402PaymentExecutionErrorInput,
  D402PaymentOperation,
} from "../runtime/payment-execution-error.js";
import { findPaymentCreatedEvent } from "../runtime/payment-events.js";
import type { D402Logger } from "../runtime/logger.js";
import type {
  D402CreatedPayment,
  D402PaymentActionResult,
  D402PaymentExecutor,
} from "./types.js";

export interface CreateDPaymentsExecutorOptions {
  signer: Signer;
  provider: AbstractProvider;
  confirmations?: number;
  logger?: D402Logger;
}

export function createDPaymentsExecutor(
  options: CreateDPaymentsExecutorOptions,
): D402PaymentExecutor {
  const executorOptions = {
    ...options,
    logger: options.logger ?? NoopLogger,
  };
  let broadcastQueue: Promise<unknown> = Promise.resolve();

  async function broadcastInQueue<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = broadcastQueue;
    const current = (async () => {
      await previous.catch(() => {});
      return operation();
    })();

    broadcastQueue = current;
    return current;
  }

  return {
    async createPayment(paymentRequest) {
      return createDPaymentsPayment(
        executorOptions,
        paymentRequest,
        broadcastInQueue,
      );
    },
    async settlePayment(payment) {
      return sendPaymentAction(
        executorOptions,
        payment,
        "settle",
        broadcastInQueue,
      );
    },
    async disputePayment(payment) {
      return raisePaymentDispute(
        executorOptions,
        payment,
        broadcastInQueue,
      );
    },
    async submitEvidence(payment, evidenceUri) {
      return submitPaymentEvidence(
        executorOptions,
        payment,
        evidenceUri,
        broadcastInQueue,
      );
    },
  };
}

type BroadcastInQueue = <T>(
  operation: () => Promise<T>,
) => Promise<T>;

type PreparedDpaymentSdkResult =
  | Awaited<ReturnType<DPayments["factory"]["prepareCreateEthPayment"]>>
  | Awaited<ReturnType<DPayments["factory"]["prepareCreateErc20Payment"]>>;

type PreparedNativeDpayment = {
  paymentRequest: D402PaymentRequest;
  payerAddress: string;
  creationTx: PreparedTx;
};

type PreparedErc20Dpayment = {
  paymentRequest: D402PaymentRequest;
  payerAddress: string;
  approvalTx: PreparedTx;
  creationTx: PreparedTx;
};

type PreparedDpayment =
  | PreparedNativeDpayment
  | PreparedErc20Dpayment;

async function createDPaymentsPayment(
  options: CreateDPaymentsExecutorOptions,
  paymentRequest: D402PaymentRequest,
  broadcastInQueue: BroadcastInQueue,
): Promise<D402CreatedPayment> {
  try {
    const payerAddress =
      await options.signer.getAddress() as Address;
    const paymentSalt = paymentRequest.paymentSalt ?? createPaymentSalt();
    const paymentId = derivePaymentId(
      paymentRequest,
      payerAddress,
      paymentSalt,
    );
    const preparedPayment = await preparePayment(
      options,
      paymentRequest,
      paymentId,
    );
    if (
      preparedPayment.payerAddress.toLowerCase() !==
      payerAddress.toLowerCase()
    ) {
      throw new Error(
        "Signer address changed during dPayment preparation.",
      );
    }
    const confirmations = options.confirmations ??
      D402_DEFAULT_CONFIRMATIONS;

    if ("approvalTx" in preparedPayment) {
      const approvalResponse = await broadcastInQueue(() =>
        sendPreparedTx(
          options.provider,
          options.signer,
          preparedPayment.approvalTx,
          "create",
          undefined,
          options.logger ?? NoopLogger,
        ),
      );
      await waitForSuccessfulReceipt(approvalResponse, confirmations);
    }

    const createResponse = await broadcastInQueue(() =>
      sendPreparedTx(
        options.provider,
        options.signer,
        preparedPayment.creationTx,
        "create",
        undefined,
        options.logger ?? NoopLogger,
      ),
    );
    const receipt = await waitForSuccessfulReceipt(
      createResponse,
      confirmations,
    );
    const paymentAddress = extractPaymentAddressFromReceipt(
      receipt,
      paymentRequest,
      preparedPayment.creationTx.to,
      payerAddress,
      paymentId,
    );

    return {
      paymentId,
      paymentAddress,
      txHash: receipt.hash as Hex32,
      paymentSalt,
      payerAddress,
    };
  } catch (cause) {
    throw paymentExecutionError({
      operation: "create",
      cause,
    });
  }
}

function isErc20PreparedPayment(
  prepared: PreparedDpaymentSdkResult,
): prepared is PrepareCreateErc20Result {
  return "approveTx" in prepared;
}

async function preparePayment(
  options: CreateDPaymentsExecutorOptions,
  paymentRequest: D402PaymentRequest,
  paymentId: Hex32,
): Promise<PreparedDpayment> {
  const payerAddress = await options.signer.getAddress();
  const dpayments = await createPinnedDPayments({
    provider: options.provider,
    walletAddress: payerAddress,
  });
  const prepared = paymentRequest.tokenAddress === null
    ? await dpayments.factory.prepareCreateEthPayment({
        paymentId,
        netAmount: BigInt(paymentRequest.netAmount),
        payeeAddress: paymentRequest.payeeAddress,
        settlementTimeUnixSec: BigInt(paymentRequest.settlementTimeUnixSec),
      })
    : await dpayments.factory.prepareCreateErc20Payment({
        paymentId,
        tokenAddress: paymentRequest.tokenAddress,
        netAmount: BigInt(paymentRequest.netAmount),
        payeeAddress: paymentRequest.payeeAddress,
        settlementTimeUnixSec: BigInt(paymentRequest.settlementTimeUnixSec),
      });

  if (
    prepared.paymentId.toLowerCase() !==
    paymentId.toLowerCase()
  ) {
    throw new Error(
      "dPayment ID does not match d402 payment ID.",
    );
  }

  if (isErc20PreparedPayment(prepared)) {
    return {
      paymentRequest,
      payerAddress,
      approvalTx: prepared.approveTx,
      creationTx: prepared.createTx,
    };
  }

  return {
    paymentRequest,
    payerAddress,
    creationTx: prepared.tx,
  };
}

function createPaymentSalt(): Hex32 {
  let paymentSalt: Hex32;
  do {
    paymentSalt = hexlify(randomBytes(32)) as Hex32;
  } while (paymentSalt === D402_CANONICAL_SALT);
  return paymentSalt;
}

async function sendPaymentAction(
  options: CreateDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  action: "settle",
  broadcastInQueue: BroadcastInQueue,
): Promise<D402PaymentActionResult> {
  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart(
      options.logger ?? NoopLogger,
      action,
      payment,
      walletAddress,
    );
    const dpayments = await createPinnedDPayments({
      provider: options.provider,
      walletAddress,
    });
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const tx = action === "settle"
      ? dPayment.settle(walletAddress)
      : unreachable(action);
    const response = await broadcastInQueue(() =>
      sendPreparedTx(
        options.provider,
        options.signer,
        tx,
        action,
        payment.paymentAddress,
        options.logger ?? NoopLogger,
      ),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );
    emitLog(options.logger ?? NoopLogger, {
      level: "info",
      event: "payment.action.confirmed",
      message: "Payment action confirmed.",
      context: {
        action,
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        walletAddress,
        txHash: receipt.hash,
      },
    });

    return { txHash: receipt.hash as Hex32 };
  } catch (cause) {
    const error = paymentExecutionError({
      operation: "settle",
      paymentAddress: payment.paymentAddress,
      cause,
    });
    logPaymentActionFailure(
      options.logger ?? NoopLogger,
      action,
      payment,
      cause,
      error,
    );
    throw error;
  }
}

async function raisePaymentDispute(
  options: CreateDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  broadcastInQueue: BroadcastInQueue,
): Promise<D402PaymentActionResult> {
  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart(options.logger ?? NoopLogger, "dispute", payment, walletAddress);
    const dpayments = await createPinnedDPayments({
      provider: options.provider,
      walletAddress,
    });
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const current = await dPayment.read();
    emitLog(options.logger ?? NoopLogger, {
      level: "debug",
      event: "payment.dispute.precheck",
      message: "Payment dispute precheck completed.",
      context: {
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        walletAddress,
        state: current.state,
      },
    });
    const prepared = await dPayment.prepareRaiseDispute(walletAddress);
    emitLog(options.logger ?? NoopLogger, {
      level: "debug",
      event: "payment.dispute.prepared",
      message: "Payment dispute transaction prepared.",
      context: {
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        walletAddress,
      },
    });
    const response = await broadcastInQueue(() =>
      sendPreparedTx(
        options.provider,
        options.signer,
        prepared.tx,
        "dispute",
        payment.paymentAddress,
        options.logger ?? NoopLogger,
      ),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );
    emitLog(options.logger ?? NoopLogger, {
      level: "info",
      event: "payment.dispute.confirmed",
      message: "Payment dispute confirmed.",
      context: {
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        walletAddress,
        txHash: receipt.hash,
      },
    });

    return { txHash: receipt.hash as Hex32 };
  } catch (cause) {
    const error = paymentExecutionError({
      operation: "dispute",
      paymentAddress: payment.paymentAddress,
      cause,
    });
    logPaymentActionFailure(
      options.logger ?? NoopLogger,
      "dispute",
      payment,
      cause,
      error,
    );
    throw error;
  }
}

async function submitPaymentEvidence(
  options: CreateDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  evidenceUri: string,
  broadcastInQueue: BroadcastInQueue,
): Promise<D402PaymentActionResult> {
  if (evidenceUri.trim().length === 0) {
    throw paymentExecutionError({
      operation: "submit-evidence",
      paymentAddress: payment.paymentAddress,
      cause: new Error("Evidence URI must not be empty."),
    });
  }

  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart(
      options.logger ?? NoopLogger,
      "submit-evidence",
      payment,
      walletAddress,
    );
    const dpayments = await createPinnedDPayments({
      provider: options.provider,
      walletAddress,
    });
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const tx = dPayment.submitEvidence(evidenceUri, walletAddress);
    const response = await broadcastInQueue(() =>
      sendPreparedTx(
        options.provider,
        options.signer,
        tx,
        "submit-evidence",
        payment.paymentAddress,
        options.logger ?? NoopLogger,
      ),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );

    emitLog(options.logger ?? NoopLogger, {
      level: "info",
      event: "payment.evidence.confirmed",
      message: "Payment evidence submission confirmed.",
      context: {
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        walletAddress,
        txHash: receipt.hash,
      },
    });

    return { txHash: receipt.hash as Hex32 };
  } catch (cause) {
    const error = paymentExecutionError({
      operation: "submit-evidence",
      paymentAddress: payment.paymentAddress,
      cause,
    });
    logPaymentActionFailure(
      options.logger ?? NoopLogger,
      "submit-evidence",
      payment,
      cause,
      error,
    );
    throw error;
  }
}

function paymentExecutionError(
  input: D402PaymentExecutionErrorInput,
): D402PaymentExecutionError {
  return normalizePaymentExecutionError(input);
}

async function sendPreparedTx(
  provider: AbstractProvider,
  signer: Signer,
  tx: PreparedTx,
  operation: D402PaymentOperation,
  paymentAddress: PaymentAddress | undefined,
  logger: D402Logger,
): Promise<TransactionResponse> {
  async function attempt(): Promise<TransactionResponse> {
    const request = toTransactionRequest(tx);
    const from = await signer.getAddress();
    const gasLimit = await provider.estimateGas({
      ...request,
      from,
    });

    return signer.sendTransaction({
      ...request,
      gasLimit,
    });
  }

  try {
    return await attempt();
  } catch (error) {
    if (!isError(error, "NONCE_EXPIRED")) {
      throw error;
    }

    emitLog(logger, {
      level: "warn",
      event: "payment.transaction.retry",
      message: "Retrying transaction after an expired nonce.",
      context: {
        operation,
        paymentAddress,
        transactionError: "NONCE_EXPIRED",
      },
    });

    // Let ethers' short-lived provider cache expire before asking the
    // integrator's signer to select a nonce for the one recovery attempt.
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });

    return attempt();
  }
}

async function waitForSuccessfulReceipt(
  response: TransactionResponse,
  confirmations: number,
): Promise<TransactionReceipt> {
  const receipt = await response.wait(confirmations);

  if (receipt === null || receipt.status !== 1) {
    throw new Error("dPayment transaction failed.");
  }

  return receipt;
}

function toTransactionRequest(tx: PreparedTx): TransactionRequest {
  return {
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value),
    chainId: tx.chainId,
  };
}

function extractPaymentAddressFromReceipt(
  receipt: TransactionReceipt,
  paymentRequest: D402PaymentRequest,
  factoryAddress: string,
  payerAddress: string,
  paymentId: Hex32,
): Address {
  const events = new PaymentEvents();
  const createdEvent = findPaymentCreatedEvent({
    logs: receipt.logs,
    factoryAddress,
    paymentId,
    creator: payerAddress,
    payee: paymentRequest.payeeAddress,
    decoder: events,
  });

  if (createdEvent === undefined) {
    throw new Error(
      "DPayments create transaction did not emit PaymentCreated.",
    );
  }

  if (createdEvent.paymentId.toLowerCase() !== paymentId.toLowerCase()) {
    throw new Error(
      "PaymentCreated event payment id does not match d402 payment id.",
    );
  }

  if (createdEvent.logAddress.toLowerCase() !== factoryAddress.toLowerCase()) {
    throw new Error(
      "PaymentCreated event factory does not match d402 payment request.",
    );
  }

  if (createdEvent.payee.toLowerCase() !== paymentRequest.payeeAddress) {
    throw new Error(
      "PaymentCreated event payee does not match d402 payment request.",
    );
  }

  if (
    createdEvent.token.toLowerCase() !==
    tokenAddressForChain(paymentRequest.tokenAddress)
  ) {
    throw new Error(
      "PaymentCreated event token does not match d402 payment request.",
    );
  }

  return createdEvent.paymentAddress.toLowerCase() as Address;
}

function tokenAddressForChain(tokenAddress: string | null): string {
  return (tokenAddress ?? ZERO_ADDRESS).toLowerCase();
}

function unreachable(value: never): never {
  void value;
  throw new D402ConfigurationError("Unsupported payment action.");
}

function logPaymentActionStart(
  logger: D402Logger,
  action: "settle" | "dispute" | "submit-evidence",
  payment: D402CreatedPayment,
  walletAddress: string,
): void {
  emitLog(logger, {
    level: "debug",
    event: "payment.action.started",
    message: "Payment action started.",
    context: {
      action,
      paymentId: payment.paymentId,
      paymentAddress: payment.paymentAddress,
      walletAddress,
    },
  });
}

function logPaymentActionFailure(
  logger: D402Logger,
  operation: "settle" | "dispute" | "submit-evidence",
  payment: D402CreatedPayment,
  cause: unknown,
  error: D402PaymentExecutionError,
): void {
  emitLog(logger, {
    level: "error",
    event: "payment.execution.failed",
    message: "Payment execution failed.",
    context: {
      operation,
      paymentId: payment.paymentId,
      paymentAddress: payment.paymentAddress,
      ...safeErrorContext(cause),
      ...(error.dpaymentsError !== undefined
        ? { dpaymentsError: error.dpaymentsError }
        : {}),
      ...(error.transactionError !== undefined
        ? { transactionError: error.transactionError }
        : {}),
    },
  });
}

function safeErrorContext(error: unknown): Readonly<Record<string, unknown>> {
  if (error === null || typeof error !== "object") return {};

  const known = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
  };

  return {
    ...(typeof known.name === "string" ? { errorName: known.name } : {}),
    ...(typeof known.message === "string"
      ? { errorMessage: known.message }
      : {}),
    ...(typeof known.code === "string" || typeof known.code === "number"
      ? { errorCode: known.code }
      : {}),
  };
}
