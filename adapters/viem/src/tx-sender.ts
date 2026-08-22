import type { PreparedTx } from "@rakelabs/dpayments-sdk";
import type { PublicClient, WalletClient } from "viem";
import {
  BaseError,
  isAddress,
  NonceTooHighError,
  NonceTooLowError,
} from "viem";
import type { D402TxSender } from "d402/core";

import { assertHex32 } from "./hash.js";
import { normalizeViemReceipt } from "./receipt.js";

const NONCE_RETRY_LIMIT = 3;
const NONCE_RETRY_BASE_DELAY_MS = 300;

type Release = () => void;

export interface ViemTxSenderOptions {
  publicClient: PublicClient;
  walletClient: WalletClient;
  confirmations?: number;
}

export function createViemTxSender(
  options: ViemTxSenderOptions,
): D402TxSender {
  let sendQueue = Promise.resolve();

  return {
    async getAddress() {
      return getAccountAddress(options.walletClient.account);
    },

    async broadcastTransaction(transaction: PreparedTx) {
      const previous = sendQueue;
      let release!: Release;
      sendQueue = new Promise<void>((resolve) => {
        release = resolve;
      });

      await previous;

      let hash: `0x${string}`;
      try {
        hash = await sendWithNonceRetry(options, transaction);
      } finally {
        release();
      }

      return {
        txHash: assertHex32(hash, "transaction hash"),
        async waitForReceipt() {
          const receipt = await options.publicClient.waitForTransactionReceipt({
            hash,
            confirmations: options.confirmations ?? 1,
          });

          return normalizeViemReceipt(receipt, hash);
        },
      };
    },
  };
}

async function sendWithNonceRetry(
  options: ViemTxSenderOptions,
  transaction: PreparedTx,
): Promise<`0x${string}`> {
  for (let retry = 0; ; retry++) {
    try {
      const account = getAccount(options.walletClient);
      const request = toViemTransaction(transaction, account);
      const gas = await options.publicClient.estimateGas(request);

      return await options.walletClient.sendTransaction({
        ...request,
        gas,
        chain: options.walletClient.chain,
      });
    } catch (error) {
      if (!isNonceConflict(error) || retry >= NONCE_RETRY_LIMIT) {
        throw error;
      }

      const delayMs =
        NONCE_RETRY_BASE_DELAY_MS * 2 ** retry +
        Math.floor(Math.random() * NONCE_RETRY_BASE_DELAY_MS);
      await delay(delayMs);
    }
  }
}

function getAccount(
  walletClient: WalletClient,
): NonNullable<WalletClient["account"]> {
  const account = walletClient.account;
  getAccountAddress(account);

  return account as NonNullable<WalletClient["account"]>;
}

function getAccountAddress(
  account: WalletClient["account"],
): `0x${string}` {
  const address = typeof account === "string"
    ? account
    : account?.address;

  if (address === undefined || !isAddress(address)) {
    throw new Error(
      "The Viem wallet client must have an account configured for d402.",
    );
  }

  return address as `0x${string}`;
}

function toViemTransaction(
  transaction: PreparedTx,
  account: NonNullable<WalletClient["account"]>,
) {
  return {
    account,
    to: transaction.to as `0x${string}`,
    data: transaction.data as `0x${string}`,
    value: BigInt(transaction.value),
  };
}

function isNonceConflict(error: unknown): boolean {
  if (!(error instanceof BaseError)) {
    return false;
  }

  const nonceError = error.walk((cause) =>
    cause instanceof NonceTooLowError ||
    cause instanceof NonceTooHighError
  );

  return (
    nonceError instanceof NonceTooLowError ||
    nonceError instanceof NonceTooHighError
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
