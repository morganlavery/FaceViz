const DEFAULT_SITE_URL = "https://infinightcapture.com";
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const WEBHOOK_TOLERANCE_SECONDS = 60 * 5;

const encoder = new TextEncoder();

export function json(data, init = {}) {
  return Response.json(data, {
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {})
    },
    status: init.status || 200
  });
}

export function getSiteUrl(env) {
  return (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
}

export function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

export function isEmailLike(email = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function tokenTtlSeconds(env) {
  const parsed = Number.parseInt(env.DOWNLOAD_LINK_TTL_SECONDS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOKEN_TTL_SECONDS;
}

export async function createDownloadToken(env, purchase, ttlSeconds = tokenTtlSeconds(env)) {
  if (!env.DOWNLOAD_TOKEN_SECRET) {
    throw new Error("DOWNLOAD_TOKEN_SECRET is not configured.");
  }

  const payload = {
    email: purchase.normalized_email || normalizeEmail(purchase.email),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    purchaseId: purchase.id
  };
  const data = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = bytesToBase64Url(await hmac(env.DOWNLOAD_TOKEN_SECRET, data));

  return `${data}.${signature}`;
}

export async function verifyDownloadToken(env, token) {
  if (!env.PURCHASES_DB || !env.DOWNLOAD_TOKEN_SECRET) {
    return { ok: false, reason: "Purchase recovery is not configured." };
  }

  const [data, signature] = String(token || "").split(".");
  if (!data || !signature) {
    return { ok: false, reason: "Invalid download link." };
  }

  const expectedSignature = bytesToBase64Url(await hmac(env.DOWNLOAD_TOKEN_SECRET, data));
  if (!constantTimeEqual(signature, expectedSignature)) {
    return { ok: false, reason: "Invalid download link." };
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(data)));
  } catch {
    return { ok: false, reason: "Invalid download link." };
  }

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "Download link has expired." };
  }

  const purchase = await env.PURCHASES_DB.prepare(
    `SELECT *
     FROM purchases
     WHERE id = ?1
       AND normalized_email = ?2
       AND license_status = 'active'
     LIMIT 1`
  )
    .bind(payload.purchaseId, payload.email)
    .first();

  if (!purchase) {
    return { ok: false, reason: "Purchase was not found." };
  }

  return { ok: true, purchase };
}

export async function createDownloadPageUrl(env, purchase, options = {}) {
  const token = await createDownloadToken(env, purchase, options.ttlSeconds);
  const url = new URL("/thanks/", getSiteUrl(env));
  url.searchParams.set("token", token);
  if (options.recovered) {
    url.searchParams.set("recovered", "1");
  }
  return url.toString();
}

export async function savePaidCheckoutSession(env, session) {
  if (!env.PURCHASES_DB) {
    return null;
  }

  const email = session.customer_details?.email || session.customer_email;
  const normalizedEmail = normalizeEmail(email);
  if (!isEmailLike(normalizedEmail)) {
    return null;
  }

  const existing = await env.PURCHASES_DB.prepare("SELECT id FROM purchases WHERE stripe_session_id = ?1 LIMIT 1")
    .bind(session.id)
    .first();
  const now = new Date().toISOString();
  const purchase = {
    amount_total: session.amount_total ?? null,
    created_at: existing ? undefined : now,
    currency: session.currency || null,
    email,
    id: existing?.id || `purchase_${crypto.randomUUID()}`,
    license_status: "active",
    normalized_email: normalizedEmail,
    stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
    stripe_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
    stripe_price_id: env.STRIPE_PRICE_ID || null,
    stripe_product_id: env.STRIPE_PRODUCT_ID || null,
    stripe_session_id: session.id,
    updated_at: now
  };

  await env.PURCHASES_DB.prepare(
    `INSERT INTO purchases (
       id,
       email,
       normalized_email,
       stripe_session_id,
       stripe_payment_intent,
       stripe_customer_id,
       stripe_product_id,
       stripe_price_id,
       amount_total,
       currency,
       license_status,
       created_at,
       updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
     ON CONFLICT(stripe_session_id) DO UPDATE SET
       email = excluded.email,
       normalized_email = excluded.normalized_email,
       stripe_payment_intent = excluded.stripe_payment_intent,
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_product_id = excluded.stripe_product_id,
       stripe_price_id = excluded.stripe_price_id,
       amount_total = excluded.amount_total,
       currency = excluded.currency,
       license_status = excluded.license_status,
       updated_at = excluded.updated_at`
  )
    .bind(
      purchase.id,
      purchase.email,
      purchase.normalized_email,
      purchase.stripe_session_id,
      purchase.stripe_payment_intent,
      purchase.stripe_customer_id,
      purchase.stripe_product_id,
      purchase.stripe_price_id,
      purchase.amount_total,
      purchase.currency,
      purchase.license_status,
      existing ? now : purchase.created_at,
      purchase.updated_at
    )
    .run();

  return purchase;
}

