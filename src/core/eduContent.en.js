/*
 * eduContent.en.js — English edu content aggregation entry.
 *
 * Each edu-en/ shard file is a translated version of the corresponding
 * src/core/edu/*.js Chinese source. Shards are added here as they are translated.
 * Missing shards fall back to Chinese automatically (see getEdu in eduContent.js).
 *
 * Translation standards:
 * - what / principle / usage / tips: translate to natural English, keep technical terms
 * - examples: keep in/out/param values as-is (they are actual code/data), translate desc only
 * - formulas: keep TeX unchanged, translate caption to English
 * - aka: keep original aliases, add English aliases if applicable
 * - LaTeX math ($...$) and backtick code (`...`) syntax: unchanged
 */

import { registerEduEn } from "./eduContent.js";

// ---- Translated shards (add import here as each shard is completed) ----
import EDU_EN_BASE1 from "./edu-en/edu-base1.en.js";
import EDU_EN_BASE2 from "./edu-en/edu-base2.en.js";
import EDU_EN_CRYPTO_PG from "./edu-en/edu-crypto-pg.en.js"; // 18 个密码学扩充 op 英文科普卡
import EDU_EN_HASH_XXHASH from "./edu-en/edu-hash-xxhash.en.js"; // xxhash 1
import EDU_EN_HASH_CITYHASH from "./edu-en/edu-hash-cityhash.en.js"; // cityhash 1
import E_EN_EDU_ANA_CRYPTO_NEW from "./edu-en/edu-ana-crypto-new.en.js";
import EDU_EN_ANA_GEFTE from "./edu-en/edu-ana-geffe.en.js";  // geffe 1
import E_EN_EDU_ANA_FREQ from "./edu-en/edu-ana-freq.en.js";
import E_EN_EDU_ANA_NEW from "./edu-en/edu-ana-new.en.js";
import E_EN_EDU_ANA_REST from "./edu-en/edu-ana-rest.en.js";
import E_EN_EDU_ANA_RSA1 from "./edu-en/edu-ana-rsa1.en.js";
import E_EN_EDU_ANA_RSA2 from "./edu-en/edu-ana-rsa2.en.js";
import E_EN_EDU_ANA_SERIAL from "./edu-en/edu-ana-serial.en.js";
import E_EN_EDU_ANA_TOOLS from "./edu-en/edu-ana-tools.en.js";
import E_EN_EDU_ANA_TOOLS2 from "./edu-en/edu-ana-tools2.en.js";
import E_EN_EDU_BATCH_NEW from "./edu-en/edu-batch-new.en.js";
import E_EN_EDU_BATCH5_MODERN from "./edu-en/edu-batch5-modern.en.js";
import E_EN_EDU_BATCH5_NEW from "./edu-en/edu-batch5-new.en.js";
import E_EN_EDU_BATCH5_STEGO from "./edu-en/edu-batch5-stego.en.js";
import E_EN_EDU_BATCH6 from "./edu-en/edu-batch6.en.js";
import E_EN_EDU_BRIDGE_NEW from "./edu-en/edu-bridge-new.en.js";
import E_EN_EDU_CLASSIC_NEW from "./edu-en/edu-classic-new.en.js";
import E_EN_EDU_CLASSIC_REST from "./edu-en/edu-classic-rest.en.js";
import E_EN_EDU_CLASSIC1 from "./edu-en/edu-classic1.en.js";
import E_EN_EDU_CLASSIC2 from "./edu-en/edu-classic2.en.js";
import E_EN_EDU_CRYPTO_PG from "./edu-en/edu-crypto-pg.en.js";
import E_EN_EDU_EXE from "./edu-en/edu-exe.en.js";
import E_EN_EDU_FANCY_CN from "./edu-en/edu-fancy-cn.en.js";
import E_EN_EDU_FANCY_MODERN_NEW from "./edu-en/edu-fancy-modern-new.en.js";
import E_EN_EDU_FANCY_NEW from "./edu-en/edu-fancy-new.en.js";
import E_EN_EDU_FANCY_REST from "./edu-en/edu-fancy-rest.en.js";
import E_EN_EDU_FORENSIC_NEW from "./edu-en/edu-forensic-new.en.js";
import E_EN_EDU_HASH_XXHASH from "./edu-en/edu-hash-xxhash.en.js";
import E_EN_EDU_HASH1 from "./edu-en/edu-hash1.en.js";
import E_EN_EDU_HASH2 from "./edu-en/edu-hash2.en.js";
import E_EN_EDU_HASH3 from "./edu-en/edu-hash3.en.js";
import E_EN_EDU_MISC2_NEW from "./edu-en/edu-misc2-new.en.js";
import E_EN_EDU_MODERN_NEW from "./edu-en/edu-modern-new.en.js";
import E_EN_EDU_MODERN_REST from "./edu-en/edu-modern-rest.en.js";
import E_EN_EDU_MODERN1 from "./edu-en/edu-modern1.en.js";
import E_EN_EDU_MODERN2 from "./edu-en/edu-modern2.en.js";
import E_EN_EDU_RADIX_BITOPS from "./edu-en/edu-radix-bitops.en.js";
import E_EN_EDU_RADIX_CHECK from "./edu-en/edu-radix-check.en.js";
import E_EN_EDU_RADIX_COLOR from "./edu-en/edu-radix-color.en.js";
import E_EN_EDU_RADIX_CONVERT from "./edu-en/edu-radix-convert.en.js";
import E_EN_EDU_RADIX_GEO from "./edu-en/edu-radix-geo.en.js";
import E_EN_EDU_RADIX_HAMMING from "./edu-en/edu-radix-hamming.en.js";
import E_EN_EDU_RADIX_MATH from "./edu-en/edu-radix-math.en.js";
import E_EN_EDU_RADIX_NET from "./edu-en/edu-radix-net.en.js";
import E_EN_EDU_RADIX_NUM from "./edu-en/edu-radix-num.en.js";
import E_EN_EDU_RADIX_NUMSYS from "./edu-en/edu-radix-numsys.en.js";
import E_EN_EDU_RADIX_TIME from "./edu-en/edu-radix-time.en.js";
import E_EN_EDU_STEGO_IMAGE from "./edu-en/edu-stego-image.en.js";
import E_EN_EDU_STEGO_QR_AUDIO from "./edu-en/edu-stego-qr-audio.en.js";
import E_EN_EDU_STEGO_TEXT from "./edu-en/edu-stego-text.en.js";
import E_EN_EDU_UNIFIED_MISC from "./edu-en/edu-unified-misc.en.js";

