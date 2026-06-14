# INFINIGHTCapture Website

Static launch site for `infinightcapture.com`.

## Local Preview

```bash
npx serve website
```

Or open `website/index.html` directly in a browser.

## Cloudflare Pages

- Project root: `website`
- Build command: `exit 0`
- Build output directory: `.`
- Production branch: `main`

After deployment, attach these custom domains in Cloudflare Pages:

- `infinightcapture.com`
- `www.infinightcapture.com`

## Payments

Cloudflare hosts the site, checkout API, purchase records, and protected downloads. Stripe handles
the card payment.

1. In Stripe, create a product named `INFINIGHTCapture Full License`.
2. Add a one-time USD price for `$5.00`.
3. Copy the Stripe price ID, which starts with `price_`.
4. In Cloudflare Pages, add these environment variables:
   - `SITE_URL`: `https://infinightcapture.com`
   - `STRIPE_PRICE_ID`: `price_1TiD1bHRHfZdckNqGRr8SbBV`
   - `STRIPE_PRODUCT_ID`: `prod_UhcGyJcNr4E0xd`
   - `STRIPE_CURRENCY`: `usd`
   - `STRIPE_UNIT_AMOUNT`: `500`
   - `STRIPE_AUTOMATIC_TAX`: `false` until Stripe Tax is configured
5. In Cloudflare Pages, add this secret:
   - `STRIPE_SECRET_KEY`: your Stripe secret key
6. Create an R2 bucket named `infinightcapture-releases`.
7. Bind the bucket to Pages Functions as `PAID_RELEASES`.
8. Upload paid installers to these R2 object keys:
   - `paid/INFINIGHTCapture-Paid-0.1.0-mac-arm64.dmg`
   - `paid/INFINIGHTCapture-Paid-Setup-0.1.0-win-x64.exe`
9. Create a D1 database named `infinightcapture-purchases`.
10. Bind it to Pages Functions as `PURCHASES_DB`.
11. Apply the D1 migration in `migrations/0001_create_purchases.sql`.
12. Generate and add this Cloudflare Pages secret:
    - `DOWNLOAD_TOKEN_SECRET`: random 32+ byte secret used to sign private download links
13. Add these Cloudflare Pages variables:
    - `DOWNLOAD_LINK_TTL_SECONDS`: `2592000`
    - `FROM_EMAIL`: `INFINIGHTCapture <downloads@infinightcapture.com>`
    - `SUPPORT_EMAIL`: `hello@infinightcapture.com`
14. Add an outbound email provider secret. The Pages project currently uses Resend because Pages
    config validation does not accept Cloudflare's `send_email` binding:
    - `RESEND_API_KEY`: Resend API key for purchase and recovery emails
15. In Stripe, create a webhook endpoint:
    - URL: `https://infinightcapture.com/api/stripe-webhook`
    - Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
16. Copy Stripe's webhook signing secret and add it as:
    - `STRIPE_WEBHOOK_SECRET`

The checkout button calls `/api/create-checkout`, redirects to Stripe Checkout, and returns to
`/thanks/?session_id=...`. Paid download links call `/api/download/mac` or `/api/download/windows`
with the Checkout Session ID, verify that Stripe reports the session as paid, and stream the installer
from R2.

Stripe webhooks call `/api/stripe-webhook`, verify the Stripe signature, save the purchase in D1,
generate a signed private download link, and email that link to the buyer. Email delivery uses Resend
for this Pages deployment. The sender helper can use a Cloudflare `EMAIL` binding later if the payment
functions move to a Worker. If the buyer loses the installer, `/recover/` lets them enter the checkout
email and receive a fresh signed link. Magic links expire, but the D1 purchase record stays available
for future recovery.

Suggested setup commands:

```bash
cd website
npx wrangler d1 create infinightcapture-purchases
npx wrangler d1 migrations apply infinightcapture-purchases --remote
openssl rand -base64 32
```

After creating D1, add the `PURCHASES_DB` binding in the Cloudflare Pages dashboard or add the
generated D1 binding to `wrangler.toml`.

For local function testing, copy `.dev.vars.example` to `.dev.vars` and fill in Stripe test values.

```bash
cd website
npx wrangler pages dev .
```

## Public Demo Downloads

The home page links to Pages Functions at:

- `https://infinightcapture.com/download/mac`
- `https://infinightcapture.com/download/windows`

Those routes resolve public demo assets from the GitHub release configured by `DEMO_RELEASE_REPO` and
`DEMO_RELEASE_TAG`, or redirect directly to `DEMO_MAC_DOWNLOAD_URL` and `DEMO_WINDOWS_DOWNLOAD_URL`
when those variables are set. If a matching platform asset has not been uploaded yet, the route
redirects to the configured GitHub release page.
