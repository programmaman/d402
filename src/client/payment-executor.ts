import {
  ABI,
  PaymentEvents,
  ZERO_ADDRESS,
} from "@rakelabs/dpayments-sdk";
import { createEthersAbiCodec } from "@rakelabs/ethers-adapter";
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
} from "ethers";
import {
  hexlify,
  randomBytes,
} from "ethers";

import {
  D402_CANONICAL_SALT,
  derivePaymentId,
} from "../core/index.js";
import type {
  Address,
  D402EventHandler,
  D402PaymentActionResult,
  D402PaymentRequest,
  Hex32,
  PaymentAddress,
} from "../core/index.js";
import { D402_DEFAULT_CONFIRMATIONS } from "../runtime/defaults.js";
import { createPinnedDPayments } from "../runtime/dpayments.js";
import { emitLog, NoopLogger } from "../runtime/logger.js";
import {
  normalizePaymentExecutionError,
} from "../runtime/payment-execution-error.js";
import type {
  D402PaymentExecutionError,
  D402PaymentOperation,
} from "../runtime/payment-execution-error.js";
import { findPaymentCreatedEvent } from "../runtime/payment-events.js";
import {
  createBroadcastQueue,
  sendPreparedTransaction,
  waitForSuccessfulReceipt,
} from "../runtime/transaction.js";
import type {
  BroadcastQueue,
  TransactionNonceRetry,
} from "../runtime/transaction.js";
import type { D402Logger } from "../runtime/logger.js";
import type {
  D402CreatedPayment,
  D402PaymentExecutor,
} from "./types.js";

export interface CreateDPaymentsExecutorOptions {
  signer: Signer;
  provider: AbstractProvider;
  confirmations?: number;
  logger?: D402Logger;
  onEvent?: D402EventHandler;
}

type ResolvedDPaymentsExecutorOptions =
  Omit<CreateDPaymentsExecutorOptions, "logger"> & {
    logger: D402Logger;
  };

