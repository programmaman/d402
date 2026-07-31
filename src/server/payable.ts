import { PaymentAuthorizer } from "./payment-authorizer.js";
import type { PayableRouteConfig } from "./types.js";

export function payable<Req extends Request = Request>(
  options: PayableRouteConfig<Req>,
): (request: Req) => Promise<Response> {
  const authorizer = new PaymentAuthorizer(options);

  return async function handlePayableRequest(request: Req): Promise<Response> {
    const authorization = await authorizer.authorize(request);
    if (authorization.response !== undefined) {
      return authorization.response;
    }
    return options.handler(request, authorization.context);
  };
}
