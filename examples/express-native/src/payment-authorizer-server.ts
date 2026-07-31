import { PaymentAuthorizer } from "d402/server";

import {
  createApp,
  port,
  reportAuthorization,
  sendWebResponse,
  toWebRequest,
} from "./shared.js";

const reportPayment = new PaymentAuthorizer(reportAuthorization);
const app = createApp();

app.get("/reports/:id", async (req, res, next) => {
  try {
    const authorization = await reportPayment.authorize(toWebRequest(req));

    if (authorization.response !== undefined) {
      await sendWebResponse(res, authorization.response);
      return;
    }

    // Express retains ownership of the successful application response.
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
  console.log(
    `d402 PaymentAuthorizer example listening on http://localhost:${port}`,
  );
});
