const DOWNLOADS = {
  mac: {
    envKey: "PAID_MAC_OBJECT_KEY",
    fallbackKey: "paid/INFINIGHTCapture-Paid-0.1.0-mac-arm64.dmg",
    contentType: "application/x-apple-diskimage",
    filename: "INFINIGHTCapture-Paid-0.1.0-mac-arm64.dmg"
  },
  windows: {
    envKey: "PAID_WINDOWS_OBJECT_KEY",
    fallbackKey: "paid/INFINIGHTCapture-Paid-Setup-0.1.0-win-x64.exe",
    contentType: "application/vnd.microsoft.portable-executable",
    filename: "INFINIGHTCapture-Paid-Setup-0.1.0-win-x64.exe"
  }
};

function json(data, init = {}) {
  return Response.json(data, {
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {})
    },
    status: init.status || 200
  });
}

async function getCheckoutSession(env, sessionId) {
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export async function onRequestGet({ env, params, request }) {
  const download = DOWNLOADS[params.platform];
  if (!download) {
    return json({ error: "Unknown platform." }, { status: 404 });
  }

  if (!env.STRIPE_SECRET_KEY || !env.PAID_RELEASES) {
    return json({ error: "Paid downloads are not configured yet." }, { status: 503 });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return json({ error: "Missing checkout session." }, { status: 401 });
  }

  const session = await getCheckoutSession(env, sessionId);
  if (!session || session.payment_status !== "paid" || session.mode !== "payment") {
    return json({ error: "Payment has not been completed." }, { status: 403 });
  }

  const objectKey = env[download.envKey] || download.fallbackKey;
  const object = await env.PAID_RELEASES.get(objectKey);
  if (!object) {
    return json({ error: "Paid installer is not available yet." }, { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${download.filename}"`,
      "Content-Length": String(object.size),
      "Content-Type": object.httpMetadata?.contentType || download.contentType
    }
  });
}
