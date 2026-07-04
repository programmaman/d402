import { JsonRpcProvider } from "ethers";

import { payable } from "@d402/sdk/server";

const provider = new JsonRpcProvider(requireEnv("RPC_URL"));
const chainId = Number(requireEnv("CHAIN_ID"));
const payeeAddress = requireEnv("PAYEE_ADDRESS") as `0x${string}`;

const protectReport = payable({
  paymentConfig: {
    provider,
    resource: (request) => request.url,
    minConfirmations: 1,
  },
  terms: (request) => {
    const url = new URL(request.url);

    return {
      chainId,
      payeeAddress,
      tokenAddress: null,
      netAmount: "1000000000000000",
      settlementTimeUnixSec: `${Math.floor(Date.now() / 1000) + 3600}` as `${bigint}`,
      agreement: {
        id: `next-report:${url.pathname}:v1`,
        hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
    };
  },
  handler: async (request, context) => {
    const url = new URL(request.url);
    const id = url.pathname.split("/").at(-1);

    return Response.json({
      ok: true,
      report: { id, title: `Report ${id}` },
      paymentId: context.paymentRequest.paymentId,
    });
  },
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
