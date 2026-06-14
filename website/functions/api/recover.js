import {
  createDownloadPageUrl,
  findLatestPurchaseByEmail,
  isEmailLike,
  json,
  normalizeEmail,
  sendDownloadEmail
} from "../_shared/purchases.js";

const GENERIC_RECOVERY_MESSAGE = "If that email has a purchase, a fresh download link is on the way.";

export async function onRequestPost({ env, request }) {
  if (!env.PURCHASES_DB || !env.DOWNLOAD_TOKEN_SECRET) {
    return json({ error: "Purchase recovery is not configured yet." }, { status: 503 });
  }

  const payload = await request.json().catch(() => ({}));
  const email = normalizeEmail(payload.email);
  if (!isEmailLike(email)) {
    return json({ error: "Enter the email used at checkout." }, { status: 400 });
  }

  const purchase = await findLatestPurchaseByEmail(env, email);
  if (purchase) {
    const downloadUrl = await createDownloadPageUrl(env, purchase, { recovered: true });
    await sendDownloadEmail(env, {
      downloadUrl,
      to: purchase.email
    });
  }

  return json({ ok: true, message: GENERIC_RECOVERY_MESSAGE });
}

export function onRequestGet() {
  return json({ error: "Method not allowed." }, { status: 405 });
}
