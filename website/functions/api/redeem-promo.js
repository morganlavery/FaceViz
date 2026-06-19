import { createDownloadPageUrl, json, redeemPromoCode, sendDownloadEmail } from "../_shared/purchases.js";

export async function onRequestPost({ env, request }) {
  if (!env.PURCHASES_DB || !env.DOWNLOAD_TOKEN_SECRET) {
    return json({ error: "Promo redemption is not configured yet." }, { status: 503 });
  }

  const payload = await request.json().catch(() => ({}));
  const result = await redeemPromoCode(env, {
    code: payload.code,
    email: payload.email,
    recipientName: payload.name
  });

  if (!result.ok) {
    return json({ error: result.error || "Promo code could not be redeemed." }, { status: result.status || 400 });
  }

  const downloadUrl = await createDownloadPageUrl(env, result.purchase);
  await sendDownloadEmail(env, {
    downloadUrl,
    intro: result.alreadyRedeemed
      ? "Here is your INFINIGHTCapture artist promo download link again."
      : "Your INFINIGHTCapture artist promo license is active. Your no-watermark build is ready here:",
    to: result.purchase.email
  });

  return json({
    alreadyRedeemed: result.alreadyRedeemed,
    downloadUrl,
    message: result.alreadyRedeemed
      ? "That code was already redeemed for this email, so we sent the download link again."
      : "Promo code redeemed. Your download link is ready and has been emailed to you."
  });
}

export function onRequestGet() {
  return json({ error: "Method not allowed." }, { status: 405 });
}
