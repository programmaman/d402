# HTTP and Framework Integration

d402 uses standard Fetch API `Request` and `Response` objects. This keeps the
payment protocol independent of a particular server framework, but production
applications still need CORS, authentication, tracing, cookies, and framework
response handling.

The safest rule is simple: let d402 own protocol bodies and decorate the HTTP
response around it.

## CORS

Wrap the complete payable and refund handlers when every response needs CORS:

```ts
type Handler = (request: Request) => Promise<Response>;

function withCors(handler: Handler): Handler {
  return async (request) => {
    const origin = request.headers.get("Origin");
    const allowed = origin === "https://app.example.com";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: allowed
          ? {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers":
                "Authorization, Content-Type, D402-Payment-Proof",
              "Access-Control-Max-Age": "86400",
              "Vary": "Origin",
            }
          : {},
      });
    }

    const response = await handler(request);
    if (!allowed) return response;

    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.append("Vary", "Origin");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
```

Apply the wrapper to both routes:

```ts
const resourceRoute = withCors(payable(routeConfig));
const refundRoute = withCors(refunder(routeConfig, refundPolicy));
```

Preflight handling matters because the paid retry sends the non-safelisted
`D402-Payment-Proof` header. A refund request also uses a non-safelisted content
type, `application/d402-refund+json`. An `OPTIONS` request should be answered by
the wrapper or framework middleware rather than entering `payable()` or
`refunder()`.

When cookies or other credentials are allowed, return the exact permitted
origin. Browsers do not permit `Access-Control-Allow-Origin: *` together with
`Access-Control-Allow-Credentials: true`.

## Decorating Protocol Responses

Payable route configuration currently exposes two response builders:

- `buildPaymentRequiredResponse` for an unpaid `402` challenge;
- `buildPaymentVerificationErrorResponse` for proof-bearing failures.

The canonical implementations are exported so an application can add headers
without recreating the protocol body:

```ts
import {
  buildPaymentRequiredResponse as canonicalPaymentRequired,
  buildPaymentVerificationErrorResponse as canonicalVerificationError,
  payable,
} from "d402/server";

const route = payable({
  ...paymentConfig,
  terms,
  handler,

  buildPaymentRequiredResponse(input) {
    const response = canonicalPaymentRequired(input);
    response.headers.set("X-Service-Version", buildVersion);
    return response;
  },

  buildPaymentVerificationErrorResponse(input) {
    const response = canonicalVerificationError(input);

    if (input.reason.retryable) {
      response.headers.set("Retry-After", "2");
    }

    return response;
  },
});
```

Builders are useful for static CORS headers, `Retry-After`, service metadata,
and diagnostic headers. They affect only the protocol response they build.
They do not handle preflight, successful handler responses, or refund
responses.

These are full response-builder hooks. Replacing the canonical status, body,
`Content-Type`, or `Cache-Control` can make the response incompatible with
standard clients. Delegate to the exported builder and limit customization to
additional headers.

## Framework-Owned Controllers

Use `PaymentAuthorizer` when Express, Nest, Next middleware, or another
framework owns the controller and response lifecycle:

```ts
const authorizer = new PaymentAuthorizer(config);

async function controller(request: Request): Promise<Response> {
  const authorization = await authorizer.authorize(request);

  if (authorization.response !== undefined) {
    return addFrameworkHeaders(request, authorization.response);
  }

  const response = await applicationHandler(
    request,
    authorization.context,
  );

  return addFrameworkHeaders(request, response);
}
```

This is the appropriate seam for request-scoped tracing, tenant-aware CORS,
session middleware, correlation IDs, centralized error handling, and
conversion to a framework-native response. `PaymentAuthorizer` still owns the
same canonical payment pipeline as `payable()`.

## Cross-Origin Client Credentials

Options passed to the protected request are preserved for its paid retry:

```ts
await client.fetch(url, {
  credentials: "include",
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

A refund is a separate request to the endpoint advertised by the payment
challenge. Headers from the protected request are deliberately not copied to a
possibly different origin.

Today, cross-origin cookie or bearer authentication for refunds can be added
through the client's configured `fetch` implementation:

```ts
const authenticatedFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);

  if (
    url.origin === "https://api.example.com" &&
    url.pathname === "/refund"
  ) {
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${await getAccessToken()}`);

    return fetch(new Request(request, {
      headers,
      credentials: "include",
    }));
  }

  return fetch(request);
};

const client = await createD402Client({
  provider,
  signer,
  fetch: authenticatedFetch,
});
```

Scope credentials to an allowlisted origin and path. A general fetch wrapper
must not attach secrets to every refund URL advertised by an untrusted server.
Same-origin refund routes can use normal same-origin cookies without this
additional transport configuration.

## Integration Map

| Requirement | Current integration seam |
| --- | --- |
| CORS on every response | Wrap `payable()` and `refunder()` |
| Browser preflight | Route wrapper or framework middleware |
| Static headers on payment responses | Canonical response builders |
| `Retry-After` on temporary verification failures | Verification-error builder |
| Request IDs or tenant headers | Route wrapper or `PaymentAuthorizer` controller |
| Protected-request authentication | Surrounding middleware or controller |
| Refund-requester authentication | `RefundPolicy` reads the refund HTTP request |
| Refund cookies or bearer token | Configured client `fetch` implementation |
| Alternate payment execution | Custom client executor |
| Payer spending limits | Client policy |
| Route-level payment-state acceptance | `VerificationPolicy` |
| Existing-result delivery | `PaymentRecovery` |
| One-shot authorization | `PaymentConsumer` |
| Paid business operation | Handler |
| Application refund approval | `RefundPolicy` |

The payment proof format, canonical authentication, on-chain observation,
refund request body, advertised refund route, and refund response validation
are not extension points. A different refund method, body, URL, or transport is
an application workflow outside the d402 refund protocol.
