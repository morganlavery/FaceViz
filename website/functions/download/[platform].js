const DEFAULT_RELEASE_REPO = "morganlavery/INFINIGHTCapture";
const DEFAULT_RELEASE_TAG = "v0.1.0";

const DOWNLOADS = {
  mac: {
    envUrl: "DEMO_MAC_DOWNLOAD_URL",
    fallbackUrl:
      "https://github.com/morganlavery/INFINIGHTCapture/releases/download/v0.1.0/INFINIGHTCapture-0.1.0-arm64.dmg"
  },
  windows: {
    envUrl: "DEMO_WINDOWS_DOWNLOAD_URL",
    fallbackUrl: null
  }
};

function text(message, init = {}) {
  return new Response(message, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      ...(init.headers || {})
    },
    status: init.status || 200
  });
}

function releasePageUrl(env) {
  const repo = env.DEMO_RELEASE_REPO || DEFAULT_RELEASE_REPO;
  const tag = env.DEMO_RELEASE_TAG || DEFAULT_RELEASE_TAG;
  return `https://github.com/${repo}/releases/tag/${tag}`;
}

async function handleDownload({ env, params }) {
  const download = DOWNLOADS[params.platform];
  if (!download) {
    return text("Unknown download platform.", { status: 404 });
  }

  const configuredUrl = env[download.envUrl];
  if (configuredUrl) {
    return Response.redirect(configuredUrl, 302);
  }

  if (download.fallbackUrl) {
    return Response.redirect(download.fallbackUrl, 302);
  }

  return Response.redirect(releasePageUrl(env), 302);
}

export const onRequestGet = handleDownload;
export const onRequestHead = handleDownload;
