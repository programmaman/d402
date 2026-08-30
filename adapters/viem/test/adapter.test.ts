import {describe, expect, it, vi} from "vitest";
import type {PreparedTx} from "@rakelabs/dpayments-sdk";
import {
  type Account,
  InvalidInputRpcError,
  NonceTooHighError,
  NonceTooLowError,
  type PublicClient,
  TransactionReceiptNotFoundError,
  type WalletClient,
} from "viem";

import {createViemAdapter, createViemSigner, createViemTxBroadcaster,} from "../src";
import {createViemRpcClient} from "../src/rpc-client.js";

const decodeViemError = vi.hoisted(() => vi.fn());
vi.mock("@rakelabs/viem-adapter", async (importOriginal) => ({
  ...(await importOriginal()),
  decodeViemError,
}));

const publicClient = {
  call: vi.fn().mockResolvedValue({ data: "0x" }),
  estimateGas: vi.fn().mockResolvedValue(21_000n),
  sendRawTransaction: vi.fn().mockResolvedValue(
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  ),
  getLogs: vi.fn().mockResolvedValue([]),
  getChainId: vi.fn().mockResolvedValue(1),
  getBlock: vi.fn().mockResolvedValue({
    number: 42n,
    timestamp: 1_700_000_000n,
    hash: "0x0000000000000000000000000000000000000000000000000000000000000009",
  }),
  getTransactionReceipt: vi.fn().mockResolvedValue({
    transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
    status: "success",
    blockNumber: 43n,
    blockHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
    logs: [],
  }),
  waitForTransactionReceipt: vi.fn().mockResolvedValue({
    transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
    status: "success",
    blockNumber: 43n,
    blockHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
    logs: [],
  }),
} as unknown as PublicClient;

const preparedTx: PreparedTx = {
  to: "0x0000000000000000000000000000000000000001",
  data: "0x",
  value: "0",
  chainId: 1,
};

