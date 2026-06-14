import {
  createDownloadPageUrl,
  json,
  savePaidCheckoutSession,
  sendDownloadEmail,
  verifyStripeWebhookEvent
} from "../_shared/purchases.js";

async function handleCheckoutSession(env, session) {
  if (!env.PURCHASES_DB || !env.DOWNLOAD_TOKEN_SECRET) {
    throw new Error("Purchase storage is not configured.");
  }

  if (session.mode !== "payment" || session.payment_status !== "paid") {
    return { emailed: false, saved: false };
  }

  const purchase = await savePaidCheckoutSession(env, session);
  if (!purchase) {
    return { emailed: false, saved: false };
  }

  const downloadUrl = await createDownloadPageUrl(env, purchase);
  const emailResult = await sendDownloadEmail(env, {
    downloadUrl,
    to: purchase.email
  });

  return { emailed: emailResult.sent, saved: true };
}

export async function onRequestPost({ env, request }) {
  const body = await request.text();

  let event;
  try {
    event = await verifyStripeWebhookEvent(env, request.headers.get("Stripe-Signature"), body);
  } catch (error) {
    return json({ error: error.message || "Invalid Stripe webhook." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    try {
      const result = await handleCheckoutSession(env, event.data.object);
      return json({ received: true, ...result });
    } catch (error) {
      return json({ error: error.message || "Purchase webhook could not be processed." }, { status: 503 });
    }
  }

  return json({ received: true, ignored: true });
}

export function onRequestGet() {
  return json({ error: "Method not allowed." }, { status: 405 });
}
