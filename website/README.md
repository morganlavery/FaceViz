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

Cloudflare hosts the site, checkout API, and protected downloads. Stripe handles the card payment.

1. In Stripe, create a product named `INFINIGHTCapture Full License`.
2. Add a one-time USD price for `$5.00`.
3. Copy either the Stripe price ID, which starts with `price_`, or the product ID, which starts with `prod_`.
4. In Cloudflare Pages, add these environment variables:
   - `SITE_URL`: `https://infinightcapture.com`
   - `STRIPE_PRODUCT_ID`: `prod_UhcGyJcNr4E0xd`
   - `STRIPE_CURRENCY`: `usd`
   - `STRIPE_UNIT_AMOUNT`: `500`
   - Optional: `STRIPE_PRICE_ID`, if you want Checkout to use a fixed Stripe `price_...` value instead
   - `STRIPE_AUTOMATIC_TAX`: `false` until Stripe Tax is configured
5. In Cloudflare Pages, add this secret:
   - `STRIPE_SECRET_KEY`: your Stripe secret key
6. Create an R2 bucket named `infinightcapture-releases`.
7. Bind the bucket to Pages Functions as `PAID_RELEASES`.
8. Upload paid installers to these R2 object keys:
   - `paid/INFINIGHTCapture-Paid-0.1.0-mac-arm64.dmg`
   - `paid/INFINIGHTCapture-Paid-Setup-0.1.0-win-x64.exe`

The checkout button calls `/api/create-checkout`, redirects to Stripe Checkout, and returns to
`/thanks/?session_id=...`. Paid download links call `/api/download/mac` or `/api/download/windows`
with the Checkout Session ID, verify that Stripe reports the session as paid, and stream the installer
from R2.

For local function testing, copy `.dev.vars.example` to `.dev.vars` and fill in Stripe test values.

```bash
cd website
npx wrangler pages dev .
```

## Launch Links To Replace

Update these placeholders in `index.html` when the product pages are ready:

- `https://infinightcapture.com/download/mac`
- `https://infinightcapture.com/download/windows`
- `https://github.com/`