describe("@d402/viem adapter", () => {
  it("creates a read-only adapter from a public client", () => {
    const adapter = createViemAdapter({ publicClient });

    expect(adapter.rpcClient).toBeDefined();
    expect(adapter.codec).toBeDefined();
    expect(adapter.errorDecoder).toBeTypeOf("function");
    expect(adapter.signer).toBeUndefined();
    expect(adapter.broadcaster).toBeDefined();
  });

  it("delegates provider error decoding to the Viem adapter", () => {
    const cause = { cause: { data: "0xdeadbeef" } };
    const decoded = { name: "InvalidState" };
    decodeViemError.mockReturnValueOnce(decoded);
    const adapter = createViemAdapter({ publicClient });

    expect(adapter.errorDecoder(cause)).toEqual(decoded);
    expect(decodeViemError).toHaveBeenCalledWith(cause, adapter.codec);
  });

  it("creates a write adapter from a wallet client", () => {
    const walletClient = {
      account: {
        address: "0x0000000000000000000000000000000000000002",
      },
      chain: undefined,
      prepareTransactionRequest: vi.fn().mockResolvedValue({}),
      signTransaction: vi.fn().mockResolvedValue("0xsigned"),
    } as unknown as WalletClient;

    const adapter = createViemAdapter({
      publicClient,
      walletClient,
    });

    expect(adapter.signer).toBeDefined();
    expect(adapter.broadcaster).toBeDefined();
  });

  it("requires an account for transaction submission", async () => {
    const walletClient = {
      account: undefined,
      chain: undefined,
    } as unknown as WalletClient;
    const signer = createViemSigner({
      publicClient,
      walletClient,
    });

    await expect(signer.getAddress()).rejects.toThrow(
      "Viem wallet client does not have an account",
    );
  });

  it("signs a prepared transaction through the wallet client", async () => {
    const prepareTransactionRequest = vi.fn().mockResolvedValue({
      to: preparedTx.to,
      data: preparedTx.data,
      value: 0n,
      chainId: preparedTx.chainId,
    });
    const signTransaction = vi.fn().mockResolvedValue("0xsigned");
    const walletClient = {
      account: {
        address: "0x0000000000000000000000000000000000000002",
      },
      chain: undefined,
      prepareTransactionRequest,
      signTransaction,
    } as unknown as WalletClient;
    const signer = createViemSigner({ publicClient, walletClient });

    await expect(signer.signTx(preparedTx)).resolves.toBe("0xsigned");
    expect(prepareTransactionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        to: preparedTx.to,
        data: preparedTx.data,
        value: 0n,
        chainId: preparedTx.chainId,
      }),
    );
    expect(signTransaction).toHaveBeenCalled();
  });

  it("normalizes a successful Viem receipt", async () => {
    const broadcaster = createViemTxBroadcaster({
      publicClient,
    });

    const result = await broadcaster.broadcastTx("0xsigned");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected the transaction broadcast to succeed.");
    }

    await expect(result.submission.waitForReceipt()).resolves.toMatchObject({
      status: "success",
      blockNumber: 43,
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
    });
  });

  it("returns a retryable result for a nonce conflict without retrying", async () => {
    const cause = new NonceTooLowError({ nonce: 1 });
    const sendRawTransaction = vi.fn().mockRejectedValue(cause);
    const broadcaster = createViemTxBroadcaster({
      publicClient: {
        ...publicClient,
        sendRawTransaction,
      } as unknown as PublicClient,
    });

    await expect(broadcaster.broadcastTx("0xsigned")).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: "nonce-conflict",
      cause,
    });
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it("normalizes raw RPC nonce conflicts through Viem", async () => {
    const cause = new InvalidInputRpcError(
      new Error("Nonce too low. Expected nonce to be 8 but got 7."),
    );
    const sendRawTransaction = vi.fn().mockRejectedValue(cause);
    const broadcaster = createViemTxBroadcaster({
      publicClient: {
        ...publicClient,
        sendRawTransaction,
      } as unknown as PublicClient,
    });

    await expect(broadcaster.broadcastTx("0xsigned")).resolves.toMatchObject({
      ok: false,
      retryable: true,
      reason: "nonce-conflict",
      cause,
    });
  });

  it("classifies nonce-too-high errors as retryable without retrying", async () => {
    const cause = new NonceTooHighError({ nonce: 2 });
    const sendRawTransaction = vi.fn().mockRejectedValue(cause);
    const broadcaster = createViemTxBroadcaster({
      publicClient: {
        ...publicClient,
        sendRawTransaction,
      } as unknown as PublicClient,
    });

    await expect(broadcaster.broadcastTx("0xsigned")).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: "nonce-conflict",
      cause,
    });
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns a fatal result for other broadcast errors without retrying", async () => {
    const cause = new Error("insufficient funds");
    const sendRawTransaction = vi.fn().mockRejectedValue(cause);
    const broadcaster = createViemTxBroadcaster({
      publicClient: {
        ...publicClient,
        sendRawTransaction,
      } as unknown as PublicClient,
    });

    await expect(broadcaster.broadcastTx("0xsigned")).resolves.toEqual({
      ok: false,
      retryable: false,
      reason: "broadcast-failed",
      cause,
    });
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it("looks up a block with its hash through the d402 RPC client", async () => {
    const rpcClient = createViemRpcClient(publicClient);

    await expect(rpcClient.getBlock("latest")).resolves.toEqual({
      number: 42,
      timestamp: 1_700_000_000,
      hash: "0x0000000000000000000000000000000000000000000000000000000000000009",
    });
    expect(publicClient.getBlock).toHaveBeenCalled();
  });

  it("passes a local account through to Viem signing", async () => {
    const account = {
      address: "0x0000000000000000000000000000000000000002",
      type: "local",
    } as Account;
    const prepareTransactionRequest = vi.fn().mockResolvedValue({});
    const signTransaction = vi.fn().mockResolvedValue("0xsigned");
    const walletClient = {
      account,
      chain: undefined,
      prepareTransactionRequest,
      signTransaction,
    } as unknown as WalletClient;
    const signer = createViemSigner({
      publicClient,
      walletClient,
    });

    await signer.signTx(preparedTx);

    expect(prepareTransactionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ account }),
    );
  });

  it("reads a fresh block number after the chain advances", async () => {
    const getBlock = vi.fn()
      .mockResolvedValueOnce({
        number: 191n,
        timestamp: 1_700_000_000n,
        hash: "0x0000000000000000000000000000000000000000000000000000000000000011",
      })
      .mockResolvedValueOnce({
        number: 192n,
        timestamp: 1_700_000_001n,
        hash: "0x0000000000000000000000000000000000000000000000000000000000000012",
      });
    const rpcClient = createViemRpcClient({
      ...publicClient,
      getBlock,
    });

    await expect(rpcClient.getBlock("latest")).resolves.toMatchObject({
      number: 191,
    });
    await expect(rpcClient.getBlock("latest")).resolves.toMatchObject({
      number: 192,
    });
    expect(getBlock).toHaveBeenCalledTimes(2);
  });

  it("normalizes a receipt lookup and preserves reverted status", async () => {
    const getTransactionReceipt = vi
      .fn()
      .mockResolvedValueOnce({
        transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000003",
        status: "reverted",
        blockNumber: 44n,
        blockHash: "0x0000000000000000000000000000000000000000000000000000000000000004",
        logs: [],
      });
    const rpcClient = createViemRpcClient({
      ...publicClient,
      getTransactionReceipt,
    });

    await expect(rpcClient.getTransactionReceipt(
      "0x0000000000000000000000000000000000000000000000000000000000000003",
    )).resolves.toEqual({
      txHash: "0x0000000000000000000000000000000000000000000000000000000000000003",
      status: "reverted",
      blockNumber: 44,
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000000004",
      logs: [],
    });
  });

  it("maps only receipt-not-found to null", async () => {
    const hash = "0x0000000000000000000000000000000000000000000000000000000000000005" as const;
    const rpcClient = createViemRpcClient({
      ...publicClient,
      getTransactionReceipt: vi.fn().mockRejectedValue(
        new TransactionReceiptNotFoundError({ hash }),
      ),
    });

    await expect(rpcClient.getTransactionReceipt(hash)).resolves.toBeNull();
  });
});