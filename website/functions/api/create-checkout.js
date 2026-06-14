const DEFAULT_SITE_URL = "https://infinightcapture.com";

function json(data, init = {}) {
  return Response.json(data, {
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {})
    },
    status: init.status || 200
  });
}

export async function onRequestPost({ env, request }) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
    return json({ error: "Checkout is not configured yet." }, { status: 503 });
  }

  const siteUrl = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${siteUrl}/thanks/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/#pricing`,
    "line_items[0][price]": env.STRIPE_PRICE_ID,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
    billing_address_collection: "auto",
    "metadata[product]": "INFINIGHTCapture",
    "metadata[edition]": "paid"
  });

  if (env.STRIPE_AUTOMATIC_TAX === "true") {
    params.set("automatic_tax[enabled]", "true");
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  const payload = await response.json();

  if (!response.ok) {
    return json({ error: payload?.error?.message || "Stripe checkout failed." }, { status: 502 });
  }

  return json({ url: payload.url });
}

export function onRequestGet() {
  return json({ error: "Method not allowed." }, { status: 405 });
}
