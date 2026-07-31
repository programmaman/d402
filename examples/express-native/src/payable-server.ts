import { payable } from "d402/server";

import {
  createApp,
  port,
  reportAuthorization,
  sendWebResponse,
  toWebRequest,
} from "./shared.js";

const reportRoute = payable({
  ...reportAuthorization,
  handler: (request, context) => {
    const id = new URL(request.url).pathname.split("/").at(-1);

    return Response.json({
      report: {
        id,
        title: `Report ${id}`,
      },
      paymentId: context.payment.paymentId,
    });
  },
});

const app = createApp();

app.get("/reports/:id", async (req, res, next) => {
  try {
    // payable() owns authorization and the successful Fetch response.
    const response = await reportRoute(toWebRequest(req));
    await sendWebResponse(res, response);
  } catch (error) {
    next(error);
  }
});

app.listen(port, () => {
  console.log(`d402 payable example listening on http://localhost:${port}`);
});
