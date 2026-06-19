import fs from "node:fs";
import path from "node:path";

const [edition, platform] = process.argv.slice(2);

if (!["demo", "paid"].includes(edition) || !["mac", "win"].includes(platform)) {
  console.error("Usage: node scripts/rename-edition-artifacts.mjs <demo|paid> <mac|win>");
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const releaseDir = path.resolve("release");
const version = packageJson.version;
const suffix = edition === "demo" ? "Demo" : "Paid";

const renames =
  platform === "mac"
    ? [
        [
          `INFINIGHTCapture-${version}-mac-arm64.dmg`,
          `INFINIGHTCapture-${suffix}-${version}-mac-arm64.dmg`
        ],
        [
          `INFINIGHTCapture-${version}-mac-arm64.dmg.blockmap`,
          `INFINIGHTCapture-${suffix}-${version}-mac-arm64.dmg.blockmap`
        ]
      ]
    : [
        [
          `INFINIGHTCapture-Setup-${version}-win-x64.exe`,
          `INFINIGHTCapture-${suffix}-Setup-${version}-win-x64.exe`
        ],
        [
          `INFINIGHTCapture-Setup-${version}-win-x64.exe.blockmap`,
          `INFINIGHTCapture-${suffix}-Setup-${version}-win-x64.exe.blockmap`
        ]
      ];

let renamed = 0;
for (const [fromName, toName] of renames) {
  const fromPath = path.join(releaseDir, fromName);
  const toPath = path.join(releaseDir, toName);
  if (!fs.existsSync(fromPath)) continue;
  fs.renameSync(fromPath, toPath);
  renamed += 1;
  console.log(`Renamed ${fromName} -> ${toName}`);
}

if (renamed === 0) {
  console.error(`No ${platform} artifacts were found to rename for ${edition}.`);
  process.exit(1);
}
