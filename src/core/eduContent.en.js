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

const EDU_EN = Object.assign(
  {},
  EDU_EN_BASE1,
  EDU_EN_BASE2,
);

registerEduEn(EDU_EN);
export default EDU_EN;
