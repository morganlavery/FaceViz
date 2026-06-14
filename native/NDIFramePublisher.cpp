// Cross-platform NDI frame publisher for INFINIGHTCapture.
// Reads the same length-prefixed RGBA packets used by the Syphon and Spout helpers.

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <fcntl.h>
#include <io.h>
#endif

#include <Processing.NDI.Lib.h>

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#define INFINIGHTCAPTURE_RAW_FRAME_MAGIC 0x46565A31U

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
  const char *configuredName = std::getenv("INFINIGHTCAPTURE_NDI_NAME");
  if (configuredName && configuredName[0] != '\0') {
    return configuredName;
  }
  return "INFINIGHTCapture Output";
}

int main() {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stderr), _O_BINARY);
#endif

  if (!NDIlib_initialize()) {
    std::fprintf(stderr, "INFINIGHTCapture NDI: failed to initialize NDI runtime\n");
    return 1;
  }

  const std::string outputName = getOutputName();
  NDIlib_send_create_t createDescription;
  std::memset(&createDescription, 0, sizeof(createDescription));
  createDescription.p_ndi_name = outputName.c_str();

  NDIlib_send_instance_t sender = NDIlib_send_create(&createDescription);
  if (!sender) {
    std::fprintf(stderr, "INFINIGHTCapture NDI: failed to create sender\n");
    NDIlib_destroy();
    return 1;
  }

  std::fprintf(stderr, "INFINIGHTCapture NDI: publishing as \"%s\"\n", outputName.c_str());

  uint64_t publishedFrames = 0;
  auto lastReport = std::chrono::steady_clock::now();
  int lastWidth = 0;
  int lastHeight = 0;

  while (true) {
    uint8_t lengthBytes[4] = {0, 0, 0, 0};
    if (!readFully(lengthBytes, sizeof(lengthBytes))) {
      break;
    }

    const uint32_t length = readBigEndian32(lengthBytes);
    if (length < 16 || length > 25U * 1024U * 1024U) {
      std::fprintf(stderr, "INFINIGHTCapture NDI: invalid frame length %u\n", length);
      break;
    }

    std::vector<uint8_t> frame(length);
    if (!readFully(frame.data(), frame.size())) {
      break;
    }

    const uint32_t magic = readBigEndian32(frame.data());
    if (magic != INFINIGHTCAPTURE_RAW_FRAME_MAGIC) {
      std::fprintf(stderr, "INFINIGHTCapture NDI: unsupported encoded frame packet\n");
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
          "INFINIGHTCapture NDI: invalid raw frame %ux%u bytes=%u packet=%zu\n",
          width,
          height,
          pixelLength,
          frame.size());
      continue;
    }

    NDIlib_video_frame_v2_t videoFrame;
    std::memset(&videoFrame, 0, sizeof(videoFrame));
    videoFrame.xres = static_cast<int>(width);
    videoFrame.yres = static_cast<int>(height);
    videoFrame.FourCC = NDIlib_FourCC_type_RGBA;
    videoFrame.frame_rate_N = 60000;
    videoFrame.frame_rate_D = 1000;
    videoFrame.picture_aspect_ratio = static_cast<float>(width) / static_cast<float>(height);
    videoFrame.frame_format_type = NDIlib_frame_format_type_progressive;
    videoFrame.timecode = NDIlib_send_timecode_synthesize;
    videoFrame.p_data = frame.data() + 16;
    videoFrame.line_stride_in_bytes = static_cast<int>(width * 4U);

    NDIlib_send_send_video_v2(sender, &videoFrame);

    publishedFrames += 1;
    if (static_cast<int>(width) != lastWidth || static_cast<int>(height) != lastHeight) {
      lastWidth = static_cast<int>(width);
      lastHeight = static_cast<int>(height);
      std::fprintf(stderr, "INFINIGHTCapture NDI: size=%ux%u\n", width, height);
    }

    const auto now = std::chrono::steady_clock::now();
    const std::chrono::duration<double> elapsed = now - lastReport;
    if (elapsed.count() >= 2.0) {
      const double fps = static_cast<double>(publishedFrames) / elapsed.count();
      std::fprintf(stderr, "INFINIGHTCapture NDI: published-frame fps=%.1f size=%ux%u\n", fps, width, height);
      publishedFrames = 0;
      lastReport = now;
    }
  }

  std::fprintf(stderr, "INFINIGHTCapture NDI: input closed\n");
  NDIlib_send_destroy(sender);
  NDIlib_destroy();
  return 0;
}
