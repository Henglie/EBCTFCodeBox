<p align="center">
  <a href="./README.md">简体中文</a> · <b>English</b>
</p>

<p align="center">
  <img src="./public/icons/logo.png" width="120" height="120" alt="EternalBlaze CTF Codebox" />
</p>
<h1 align="center">
  <span>EternalBlaze CTF Codebox · EBCTFCodeBox</span>
</h1>
<p align="center">
  <span align="center">A local-first, zero-upload codec / cryptography / steganalysis toolbox: 810 registered operations across 23 categories, most running entirely in your browser; Windows can additionally enable local-bridge capabilities, while macOS / Linux ship with double-click launchers.</span>
</p>

<p align="center">
  <a href="https://github.com/Henglie/EBCTFCodeBox/stargazers"><img src="https://img.shields.io/github/stars/Henglie/EBCTFCodeBox?style=flat-square" alt="GitHub Repo stars" /></a>
  <a href="https://github.com/Henglie/EBCTFCodeBox/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Henglie/EBCTFCodeBox?style=flat-square" alt="GitHub License" /></a>
  <a href="https://github.com/Henglie/EBCTFCodeBox/releases"><img src="https://img.shields.io/github/v/release/Henglie/EBCTFCodeBox?style=flat-square" alt="GitHub Release" /></a>
</p>
<p align="center">
  <a href="https://github.com/Henglie/EBCTFCodeBox/issues"><img src="https://img.shields.io/github/issues/Henglie/EBCTFCodeBox?style=flat-square" alt="GitHub Issues" /></a>
  <a href="https://github.com/Henglie/EBCTFCodeBox/pulls"><img src="https://img.shields.io/github/issues-pr/Henglie/EBCTFCodeBox?style=flat-square" alt="GitHub Pull Requests" /></a>
  <a href="https://github.com/Henglie/EBCTFCodeBox/network/members"><img src="https://img.shields.io/github/forks/Henglie/EBCTFCodeBox?style=flat-square" alt="GitHub forks" /></a>
</p>

> [!WARNING]
> This tool is intended solely for CTF learning, competitions, and security research. Do not use it for anything illegal, for infringing on the rights of others, or for any purpose that could get you into trouble. You are responsible for all consequences of improper use.
> If you find a bug, an incorrect algorithm result, or missing documentation, feel free to open an Issue, ideally with a sample input, the expected output, and reproduction steps.

## Table of Contents

