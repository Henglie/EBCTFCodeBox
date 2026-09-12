/*
 * edu-bridge-new.en.js — English edu shard for the local-bridge / exe bridging ops (pure data, no side effects).
 *
 * Covers 15 bridging ops that "call a local exe / launch a local GUI". These ops are essentially wrappers around external tools:
 * - GUI type (*Launch): only call the bridge /api/launch to spin up a local exe; the user operates manually in the pop-up window.
 *   The toolbox does not feed input or fetch results on your behalf.
 * - CLI type (*Bridge / *Exe): call the bridge /api/run for unattended execution, with files passed in via {placeholder}.
 * Common prerequisites: Windows only, and you must first run python bridge.py locally (listening on localhost:8181).
 * When the bridge isn't running / it's not Windows, the op returns a friendly notice instead of throwing. Zero outbound traffic (connects to localhost only).
 *
 * This file only exports data; it's wired up by the master controller eduContent.js, with no import / register.
 */
export default {
 // ============================================================
 // GUI launchers (bridgeStego)
 // ============================================================
  watermarkhLaunch: {
    what: "A button that launches the local watermarkH image-watermark steganography tool (a 52pojie release).",
    principle:
      "watermarkH is a Chinese GUI steganography tool that hides text/images as a watermark inside a carrier image, or extracts watermarks from an image; " +
      "it circulates on the 52pojie (Kanxue/wuaipojie) forum and is common in CTF image-misc challenges.\n\n" +
      "This op does no image processing: it only spins up the local watermarkH.exe via the local bridge's /api/launch endpoint, " +
      "and the actual hide/extract operations all happen manually in the pop-up program window.",
    usage:
      "Windows only. First run python bridge.py locally (listening on localhost:8181), refresh this page, then click this feature to launch the watermarkH window. " +
      "This is a pure GUI launcher: the toolbox does not receive input or return results — do all steganography operations manually in the pop-up watermarkH window.",
    examples: [
      {
        in: "（no input, just click）",
        out: "● Launched local exe: watermarkH · watermark\nPath: ...\nPlease operate manually in the pop-up program window.",
        desc: "After clicking, the bridge spins up watermarkH.exe; everything else is done in the native window.",
      },
    ],
    tips: [
      "When you get a suspicious image, try it first to check for a hidden watermark — many Chinese misc challenges rely on it.",
      "If the bridge isn't running it returns \"local bridge not ready\"; first confirm python bridge.py is running and that you're on Windows.",
    ],
    aka: [
      "watermarkH", "watermark", "图像水印", "图片水印", "水印隐写", "吾爱破解", "52pojie",
      "图片隐写", "watermarkH.exe", "image watermark", "steganography", "misc 隐写",
    ],
  },

  jphswinLaunch: {
    what: "Launches the local JPHS for Windows (jphide/jpseek) to hide data in a JPEG or extract it.",
    principle:
      "JPHS = JP Hide and Seek, written by Allan Latham. jphide embeds data into a JPEG's DCT coefficients, " +
      "jpseek extracts it in reverse; both are the classic password-protected JPEG steganography pair. JPHSwin is its Windows GUI version.\n\n" +
      "This op only calls the bridge's /api/launch to spin up JPHSwin.exe; you do the hide/extract by clicking in the window.",
    usage:
      "Windows only, requires python bridge.py running first. After clicking to launch the JPHSwin window, do Open jpeg → Hide/Seek in it, " +
      "entering the password manually. A pure GUI launcher — the toolbox doesn't feed input or fetch results on your behalf.",
    examples: [
      {
        in: "（no input, just click）",
        out: "● Launched local exe: JPHS · JPEG steganography\nPath: ...\nPlease operate manually in the pop-up window.",
        desc: "Spins up JPHSwin; do jphide/jpseek in the native window.",
      },
    ],
    tips: [
      "When stegdetect reports jphide(*), use JPHS's jpseek with the password to extract.",
      "jphide only eats JPEG; other formats won't work.",
    ],
    aka: [
      "JPHS", "JPHSwin", "jphide", "jpseek", "JP Hide and Seek", "JPEG 隐写",
      "DCT 隐写", "Allan Latham", "JPHS for Windows", "图像隐写", "jphide and seek", "misc",
    ],
  },

  openpuffLaunch: {
    what: "Launches the local OpenPuff multi-carrier steganography tool (image/audio/video/PDF/flash, etc.), with multi-layer passwords.",
    principle:
      "OpenPuff is Cosimo Oliboni's free professional-grade steganography tool that can scatter data across many carriers (BMP/JPG/PNG/MP3/WAV/" +
      "MP4/PDF/SWF, etc.), supporting three-layer passwords, deduplication, decoys, and other advanced features, with fairly strong anti-detection.\n\n" +
      "This op only calls the bridge's /api/launch to spin up OpenPuff.exe; do the hide/extract manually in the window.",
    usage:
      "Windows only, requires python bridge.py running first. After clicking to launch the OpenPuff window, do Hide/Unhide, pick carriers, and fill in the three-layer passwords manually. " +
      "A pure GUI launcher — the toolbox doesn't feed input or fetch results on your behalf.",
    examples: [
      {
        in: "（no input, just click）",
        out: "● Launched local exe: OpenPuff · multi-carrier\nPath: ...\nPlease operate manually in the pop-up window.",
        desc: "Spins up OpenPuff; multi-carrier steganography is done in the native window.",
      },
    ],
    tips: [
      "When a challenge gives multiple files of the same type + hints at multi-layer passwords, suspect OpenPuff first.",
      "All three password layers must be correct to extract, none can be missing; note the carrier order may also be part of the key.",
    ],
    aka: [
      "OpenPuff", "openpuff", "多载体隐写", "Cosimo Oliboni", "carrier chain",
      "多层密码", "steganography", "隐写", "decoy", "OpenPuff.exe", "professional steganography", "misc 隐写",
    ],
  },

  oursecretLaunch: {
    what: "Launches the local OurSecret GUI steganography tool (proprietary format, cannot be replicated purely in the frontend).",
    principle:
      "OurSecret (sometimes written Our Secret) is a GUI steganography tool that password-encrypts a file/text then hides it inside an image or sound file, " +
      "using a proprietary embedding format; in CTF, if a .ourse file is given or OurSecret is hinted, use it to extract.\n\n" +
      "This op only calls the bridge's /api/launch to spin up OurSecret.exe; do the hide/extract manually in the window.",
    usage:
      "Windows only, requires python bridge.py running first. After clicking to launch the OurSecret window, pick the carrier, enter the password, and do Hide/Unhide manually. " +
      "A pure GUI launcher — the toolbox doesn't feed input or fetch results on your behalf; because the format is proprietary it can't be replaced by other tools.",
    examples: [
      {
        in: "（no input, just click）",
        out: "● Launched local exe: OurSecret · steganography\nPath: ...\nPlease operate manually in the pop-up window.",
        desc: "Spins up OurSecret; do proprietary-format extraction in the native window.",
      },
    ],
    tips: [
      "When a challenge explicitly names OurSecret, or the carrier tests negative on every other steganography tool, try it.",
      "The password is often hidden in the challenge description / image exif / an attachment — try each one.",
    ],
    aka: [
      "OurSecret", "Our Secret", "oursecret", "我们的秘密", "私有格式隐写", "图片隐写", "音频隐写",
      "密码隐写", "steganography", "隐写工具", "OurSecret.exe", "hide data", "misc",
    ],
  },};
