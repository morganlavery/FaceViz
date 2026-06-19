// Windows Spout frame publisher for INFINIGHTCapture.
// Reads the same length-prefixed RGBA packets used by the macOS Syphon helper.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <fcntl.h>
#include <io.h>

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#define INFINIGHTCAPTURE_RAW_FRAME_MAGIC 0x46565A31U
#define GL_RGBA 0x1908

typedef unsigned int GLuint;
typedef unsigned int GLenum;

struct SPOUTLIBRARY {
  virtual void SetSenderName(const char *sendername = nullptr) = 0;
  virtual void SetSenderFormat(DWORD dwFormat) = 0;
  virtual void ReleaseSender(DWORD dwMsec = 0) = 0;
  virtual bool SendFbo(GLuint FboID, unsigned int width, unsigned int height, bool bInvert = true) = 0;
  virtual bool SendTexture(
      GLuint TextureID,
      GLuint TextureTarget,
      unsigned int width,
      unsigned int height,
      bool bInvert = true,
      GLuint HostFBO = 0) = 0;
  virtual bool SendImage(
      const unsigned char *pixels,
      unsigned int width,
      unsigned int height,
      GLenum glFormat = GL_RGBA,
      bool bInvert = false) = 0;
  virtual bool IsInitialized() = 0;
  virtual const char *GetName() = 0;
  virtual unsigned int GetWidth() = 0;
  virtual unsigned int GetHeight() = 0;
  virtual double GetFps() = 0;
  virtual long GetFrame() = 0;
  virtual HANDLE GetHandle() = 0;
  virtual bool GetCPU() = 0;
  virtual bool GetGLDX() = 0;
};

typedef SPOUTLIBRARY *(WINAPI *GetSpoutProc)(void);

static uint32_t readBigEndian32(const uint8_t *bytes) {
  return (static_cast<uint32_t>(bytes[0]) << 24) |
         (static_cast<uint32_t>(bytes[1]) << 16) |
         (static_cast<uint32_t>(bytes[2]) << 8) |
         static_cast<uint32_t>(bytes[3]);
}

static bool readFully(void *buffer, size_t length) {
  uint8_t *cursor = static_cast<uint8_t *>(buffer);
  size_t remaining = length;
  while (remaining > 0) {
    const size_t read = std::fread(cursor, 1, remaining, stdin);
    if (read == 0) {
      return false;
    }
    cursor += read;
    remaining -= read;
  }
  return true;
}

static std::string getOutputName() {
  const char *configuredName = std::getenv("INFINIGHTCAPTURE_SPOUT_NAME");
  if (configuredName && configuredName[0] != '\0') {
    return configuredName;
  }
  return "INFINIGHTCapture Output";
}

static bool shouldInvert() {
  const char *configured = std::getenv("INFINIGHTCAPTURE_SPOUT_INVERT");
  return configured && std::strcmp(configured, "1") == 0;
}

int main() {
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stderr), _O_BINARY);

  HMODULE spoutDll = LoadLibraryW(L"SpoutLibrary.dll");
  if (!spoutDll) {
    std::fprintf(stderr, "INFINIGHTCapture Spout: failed to load SpoutLibrary.dll error=%lu\n", GetLastError());
    return 1;
  }

  GetSpoutProc getSpout = reinterpret_cast<GetSpoutProc>(GetProcAddress(spoutDll, "GetSpout"));
  if (!getSpout) {
    std::fprintf(stderr, "INFINIGHTCapture Spout: failed to resolve GetSpout error=%lu\n", GetLastError());
    FreeLibrary(spoutDll);
    return 1;
  }

  SPOUTLIBRARY *spout = getSpout();
  if (!spout) {
    std::fprintf(stderr, "INFINIGHTCapture Spout: GetSpout returned null\n");
    FreeLibrary(spoutDll);
    return 1;
  }

  const std::string outputName = getOutputName();
  const bool invert = shouldInvert();
  spout->SetSenderName(outputName.c_str());
  std::fprintf(stderr, "INFINIGHTCapture Spout: publishing as \"%s\"\n", outputName.c_str());

  uint64_t publishedFrames = 0;
  auto lastReport = std::chrono::steady_clock::now();
  unsigned int lastWidth = 0;
  unsigned int lastHeight = 0;

  while (true) {
    uint8_t lengthBytes[4] = {0, 0, 0, 0};
    if (!readFully(lengthBytes, sizeof(lengthBytes))) {
      break;
    }

    const uint32_t length = readBigEndian32(lengthBytes);
    if (length < 16 || length > 25U * 1024U * 1024U) {
      std::fprintf(stderr, "INFINIGHTCapture Spout: invalid frame length %u\n", length);
      break;
    }

    std::vector<uint8_t> frame(length);
    if (!readFully(frame.data(), frame.size())) {
      break;
    }

    const uint32_t magic = readBigEndian32(frame.data());
    if (magic != INFINIGHTCAPTURE_RAW_FRAME_MAGIC) {
      std::fprintf(stderr, "INFINIGHTCapture Spout: unsupported encoded frame packet\n");
      continue;
    }

    const uint32_t width = readBigEndian32(frame.data() + 4);
    const uint32_t height = readBigEndian32(frame.data() + 8);
    const uint32_t pixelLength = readBigEndian32(frame.data() + 12);
    const size_t expectedLength = 16U + static_cast<size_t>(pixelLength);
    const size_t expectedPixels = static_cast<size_t>(width) * static_cast<size_t>(height) * 4U;
    if (width == 0 || height == 0 || expectedLength != frame.size() || expectedPixels != pixelLength) {
      std::fprintf(
          stderr,
          "INFINIGHTCapture Spout: invalid raw frame %ux%u bytes=%u packet=%zu\n",
          width,
          height,
          pixelLength,
          frame.size());
      continue;
    }

    if (!spout->SendImage(frame.data() + 16, width, height, GL_RGBA, invert)) {
      std::fprintf(stderr, "INFINIGHTCapture Spout: SendImage failed for %ux%u\n", width, height);
      continue;
    }

    publishedFrames += 1;
    if (width != lastWidth || height != lastHeight) {
      lastWidth = width;
      lastHeight = height;
      std::fprintf(stderr, "INFINIGHTCapture Spout: size=%ux%u\n", width, height);
    }

    const auto now = std::chrono::steady_clock::now();
    const std::chrono::duration<double> elapsed = now - lastReport;
    if (elapsed.count() >= 2.0) {
      const double fps = static_cast<double>(publishedFrames) / elapsed.count();
      std::fprintf(stderr, "INFINIGHTCapture Spout: published-frame fps=%.1f size=%ux%u\n", fps, width, height);
      publishedFrames = 0;
      lastReport = now;
    }
  }

  std::fprintf(stderr, "INFINIGHTCapture Spout: input closed\n");
  spout->ReleaseSender();
  FreeLibrary(spoutDll);
  return 0;
}
