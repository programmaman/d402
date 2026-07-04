import { DPayments } from "@rakelabs/dpayments-sdk";
import type { PreparedTx } from "@rakelabs/dpayments-sdk";
import type { Signer, TransactionReceipt, TransactionRequest } from "ethers";

import type { Hex32, PaymentAddress } from "../core/index.js";
import type {
  PaymentActionResult,
  PaymentAppealResult,
  PaymentActions,
  PaymentConfig,
} from "./types.js";

export function paymentActions(config: PaymentConfig): PaymentActions {
  if (config.signer === undefined) {
    throw new Error("paymentConfig.signer is required for payment actions.");
  }
  const actionConfig = {
    ...config,
    signer: config.signer,
  };

  return {
    settlePayment(payment) {
      return sendPaymentAction(actionConfig, payment, "settle");
    },
    refundPayment(payment) {
      return sendPaymentAction(actionConfig, payment, "refund");
    },
    submitEvidence(payment, evidenceUri) {
      return sendEvidenceAction(actionConfig, payment, evidenceUri);
    },
    appealPayment(payment) {
      return sendAppealAction(actionConfig, payment);
    },
  };
}

async function sendPaymentAction(
  config: PaymentConfig & { signer: Signer },
  paymentAddress: PaymentAddress,
  action: "settle" | "refund",
): Promise<PaymentActionResult> {
  const walletAddress = await config.signer.getAddress();
  console.log("[server] payment action started", {
    action,
    paymentAddress,
    walletAddress,
  });
  const dpayments = await DPayments.fromProvider(config.provider, walletAddress);
  const dPayment = dpayments.dPayment(paymentAddress);
  const tx = action === "settle"
    ? dPayment.settle(walletAddress)
    : dPayment.voluntaryRefund(walletAddress);
  const receipt = await sendPreparedTx(
    config.signer,
    tx,
    config.actionConfirmations ?? 0,
  );
  console.log("[server] payment action confirmed", {
    action,
    paymentAddress,
    walletAddress,
    txHash: receipt.hash,
  });

  return { txHash: receipt.hash as Hex32 };
}

async function sendEvidenceAction(
  config: PaymentConfig & { signer: Signer },
  paymentAddress: PaymentAddress,
  evidenceUri: string,
): Promise<PaymentActionResult> {
  const walletAddress = await config.signer.getAddress();
  console.log("[server] evidence submission started", {
    paymentAddress,
    walletAddress,
    evidenceUri,
  });
  const dpayments = await DPayments.fromProvider(config.provider, walletAddress);
  const dPayment = dpayments.dPayment(paymentAddress);
  const tx = dPayment.submitEvidence(evidenceUri, walletAddress);
  const receipt = await sendPreparedTx(
    config.signer,
    tx,
    config.actionConfirmations ?? 0,
  );
  console.log("[server] evidence submission confirmed", {
    paymentAddress,
    walletAddress,
    txHash: receipt.hash,
  });

  return { txHash: receipt.hash as Hex32 };
}

async function sendAppealAction(
  config: PaymentConfig & { signer: Signer },
  paymentAddress: PaymentAddress,
): Promise<PaymentAppealResult> {
  const walletAddress = await config.signer.getAddress();
  console.log("[server] appeal started", {
    paymentAddress,
    walletAddress,
  });
  const dpayments = await DPayments.fromProvider(config.provider, walletAddress);
  const dPayment = dpayments.dPayment(paymentAddress);
  const prepared = await dPayment.prepareAppeal(
    "0x",
    walletAddress,
  );
  const receipt = await sendPreparedTx(
    config.signer,
    prepared.tx,
    config.actionConfirmations ?? 0,
  );
  console.log("[server] appeal confirmed", {
    paymentAddress,
    walletAddress,
    txHash: receipt.hash,
    appealFeeWei: prepared.appealFeeWei,
    appealPeriod: prepared.appealPeriod,
  });

  return {
    txHash: receipt.hash as Hex32,
    appealFeeWei: prepared.appealFeeWei,
    appealPeriod: prepared.appealPeriod,
  };
}

async function sendPreparedTx(
  signer: Signer,
  tx: PreparedTx,
  confirmations: number,
): Promise<TransactionReceipt> {
  const response = await signer.sendTransaction(toTransactionRequest(tx));
  const receipt = await response.wait(confirmations);

  if (receipt === null || receipt.status !== 1) {
    throw new Error("DPayments action transaction failed.");
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