const EDU_EN = Object.assign(
  {},
  E_EN_EDU_ANA_CRYPTO_NEW,
  EDU_EN_ANA_GEFTE,
  E_EN_EDU_ANA_FREQ,
  E_EN_EDU_ANA_NEW,
  E_EN_EDU_ANA_REST,
  E_EN_EDU_ANA_RSA1,
  E_EN_EDU_ANA_RSA2,
  E_EN_EDU_ANA_SERIAL,
  E_EN_EDU_ANA_TOOLS,
  E_EN_EDU_ANA_TOOLS2,
  EDU_EN_BASE1,
  EDU_EN_BASE2,
  E_EN_EDU_BATCH_NEW,
  E_EN_EDU_BATCH5_MODERN,
  E_EN_EDU_BATCH5_NEW,
  E_EN_EDU_BATCH5_STEGO,
  E_EN_EDU_BATCH6,
  E_EN_EDU_BRIDGE_NEW,
  E_EN_EDU_CLASSIC_NEW,
  E_EN_EDU_CLASSIC_REST,
  E_EN_EDU_CLASSIC1,
  E_EN_EDU_CLASSIC2,
  EDU_EN_CRYPTO_PG,
  E_EN_EDU_EXE,
  E_EN_EDU_FANCY_CN,
  E_EN_EDU_FANCY_MODERN_NEW,
  E_EN_EDU_FANCY_NEW,
  E_EN_EDU_FANCY_REST,
  E_EN_EDU_FORENSIC_NEW,
  EDU_EN_HASH_XXHASH,
  EDU_EN_HASH_CITYHASH,
  E_EN_EDU_HASH1,
  E_EN_EDU_HASH2,
  E_EN_EDU_HASH3,
  E_EN_EDU_MISC2_NEW,
  E_EN_EDU_MODERN_NEW,
  E_EN_EDU_MODERN_REST,
  E_EN_EDU_MODERN1,
  E_EN_EDU_MODERN2,
  E_EN_EDU_RADIX_BITOPS,
  E_EN_EDU_RADIX_CHECK,
  E_EN_EDU_RADIX_COLOR,
  E_EN_EDU_RADIX_CONVERT,
  E_EN_EDU_RADIX_GEO,
  E_EN_EDU_RADIX_HAMMING,
  E_EN_EDU_RADIX_MATH,
  E_EN_EDU_RADIX_NET,
  E_EN_EDU_RADIX_NUM,
  E_EN_EDU_RADIX_NUMSYS,
  E_EN_EDU_RADIX_TIME,
  E_EN_EDU_STEGO_IMAGE,
  E_EN_EDU_STEGO_QR_AUDIO,
  E_EN_EDU_STEGO_TEXT,
  E_EN_EDU_UNIFIED_MISC,
);

registerEduEn(EDU_EN);
export default EDU_EN;