export type OutputTarget = "syphon" | "spout";

export type OutputStatus = {
  target: OutputTarget;
  available: boolean;
  label: string;
  detail: string;
};

const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
const isWindows = /Win/i.test(navigator.platform);

export const getOutputStatuses = (): OutputStatus[] => [
  {
    target: "syphon",
    available: isMac,
    label: "Syphon",
    detail: isMac ? "Native sender scaffold ready" : "Available in macOS builds"
  },
  {
    target: "spout",
    available: isWindows,
    label: "Spout",
    detail: isWindows ? "Native sender scaffold ready" : "Available in Windows builds"
  }
];

export const getPreferredOutput = (): OutputTarget => (isWindows ? "spout" : "syphon");
