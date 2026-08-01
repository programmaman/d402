import type { Signer } from "ethers";

import type {
  D402PaymentActionResult,
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
  D402PaymentOperation,
} from "../runtime/payment-execution-error.js";
import {
  createBroadcastQueue,
  sendPreparedTransaction,
  waitForSuccessfulReceipt,
} from "../runtime/transaction.js";
import type {
  BroadcastQueue,
  TransactionNonceRetry,
} from "../runtime/transaction.js";
import type {
  PaymentAppealResult,
  PaymentActions,
  PaymentConfig,
} from "./types.js";
import type { D402Logger } from "../runtime/logger.js";

type ResolvedPaymentConfig = PaymentConfig & {
  signer: Signer;
  logger: D402Logger;
};

const ACTION_TRANSACTION_FAILURE_MESSAGE =
  "DPayments action transaction failed after broadcast or was not mined successfully.";

export function paymentActions(config: PaymentConfig): PaymentActions {
  if (config.signer === undefined) {
    throw new Error(
      "paymentConfig.signer is required for payment actions so the server can broadcast settlement, refund, consumption, evidence, or appeal transactions.",
    );
  }
  const actionConfig: ResolvedPaymentConfig = {
    ...config,
    signer: config.signer,
    logger: config.logger ?? NoopLogger,
  };
  const broadcastInQueue = createBroadcastQueue();

  return {
    settlePayment(payment) {
      return executePaymentOperation(
        actionConfig,
        "settle",
        payment,
        () => sendPaymentAction(
          actionConfig,
          payment,
          "settle",
          broadcastInQueue,
        ),
      );
    },
    refundPayment(payment) {
      return executePaymentOperation(
        actionConfig,
        "refund",
        payment,
        () => sendPaymentAction(
          actionConfig,
          payment,
          "refund",
          broadcastInQueue,
        ),
      );
    },
    consumePayment(payment) {
      return executePaymentOperation(
        actionConfig,
        "consume",
        payment,
        () => sendPaymentAction(
          actionConfig,
          payment,
          "consume",
          broadcastInQueue,
        ),
      );
    },
    submitEvidence(payment, evidenceUri) {
      return executePaymentOperation(
        actionConfig,
        "submit-evidence",
        payment,
        () => sendEvidenceAction(
          actionConfig,
          payment,
          evidenceUri,
          broadcastInQueue,
        ),
      );
    },
    appealPayment(payment) {
      return executePaymentOperation(
        actionConfig,
        "appeal",
        payment,
        () => sendAppealAction(
          actionConfig,
          payment,
          broadcastInQueue,
        ),
      );
    },
  };
}

async function executePaymentOperation<Result>(
  config: ResolvedPaymentConfig,
  operation: D402PaymentOperation,
  paymentAddress: PaymentAddress,
  execute: () => Promise<Result>,
): Promise<Result> {
  try {
    return await execute();
  } catch (cause) {
    const error = normalizePaymentExecutionError({
      operation,
      paymentAddress,
      cause,
    });
    emitLog(config.logger, {
      level: "error",
      event: "payment.execution.failed",
      message: "Payment execution failed.",
      context: {
        operation: error.operation,
        paymentAddress: error.paymentAddress,
        errorName: error.name,
        errorCode: error.code,
        ...(error.dpaymentsError !== undefined
          ? { dpaymentsError: error.dpaymentsError }
          : {}),
        ...(error.transactionError !== undefined
          ? { transactionError: error.transactionError }
          : {}),
      },
    });
    throw error;
  }
}

async function sendPaymentAction(
  config: ResolvedPaymentConfig,
  paymentAddress: PaymentAddress,
  action: "settle" | "refund" | "consume",
  broadcastInQueue: BroadcastQueue,
): Promise<D402PaymentActionResult> {
  const walletAddress = await config.signer.getAddress();
  emitLog(config.logger, {
    level: "debug",
    event: "payment.action.started",
    message: "Payment action started.",
    context: {
      action,
      paymentAddress,
      walletAddress,
    },
  });
  const dpayments = await createPinnedDPayments({
    provider: config.provider,
    walletAddress,
  });
  const dPayment = dpayments.dPayment(paymentAddress);
  const tx = action === "settle"
    ? dPayment.settle(walletAddress)
    : action === "refund"
      ? dPayment.voluntaryRefund(walletAddress)
      : dPayment.consume(walletAddress);
  const response = await broadcastInQueue(() =>
    sendPreparedTransaction({
      provider: config.provider,
      signer: config.signer,
      tx,
      onEvent: config.onEvent,
      onNonceRetry: createNonceRetryLogger(
        config.logger,
        action,
        paymentAddress,
      ),
    }),
  );
  const receipt = await waitForSuccessfulReceipt(
    response,
    config.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    ACTION_TRANSACTION_FAILURE_MESSAGE,
  );
  emitLog(config.logger, {
    level: "info",
    event: "payment.action.confirmed",
    message: "Payment action confirmed.",
    context: {
      action,
      paymentAddress,
      walletAddress,
      txHash: receipt.hash,
    },
  });

  return { txHash: receipt.hash as Hex32 };
}

