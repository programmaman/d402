import "dotenv/config";

import express from "express";
import { JsonRpcProvider } from "ethers";

import { PaymentAuthorizer } from "d402/server";

const port = Number(process.env.PORT ?? "3000");
const chainId = Number(requireEnv("CHAIN_ID"));
const payeeAddress = requireEnv("PAYEE_ADDRESS") as `0x${string}`;
const provider = new JsonRpcProvider(requireEnv("RPC_URL"));

const reportPayment = new PaymentAuthorizer({
  paymentConfig: {
    provider,
    confirmations: 1,
    settlementWindow: 3600,
  },
  terms: (request) => ({
    chainId,
    payeeAddress,
    tokenAddress: null,
    netAmount: "1000000000000000",
    agreement: {
      id: `express-report:${new URL(request.url).pathname}:v1`,
    },
    expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
  }),
});

const app = express();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/reports/:id", async (req, res, next) => {
  try {
    const authorization =
      await reportPayment.authorize(toWebRequest(req));

    if (authorization.response !== undefined) {
      await sendWebResponse(res, authorization.response);
      return;
    }

    res.json({
      report: {
        id: req.params.id,
        title: `Report ${req.params.id}`,
      },
      paymentId: authorization.context.payment.paymentId,
    });
  } catch (error) {
    next(error);
  }
});

app.listen(port, () => {
  console.log(`d402 Express example listening on http://localhost:${port}`);
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
