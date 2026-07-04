import "dotenv/config";

import express from "express";
import { JsonRpcProvider } from "ethers";

import { payable } from "d402/server";
import { consumeOnce } from "./store.js";

const port = Number(process.env.PORT ?? "3000");
const chainId = Number(requireEnv("CHAIN_ID"));
const payeeAddress = requireEnv("PAYEE_ADDRESS") as `0x${string}`;
const provider = new JsonRpcProvider(requireEnv("RPC_URL"));

const protectedDownload = payable({
  paymentConfig: {
    provider,
    resource: (request) => request.url,
    minConfirmations: 1,
  },
  terms: (request) => ({
    chainId,
    payeeAddress,
    tokenAddress: null,
    netAmount: "1000000000000000",
    settlementTimeUnixSec: `${Math.floor(Date.now() / 1000) + 3600}` as `${bigint}`,
    agreement: {
      id: `one-shot-download:${new URL(request.url).pathname}:v1`,
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
  }),
  handler: async (_request, context) => {
    if (context.payment === undefined) {
      return Response.json({ error: "payment context missing" }, { status: 500 });
    }

    const consumptionKey = [
      context.paymentRequest.chainId,
      context.payment.paymentId,
      context.payment.paymentAddress,
      context.payment.txHash,
    ].join(":");

    if (!consumeOnce(consumptionKey)) {
      return Response.json({ error: "payment-already-consumed" }, { status: 409 });
    }

    return Response.json({
      ok: true,
      downloadUrl: "https://storage.example.test/downloads/report-123.pdf",
      paymentId: context.payment.paymentId,
    });
  },
});

const app = express();

app.get("/downloads/:id", async (req, res, next) => {
  try {
    const response = await protectedDownload(toWebRequest(req));
    await sendWebResponse(res, response);
  } catch (error) {
    next(error);
  }
});

app.listen(port, () => {
  console.log(`d402 one-shot example listening on http://localhost:${port}`);
});

function toWebRequest(req: express.Request): Request {
  const origin = `${req.protocol}://${req.get("host")}`;

  return new Request(`${origin}${req.originalUrl}`, {
    method: req.method,
    headers: toWebHeaders(req),
  });
}

function toWebHeaders(req: express.Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }

  return headers;
}

async function sendWebResponse(
  res: express.Response,
  response: Response,
): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(Buffer.from(await response.arrayBuffer()));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }

  return value;
}