export function createDPaymentsExecutor(
  options: CreateDPaymentsExecutorOptions,
): D402PaymentExecutor {
  const executorOptions: ResolvedDPaymentsExecutorOptions = {
    ...options,
    logger: options.logger ?? NoopLogger,
  };
  const broadcastInQueue = createBroadcastQueue();

  return {
    async createPayment(paymentRequest) {
      return createDPaymentsPayment(
        executorOptions,
        paymentRequest,
        broadcastInQueue,
      );
    },
    async settlePayment(payment) {
      return sendSettlementAction(
        executorOptions,
        payment,
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
  options: ResolvedDPaymentsExecutorOptions,
  paymentRequest: D402PaymentRequest,
  broadcastInQueue: BroadcastQueue,
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
        sendPreparedTransaction({
          provider: options.provider,
          signer: options.signer,
          tx: preparedPayment.approvalTx,
          onEvent: options.onEvent,
          onNonceRetry: createNonceRetryLogger(
            options.logger,
            "create",
          ),
        }),
      );
      await waitForSuccessfulReceipt(approvalResponse, confirmations);
    }

    const createResponse = await broadcastInQueue(() =>
      sendPreparedTransaction({
        provider: options.provider,
        signer: options.signer,
        tx: preparedPayment.creationTx,
        onEvent: options.onEvent,
        onNonceRetry: createNonceRetryLogger(
          options.logger,
          "create",
        ),
      }),
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
    throw normalizePaymentExecutionError({
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
  options: ResolvedDPaymentsExecutorOptions,
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

async function sendSettlementAction(
  options: ResolvedDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  broadcastInQueue: BroadcastQueue,
): Promise<D402PaymentActionResult> {
  const action = "settle";

  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart(
      options.logger,
      action,
      payment,
      walletAddress,
    );
    const dpayments = await createPinnedDPayments({
      provider: options.provider,
      walletAddress,
    });
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const tx = dPayment.settle(walletAddress);
    const response = await broadcastInQueue(() =>
      sendPreparedTransaction({
        provider: options.provider,
        signer: options.signer,
        tx,
        onEvent: options.onEvent,
        onNonceRetry: createNonceRetryLogger(
          options.logger,
          action,
          payment.paymentAddress,
        ),
      }),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );
    emitLog(options.logger, {
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
    const error = normalizePaymentExecutionError({
      operation: "settle",
      paymentAddress: payment.paymentAddress,
      cause,
    });
    logPaymentActionFailure(
      options.logger,
      action,
      payment,
      cause,
      error,
    );
    throw error;
  }
}

async function raisePaymentDispute(
  options: ResolvedDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  broadcastInQueue: BroadcastQueue,
): Promise<D402PaymentActionResult> {
  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart(
      options.logger,
      "dispute",
      payment,
      walletAddress,
    );
    const dpayments = await createPinnedDPayments({
      provider: options.provider,
      walletAddress,
    });
    const dPayment = dpayments.dPayment(payment.paymentAddress);
    const current = await dPayment.read();
    emitLog(options.logger, {
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
    emitLog(options.logger, {
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
      sendPreparedTransaction({
        provider: options.provider,
        signer: options.signer,
        tx: prepared.tx,
        onEvent: options.onEvent,
        onNonceRetry: createNonceRetryLogger(
          options.logger,
          "dispute",
          payment.paymentAddress,
        ),
      }),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );
    emitLog(options.logger, {
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
    const error = normalizePaymentExecutionError({
      operation: "dispute",
      paymentAddress: payment.paymentAddress,
      cause,
    });
    logPaymentActionFailure(
      options.logger,
      "dispute",
      payment,
      cause,
      error,
    );
    throw error;
  }
}

async function submitPaymentEvidence(
  options: ResolvedDPaymentsExecutorOptions,
  payment: D402CreatedPayment,
  evidenceUri: string,
  broadcastInQueue: BroadcastQueue,
): Promise<D402PaymentActionResult> {
  if (evidenceUri.trim().length === 0) {
    throw normalizePaymentExecutionError({
      operation: "submit-evidence",
      paymentAddress: payment.paymentAddress,
      cause: new Error("Evidence URI must not be empty."),
    });
  }

  try {
    const walletAddress = await options.signer.getAddress();
    logPaymentActionStart(
      options.logger,
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
      sendPreparedTransaction({
        provider: options.provider,
        signer: options.signer,
        tx,
        onEvent: options.onEvent,
        onNonceRetry: createNonceRetryLogger(
          options.logger,
          "submit-evidence",
          payment.paymentAddress,
        ),
      }),
    );
    const receipt = await waitForSuccessfulReceipt(
      response,
      options.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    );

    emitLog(options.logger, {
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
    const error = normalizePaymentExecutionError({
      operation: "submit-evidence",
      paymentAddress: payment.paymentAddress,
      cause,
    });
    logPaymentActionFailure(
      options.logger,
      "submit-evidence",
      payment,
      cause,
      error,
    );
    throw error;
  }
}

function createNonceRetryLogger(
  logger: D402Logger,
  operation: D402PaymentOperation,
  paymentAddress?: PaymentAddress,
): (retry: TransactionNonceRetry) => void {
  return ({ retry, retryLimit, delayMs }) => {
    emitLog(logger, {
      level: "warn",
      event: "payment.transaction.retry",
      message: "Retrying transaction after an expired nonce.",
      context: {
        operation,
        paymentAddress,
        transactionError: "NONCE_EXPIRED",
        retry,
        retryLimit,
        delayMs,
      },
    });
  };
}

function extractPaymentAddressFromReceipt(
  receipt: TransactionReceipt,
  paymentRequest: D402PaymentRequest,
  factoryAddress: string,
  payerAddress: string,
  paymentId: Hex32,
): Address {
  const events = new PaymentEvents(createEthersAbiCodec(ABI));
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
