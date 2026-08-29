import type { PreparedTx } from "@rakelabs/dpayments-sdk";
import type { D402Signer } from "d402/core";
import type { PublicClient, WalletClient } from "viem";

export interface ViemSignerOptions {
  publicClient: PublicClient;
  walletClient: WalletClient;
}

export function createViemSigner(
  options: ViemSignerOptions,
): D402Signer {
  return {
    async getAddress() {
      const account = options.walletClient.account;

      if (account === undefined) {
        throw new Error(
          "Viem wallet client does not have an account.",
        );
      }

      if (typeof account === "string") {
        return account;
      }

      return account.address;
    },

    async signTx(transaction: PreparedTx) {
      const account = getAccount(options.walletClient);

      const request = toViemTransaction(
        transaction,
        account,
      );

      const preparedRequest =
        await options.walletClient.prepareTransactionRequest({
          ...request,
          account,
          chain: options.walletClient.chain,
        });

      return options.walletClient.signTransaction(
        preparedRequest,
      );
    },
  };
}

function getAccount(
  walletClient: WalletClient,
): NonNullable<WalletClient["account"]> {
  const account = walletClient.account;

  if (account === undefined) {
    throw new Error(
      "Viem wallet client does not have an account.",
    );
  }

  return account;
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
    chainId: transaction.chainId,
  };
}
