import {
  constantTimeEqual,
  createHumanPromoCode,
  hashPromoCode,
  isEmailLike,
  json,
  normalizeEmail
} from "../_shared/purchases.js";

function requireAdmin(env, request) {
  if (!env.PROMO_ADMIN_TOKEN) {
    return { ok: false, response: json({ error: "Promo admin is not configured yet." }, { status: 503 }) };
  }

  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const token = bearer || request.headers.get("X-Promo-Admin-Token") || "";
  if (!constantTimeEqual(token, env.PROMO_ADMIN_TOKEN)) {
    return { ok: false, response: json({ error: "Unauthorized." }, { status: 401 }) };
  }

  return { ok: true };
}

function cleanOptionalText(value, maxLength = 500) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeExpiry(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

export async function onRequestGet({ env, request }) {
  const admin = requireAdmin(env, request);
  if (!admin.ok) return admin.response;
  if (!env.PURCHASES_DB) {
    return json({ error: "Promo codes are not configured yet." }, { status: 503 });
  }

  const rows = await env.PURCHASES_DB.prepare(
    `SELECT
       id,
       code_prefix,
       artist_name,
       artist_email,
       plan_label,
       max_redemptions,
       redeemed_count,
       expires_at,
       status,
       notes,
       created_at,
       updated_at
     FROM promo_codes
     ORDER BY created_at DESC
     LIMIT 100`
  ).all();

  return json({ promoCodes: rows.results || [] });
}

export async function onRequestPost({ env, request }) {
  const admin = requireAdmin(env, request);
  if (!admin.ok) return admin.response;
  if (!env.PURCHASES_DB) {
    return json({ error: "Promo codes are not configured yet." }, { status: 503 });
  }

  const payload = await request.json().catch(() => ({}));
  const artistName = cleanOptionalText(payload.artistName, 120);
  const artistEmail = normalizeEmail(payload.artistEmail);
  const planLabel = cleanOptionalText(payload.planLabel, 80) || "Full license";
  const notes = cleanOptionalText(payload.notes, 1000);
  const expiresAt = normalizeExpiry(payload.expiresAt);
  const maxRedemptions = Math.max(1, Math.min(100, Number.parseInt(payload.maxRedemptions || "1", 10) || 1));

  if (artistEmail && !isEmailLike(artistEmail)) {
    return json({ error: "Enter a valid artist email, or leave it blank." }, { status: 400 });
  }

  const code = createHumanPromoCode(artistName || artistEmail || "ARTIST");
  const codeHash = await hashPromoCode(env, code);
  const now = new Date().toISOString();
  const promoCode = {
    artist_email: artistEmail || null,
    artist_name: artistName,
    code_prefix: `${code.slice(0, Math.min(12, Math.max(4, code.length - 5)))}...${code.slice(-2)}`,
    expires_at: expiresAt,
    id: `promo_${crypto.randomUUID()}`,
    max_redemptions: maxRedemptions,
    normalized_artist_email: artistEmail || null,
    notes,
    plan_label: planLabel,
    status: "active"
  };

  await env.PURCHASES_DB.prepare(
    `INSERT INTO promo_codes (
       id,
       code_hash,
       code_prefix,
       artist_name,
       artist_email,
       normalized_artist_email,
       plan_label,
       max_redemptions,
       redeemed_count,
       expires_at,
       status,
       notes,
       created_at,
       updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11, ?12, ?13)`
  )
    .bind(
      promoCode.id,
      codeHash,
      promoCode.code_prefix,
      promoCode.artist_name,
      promoCode.artist_email,
      promoCode.normalized_artist_email,
      promoCode.plan_label,
      promoCode.max_redemptions,
      promoCode.expires_at,
      promoCode.status,
      promoCode.notes,
      now,
      now
    )
    .run();

  return json({
    promoCode: {
      ...promoCode,
      code,
      created_at: now,
      redeemed_count: 0,
      updated_at: now
    }
  });
}

export async function onRequestPatch({ env, request }) {
  const admin = requireAdmin(env, request);
  if (!admin.ok) return admin.response;
  if (!env.PURCHASES_DB) {
    return json({ error: "Promo codes are not configured yet." }, { status: 503 });
  }

  const payload = await request.json().catch(() => ({}));
  const id = String(payload.id || "").trim();
  const status = String(payload.status || "").trim();
  if (!id || !["active", "revoked"].includes(status)) {
    return json({ error: "Enter a promo code id and a valid status." }, { status: 400 });
  }

  const result = await env.PURCHASES_DB.prepare(
    `UPDATE promo_codes
     SET status = ?1,
         updated_at = ?2
     WHERE id = ?3`
  )
    .bind(status, new Date().toISOString(), id)
    .run();

  if (!result.meta?.changes) {
    return json({ error: "Promo code was not found." }, { status: 404 });
  }

  return json({ ok: true });
}
