const express = require("express");
const db = require("../config/db");
const safepay = require("../services/safepay");
const { reconcileDonation } = require("../services/payments");

const router = express.Router();

// Safepay webhook. The signature is checked, but the payload is still only a hint: the payment is
// confirmed by asking Safepay for the tracker with the merchant secret, exactly like every other path.
router.post("/safepay/webhook", async (req, res) => {
  if (!safepay.isConfigured() || !safepay.webhookConfigured()) {
    console.error("Safepay webhook received, but SAFEPAY_WEBHOOK_SECRET or Safepay keys are not configured.");
    return res.status(503).json({ message: "Webhook not configured." });
  }

  const valid = safepay.verifyWebhookSignature({
    signature: req.get("x-sfpy-signature"),
    body: req.body,
    rawBody: req.rawBody
  });

  if (!valid) {
    console.warn("Safepay webhook rejected: invalid or missing X-SFPY-SIGNATURE.");
    return res.status(401).json({ message: "Invalid signature." });
  }

  const tracker = safepay.trackerFromWebhook(req.body);

  if (!tracker) {
    return res.json({ received: true });
  }

  try {
    const [payments] = await db.execute(
      "SELECT donation_id FROM payments WHERE provider = 'safepay' AND provider_transaction_id = ?",
      [tracker]
    );

    if (!payments.length) {
      console.warn("Safepay webhook for an unknown tracker was ignored.");
      return res.json({ received: true });
    }

    const { status } = await reconcileDonation(payments[0].donation_id);
    console.log(`Safepay webhook: donation ${payments[0].donation_id} is ${status}.`);

    res.json({ received: true });
  } catch (error) {
    // A non-2xx answer makes Safepay retry later; the background check is a further safety net.
    console.error("Safepay webhook error:", error.message);
    res.status(500).json({ message: "Could not process webhook." });
  }
});

module.exports = router;
