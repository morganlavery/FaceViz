const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const buildDir = path.join(rootDir, "native", "build");
const sourcePath = path.join(rootDir, "native", "NDIFramePublisher.cpp");
const isWindows = process.platform === "win32";
const outputPath = path.join(buildDir, isWindows ? "NDIFramePublisher.exe" : "NDIFramePublisher");

const env = process.env;
const sdkDir = env.NDI_SDK_DIR || env.NDI_SDK_PATH || "";

const firstExisting = (candidates) => candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";

const includeDir = firstExisting([
  env.NDI_INCLUDE_DIR,
  path.join(sdkDir, "include"),
  path.join(sdkDir, "Include")
]);

const runtimeName = isWindows ? "Processing.NDI.Lib.x64.dll" : process.platform === "darwin" ? "libndi.dylib" : "libndi.so";
const libraryName = isWindows ? "Processing.NDI.Lib.x64.lib" : process.platform === "darwin" ? "libndi.dylib" : "libndi.so";
const libraryPath = firstExisting([
  env.NDI_LIBRARY_PATH,
  path.join(sdkDir, "lib", libraryName),
  path.join(sdkDir, "lib", process.platform === "darwin" ? "macOS" : "x86_64-linux-gnu", libraryName),
  path.join(sdkDir, "Lib", "x64", libraryName),
  path.join(sdkDir, "lib", "x64", libraryName)
]);
const runtimePath = firstExisting([
  env.NDI_RUNTIME_LIBRARY,
  env.NDI_DLL_PATH,
  libraryPath.endsWith(runtimeName) ? libraryPath : "",
  path.join(path.dirname(libraryPath || "."), runtimeName)
]);

if (!includeDir) {
  throw new Error("NDI include directory not found. Set NDI_SDK_DIR or NDI_INCLUDE_DIR.");
}

if (!libraryPath) {
  throw new Error("NDI library not found. Set NDI_SDK_DIR or NDI_LIBRARY_PATH.");
}

fs.mkdirSync(buildDir, { recursive: true });

if (isWindows) {
  const cl = firstExisting((env.PATH || "").split(path.delimiter).map((entry) => path.join(entry, "cl.exe")));
  if (!cl) {
    throw new Error("cl.exe was not found. Run this from a Visual Studio Developer PowerShell or Developer Command Prompt.");
  }

  execFileSync(
    cl,
    ["/nologo", "/std:c++17", "/EHsc", "/O2", "/MT", "/W3", `/I${includeDir}`, `/Fe:${outputPath}`, sourcePath, libraryPath],
    { stdio: "inherit" }
  );
} else {
  const compiler = env.CXX || "c++";
  execFileSync(
    compiler,
    ["-std=c++17", "-O2", "-Wall", "-Wextra", `-I${includeDir}`, sourcePath, libraryPath, "-o", outputPath],
    { stdio: "inherit" }
  );
  fs.chmodSync(outputPath, 0o755);
}

if (runtimePath) {
  fs.copyFileSync(runtimePath, path.join(buildDir, runtimeName));
}

console.log(`Built ${outputPath}`);
if (runtimePath) {
  console.log(`Copied ${runtimePath} to ${path.join(buildDir, runtimeName)}`);
}
