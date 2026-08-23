import type {
  D402PaymentActionResult,
  PaymentAddress,
} from "../core/index.js";
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
  broadcastPreparedTransaction,
  waitForSuccessfulReceipt,
} from "../runtime/transaction.js";
import type {
  BroadcastQueue,
} from "../runtime/transaction.js";
import type {
  PaymentAppealResult,
  PaymentActions,
  PaymentConfig,
} from "./types.js";
const ACTION_TRANSACTION_FAILURE_MESSAGE =
  "DPayments action transaction failed after broadcast or was not mined successfully.";

export function paymentActions(config: PaymentConfig): PaymentActions {
  if (config.adapter.txSender === undefined) {
    throw new Error(
      "adapter.txSender is required for payment actions so the adapter can broadcast, retry, and confirm settlement, refund, consumption, evidence, or appeal transactions.",
    );
  }
  const broadcastInQueue = createBroadcastQueue();

  return {
    settlePayment(payment) {
      return executePaymentOperation(
        config,
        "settle",
        payment,
        () => sendPaymentAction(
          config,
          payment,
          "settle",
          broadcastInQueue,
        ),
      );
    },
    refundPayment(payment) {
      return executePaymentOperation(
        config,
        "refund",
        payment,
        () => sendPaymentAction(
          config,
          payment,
          "refund",
          broadcastInQueue,
        ),
      );
    },
    consumePayment(payment) {
      return executePaymentOperation(
        config,
        "consume",
        payment,
        () => sendPaymentAction(
          config,
          payment,
          "consume",
          broadcastInQueue,
        ),
      );
    },
    submitEvidence(payment, evidenceUri) {
      return executePaymentOperation(
        config,
        "submit-evidence",
        payment,
        () => sendEvidenceAction(
          config,
          payment,
          evidenceUri,
          broadcastInQueue,
        ),
      );
    },
    appealPayment(payment) {
      return executePaymentOperation(
        config,
        "appeal",
        payment,
        () => sendAppealAction(
          config,
          payment,
          broadcastInQueue,
        ),
      );
    },
  };
}

async function executePaymentOperation<Result>(
  config: PaymentConfig,
  operation: D402PaymentOperation,
  paymentAddress: PaymentAddress,
  execute: () => Promise<Result>,
): Promise<Result> {
  try {
    return await execute();
  } catch (cause) {
    const logger = config.payment.logger ?? NoopLogger;
    const error = normalizePaymentExecutionError({
      operation,
      paymentAddress,
      codec: config.adapter.codec,
      errorDecoder: config.adapter.errorDecoder,
      logger,
      cause,
    });
    emitLog(logger, {
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
  config: PaymentConfig,
  paymentAddress: PaymentAddress,
  action: "settle" | "refund" | "consume",
  broadcastInQueue: BroadcastQueue,
): Promise<D402PaymentActionResult> {
  const txSender = config.adapter.txSender!;
  const logger = config.payment.logger ?? NoopLogger;
  const walletAddress = await txSender.getAddress();
  emitLog(logger, {
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
    rpcClient: config.adapter.rpcClient,
    codec: config.adapter.codec,
    walletAddress,
  });
  const dPayment = dpayments.dPayment(paymentAddress);
  const tx = action === "settle"
    ? dPayment.settle(walletAddress)
    : action === "refund"
      ? dPayment.voluntaryRefund(walletAddress)
      : dPayment.consume(walletAddress);
  const response = await broadcastInQueue(() =>
    broadcastPreparedTransaction({
      txSender,
      tx,
      onEvent: config.payment.onEvent,
    }),
  );
  const receipt = await waitForSuccessfulReceipt(
    response,
    ACTION_TRANSACTION_FAILURE_MESSAGE,
  );
  emitLog(logger, {
    level: "info",
    event: "payment.action.confirmed",
    message: "Payment action confirmed.",
    context: {
      action,
      paymentAddress,
      walletAddress,
      txHash: receipt.txHash,
    },
  });

  return { txHash: receipt.txHash };
}

async function sendEvidenceAction(
  config: PaymentConfig,
  paymentAddress: PaymentAddress,
  evidenceUri: string,
  broadcastInQueue: BroadcastQueue,
): Promise<D402PaymentActionResult> {
  const txSender = config.adapter.txSender!;
  const logger = config.payment.logger ?? NoopLogger;
  const walletAddress = await txSender.getAddress();
  emitLog(logger, {
    level: "debug",
    event: "payment.evidence.started",
    message: "Payment evidence submission started.",
    context: {
      paymentAddress,
      walletAddress,
    },
  });
  const dpayments = await createPinnedDPayments({
    rpcClient: config.adapter.rpcClient,
    codec: config.adapter.codec,
    walletAddress,
  });
  const dPayment = dpayments.dPayment(paymentAddress);
  const tx = dPayment.submitEvidence(evidenceUri, walletAddress);
  const response = await broadcastInQueue(() =>
    broadcastPreparedTransaction({
      txSender,
      tx,
      onEvent: config.payment.onEvent,
    }),
  );
  const receipt = await waitForSuccessfulReceipt(
    response,
    ACTION_TRANSACTION_FAILURE_MESSAGE,
  );
  emitLog(logger, {
    level: "info",
    event: "payment.evidence.confirmed",
    message: "Payment evidence submission confirmed.",
    context: {
      paymentAddress,
      walletAddress,
      txHash: receipt.txHash,
    },
  });

  return { txHash: receipt.txHash };
}

async function sendAppealAction(
  config: PaymentConfig,
  paymentAddress: PaymentAddress,
  broadcastInQueue: BroadcastQueue,
): Promise<PaymentAppealResult> {
  const txSender = config.adapter.txSender!;
  const logger = config.payment.logger ?? NoopLogger;
  const walletAddress = await txSender.getAddress();
  emitLog(logger, {
    level: "debug",
    event: "payment.appeal.started",
    message: "Payment appeal started.",
    context: {
      paymentAddress,
      walletAddress,
    },
  });
  const dpayments = await createPinnedDPayments({
    rpcClient: config.adapter.rpcClient,
    codec: config.adapter.codec,
    walletAddress,
  });
  const dPayment = dpayments.dPayment(paymentAddress);
  const prepared = await dPayment.prepareAppeal(
    "0x",
    walletAddress,
  );
  const response = await broadcastInQueue(() =>
    broadcastPreparedTransaction({
      txSender,
      tx: prepared.tx,
      onEvent: config.payment.onEvent,
    }),
  );
  const receipt = await waitForSuccessfulReceipt(
    response,
    ACTION_TRANSACTION_FAILURE_MESSAGE,
  );
  emitLog(logger, {
    level: "info",
    event: "payment.appeal.confirmed",
    message: "Payment appeal confirmed.",
    context: {
      paymentAddress,
      walletAddress,
      txHash: receipt.txHash,
      appealFeeWei: prepared.appealFeeWei.toString(),
      appealPeriodStart: prepared.appealPeriod.start.toString(),
      appealPeriodEnd: prepared.appealPeriod.end.toString(),
    },
  });

  return {
    txHash: receipt.txHash,
    appealFeeWei: prepared.appealFeeWei,
    appealPeriod: prepared.appealPeriod,
  };
}
