const DEFAULT_RELEASE_REPO = "morganlavery/INFINIGHTCapture";
const DEFAULT_RELEASE_TAG = "v0.1.0";

const DOWNLOADS = {
  mac: {
    envUrl: "DEMO_MAC_DOWNLOAD_URL",
    assetName: "DEMO_MAC_ASSET_NAME",
    fallbackUrl:
      "https://github.com/morganlavery/INFINIGHTCapture/releases/download/v0.1.0/INFINIGHTCapture-Demo-0.1.0-mac-arm64.dmg"
  },
  windows: {
    envUrl: "DEMO_WINDOWS_DOWNLOAD_URL",
    assetName: "DEMO_WINDOWS_ASSET_NAME",
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

function releaseAssetUrl(env, assetName) {
  const repo = env.DEMO_RELEASE_REPO || DEFAULT_RELEASE_REPO;
  const tag = env.DEMO_RELEASE_TAG || DEFAULT_RELEASE_TAG;
  return `https://github.com/${repo}/releases/download/${tag}/${assetName}`;
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

  const configuredAssetName = download.assetName ? env[download.assetName] : "";
  if (configuredAssetName) {
    return Response.redirect(releaseAssetUrl(env, configuredAssetName), 302);
  }

  if (download.fallbackUrl) {
    return Response.redirect(download.fallbackUrl, 302);
  }

  return Response.redirect(releasePageUrl(env), 302);
}

export const onRequestGet = handleDownload;
export const onRequestHead = handleDownload;