export async function findLatestPurchaseByEmail(env, email) {
  if (!env.PURCHASES_DB) {
    return null;
  }

  const normalizedEmail = normalizeEmail(email);
  if (!isEmailLike(normalizedEmail)) {
    return null;
  }

  return env.PURCHASES_DB.prepare(
    `SELECT *
     FROM purchases
     WHERE normalized_email = ?1
       AND license_status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`
  )
    .bind(normalizedEmail)
    .first();
}

export async function sendDownloadEmail(env, { downloadUrl, to }) {
  const supportEmail = env.SUPPORT_EMAIL || "hello@infinightcapture.com";
  const from = parseSender(env.FROM_EMAIL || "INFINIGHTCapture <downloads@infinightcapture.com>");
  const subject = "Your INFINIGHTCapture download";
  const html = `
        <div style="font-family:Inter,Arial,sans-serif;line-height:1.55;color:#101820">
          <h1 style="font-size:22px">Your INFINIGHTCapture download</h1>
          <p>Thanks for buying INFINIGHTCapture. Your no-watermark build is ready here:</p>
          <p><a href="${downloadUrl}">Download INFINIGHTCapture</a></p>
          <p>This private link can be regenerated any time from the recovery page.</p>
          <p>Need help? Reply to this email or contact ${supportEmail}.</p>
        </div>
      `;
  const text = [
    "Your INFINIGHTCapture download",
    "",
    "Thanks for buying INFINIGHTCapture. Your no-watermark build is ready here:",
    downloadUrl,
    "",
    "This private link can be regenerated any time from the recovery page.",
    `Need help? Reply to this email or contact ${supportEmail}.`
  ].join("\n");

  if (env.EMAIL?.send) {
    try {
      await env.EMAIL.send({
        from,
        html,
        subject,
        text,
        to: [{ email: to }]
      });
      return { sent: true };
    } catch (error) {
      return { sent: false, reason: error.message || "Cloudflare Email could not send the download email." };
    }
  }

  if (!env.RESEND_API_KEY) {
    console.warn("No email binding or RESEND_API_KEY is configured; skipping download email.");
    return { sent: false, reason: "Email provider is not configured." };
  }

  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from: from.name ? `${from.name} <${from.email}>` : from.email,
      html,
      reply_to: supportEmail,
      subject,
      text,
      to
    }),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    return { sent: false, reason: payload?.message || "Download email could not be sent." };
  }

  return { sent: true };
}

function parseSender(value) {
  const match = String(value).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    return {
      email: match[2],
      name: match[1]
    };
  }

  return { email: String(value).trim() };
}

export async function verifyStripeWebhookEvent(env, signatureHeader, body) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }

  const parts = String(signatureHeader || "")
    .split(",")
    .reduce(
      (current, part) => {
        const [key, value] = part.split("=");
        if (key === "t") current.timestamp = value;
        if (key === "v1") current.signatures.push(value);
        return current;
      },
      { signatures: [], timestamp: "" }
    );
  const timestamp = Number.parseInt(parts.timestamp, 10);

  if (!timestamp || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("Stripe webhook timestamp is outside the tolerance window.");
  }

  const expectedSignature = bytesToHex(await hmac(env.STRIPE_WEBHOOK_SECRET, `${parts.timestamp}.${body}`));
  const signatureMatches = parts.signatures.some((signature) => constantTimeEqual(signature, expectedSignature));
  if (!signatureMatches) {
    throw new Error("Stripe webhook signature verification failed.");
  }

  return JSON.parse(body);
}
