const DEFAULT_SITE_URL = "https://infinightcapture.com";
const DEFAULT_STRIPE_PRICE_ID = "price_1TiD1bHRHfZdckNqGRr8SbBV";
const DEFAULT_STRIPE_PRODUCT_ID = "prod_UhcGyJcNr4E0xd";
const DEFAULT_STRIPE_CURRENCY = "usd";
const DEFAULT_STRIPE_UNIT_AMOUNT = "500";

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
  const stripePriceId = env.STRIPE_PRICE_ID || DEFAULT_STRIPE_PRICE_ID;
  const stripeProductId = env.STRIPE_PRODUCT_ID || DEFAULT_STRIPE_PRODUCT_ID;

  if (!env.STRIPE_SECRET_KEY || (!stripePriceId && !stripeProductId)) {
    return json({ error: "Checkout is not configured yet." }, { status: 503 });
  }

  const siteUrl = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${siteUrl}/thanks/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/#pricing`,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
    billing_address_collection: "auto",
    "metadata[product]": "INFINIGHTCapture",
    "metadata[edition]": "paid"
  });

  if (stripePriceId) {
    params.set("line_items[0][price]", stripePriceId);
  } else {
    params.set("line_items[0][price_data][currency]", env.STRIPE_CURRENCY || DEFAULT_STRIPE_CURRENCY);
    params.set("line_items[0][price_data][product]", stripeProductId);
    params.set("line_items[0][price_data][unit_amount]", env.STRIPE_UNIT_AMOUNT || DEFAULT_STRIPE_UNIT_AMOUNT);
  }

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
