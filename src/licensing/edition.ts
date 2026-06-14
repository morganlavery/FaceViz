export type AppEdition = "demo" | "paid";

const rawEdition = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env?.VITE_INFINIGHT_EDITION;

export const appEdition: AppEdition = rawEdition === "paid" ? "paid" : "demo";

export const isDemoEdition = appEdition === "demo";

export const demoWatermarkLabel = "INFINIGHTCapture Demo - infinightcapture.com";