async function sendEvidenceAction(
  config: ResolvedPaymentConfig,
  paymentAddress: PaymentAddress,
  evidenceUri: string,
  broadcastInQueue: BroadcastQueue,
): Promise<D402PaymentActionResult> {
  const walletAddress = await config.signer.getAddress();
  emitLog(config.logger, {
    level: "debug",
    event: "payment.evidence.started",
    message: "Payment evidence submission started.",
    context: {
      paymentAddress,
      walletAddress,
    },
  });
  const dpayments = await createPinnedDPayments({
    provider: config.provider,
    walletAddress,
  });
  const dPayment = dpayments.dPayment(paymentAddress);
  const tx = dPayment.submitEvidence(evidenceUri, walletAddress);
  const response = await broadcastInQueue(() =>
    sendPreparedTransaction({
      provider: config.provider,
      signer: config.signer,
      tx,
      onEvent: config.onEvent,
      onNonceRetry: createNonceRetryLogger(
        config.logger,
        "submit-evidence",
        paymentAddress,
      ),
    }),
  );
  const receipt = await waitForSuccessfulReceipt(
    response,
    config.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    ACTION_TRANSACTION_FAILURE_MESSAGE,
  );
  emitLog(config.logger, {
    level: "info",
    event: "payment.evidence.confirmed",
    message: "Payment evidence submission confirmed.",
    context: {
      paymentAddress,
      walletAddress,
      txHash: receipt.hash,
    },
  });

  return { txHash: receipt.hash as Hex32 };
}

async function sendAppealAction(
  config: ResolvedPaymentConfig,
  paymentAddress: PaymentAddress,
  broadcastInQueue: BroadcastQueue,
): Promise<PaymentAppealResult> {
  const walletAddress = await config.signer.getAddress();
  emitLog(config.logger, {
    level: "debug",
    event: "payment.appeal.started",
    message: "Payment appeal started.",
    context: {
      paymentAddress,
      walletAddress,
    },
  });
  const dpayments = await createPinnedDPayments({
    provider: config.provider,
    walletAddress,
  });
  const dPayment = dpayments.dPayment(paymentAddress);
  const prepared = await dPayment.prepareAppeal(
    "0x",
    walletAddress,
  );
  const response = await broadcastInQueue(() =>
    sendPreparedTransaction({
      provider: config.provider,
      signer: config.signer,
      tx: prepared.tx,
      onEvent: config.onEvent,
      onNonceRetry: createNonceRetryLogger(
        config.logger,
        "appeal",
        paymentAddress,
      ),
    }),
  );
  const receipt = await waitForSuccessfulReceipt(
    response,
    config.confirmations ?? D402_DEFAULT_CONFIRMATIONS,
    ACTION_TRANSACTION_FAILURE_MESSAGE,
  );
  emitLog(config.logger, {
    level: "info",
    event: "payment.appeal.confirmed",
    message: "Payment appeal confirmed.",
    context: {
      paymentAddress,
      walletAddress,
      txHash: receipt.hash,
      appealFeeWei: prepared.appealFeeWei.toString(),
      appealPeriodStart: prepared.appealPeriod.start.toString(),
      appealPeriodEnd: prepared.appealPeriod.end.toString(),
    },
  });

  return {
    txHash: receipt.hash as Hex32,
    appealFeeWei: prepared.appealFeeWei,
    appealPeriod: prepared.appealPeriod,
  };
}

function createNonceRetryLogger(
  logger: D402Logger,
  operation: D402PaymentOperation,
  paymentAddress: PaymentAddress,
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
