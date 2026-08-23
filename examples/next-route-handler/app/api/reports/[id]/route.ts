import { JsonRpcProvider } from "ethers";
import { createEthersAdapter } from "@d402/ethers";

import { payable } from "d402/server";

const provider = new JsonRpcProvider(requireEnv("RPC_URL"));
const adapter = createEthersAdapter({ provider });
const chainId = Number(requireEnv("CHAIN_ID"));
const payeeAddress = requireEnv("PAYEE_ADDRESS") as `0x${string}`;

const protectReport = payable({
  adapter,
  payment: {
    confirmations: 1,
    settlementWindow: 3600,
  },
  terms: (request) => {
    return {
      chainId,
      payeeAddress,
      tokenAddress: null,
      netAmount: "1000000000000000",
      agreement: {
        id: `next-report:${new URL(request.url).pathname}:v1`,
      },
      expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
    };
  },
  handler: (request, context) =>
    Response.json({
      ok: true,
      report: {
        id: new URL(request.url).pathname.split("/").at(-1),
      },
      paymentId: context.payment.paymentId,
    }),
});

export async function GET(request: Request): Promise<Response> {
  return protectReport(request);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }

  return value;
}
