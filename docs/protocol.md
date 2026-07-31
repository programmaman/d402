# d402 Protocol

d402 is an HTTP payment protocol. A server responds to an unpaid request with
HTTP `402 Payment Required`. The client creates the requested payment on-chain
and repeats the same HTTP request with proof of payment.

## Request Flow

```text
Client                         Server                         Chain
  |                              |                              |
  |--- original HTTP request --->|                              |
  |<-- 402 Payment Required -----|                              |
  |                              |                              |
  |--- create payment ----------------------------------------->|
  |<-- payment created -----------------------------------------|
  |                              |                              |
  |--- same HTTP request ------->|                              |
  |    + payment proof           |                              |
  |                              |--- authenticate payment ---->|
  |                              |<-- authenticated payment -----|
  |<-- protected HTTP response --|                              |
```

The second request is the original request with a
`D402-Payment-Proof` header. The server either accepts the payment and returns
the protected response, or returns a d402 verification error.

## HTTP Messages

### Payment required

```http
HTTP/1.1 402 Payment Required
Content-Type: application/d402+json
Cache-Control: no-store
```

The response body contains:

- the requested payment terms;
- the reason payment is required;
- an optional refund URL.

### Paid request

```http
GET /resource HTTP/1.1
D402-Payment-Proof: <payment proof>
```

The method, URL, body, and ordinary request headers remain those of the
original request.

### Protected response

```http
HTTP/1.1 <application status>
Content-Type: <application content type>
```

The protected response belongs to the application. d402 does not define its
status, headers, or body.

## Error Flow

```text
paid request
    |
    +-- payment proof is invalid or unusable --> 422
    |
    +-- payment is not ready -----------------> 425
    |
    +-- chain verification is unavailable ----> 503
    |
    +-- chain verification times out ----------> 504
    |
    +-- payment is accepted ------------------> protected response
```

| HTTP status | Meaning |
| --- | --- |
| `402 Payment Required` | The request needs a payment |
| `422 Unprocessable Content` | The supplied payment proof is invalid or cannot authorize the request |
| `425 Too Early` | The payment is not yet observable or sufficiently confirmed |
| `503 Service Unavailable` | Payment verification is temporarily unavailable |
| `504 Gateway Timeout` | Payment verification timed out |

d402 error responses use:

```http
Content-Type: application/d402+json
Cache-Control: no-store
```

Their body contains a machine-readable reason and a retryability hint:

```json
{
  "reason": {
    "code": "invalid-proof",
    "retryable": false
  }
}
```

The reason explains the failure. `retryable` is only a hint; it does not
instruct the client to create another payment.

## Refund Flow

A `402` response may include a refund URL. Its presence means the server
supports the standard d402 refund request; it does not guarantee approval.

```text
Client                         Server                         Chain
  |                              |                              |
  |--- refund request ---------->|                              |
  |    payment request + proof   |                              |
  |                              |--- authenticate payment ---->|
  |                              |<-- authenticated payment -----|
  |                              |--- approved refund ---------->|
  |<-- refund transaction -------|                              |
```

### Refund request

```http
POST <refund URL> HTTP/1.1
Content-Type: application/d402-refund+json
```

The body contains the original payment request, its payment proof, and an
optional reason.

### Refund response

```http
HTTP/1.1 200 OK
Content-Type: application/d402-refund+json

{
  "txHash": "0x..."
}
```

| HTTP status | Meaning |
| --- | --- |
| `400 Bad Request` | The refund request is malformed |
| `403 Forbidden` | The refund request is not authorized or approved |
| `409 Conflict` | The payment is not refundable |
| `422 Unprocessable Content` | The historical payment proof is invalid |
| `425 Too Early` | The payment is not ready for verification |
| `503 Service Unavailable` | Payment verification is unavailable |
| `504 Gateway Timeout` | Payment verification timed out |