- [Quick Download](#quick-download)　　　　[Changelog](#changelog)
- [Introduction](#introduction)　　　　[Features](#features)
- [Screenshots](#screenshots)　　　　[Running](#running)
- [Platform Compatibility](#platform-compatibility)　　[Performance Requirements](#performance-requirements)
- [Directory Structure](#directory-structure)　　　　[Full Codec List](#full-codec-list-810-ops--23-categories)
- [Plugins & AI Access](#plugins--ai-access)　　[License](#license)
- [Third-party Resources & Licenses](#third-party-resources--licenses)　　[Privacy](#privacy)

## Quick Download

> Core processing runs locally with zero upload. Download, unzip, and double-click `通用点我启动.py` (the "double-click launcher") to start — requires Python 3 on your machine. Windows can enable the local bridge; macOS / Linux automatically skip bridge-only capabilities.

| Cloud drive | Link | Passcode |
|---|---|---|
| Baidu Netdisk | https://pan.baidu.com/s/1Uqq_ONMBG9qA0dJvUG53Og?pwd=0000 | 0000 |
| Quark | https://pan.quark.cn/s/3b7e573b19c0 | none |

Current version **v0.1.10**. The source of truth is always the GitHub repository: [github.com/Henglie/EBCTFCodeBox](https://github.com/Henglie/EBCTFCodeBox).

## Changelog

## v0.1.10

### New

- Rabbit gains three variants
- Rabbit passphrase mode and cracking

### Fixed

- Rabbit interop with other tools fixed
- Stale counts in docs fixed

### Improvements

- One-shot attack covers all Rabbit variants
- MCP resource docs completed
- MCP protocol version negotiation
- Load-time diagnostics silent by default

## Introduction

`EternalBlaze CTF Codebox` (EBCTFCodeBox) is a local-first toolbox built around CTF scenarios but aimed at general-purpose encoding/decoding and cryptography needs.

It gathers encoding, classical ciphers, modern cryptography, hash verification, radix conversion, cryptanalysis / brute force, steganography, and image tooling into a single page. Core computation happens locally in the browser — your input is never uploaded; Windows can optionally enable a local bridge. The goal is to serve competition solving, cryptography learning, and everyday toolbox needs alike.

Core design:

- Native ES modules, no framework, no build step
- High-performance algorithms compiled to WASM from C / emscripten
- Material 3 warm-red theme, light / dark modes
- Bundled Cheonhyeong full-font library — rare glyphs render everywhere
- 20 languages

---

## Features

- **Local-first · zero upload**: Native ES modules, no framework, no build step. Core codecs run in-browser and never upload your input; "external link" ops only generate URLs. PWA updates fetch site assets only, the local bridge only talks to `127.0.0.1`, and external AI is only used after you configure an endpoint yourself.
- **One-shot smart decoding**: Paste or drop content; it detects possible encoding chains and returns ranked decode candidates, with crib-based filtering and deep brute force.
- **810 registered operations · 23 categories**: covering Base, text / transfer encodings, fancy CTF encodings, esoteric programming languages, Chinese / domestic encodings, classical ciphers, modern crypto (block / stream / asymmetric / other), hashes & checksums, radix & charsets (incl. primality testing and sieving), analysis / brute force, password attacks, compression & archives, password / archive cracking, forensics & traffic, file-format structures, data structures, images & QR codes, audio & video, steganography, plus 4 optional Windows GUI bridge entries. The complete list is generated automatically from the registry.
- **Decoding-strength quartet** (v0.1.2): strength levels + custom algorithm pool + a **separate brute-force channel** (XOR / Caesar / dictionary / rainbow-table / HMAC / PBE / Playfair / ZIP / CRC32 / bkcrack — results are grouped separately so they don't pollute the main ranking) + **decode depth 1–3**.
- **Lenient matching mode** (v0.1.2): at the Enhanced / Very Strong / Maximum / Custom levels, algorithms are admitted by character-class count alone, so variant-encoding challenges (a "meow" table for 0/1, emoji-as-binary) also participate; Default / Fast keep strict domain detection.
- **Key + ciphertext one-shot attack**: given ciphertext and a key, automatically enumerates AES / DES / 3DES / RC4 / XOR / Fernet × cipher modes × encoding combinations.
- **Drag-in file analysis**: dropping a file auto-detects its type, appended data, anomalous image dimensions, and more.
- **Full Unicode display**: bundled Cheonhyeong full-font library, loaded per Unicode plane on demand — rare characters, ancient scripts, and emoji all render correctly.
- **Material 3 warm-red theme**, light / dark toggle, 20 languages.

> For the full feature walkthrough and scenario demos, see [`介绍文章.md`](./介绍文章.md) (Chinese).

## Screenshots

<p align="center">
  <img src="介绍图片/一把梭界面.png" alt="One-shot smart decoding" width="80%" />
</p>

<p align="center"><i>One-shot smart decoding: paste text and get ranked decode chains automatically</i></p>

<p align="center">
  <img src="介绍图片/解析文件演示.gif" alt="File analysis demo" width="80%" />
</p>

<p align="center"><i>Drop a file to auto-detect its type and strip appended data</i></p>

<p align="center">
  <img src="介绍图片/配方链演示.gif" alt="Recipe chain demo" width="80%" />
</p>

<p align="center"><i>Recipe chains: wire multiple algorithms into a visual pipeline</i></p>

<table>
  <tr>
    <td><img src="介绍图片/编码图片.png" alt="Encoding chart gallery" /></td>
    <td><img src="介绍图片/Edu演示.png" alt="Crypto explainer card" /></td>
  </tr>
  <tr>
    <td align="center"><i>Encoding chart gallery · 253 reference tables</i></td>
    <td align="center"><i>Every algorithm ships with an edu explainer card</i></td>
  </tr>
  <tr>
    <td><img src="介绍图片/关于页面-白.png" alt="Light theme" /></td>
    <td><img src="介绍图片/关于页面-暗.png" alt="Dark theme" /></td>
  </tr>
  <tr>
    <td align="center"><i>Light theme</i></td>
    <td align="center"><i>Dark theme (Material 3 day/night)</i></td>
  </tr>
</table>

## Running

Pure static — any static server works. The bundled script is recommended (double-click or command line):

```bash
py 通用点我启动.py     # Windows (use py, not python3)
python3 通用点我启动.py # macOS / Linux
```

The script starts the static server and the local bridge (bridge.py, fixed port 8181, real capabilities on Windows only) together, then opens your default browser. The bridge runs in a background thread of the same process — no second window.

### Double-click launch on Linux / macOS

Equivalent to the "double-click the exe" flow on Windows. Only the **double-click entry points** live in the root; the binary cores are tucked into `bin/` (so they don't get clicked by mistake):

| File | Platform | How to use |
|---|---|---|
| `Windows点我启动.exe` | Windows | **Double-click** (32-bit single file, works on 64-bit and ARM64 Windows) |
| `macOS点我启动.command` | macOS | **Double-click** in Finder → Terminal opens and the control panel runs |
| `Linux点我启动.sh` | Linux | KDE (Dolphin): **double-click**; GNOME (Nautilus): right-click → Run (or tick "Allow executing as program" in Properties, then double-click) |
| `bin/macOS启动器` | macOS | universal2 single file (Apple Silicon + Intel), invoked by the .command above — no need to click directly |
| `bin/Linux启动器` | Linux | x86_64 ELF, invoked by the .sh above — no need to click directly |

- macOS uses `.command` because Finder won't open a terminal for a bare binary; Linux desktop environments disagree on double-click behaviour for raw binaries, so `.sh` + the executable bit is the portable choice.
- **First use**: if double-clicking does nothing after unzipping, grant the executable bit once (`chmod +x macOS点我启动.command bin/macOS启动器 Linux点我启动.sh bin/Linux启动器`). The launchers are unsigned — if Gatekeeper blocks the first open on macOS, click "Open Anyway" in System Settings → Privacy & Security, or right-click → Open.
- **Feature parity with Windows**: same C source; the control panel is 1 restart service / 2 free the occupied port / 3 local-bridge settings / 4 open browser / 5 refresh status / 0 exit (keyboard-driven line menu on Linux/macOS — no mouse hover highlighting, a terminal capability difference); local bridge, MCP, pyc decompile, and environment probing all work. Windows-only GUI tool launching and system accent colour degrade gracefully with a notice on these platforms. Both artifacts have passed static acceptance (architecture / linked dependencies / branch fingerprints / endpoint strings); real-machine acceptance is ongoing.

Or point any static server at the project root. There is no build step: edit and refresh.

### Deploying without Python

The project is pure static assets and can be hosted by any HTTP server (ES modules require an http(s) context — you cannot just double-click `index.html` over file://). Without Python, or if you would rather not use the launcher, pick one:

```bash
npx serve .                    # Node.js (pick any port)
python3 -m http.server 8180    # Python 3 installed, but not using the launcher
php -S localhost:8180          # PHP built-in server
```

Full web servers (nginx / Apache / Caddy, …) work too; two caveats:

1. `.wasm` must be served as `application/wasm`, otherwise the browser refuses streaming compilation.
2. Multithreaded WASM (e.g. bkcrack's pthread build) relies on `SharedArrayBuffer` and requires cross-origin isolation headers:

   ```
   Cross-Origin-Opener-Policy: same-origin
   Cross-Origin-Embedder-Policy: require-corp
   ```

   The bundled `通用点我启动.py` sends both headers by default; self-hosted servers need their own configuration. When the headers are missing, multithreaded WASM ops degrade gracefully or report unavailable — pure frontend features are unaffected.

The PWA is fully wired (`manifest.json` + `sw.js`): after the first online visit it precaches 709 core runtime assets (version updates are fetched incrementally by checksum — only changed files are transferred), supports installing to the desktop, and runs core features fully offline. Large on-demand assets (the four Cheonhyeong font planes, WASM, IDS composition data, encoding charts, KaTeX) are cached on first use and then work offline as well. The "Check for updates" button in the top bar downloads the complete new version before asking you to refresh.

## Platform Compatibility

| Platform | Frontend features | Local bridge (exe tools) | Launch |
|---|---|---|---|
| Windows | Full (primary platform) | JPHS / OpenPuff / OurSecret (GUI launch) + pyc/exe local decompile + system accent colour sync | `py 通用点我启动.py` |
| macOS | Full | Unavailable (no .exe); the bridge is auto-skipped and related ops grey out with a notice | Double-click `macOS点我启动.command`, or `python3 通用点我启动.py` |
| Linux | Full | Same as macOS, bridge auto-skipped | Double-click `Linux点我启动.sh`, or `python3 通用点我启动.py` |
| ChromeOS | Full (via the Crostini Linux container) | Same as Linux | `python3 通用点我启动.py` (inside Crostini) |
| HarmonyOS / Android / iOS | Full (PWA, touch-responsive) | Unavailable (no exe on mobile) | Open the deployed URL in a browser; optionally "Add to Home Screen" |

Notes:

- "Local bridge" refers to `bridge.py` (port 8181, Windows only), providing GUI launching, pyc/exe decompile, system accent colour, and other on-device capabilities. When the bridge is unavailable, in-browser features still work; bridge-dependent entries degrade with a notice.
- Mobile / HarmonyOS works offline after installing as a PWA; large assets (fonts / WASM / charts) are cached on demand and fetched once online at first use.
- The bridge only listens on `127.0.0.1` and never sends anything out — the zero-upload rule holds.

### Browser Requirements

Requires a modern browser with ES modules, WebAssembly, Web Workers, Service Worker, Web Crypto API, and DecompressionStream:

- Chrome / Edge 90+
- Firefox 113+
- Safari 16.4+

## Performance Requirements

The project is a pure frontend application — regular computation happens in the browser, with no server-side compute dependency; the few Windows local-bridge capabilities are noted separately. Requirements and suggestions per dimension:

| Dimension | Minimum | Recommended | Notes |
|---|---|---|---|
| CPU | single core | 4 cores+ | Web Worker pool size = `min(8, navigator.hardwareConcurrency)`; more cores speed up brute force / chunked large-file work |
| Memory | 512 MB | 1 GB+ | Cheonhyeong fonts and WASM load on demand; large-file analysis grows linearly with file size |
| GPU | not needed | hardware acceleration on | No GPU compute; GPU-accelerated compositing improves scroll / animation smoothness |
| Disk | keep 100 MB+ free | same | Code, fonts, WASM, and charts grow with versions — refer to the actual release package |
| Network | connection needed for first load | stable connection | Input is never uploaded; core features work offline after PWA install |
| Architecture | x86 / x64 / ARM all fine | same | The browser abstracts the architecture; WASM runs across them |

Multithreaded WASM (`SharedArrayBuffer`) needs the cross-origin isolation headers (COOP/COEP); `通用点我启动.py` sends them by default, and without them multithreaded ops fall back to single-thread or report unavailable, without affecting anything else. First paint uses HTTP/1.1 keep-alive, an early ES module entry, and lazy font loading; the complete offline assets are installed by the Service Worker in the background after the page loads.

## Directory Structure

```
index.html          entry
src/
  main.js           UI driver (declarative rendering from the registry)
  core/             algorithm layer (pure functions; each module self-registers into the registry)
  ui/               styles + icons + font loading
  i18n/             20 language packs (static zh/en master + 18 dynamic shards, incl. RTL and four ethnic-language packs)
public/
  icons/            Material Symbols Rounded icons (SVG)
  fonts/th/         Cheonhyeong first-paint subset + 4 plane WOFF2 files
资料/               algorithm cross-check tables + research artifacts (dev-only; not shipped in release packages)
```

## Full Codec List (810 ops · 23 categories)

> This section is generated by `node tools/gen_readme_ops.mjs` from the real import closure of the main entry; opId is the unique registry identifier.

### Base (30 ops)

| opId | Name | Notes |
|---|---|---|
| base16 | Base16 / Hex |  |
| base32 | Base32 |  |
| base36 | Base36 |  |
| base45 | Base45 |  |
| base58 | Base58 |  |
| base62 | Base62 |  |
| base64 | Base64 |  |
| base85 | Base85 / Ascii85 |  |
| base91 | Base91 |  |
| base92 | Base92 |  |
| base100 | Base100 |  |
| radixN | Arbitrary radix |  |
| baseCustom | Custom-alphabet Base |  |
| base58check | Base58Check |  |
| radix64 | Radix64 (crypt) |  |
| base69 | Base69 |  |
| z85 | Z85 (ZeroMQ) |  |
| base85ipv6 | Base85 IPv6 |  |
| base2048 | Base2048 |  |
| base65536 | Base65536 |  |
| ecoji | Ecoji |  |
| base64steg | Base64 steganography |  |
| base32steg | Base32 steganography |  |
| base64dict | Caesar custom-dictionary Base64 |  |
| multilineBase64 | Multiline Base64 |  |
| base64decompress | Base64 + Zlib |  |
| modhex | Modhex (YubiKey) |  |
| citrixCtx1 | Citrix CTX1 |  |
| crockford32 | Crockford Base32 |  |
| dxBase64 | DXBase64 |  |

### Text / Transfer Encodings (39 ops)

| opId | Name | Notes |
|---|---|---|
| url | URL encoding |  |
| htmlEntity | HTML entities |  |
| unicodeEscape | Unicode escape |  |
| quotedPrintable | Quoted-Printable |  |
| uuencode | UUencode |  |
| xxencode | XXencode |  |
| jsfuck | JSFuck |  |
| utf7 | UTF-7 encoding |  |
| punycode | Punycode (IDN) |  |
| jsHex | JS hex escape |  |
| mixHexOctBin | Mixed-radix string decoding |  |
| hexReverse | Hex byte-wise reverse |  |
| leetSpeak | Leet Speak (1337) |  |
| netbios | NetBIOS encoding |  |
| caretMdecode | Caret / M control characters |  |
| natoAlphabet | NATO phonetic alphabet |  |
| asciiControl | ASCII control characters |  |
| gbCharset | GBK / GB2312 / GB18030 |  |
| gb2312QuWei | GB2312 quwei code |  |
| big5 | Big5 (Traditional Chinese) |  |
| shiftJis | Shift-JIS (Japanese) |  |
| eucKr | EUC-KR (Korean) |  |
| latinCharset | Latin / ISO-8859 / Windows single-byte |  |
| ebcdic | EBCDIC |  |
| utf16 | UTF-16 BE/LE |  |
| mojibakeFix | Mojibake repair |  |
| urlQueryParse | URL query parsing |  |
| cookieParse | Cookie parsing |  |
| httpBasicAuth | HTTP Basic auth |  |
| dataUriParse | Data URI parsing |  |
| magnetParse | Magnet link parsing |  |
| hexdump | Hexdump (xxd) conversion |  |
| fullwidth | Fullwidth cipher |  |
| bubblebabble | BubbleBabble |  |
| jsEscape | JS escape encoding |  |
| ppencode | ppencode |  |
| mimeMultipart | MIME multipart parsing |  |
| yenc | yEnc encode / decode |  |
| binhex | BinHex 4.0 encode / decode |  |

### Fancy / CTF Encodings (77 ops)

| opId | Name | Notes |
|---|---|---|
| morse | Morse code |  |
| bacon | Bacon's cipher |  |
| rot13 | ROT13 |  |
| rot5 | ROT5 |  |
| rot18 | ROT18 |  |
| rot47 | ROT47 |  |
| atbash | Atbash |  |
| a1z26 | A1Z26 |  |
| dna | DNA encoding |  |
| keyboard | Keyboard coordinates |  |
| ook | Ook! |  |
| cetacean | Cetacean (whale talk) |  |
| yygq | Roar cipher |  |
| braille | Braille |  |
| eightdiagram | I Ching 64 hexagrams |  |
| aaencode | Kaomoji aaencode |  |
| baudot | Baudot code |  |
| type7 | Cisco Type 7 |  |
| decabit | Decabit pulse code |  |
| txtmoji | txtmoji emoji encryption |  |
| keyCode | JS keyCode table |  |
| shiftKey | Shift-key symbols |  |
| keyword9 | T9 keypad |  |
| keyboardSurround | Keyboard surrounding keys |  |
| qweAbc | QWERTY→ABC |  |
| mirrorLetters | Mirrored letters |  |
| hieroglyphs | Hieroglyphs (MdC) |  |
| sga | Standard Galactic Alphabet |  |
| occult | Occult alphabets (4-in-1) |  |
| marineFlags | International maritime signal flags |  |
| americanMorse | American Morse |  |
| cnTelegraphMorse | Chinese telegraph code in Morse |  |
| tapCode | Tap code |  |
| semaphore | Semaphore flags |  |
| dtmf | DTMF (touch-tone) |  |
| morseRhythm | Morse rhythm normalisation |  |
| pigpen | Pigpen cipher |  |
| keyboardShift | Keyboard drift |  |
| layoutMap | Keyboard layout mapping |  |
| t9Phone | Phone keypad T9 |  |
| stenoLetter | Steno shorthand letters |  |
| arrowKey | Arrow-key encoding |  |
| manchester | Manchester encoding |  |
| diffManchester | Differential Manchester |  |
| nrzi | NRZI encoding |  |
| miller | Miller code |  |
| fourB5B | 4B5B encoding |  |
| pwmPpm | PWM/PPM pulse modulation |  |
| musicNotation | Music notation conversion |  |
| musicInfo | Musical note info |  |
| kenny | Kenny speak |  |
| alienAlphabet | Alien alphabet |  |
| futhark | Runes (Futhark) |  |
| chuckUnary | Chuck Norris unary |  |
| wingdings | Wingdings font symbols |  |
| fracmorse | FracMorse (fractional Morse) |  |
| qqxiuzi_arrow | Qianqian Xiuzi · Arrows |  |
| qqxiuzi_flower | Qianqian Xiuzi · Flowers |  |
| qqxiuzi_ipa | Qianqian Xiuzi · IPA |  |
| qqxiuzi_letter | Qianqian Xiuzi · Letters |  |
| qqxiuzi_braille | Qianqian Xiuzi · Braille |  |
| qqxiuzi_chinese | Qianqian Xiuzi · Chinese |  |
| qqxiuzi_music | Qianqian Xiuzi · Music |  |
| lolcode | LOLCODE |  |
| clockCipher | Clock cipher |  |
| rot8000 | ROT8000 |  |
| jjencode | JJEncode |  |
| spoon | Spoon |  |
| carbonaro | Carbonaro cipher |  |
| albam | Albam cipher |  |
| twinHex | Twin-Hex |  |
| trollScript | TrollScript |  |
| asciiSum | ASCII prefix-sum |  |
| wabun | Wabun Morse (Japanese) |  |
| astroSymbols | Astronomical / zodiac symbols |  |
| emojiAes | emoji-aes encryption |  |
| roar | Roar cipher (ao-wu-a variant) |  |

### Esoteric Languages (15 ops)

| opId | Name | Notes |
|---|---|---|
| brainfuck | Brainfuck |  |
| whitespace | Whitespace |  |
| malbolge | Malbolge (identify) |  |
| deadfish | Deadfish |  |
| befunge | Befunge-93 (execute) |  |
| emojicodeIdent | Emojicode (identify) |  |
| pietIdent | Piet (identify) |  |
| malbolgeExec | Malbolge (execute) |  |
| pietExec | Piet (execute) |  |
| blub | Blub! |  |
| cow | COW / MOO |  |
| brainlollerDecode | Brainloller decode |  |
| brainlollerEncode | Brainloller encode |  |
| braincopterDecode | Braincopter decode |  |
| braincopterEncode | Braincopter encode |  |

### Chinese / Domestic Encodings (20 ops)

| opId | Name | Notes |
|---|---|---|
| pawnshop | Pawnshop cipher |  |
| stemBranch | Heavenly Stems & Earthly Branches |  |
| baiJiaXing | Hundred Family Surnames |  |
| element | Periodic table |  |
| foyu | Foyu |  |
| shzyhxjzg | Socialist core values |  |
| makkaPakka | Makka Pakka |  |
| countingRods | Counting rods |  |
| suiYanSuiYu | Sui Yan Sui Yu |  |
| fuyouyue | Fuyouyue |  |
| tianshu | Tianshu |  |
| xiongyue | Xiongyue |  |
| huoxingwen | Huoxingwen (Martian script) |  |
| jianfan | Simplified ↔ Traditional Chinese |  |
| numToPinyin | Digits → Pinyin |  |
| hanziToPinyin | Hanzi → Pinyin |  |
| moyue | Moyue |  |
| xiangyue | XiangYue |  |
| xiangyueEnc | XiangYue encryption |  |
| yueChang | Yuechang |  |

### Classical Ciphers (71 ops)

| opId | Name | Notes |
|---|---|---|
| railFence | Rail Fence |  |
| caesar | Caesar cipher |  |
| scytale | Scytale (cipher rod) |  |
| vigenere | Vigenère |  |
| gronsfeld | Gronsfeld |  |
| beaufort | Beaufort |  |
| autokey | AutoKey |  |
| porta | Porta |  |
| playfair | Playfair |  |
| nihilist | Nihilist |  |
| columnar | Columnar transposition |  |
| hill | Hill cipher |  |
| affine | Affine cipher |  |
| bifid | Bifid |  |
| trifid | Trifid |  |
| polybius | Polybius square |  |
| adfgx | ADFGX |  |
| adfgvx | ADFGVX |  |
| foursquare | Four-square |  |
| graycode | Gray code |  |
| trithemius | Trithemius progressive shift |  |
| jefferson | Jefferson disk |  |
| amsco | AMSCO |  |
| ragbaby | Ragbaby |  |
| trilitere | Trilitère |  |
| skipCipher | Skip cipher |  |
| vic | VIC cipher |  |
| phillips | Phillips cipher |  |
| bellaso | Bellaso |  |
| slidefair | Slidefair |  |
| collon | Collon |  |
| dancingMen | Dancing Men |  |
| zodiac | Zodiac Z408 |  |
| threeSquare | Three-square |  |
| monomeBinome | Monome-Binome |  |
| yuanYin | Vowel cipher |  |
| columnReplace | Column substitution |  |
| rowsReplace | Row substitution |  |
| otp | One-time pad (OTP) |  |
| keywordcipher | Keyword cipher |  |
| simplesub | Simple substitution |  |
| runningkey | Running key |  |
| homophonic | Homophonic substitution |  |
| doubleTrans | Double transposition |  |
| pollux | Pollux |  |
| morbit | Morbit |  |
| bookCipher | Book cipher |  |
| turningGrille | Turning grille |  |
| cardanGrille | Cardan grille |  |
| bazeries | Bazeries |  |
| fenham | Fenham |  |
| pizzini | Pizzini |  |
| kamasutra | Kamasutra cipher |  |
| enigma | Enigma machine |  |
| m209 | M-209 rotor machine |  |
| rotSpecial | Rot (arbitrary shift) |  |
| goldbug | Gold-Bug cipher |  |
| routeCipher | Route cipher |  |
| caesarBox | Caesar box transposition |  |
| curveCipher | Curve cipher |  |
| chaocipher | Chaocipher |  |
| straddleCheckerboard | Straddling checkerboard |  |
| nihilistCipher | Nihilist cipher |  |
| solitaire | Solitaire (playing-card stream cipher) |  |
| ls47 | LS47 letter-card cipher |  |
| alberti | Alberti disk |  |
| gematria | Gematria numerals |  |
| foursquarekw | Four-square (keyword) |  |
| twosquare | Two-square |  |
| beaufortVariant | Beaufort variant |  |
| redefence | Redefence (rail fence) |  |
### Modern Crypto · Block (32 ops)

| opId | Name | Notes |
|---|---|---|
| aes | AES | AES (ECB/CBC/CFB/OFB/CTR in pure JS + GCM via WebCrypto; key 16/24/32 bytes) |
| des | DES | Data Encryption Standard (FIPS-46-3; 8-byte key, 8-byte block) |
| des3 | 3DES / TripleDES | Triple DES (EDE; key 16 or 24 bytes, 8-byte block) |
| kuznyechik | Kuznyechik (GOST R 34.12-2015) |  |
| tea | TEA |  |
| xtea | XTEA |  |
| xxtea | XXTEA |  |
| sm4 | SM4 |  |
| noekeon | Noekeon |  |
| shacal2 | SHACAL-2 |  |
| cast6 | CAST-256 |  |
| rc5 | RC5 |  |
| idea | IDEA |  |
| blowfish | Blowfish |  |
| rc6 | RC6 |  |
| cast5 | CAST-128 |  |
| twofish | Twofish |  |
| aesCmac | AES-CMAC |  |
| sm4Cmac | SM4-CMAC |  |
| camellia | Camellia (RFC 3713) |  |
| seed | SEED (RFC 4269) |  |
| rc2 | RC2 |  |
| aesKeyWrap | AES Key Wrap |  |
| simonSpeck | Simon / Speck lightweight ciphers |  |
| des2Mitm | 2DES meet-in-the-middle |  |
| magma | Magma (GOST R 34.12-2015) |  |
| present | PRESENT lightweight block cipher |  |
| serpent | Serpent |  |
| aria | ARIA (RFC 5794) |  |
| threefish | Threefish tweakable block cipher |  |
| skipjack | Skipjack block cipher |  |
| mars | MARS block cipher |  |

### Modern Crypto · Stream (21 ops)

| opId | Name | Notes |
|---|---|---|
| rc4 | RC4 | RC4 stream cipher (self-inverse; any key length) |
| xor | XOR | repeating-key XOR (self-inverse, the CTF workhorse; single-byte brute force lives in the analysis section as xorBrute) |
| rabbit | Rabbit | RFC 4503 Rabbit stream cipher. Three variants: CryptoJS Legacy (default in older online tools; recommended) / CryptoJS standard / RFC 4503 document orientation; a 32-hex key is used directly (IV optional), passphrases go through the CryptoJS OpenSSL envelope (Salted base64), and decode auto-tries the empty passphrase and common passwords. |
| salsa20 | Salsa20 |  |
| chacha20 | ChaCha20 |  |
| flashSwirl | FlashSwirl |  |
| zuc | ZUC (Zu Chongzhi) |  |
| a51 | A5/1 stream cipher |  |
| a52 | A5/2 stream cipher |  |
| e0 | E0 stream cipher |  |
| hc128 | HC-128 stream cipher |  |
| hc256 | HC-256 stream cipher |  |
| sosemanuk | Sosemanuk |  |
| spritz | Spritz stream cipher |  |
| vmpc | VMPC stream cipher |  |
| mickey | MICKEY-128 2.0 |  |
| trivium | Trivium stream cipher |  |
| grainV1 | Grain v1 stream cipher |  |
| grain128aead | Grain-128AEAD authenticated encryption |  |
| rc4Drop | RC4-drop / CipherSaber-2 |  |
| xsalsa20 | XSalsa20 |  |
### Modern Crypto · Asymmetric (105 ops)

| opId | Name | Notes |
|---|---|---|
| rsa | RSA | RSA modular-exponentiation encryption: encrypt c=mᵉ mod n, decrypt m=cᵈ mod n. Accepts hex/base64 ciphertext and plaintext byte strings (decryption outputs the flag directly); fill in p,q to derive n and d automatically. |
| ecdsaKeyGen | ECDSA key-pair generation |  |
| ecdsaSign | ECDSA sign |  |
| ecdsaVerify | ECDSA verify |  |
| ecdsaSigConvert | ECDSA signature format conversion |  |
| eccCalc | ECC point operations |  |
| rsaGenKeyPair | RSA key-pair generation |  |
| mlkemKeyGen | ML-KEM key generation |  |
| mlkemEncaps | ML-KEM encapsulation |  |
| mlkemDecaps | ML-KEM decapsulation |  |
| rsaParams | RSA parameter calculation (p,q→n,φ,d) |  |
| rsaModinv | Modular inverse (a⁻¹ mod m) |  |
| rsaEgcd | Extended Euclidean (Bézout) |  |
| rsaCrt | Chinese remainder theorem (CRT) |  |
| rsaModpow | Big-integer fast exponentiation (base^exp mod m) |  |
| sm2KeyGen | SM2 key-pair generation |  |
| sm2Encrypt | SM2 encrypt |  |
| sm2Decrypt | SM2 decrypt |  |
| sm2Sign | SM2 sign |  |
| sm2Verify | SM2 verify |  |
| sm2KeyExchange | SM2 key exchange |  |
| sm9KeyGen | SM9 key generation |  |
| sm9Sign | SM9 sign |  |
| sm9Verify | SM9 verify |  |
| sm9Encrypt | SM9 encrypt |  |
| sm9Decrypt | SM9 decrypt |  |
| x25519KeyGen | X25519 key generation |  |
| x25519Shared | X25519 shared secret (both private keys) |  |
| x25519SharedFromPub | X25519 shared secret (private key + peer public key) |  |
| xwingKeyGen | X-Wing key generation |  |
| xwingEncaps | X-Wing encapsulation |  |
| xwingDecaps | X-Wing decapsulation |  |
| xmssKeyGen | XMSS key generation |  |
| xmssSign | XMSS sign |  |
| xmssVerify | XMSS verify |  |
| lmsSign | LMS/HSS sign |  |
| lmsVerify | LMS/HSS verify |  |
| hqcKeyGen | HQC key generation |  |
| hqcEncrypt | HQC encrypt |  |
| hqcDecrypt | HQC decrypt |  |
| ntruKeyGen | NTRU key generation (real parameters) |  |
| ntruEncrypt | NTRU encrypt (real parameters) |  |
| ntruDecrypt | NTRU decrypt (real parameters) |  |
| blsKeyGen | BLS key generation |  |
| blsSign | BLS sign |  |
| blsVerify | BLS verify |  |
| blsAggVerify | BLS aggregate verification |  |
| merkleProve | Merkle inclusion proof |  |
| merkleVerify | Merkle proof verification |  |
| pedersenCommit | Pedersen commitment |  |
| feldmanVss | Feldman VSS |  |
| lsagSign | LSAG ring signature |  |
| lsagVerify | LSAG ring-signature verification |  |
| elgamal | ElGamal |  |
| elgamalKeyGen | ElGamal key generation |  |
| pemToHex | PEM → DER |  |
| hexToPem | DER → PEM |  |
| pemToJwk | PEM → JWK |  |
| jwkToPem | JWK → PEM |  |
| pubFromPriv | Private key → public key |  |
| rsaSign | RSA sign |  |
| rsaVerify | RSA verify |  |
| ed448Sign | Ed448 sign |  |
| ed448Verify | Ed448 verify |  |
| x448KeyGen | X448 key generation |  |
| x448Shared | X448 shared secret |  |
| gostSign | GOST R 34.10-2012 sign |  |
| gostVerify | GOST R 34.10-2012 verify |  |
| pgpGenKeyPair | PGP key-pair generation |  |
| pgpEncrypt | PGP encrypt |  |
| pgpDecrypt | PGP decrypt |  |
| pgpSign | PGP sign |  |
| pgpVerify | PGP verify |  |
| pgpEncryptAndSign | PGP encrypt and sign |  |
| pgpDecryptAndVerify | PGP decrypt and verify |  |
| pgpParseKey | PGP key parsing |  |
| ed25519KeyGen | Ed25519 key generation |  |
| ed25519Sign | Ed25519 sign |  |
| ed25519Verify | Ed25519 verify |  |
| mldsaKeyGen | ML-DSA key generation |  |
| mldsaSign | ML-DSA sign |  |
| mldsaVerify | ML-DSA verify |  |
| slhdsaKeyGen | SLH-DSA key generation |  |
| slhdsaSign | SLH-DSA sign |  |
| slhdsaVerify | SLH-DSA verify |  |
| knapsack | Knapsack encryption (Merkle-Hellman) |  |
| dsaParamGen | DSA key-pair / domain-parameter generation |  |
| dsaSign | DSA sign |  |
| dsaVerify | DSA verify |  |
| dsaReuseK | DSA k-reuse attack |  |
| x509Parse | X.509 certificate parsing |  |
| sshHostKeyParse | SSH public key parsing (authorized_keys / known_hosts) |  |
| csrParse | CSR parsing (PKCS#10) |  |
| crlParse | X.509 CRL parsing |  |
| lweToy | LWE toy encrypt / decrypt |  |
| ntruToy | NTRU toy encrypt / decrypt |  |
| rabin | Rabin cipher |  |
| paillierKeyGen | Paillier key-pair generation |  |
| paillierEncrypt | Paillier encrypt |  |
| paillierDecrypt | Paillier decrypt |  |
| paillierHomAdd | Paillier homomorphic addition |  |
| schnorrKeyGen | Schnorr key-pair generation |  |
| schnorrSign | Schnorr sign |  |
| schnorrVerify | Schnorr verify |  |
| schnorrReuseK | Schnorr nonce-reuse attack |  |
### Modern Crypto · Other (29 ops)

| opId | Name | Notes |
|---|---|---|
| fernet | Fernet | symmetric token (AES-128-CBC + HMAC-SHA256; base64url 32-byte key) |
| xorStrings | XOR with cyclic padding |  |
| jwt | JWT |  |
| jwtNone | JWT "none" attack |  |
| jweIdentify | JWE structure identification |  |
| pasetoIdentify | PASETO identification |  |
| jwtSign | JWT signing |  |
| jwtVerify | JWT verification |  |
| godzillaPhpXorBase64 | Godzilla PHP_XOR_BASE64 |  |
| behinderAesEcb | Behinder AES-ECB |  |
| ror13Hash | ROR13 API hash |  |
| byteArith | Byte arithmetic (mod 256) |  |
| bwt | BWT block-sorting transform |  |
| flaskSessionDecode | Flask session decode |  |
| flaskSessionSign | Flask session signing |  |
| flaskSessionVerify | Flask session verification |  |
| hotp | HOTP |  |
| totp | TOTP |  |
| dlp | Discrete logarithm (DLP) |  |
| ascon | Ascon-AEAD128 |  |
| bb84Qkd | BB84 quantum key distribution simulation |  |
| jwsSign | JWS signing |  |
| jwsVerify | JWS verification |  |
| jweEncrypt | JWE encryption |  |
| jweDecrypt | JWE decryption |  |
| pasetoV4Sign | PASETO v4 signing (public) |  |
| pasetoV4Verify | PASETO v4 verification (public) |  |
| shamir | Shamir secret sharing |  |
| jwtCrack | JWT key cracking (small-dictionary demo) |  |

### Hash / Checksum (66 ops)

| opId | Name | Notes |
|---|---|---|
| md5 | MD5 | MD5 message digest (128-bit, RFC 1321, pure JS) |
| md4 | MD4 | MD4 message digest (128-bit, RFC 1320, pure JS, NTLM base) |
| sha1 | SHA-1 | SHA-1 message digest (160-bit, WebCrypto) |
| sha256 | SHA-256 | SHA-256 message digest (256-bit, WebCrypto) |
| sha384 | SHA-384 | SHA-384 message digest (384-bit, WebCrypto) |
| sha512 | SHA-512 | SHA-512 message digest (512-bit, WebCrypto) |
| hmac | HMAC | HMAC message authentication (params: key + hash algorithm; WebCrypto) |
| crc32 | CRC32 | CRC32 checksum (IEEE 802.3, table-driven) |
| crc16 | CRC16 | CRC16 checksum (CCITT-FALSE, polynomial 0x1021) |
| ntlm | NTLM | NTLM hash (MD4 of the UTF-16LE password; Windows credential storage) |
| sha3 | SHA-3 | SHA-3 (FIPS 202, pure-JS Keccak; 224/256/384/512 selectable) |
| keccak256 | Keccak-256 | Keccak-256 (Ethereum, 0x01 padding, 256-bit) |
| shake128 | SHAKE128 | SHAKE128 extendable output (FIPS 202; output-length param) |
| shake256 | SHAKE256 | SHAKE256 extendable output (FIPS 202; output-length param) |
| ssdeep | SSDEEP fuzzy hash |  |
| sm3 | SM3 |  |
| ripemd160 | RIPEMD-160 |  |
| blake2b | BLAKE2b |  |
| blake2s | BLAKE2s |  |
| adler32 | Adler-32 |  |
| crc8 | CRC-8 |  |
| crc8_maxim | CRC-8/MAXIM |  |
| crc64 | CRC-64 |  |
| crc32c | CRC-32C |  |
| fnv1a | FNV-1a |  |
| murmur3_32 | MurmurHash3-32 |  |
| md6 | MD6 |  |
| snefru | Snefru |  |
| sha0 | SHA-0 |  |
| has160 | HAS-160 |  |
| gostHash | GOST R 34.11-94 |  |
| argon2 | Argon2 KDF (Argon2d/i/id) |  |
| tiger | Tiger / Tiger2 hash (192-bit) |  |
| kupyna | Kupyna hash (DSTU 7564:2014) |  |
| kmac | KMAC |  |
| cmacExt | CMAC extension |  |
| crcGeneric | Generic CRC (parameterised) |  |
| crc16Modbus | CRC-16/MODBUS |  |
| crc16CcittTrue | CRC-16/CCITT-FALSE |  |
| crc16Arc | CRC-16/ARC |  |
| crc16Xmodem | CRC-16/XMODEM |  |
| fletcher | Fletcher |  |
| bsdSum | BSD checksum |  |
| sysvSum | SysV checksum |  |
| verhoeff | Verhoeff check digit |  |
| md2 | MD2 |  |
| pbkdf2 | PBKDF2 |  |
| hkdf | HKDF |  |
| lmHash | LM Hash |  |
| evpBytesToKey | EVP_BytesToKey |  |
| asconHash | Ascon-Hash256 |  |
| streebog | Streebog (GOST R 34.11-2012) |  |
| bcrypt | Bcrypt |  |
| siphash | SipHash-2-4 / 1-3 |  |
| scrypt | scrypt key derivation |  |
| balloon | Balloon key derivation |  |
| lyra2 | Lyra2 key derivation |  |
| yescrypt | yescrypt key derivation |  |
| blake3 | BLAKE3 |  |
| pearson | Pearson hash |  |
| whirlpool | Whirlpool |  |
| skein | Skein |  |
| grostl | Grøstl |  |
| jh | JH |  |
| xxhash | xxHash (fast non-crypto hash) |  |
| cityhash | CityHash (non-crypto hash) |  |
### Radix / Charsets (80 ops)

| opId | Name | Notes |
|---|---|---|
| iban | IBAN check digits (mod-97) |  |
| mayaNumerals | Mayan numerals |  |
| babylonianNumerals | Babylonian numerals |  |
| egyptianNumerals | Egyptian numerals |  |
| radixConvert | Radix conversion |  |
| asciiRadix | Character ↔ radix ASCII |  |
| ieee754 | IEEE754 floating point |  |
| bcd | BCD code |  |
| binPad | Binary zero-padding alignment |  |
| hybridCode | Mixed-radix decoding |  |
| separationAscii | Digit-string split to ASCII |  |
| asciiOffset | ASCII offset |  |
| decimalToFloat | Decimal to arbitrary-radix float |  |
| binaryComplement | Sign-magnitude / ones' / two's complement |  |
| completion | Zero-pad alignment |  |
| splitHex | Hex N-digit splitting |  |
| standardCode | Charset conversion |  |
| timestamp | Timestamp ↔ time |  |
| gcd | Greatest common divisor |  |
| primeFactor | Prime factorisation |  |
| fibonacci | Fibonacci decoding |  |
| negabase | Negative base |  |
| balancedTernary | Balanced ternary |  |
| factorialBase | Factorial base |  |
| zeckendorf | Zeckendorf representation |  |
| roman | Roman numerals |  |
| chineseNum | Chinese numerals |  |
| continuedFraction | Continued fractions |  |
| sternBrocot | Stern-Brocot path |  |
| collatz | Collatz sequence |  |
| primeGen | Large prime generation |  |
| primeTest | Primality testing (Miller-Rabin) |  |
| ipv4Int | IPv4 ↔ integer |  |
| ipv6Format | IPv6 compression / expansion |  |
| macFormat | MAC address format conversion |  |
| cidrCalc | CIDR subnet calculation |  |
| userAgentParse | User-Agent parsing |  |
| unixTime | Unix timestamp ↔ ISO 8601 |  |
| filetime | Windows FILETIME ↔ ISO 8601 |  |
| hfsTime | Mac HFS+ time ↔ ISO 8601 |  |
| cocoaTime | Cocoa time ↔ ISO 8601 |  |
| dosDateTime | DOS date-time ↔ ISO 8601 |  |
| chineseDate | Chinese-character date ↔ ISO 8601 |  |
| tzConvert | Time-zone conversion |  |
| luhn | Luhn check digit |  |
| isbn | ISBN-10/13 check digit |  |
| ean13 | EAN-13 check digit |  |
| cnidCheck | Chinese ID (18-digit) check digit |  |
| upc | UPC-A check digit |  |
| bankBin | Bank card BIN identification |  |
| geoDms | DMS ↔ decimal degrees |  |
| geoHash | Geohash |  |
| geoPlusCode | Plus Code / OLC |  |
| geoMaidenhead | Maidenhead grid |  |
| geoUtm | UTM coordinates |  |
| color | Colour code conversion |  |
| colorInfo | Colour full info |  |
| bitReverse | Bit reversal |  |
| bitRotate | Bitwise rotation |  |
| byteSwap | Byte-order reversal |  |
| bitPlaneExtract | Bit-plane extraction |  |
| byteReverse | Whole-string byte reversal |  |
| julianDate | Julian day ↔ ISO 8601 |  |
| excelDate | Excel serial date ↔ ISO 8601 |  |
| chromeTime | Chrome time ↔ ISO 8601 |  |
| snowflakeId | Snowflake ID parsing |  |
| unixPerms | UNIX file permissions |  |
| hammingCode | Hamming code |  |
| bech32 | Bech32 encoding |  |
| uuidParse | UUID parsing |  |
| varint | VarInt (LEB128) |  |
| pipNumerals | Pip counting (dice / dominoes) |  |
| bigCalc | Big-number calculator (BigInt) |  |
| primeInspector | Primality testing and sieving |  |
| randomSeed | Random seed generation |  |
| randomSecure | Enhanced random security |  |
| randBeacon | Public randomness beacon verification |  |
| radixAll | One-shot multi-radix conversion |  |
| progCalc | Programmer calculator | Bitwise expression evaluator (hand-written recursive-descent parser, no eval): & \| ^ ~ << >> >>> + - * / % **, parentheses, rotl/rotr rotations; 8/16/32/64-bit word-size masking and wrapping (BigInt throughout); signed/unsigned toggle; one-pass output of decimal / hex / octal / binary (4-bit grouped) / two's complement / popcount / leading zeros / trailing zeros. |
| objectIdTime | ObjectID timestamp parsing |  |

### Analysis / Brute Force (46 ops)

| opId | Name | Notes |
|---|---|---|
| xorBrute | Single-byte XOR brute force |  |
| freqDist | Character frequency distribution |  |
| entropy | Shannon entropy |  |
| wordFreq | Word frequency statistics |  |
| hammingDistance | Hamming distance |  |
| levenshtein | Edit distance |  |
| strContrast | Equal-length ASCII diff |  |
| debruijn | De Bruijn sequence |  |
| textIntConverter | Text ↔ big integer |  |
| extractHashes | Hash-string extraction |  |
| getAllCasings | All-case permutations |  |
| alternatingCaps | Alternating caps |  |
| hashTypeIdentify | Hash type identification |  |
| vigenereAuto | Vigenère automatic crack |  |
| hillKnownPlain | Hill known-plaintext attack |  |
| playfairCrack | Playfair hill-climbing crack |  |
| freqAnalysis | Frequency analysis (n-gram) |  |
| icAnalysis | Index of coincidence (with grouping) |  |
| kasiskiTest | Kasiski examination |  |
| chiSquareAnalysis | Chi-square test (detailed) |  |
| subCipherSolver | Monoalphabetic substitution auto-solver |  |
| caesarBrute | Caesar / ROT auto shift finder |  |
| ecCurveIdent | Elliptic-curve parameter identification |  |
| sstiKeyword | SSTI keyword identification |  |
| xorCribDrag | XOR crib-drag known-plaintext |  |
| shaLengthExtend | SHA length extension |  |
| birthdayCollision | Birthday collision demo |  |
| dictGen | Dictionary generation |  |
| formatSniff | Format sniffing |  |
| flagExtract | Automatic flag extractor |  |
| xorAnalyze | xortool all-in-one (repeating-key XOR analysis) |  |
| spiralMatrix | Spiral matrix reading |  |
| nonogram | Nonogram solver |  |
| randu | RANDU weak LCG |  |
| truncLcgRecover | Truncated LCG seed recovery |  |
| babaiCvp | Babai nearest plane (CVP) |  |
| hnpRecover | Hidden number problem (HNP) |  |
| spnAnalysis | SPN differential / linear analysis |  |
| md5CollisionShow | MD5 truncated collision demo |  |
| crc32Reverse | CRC32 reverse collision |  |
| geffeGenerate | Geffe generator |  |
| geffeAttack | Geffe correlation attack |  |
| pcapRepair | pcap file repair |  |
| lfsrRecover | LFSR sequence recovery |  |
| xorshiftRecover | xorshift state recovery |  |
| rc4Visualize | RC4 KSA/PRGA visualisation |  |
### Password Attacks (21 ops)

| opId | Name | Notes |
|---|---|---|
| ecdsaReuseK | ECDSA nonce-reuse attack |  |
| hashDictCrack | Hash dictionary cracking (small-dictionary demo) |  |
| rainbowQuery | Rainbow-table query (local demo table) |  |
| hmacKeyBrute | HMAC key brute force (small-dictionary demo) |  |
| rsaSmallE | RSA small-e attack (integer root) |  |
| rsaCommonModulus | RSA common-modulus attack |  |
| rsaWiener | RSA Wiener attack (continued fractions) |  |
| rsaFermat | Fermat factorisation (close p,q) |  |
| rsaPollard | Pollard rho factorisation |  |
| lllAttack | LLL lattice-reduction attack |  |
| rsaDpDqLeak | RSA dp/dq leak → d |  |
| rsaLsbOracle | RSA LSB oracle attack |  |
| rsaBleichenbacher | RSA Bleichenbacher attack |  |
| rsaCoppersmith | RSA Coppersmith small-root attack |  |
| rsaBonehDurfee | RSA Boneh-Durfee hint |  |
| pbeAesBrute | PBE-AES passphrase brute force (small-dictionary demo) |  |
| rsaBatchGcd | RSA common-factor factorisation (batch GCD) |  |
| rsaHastad | RSA Hastad broadcast attack |  |
| rsaPollardPm1 | RSA Pollard p-1 factorisation |  |
| prngAttack | PRNG cracking (LCG / MT19937) |  |
| hashLengthExtension | Hash length-extension attack (MD5/SHA1/SHA256) |  |

### Compression / Archives (16 ops)

| opId | Name | Notes |
|---|---|---|
| gzipCodec | Gzip decompress / compress | gzip stream both ways (browser DecompressionStream; input hex/base64/UTF-8 auto-detected) |
| zlibCodec | Zlib decompress / compress | zlib stream (2-byte header + adler32 trailer) both ways; browser-tested |
| deflateRawCodec | Raw Deflate decompress / compress | raw deflate (no zlib header) both ways; browser-tested |
| b64CompressedProbe | Base64-embedded compressed-stream probe | scan base64 segments → decode → magic-recognise → try gzip/zlib/deflate decompression |
| lznt1 | LZNT1 decompress |  |
| rle | RLE run-length encoding |  |
| lzw | Standard LZW (GIF/TIFF) |  |
| elias | Elias Gamma/Delta coding |  |
| lz4Dec | LZ4 decompress |  |
| bzip2Dec | bzip2 decompress |  |
| lzstring | LZString compression (LZW) |  |
| sevenZipExtract | 7z archive parsing / extraction | recognises the 7z signature + parses SignatureHeader/StartHeader (CRC-verified); with public/wasm/7zz.js present it can list/extract for real (LZMA etc.; degrades gracefully when the wasm is absent) |
| archiveUnified | Unified compression / archive analysis |  |
| zipRepair | ZIP pseudo-encryption repair |  |
| zipPseudoEncrypt | ZIP pseudo-encryption (set flag) |  |
| zipCreate | ZIP creation (for challenge authors) |  |

### Password / Archive Cracking (10 ops)

| opId | Name | Notes |
|---|---|---|
| office2john | Office hash extraction (office2john) |  |
| crc32Collision | CRC32 collision brute force |  |
| zipBrute | ZIP weak-password brute force (small-dictionary quick check) |  |
| zip2john | ZIP hash extraction (zip2john) |  |
| zipCrc32Brute | ZIP CRC32 content brute force |  |
| sevenZip2john | 7z hash extraction (7z2john) |  |
| pdf2john | PDF hash extraction (pdf2john) |  |
| rar2john | RAR hash extraction (rar2john) |  |
| sshkey2john | SSH private-key hash extraction (sshkey2john) |  |
| bkcrackAttack | ZipCrypto known-plaintext attack (bkcrack) |  |

### Forensics / Traffic (19 ops)

| opId | Name | Notes |
|---|---|---|
| pcapParse | pcap/pcapng structure parsing | parse pcap/pcapng capture files: global header + packet records + Ethernet/IPv4/IPv6/TCP/UDP/ICMP/HTTP/DNS framing; output packet summary table + protocol details + payload extraction. Pure frontend, zero dependencies |
| pcapTcpReassemble | TCP stream reassembly | aggregate TCP segments by 5-tuple, order by seq and de-duplicate, reconstruct the complete byte stream per direction (the basis of HTTP extraction). Pure frontend, zero deps, reuses pcapParse framing |
| pcapHttpExtract | HTTP object extraction | parse HTTP requests/responses on top of TCP reassembly, handle chunked transfer and gzip/deflate decompression (pure-JS inflate), export transferred files/text |
| pcapDnsTunnel | DNS tunnel detection | extract data labels from DNS query subdomains, join and try base32/base64/hex decoding to expose data exfiltrated through DNS tunnels. Reuses pcapParse DNS framing |
| pcapIcmpPayload | ICMP payload extraction | extract ICMP echo payloads, order by id/seq and join, reconstruct data hidden via ICMP steganography / tunnels. Reuses pcapParse ICMP framing |
| pcapFieldExtract | pcap field extraction / filtering | per-packet extraction of ip.id / TTL / TCP urgent pointer / DNS qry-answer fields with protocol and direction filters (src:/dst:/port=); three output modes: table / TSV / plain values (the plain TTL column feeds straight into TTL-stego decoding) |
| mcLevelDat | Minecraft level.dat parsing | parse Minecraft Java world level.dat (gzip-compressed NBT): seed / spawn / GameRules / version / DataVersion, highlighting suspicious fields such as non-standard GameRules and abnormal coordinates. Self-written big-endian NBT parser, BigInt for Longs, pure frontend, zero upload |
| mcMapRender | Minecraft map rendering | render Minecraft Java map item map_#.dat (gzip NBT; data.colors is a 128×128 palette-index grid) to PNG: 62 built-in MapColor base colours × 4 shade levels, 16384 bytes decoded to RGBA, hand-rolled minimal PNG encoder (zero canvas dependency) with full-file download and thumbnail preview. Commonly used in CTF to draw QR codes / pixel art / hidden text on maps; nearest-neighbour upscaling helps scanning QR codes. Reuses the mcSave NBT parser, pure frontend, zero upload |
| trailerCarve | Appended-data carving | detect the carrier's true end offset (PNG IEND / JPEG FFD9 / GIF 3B / ZIP EOCD / BMP / RIFF / PDF %%EOF), carve the trailing bytes and identify the magic; or binwalk-style whole-file scanning for embedded files |
| oleExtract | OLE/CFB container static extraction |  |
| foremostCarve | File carving (Foremost JS) |  |
| trafficReadable | Traffic readable conclusions |  |
| usbKeyboard | USB keyboard traffic parsing |  |
| usbMouse | USB mouse traffic parsing |  |
| ftpExtract | FTP object extraction |  |
| tlsDecrypt | TLS 1.2 known-key decryption |  |
| wpaDecrypt | WPA2 handshake check / CCMP decryption |  |
| mcTextExtract | Minecraft text-intelligence extraction |  |
| mcNbtView | Minecraft NBT tree viewer |  |

### File Format / Structure (11 ops)

| opId | Name | Notes |
|---|---|---|
| pycExeDecompile | pyc/exe decompilation (local bridge) | drop a .pyc or a PyInstaller-packaged .exe; via the local bridge.py it detects the Python version and decompiles to source (uncompyle6/decompyle3; 3.9+ uses the experimental pylingual chain; Windows only, start python bridge.py first) |
| htmlCommentExtract | HTML comment extraction |  |
| zipCommentExtract | ZIP comment extraction |  |
| scriptDecoder | MS script decoding (.vbe/.jse) |  |
| adsTool | NTFS ADS alternate data streams |  |
| stringsExtract | String extraction (strings) |  |
| pdfObjects | PDF object parsing |  |
| ooxmlMeta | OOXML metadata extraction |  |
| apkManifest | APK manifest parsing |  |
| elfInfo | ELF executable info |  |
| peInfo | PE executable info |  |

### Data Structures / Serialisation (21 ops)

| opId | Name | Notes |
|---|---|---|
| hexRange | Hex range extraction | extract bytes in a given offset range, shown as hex / dec / oct / bin / ASCII / UTF-8 |
| hexStats | Byte distribution statistics | byte-value distribution (256-bucket density grid / 3-bucket) + printable ratio + global and sliding-window Shannon entropy (locate encrypted / compressed regions) + top-N frequent bytes |
| stegoDetect | Steganography detection (text / files) |  |
| b64urlJson | Base64url ↔ JSON |  |
| pemParse | PEM/DER structure parsing |  |
| asn1Parse | ASN.1 TLV parsing |  |
| sshPubkeyParse | SSH public key parsing |  |
| btcAddressIdent | Bitcoin address identification |  |
| ethAddressIdent | Ethereum address identification |  |
| protobufParse | Protobuf wire parsing |  |
| msgpackParse | MessagePack parsing |  |
| cborParse | CBOR parsing |  |
| bsonParse | BSON document parsing |  |
| phpSerializeParse | PHP serialize parsing |  |
| javaSerializeIdent | Java serialization identification |  |
| diffTool | Diff comparison |  |
| rison | Rison |  |
| pickleDisasm | Pickle disassembly |  |
| cryptoAddrUnified | Cryptocurrency address parsing |  |
| huffmanCodec | Huffman coding (generic) |  |
| unitConv | Unit conversion | data sizes B/KB/MB/GB/TB/PB vs KiB/MiB/GiB/TiB/PiB side by side (SI 1000 vs IEC 60027-2 1024; all factors traceable); rates bps/Kbps/Mbps/Gbps ↔ B/s/KB/s/MB/s (bit×8); time ns–d; plain numbers trigger timestamp-epoch comparisons (Unix s/ms, FILETIME, Cocoa, Chrome µs, DOS packed; magnitude auto-sniffed); frequency Hz–GHz; angles deg/rad/gon. Data sizes run on BigInt rationals throughout — zero precision loss at PB scale; exact decimals and truncation bits are labelled. |
### Image / QR (33 ops)

| opId | Name | Notes |
|---|---|---|
| pngChunkList | PNG full chunk parsing | list all PNG chunks (IHDR/PLTE/tEXt/zTXt/iTXt/bKGD/iCCP/IDAT/IEND etc.), parse text chunks and metadata (compressed text is inflated by the in-repo inflate — no pako needed); export per-chunk raw bytes (length/type/CRC), the PLTE palette, and the palette-index bitstream |
| jpegAppList | JPEG APPn segment listing | list all APP0-APP15 and marker segments (SOF/DQT/DHT/COM etc.) with content identification |
| gifComment | GIF comment extension | extract GIF 89a comment extension blocks (0x21 0xFE), joining all sub-block text |
| gifFrames | GIF frame extraction | decode and compose every frame to PNG in a single ZIP download; defaults to all frames, constrained by 4096-frame / 128 MiB ZIP and pixel/time budgets — on failure no incomplete package is delivered |
| iccStrip | ICC stripping | strip the ICC profile (PNG iCCP chunk / JPEG APP2 ICC_PROFILE segment), returning the ICC-free base64 |
| qrGen | QR generation | pure-JS QR encoding (numeric/alphanumeric/byte modes + L/M/Q/H error correction), outputting a scannable QR PNG (with quiet zone) + 0/1 matrix JSON. Core ported from Nayuki (MIT) |
| barcodeIdentify | Barcode type identification | 2D (QR/Aztec/DataMatrix structure recognition) + 1D (EAN/UPC/ISBN/ITF/Code39/Codabar check-digit verdicts) |
| qrDecode | QR decoding | decode QR content from a 0/1 matrix: finder detection + format info + zigzag sampling + mask removal + RS error correction + numeric/alphanumeric/byte mode restoration. With Diagnostics on, prints a full report of version/ECL/mask/RS corrections/segment modes |
| pngSizeRecover | PNG size brute-force recovery | detect a tampered PNG IHDR CRC and brute-force the real dimensions (the classic CTF trick of hiding an image by editing the height; try height first at O(N) speed, then width, then both; outputs the repaired base64) |
| bmpSizeRecover | BMP size repair | detect BMP width/height vs pixel-data mismatches and derive the real dimensions (BMP has no CRC — divide the pixel byte count by rowSize; the CTF BMP hiding trick; outputs repaired base64) |
| jpgSizeRecover | JPEG size repair | baseline JPEG: count MCUs to derive the real height (SOF carries no checksum — count blocks during entropy decoding; the JPEG version of the CTF height-editing trick) + manual forced dimensions; outputs repaired base64 |
| qrScanImage | QR scan & parse | one-stop QR entry: paste an image to scan, or paste a text matrix to parse. Images (PNG/JPEG/GIF/BMP/WebP) are decoded to content; 0/1 matrices or ASCII art get a version / error-correction level / mask / finder check-up. Decodes even with finder patterns erased or occluded (grid reconstruction + brute force + erasure correction). With the "read range" widened it also reads barcodes (Code128/EAN/UPC/ITF etc.) and DataMatrix/PDF417/Aztec from the image, listing every symbol in the diagnostic report; when decoding fails the diagnostics show where it got stuck and what to try. All computation is local. |
| imageBasic | Image basic operations |  |
| pngText | PNG text chunk read/write |  |
| pngHeight | PNG height modification |  |
| exifExtract | EXIF extraction |  |
| bitplaneSlicing | Bit-plane slicing |  |
| imageDiff | Image diff comparison |  |
| qrFormatBrute | QR format-info brute force |  |
| barcodeGen | Barcode generation (Code128/EAN-13/DataMatrix) |  |
| imageStructUnified | Image structure analysis (unified) |  |
| bin2img | Binary to image |  |
| img2dataURI | Image to Base64/dataURI |  |
| dataToImage | Render numeric data as an image |  |
| bmpPalette | BMP palette steganography analysis |  |
| gifTiming | GIF frame-timing steganography |  |
| imageCompress | Image compression |  |
| imageGray | Image greyscale |  |
| imagePixelate | Image pixelation |  |
| imageFrosted | Image frosted glass |  |
| imageSketch | Image to sketch |  |
| imageToText | Image to text (ASCII art) |  |
| gifCompose | GIF composition |  |
| spriteSheet | Sprite-sheet conversion |  |

### Audio / Video (7 ops)

| opId | Name | Notes |
|---|---|---|
| dtmfWav | DTMF dial-tone WAV | key sequence ↔ dial-tone WAV: encode digits (0-9 A-D * #) → summed row/column dual-sine 16-bit mono WAV (base64); decode WAV (base64/hex) → Goertzel detection of the 8 base frequencies → keys. Decoding supports integer PCM (8/16/24/32-bit), IEEE float (32/64-bit), µ-law — meets and exceeds dtmf2num. |
| wavHeader | WAV header parsing | parse the RIFF/WAVE structure: walk chunks + fmt block (sample rate / bit depth / channels / format code) + data block duration; input hex/base64/UTF-8 auto-detected |
| sstvIdent | SSTV mode identification | detect the 1200 Hz start sync pulse + VIS code, label the likely SSTV mode (Robot/Scottie/Martin/PD); identification only, no image demodulation |
| pcmTransforms | PCM waveform transforms |  |
| sstv | SSTV slow-scan TV encode / decode |  |
| morseWav | Morse audio encode / decode |  |
| spectrogram | Audio spectrogram (STFT) |  |

### Text Steganography (13 ops)

| opId | Name | Notes |
|---|---|---|
| zeroWidth | Zero-width character steganography |  |
| zeroChar | Zero-width Morse |  |
| zwTags | Unicode Tag smuggling |  |
| zwVarSel | Variation-selector steganography |  |
| emojiSubst | emoji substitution steganography |  |
| tadpole | Tadpole script |  |
| textBlindWatermark | Text blind watermark |  |
| snow | SNOW whitespace steganography |  |
| acrostic | Acrostic (head / tail / middle) |  |
| everyN | Every-Nth-character steganography |  |
| caseBitStego | Case-bit steganography |  |
| nthChar | Nth-character steganography |  |
| wordSpacingBits | Word-spacing bit steganography |  |

### File Steganography (27 ops)

| opId | Name | Notes |
|---|---|---|
| audioLsb | Audio LSB extraction | extract the hidden bitstream from WAV PCM sample least-significant bits → text/hex + raw-byte download; supports 8/16/24/32-bit depths, channel selection, and multiple bits per sample |
| audioLsbEmbed | Audio LSB embedding (for challenge authors) | write a payload into WAV PCM sample LSBs (or multiple bits per sample) to produce a stego WAV; the bit layout matches audioLsb extraction 1:1; non-WAV input is raw-PCM wrapped |
| lsbImage | LSB pixel steganography |  |
| pixelJihad | PixelJihad |  |
| arnoldCat | Arnold cat-map transform |  |
| arnoldCatBrute | Arnold cat-map brute force |  |
| f5stego | F5 JPEG steganography encode / decode |  |
| jphswinLaunch | JPHS · JPEG steganography |  |
| openpuffLaunch | OpenPuff · multi-carrier |  |
| oursecretLaunch | OurSecret · steganography |  |
| jsteg | jsteg JPEG steganography encode / decode |  |
| dctWatermark | DCT blind watermark |  |
| dualFftWatermark | Dual-image blind watermark (F) frequency-domain overlay |  |
| outguess | OutGuess steganography (both ways) |  |
| steghide | steghide (both ways) |  |
| gifshuffle | GifShuffle palette steganography |  |
| watermarkhFft | WaterMarkH frequency-domain invisible watermark |  |
| dwtSvdWatermark | DWT-DCT-SVD blind watermark |  |
| mirageTank | Mirage tank (transparent-on-background image pair) |  |
| tomatoScramble | Tomato image scrambling |  |
| imgFft | Image 2D FFT magnitude spectrum |  |
| ttlStego | TTL steganography (IP packet TTL sequence) |  |
| stegosaurus | Stegosaurus pyc steganography detection |  |
| stegpy | stegpy steganography (stegv3) |  |
| stereogramSolver | Stereogram solver |  |
| lsbEmbed | LSB embedding (for challenge authors) |  |
| deepsoundExtract | DeepSound extraction |  |
## Plugins & AI Access

The toolbox is driven by a declarative registry: every algorithm is a single `{id, cat, name, params, encode/decode/run, detect}` record, and the UI renders itself. The same contract is open to third parties.

### Plugin SDK

Third parties can write plugins with zero main-project changes: a plugin is a standard ESM module that only sees the host-injected, controlled `ctx` and never imports internal modules. Plugins can register algorithm ops (auto-appearing in the menu, search, and one-shot decoding), add categories, inject localised strings, and use namespace-isolated local storage. Every registration is precisely reclaimed on unload.

- Developer guide: [`src/plugin/README.md`](./src/plugin/README.md)
- Reference plugin (a live template — copy, rename, start): [`src/plugin/examples/hello-cipher/index.js`](./src/plugin/examples/hello-cipher/index.js)

### For External AI (MCP / Skills)

The toolbox's capability surface can be exposed to MCP-capable AI clients or agents — local processes throughout, zero upload. The single source of truth lives in `src/plugin/mcpBridge.js`, exposing 6 MCP tools (list categories, list ops, op param schema, detect encodings, run an op, one-shot smart decode) and 3 MCP resources (`ebctf://ops` full op list, `ebctf://categories` category overview, `ebctf://guide` solving guide). The in-browser AI panel, the Node stdio server, and the CLI Skill all reuse the same definition.

- MCP server (Claude Desktop et al.): [`mcp/README.md`](./mcp/README.md)
- Skill (Claude Code / CLI agents): [`skills/ebctf-decode/`](./skills/ebctf-decode/)

The AI's only network egress is the optional `aiClient`, which requires your own endpoint + key, connects directly to your site, and is never relayed or logged by the main project. Off by default.

## Contributors

The list below matches the "Authors & Contributors" section of the in-app About page, in the same order.

**Founder · Author**

- 恒烈 · EternalBlaze — founder · author.

**Authors**

- 小布丁 — author.

**Contributors**

- Enze: proposed the recipe-chain interaction improvement.
- yy2m1a0 — beta tester · one-shot multi-decode scoring optimisation.
- 霍雅 — beta tester · day/night toggle optimisation.
- 0x0off — beta tester · real-challenge algorithm additions.
- 懒羊羊大王 — beta tester · found the fancy-series detection too strict, leading to the lenient matching mode.
- 风之暇想 — beta tester · proposed several modern-cipher additions.
- jluvb — V0.1.2 partial encoding escape fixes.
- smile1110 — proposed ECC and other modern-crypto expansions (the v0.1.6 key-lifecycle and signature expansion direction came from this).
- 拉面: feedback on original-version compatibility for Qianqian Xiuzi, Foyu, and SNOW; Unicode and Twin-Hex whitespace boundaries; Whitespace execution and Malbolge identification issues; proposed the Scytale dual-key form, zero-width stego charset & format expansion, edu and tool-category corrections, and trade-off suggestions for non-standard Brainfuck variants.
- qinling072: proposed adding OutGuess and other image-steganography algorithms.
- cnui6: proposed the Rabbit compatibility fix, enabling CryptoJS interop and passphrase support.

## Community

- [Linux.Do](https://linux.do) — this project thinks highly of the LinuxDo community!

## License

The project's own code is licensed under the **Apache License 2.0** — free to use, modify, and redistribute; see the full [`LICENSE`](./LICENSE) in the repository root. Third-party resources remain under their respective licences.

Third-party components (e.g. the vendored abracadabra-cn, the various WASM libraries) each follow their original licences.

## Third-party Resources & Licenses

The project's own code is licensed under Apache License 2.0. Third-party resources used:

### Permissively licensed components

- [noble curves / noble hashes](https://github.com/paulmillr/noble-curves) (MIT © Paul Miller) — elliptic curves and hashes; vendored at `src/core/lib/noble/` (with LICENSE.txt).
- [bwip-js](https://github.com/metafilter/bwip-js) 4.11.4 + [BWIPP](https://github.com/bwipp/postscriptbarcode) 2026-05-28 (dual MIT) — barcode generation.
- [material-color-utilities](https://github.com/material-foundation/material-color-utilities) 0.4.0 (Apache-2.0) — dynamic colour extraction.
- [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (MIT © 2023 Ze-Zheng Wu; upstream ZXing-C++ is Apache-2.0) — QR / barcode decoding.
- [CodeMirror 6](https://github.com/codemirror/dev) (MIT) — custom-algorithm editor core.
- [KaTeX](https://github.com/KaTeX/KaTeX) 0.16.11 (MIT, fonts OFL) — math formula rendering.

### Icons · Material Symbols Rounded

- Source: Google [Material Symbols](https://fonts.google.com/icons) (`@material-symbols/svg-400`)
- Licence: **Apache License 2.0** — free for commercial use / modification / redistribution.
- Usage: official SVG paths inlined into `src/ui/icons.js` — zero requests, zero CDN.

### Font · Cheonhyeong Full Font (Jeonjatang)

- Source: Shen Tianheng "Jeonjatang" <http://cheonhyeong.com/index.html>
- Version: Cheonhyeong Full Font V5.0.0 (compiled 2025-09-25)
- Coverage: full Unicode — 150 000+ Han characters plus the symbols and minor scripts defined up to Unicode 17.0.
- Files: `public/fonts/th/th-ctf-subset.woff2` (first-paint subset), `th-p0.woff2` (plane 0 BMP), `th-p1.woff2` (plane 1 SMP), `th-p2.woff2` (plane 2 SIP), `th-p16.woff2` (plane 3+).
- **Licence & usage statement**: clause 6 of the official Cheonhyeong notes states "to protect the copyright of the font (including glyph copyrights of various companies and the compiler's own arrangement) … **do not use commercially**". This project is an open-source, non-commercial CTF learning tool that references the font locally only to display rare characters and makes no commercial use of the font itself, staying within those bounds. The copyright of the font belongs to Shen Tianheng and the original glyph copyright holders; for commercial use, obtain authorisation from the author or substitute a commercially usable font (e.g. Source Han Sans / HanaMin, both SIL OFL).

## Privacy

Zero upload is this tool's signature: core algorithms never upload your input; the PWA and update checks download site assets only; the local bridge only talks to `127.0.0.1`; external AI connects directly to the endpoint and key you configure yourself, with no relay or logging by the main project.
