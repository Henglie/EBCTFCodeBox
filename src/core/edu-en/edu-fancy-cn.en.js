// English edu shard: fancy 4 (deadfish/befunge/emojicodeIdent/pietIdent) + cn 5 (stemBranch/baiJiaXing/element/rot8000/makkaPakka). Pure data, no import, no side effects.
export default {
 // ============ Fancy / esoteric languages ============
  deadfish: {
    what: "Deadfish: billed as 'the most useless language'. It has just one accumulator and 4 instructions — add, subtract, square, output — and nothing else.",
    principle:
      "One accumulator `acc` (initial value 0) + 4 instructions: `i` increment, `d` decrement, `s` square, `o` output the current value.\n\n" +
      "The classic boundary rule: after each step, if `acc` becomes -1 or 256, reset it to zero. When decoding, this tool outputs the numeric sequence plus a preview that treats the numbers as character codes.",
    usage: "Decode: paste an `idso` instruction string; the tool executes it and outputs the value at each `o` plus a character preview. Encode: turn text into an instruction string that prints it (walk i/d to the target code for each character, then o).",
    examples: [
      { in: "玛卡巴卡轰阿巴雅卡轰伊卡阿卡噢轰", out: "(this is Makka Pakka, not Deadfish)", desc: "Don't confuse them — see makkaPakka below" },
      { in: "iiii...o", out: "corresponding value", desc: "Increment several times, then output" },
    ],
    tips: ["A string made only of i/d/s/o that also contains o is basically Deadfish.", "`s` is square — combined with i it pushes the accumulator to large numbers fast, so don't treat it as just add/subtract."],
    aka: ["deadfish", "死鱼语言", "累加器语言", "死鱼", "deadfish语言", "idso",
      "最没用的语言", "accumulator language", "deadfish esolang", "无用语言", "i d s o", "深奥语言deadfish"],
  },

  befunge: {
    what: "Befunge-93: an esoteric language whose instructions sit in a 2D grid, with a pointer that can move up/down/left/right. The code looks like an ASCII maze.",
    principle:
      "Instructions are written on a grid; the pointer moves in the direction set by `>`/`<`/`^`/`v`, wrapping around at the edges (like a snake going through a wall). A single stack holds data, and `@` ends the program.\n\n" +
      "Common instructions: `0-9` push a number, `+ - * / %` arithmetic, `\"` enter/exit string mode (push characters), `. ,` output number/character, `: \\` duplicate/swap the top, `_ |` branch horizontally/vertically on the top of stack. A step limit guards against infinite loops.",
    usage: "Paste Befunge-93 code to run; the tool outputs the result.",
    examples: [
      { in: '>25*"!dlroW olleH":v\n                 v:,_@\n                 >  ^', out: "Hello World!", desc: "The classic Hello World (structure sketch)" },
    ],
    tips: ["A screen full of `>v<^` direction arrows + a `@` terminator + quoted strings is Befunge.", "It runs by looping the pointer around a 2D plane, so read the code following the arrows, not left to right."],
    aka: ["befunge", "befunge-93", "二维语言", "2d esolang", "befunge93", "Befunge",
      "二维深奥语言", "网格语言", "fungeoid", "befunge 93", "二维栈语言", "指针网格语言"],
  },

  emojicodeIdent: {
    what: "Emojicode identification: Emojicode is a real compiled language that uses emoji as keywords, so source looks like 🏁🍇…🍉. This tool only identifies and annotates; it does not execute.",
    principle: "It scans the text for signature keyword emoji: 🏁 (program entry), 🍇🍉 (block start/end), 🔤 (string), 🍮 (variable), 🍊 (if), 🔁 (while), etc., counts hits, and gives a confidence score. Actual compilation/execution requires `emojicodec`.",
    usage: "Paste suspected Emojicode source; the tool reports which keyword emoji were hit, how many times each, and how likely it is Emojicode.",
    examples: [
      { in: "🏁 🍇 😀 🔤Hello🔤❗️ 🍉", out: "Identified as Emojicode (has entry 🏁 + block 🍇🍉)" },
    ],
    tips: ["Something starting with 🏁 and using 🍇/🍉 pairs to wrap code is most likely Emojicode rather than plain emoji steganography.", "This is an identification tool: it tells you 'what language this is', it doesn't run it for you."],
    aka: ["emojicode", "emojicode识别", "emoji语言", "Emojicode", "emoji编程语言", "表情编程语言",
      "emojicodec", "emoji代码", "🏁语言", "emojicode source", "emoji关键字语言", "表情符号语言"],
  },

  pietIdent: {
    what: "Piet identification: Piet is an esoteric language that renders programs as abstract paintings, with instructions hidden in color blocks. Plain text can't run it, so this tool only identifies and explains.",
    principle: "A Piet program is a bitmap made of 18 colors (6 hues × 3 lightness) plus black and white. The pointer moves between same-color blocks, encoding push/arithmetic/IO instructions via the hue and lightness differences between adjacent blocks. Execution requires the image itself (the pixels).",
    usage: "Paste content that might relate to Piet (file name, color values, keywords); the tool gives identification hints and explains the principle. Actually running it requires the image.",
    examples: [
      { in: "program.png (a colorful block mosaic)", out: "Hint: likely Piet, needs the image pixels to execute" },
    ],
    tips: ["When the challenge gives a small image that looks like a modern abstract painting (mosaic color blocks), think Piet.", "The relative color change (hue/lightness difference) is the instruction; a single color on its own means nothing."],
    aka: ["piet", "piet识别", "色块语言", "图像编程语言", "Piet", "彩色块语言",
      "位图编程语言", "抽象画语言", "图形深奥语言", "像素编程语言", "颜色编程语言", "piet esolang"],
  },

 // ============ Chinese / native encodings ============
  stemBranch: {
    what: "Heavenly Stems and Earthly Branches encoding: borrows the sexagenary cycle ('甲子, 乙丑… 癸亥') as 60 symbols, treating the data as a big integer in base 60.",
    principle:
      "The ten Heavenly Stems (甲乙丙丁戊己庚辛壬癸) × the twelve Earthly Branches (子丑寅卯辰巳午未申酉戌亥) cycle into 60 'stem-branch' pairs, forming a base60 alphabet.\n\n" +
      "It concatenates the source UTF-8 bytes into one big integer, then repeatedly divides by 60 and looks up the stem-branch table. Each stem-branch is 2 Chinese characters, so the ciphertext always has an even number of characters.",
    usage: "Paste a stem-branch string (e.g. '己巳壬申辛酉') to decode; encode direction turns text into stem-branch. Length must be even.",
    examples: [
      { in: "己巳壬申辛酉", out: "Hi", desc: "3 stem-branch pairs = 3 base60 digits" },
    ],
    tips: ["A neat string of 'stem + branch' two-character combos with an even count → try stem-branch.", "It's fundamentally a base60 big integer, same idea as base58/base62, just with a stem-branch alphabet."],
    aka: ["天干地支", "六十甲子", "干支编码", "base60", "stem branch", "干支纪年编码",
      "甲子编码", "60进制编码", "天干地支编码", "stem-branch", "六十进制", "干支base"],
  },

  baiJiaXing: {
    what: "Hundred Family Surnames encoding: maps the 64 characters of base64 one-to-one to surnames from the 'Hundred Family Surnames' (赵=0, 钱=1…), outputting a string of surnames.",
    principle: "First it standard-base64-encodes the source, then by a fixed mapping replaces each base64 character with a surname (赵钱孙李… covering A-Z, a-z, 0-9 and symbols). Decoding reverses the surnames back to base64, then decodes.",
    usage: "Paste a surname string to decode; encode direction turns text into Hundred Family Surnames.",
    examples: [
      { in: "花潘何贝", out: "Hi", desc: "Four surnames correspond to base64 SGk=" },
    ],
    tips: ["A row of common surnames that don't form actual names is most likely Hundred Family Surnames encoding.", "It's essentially 'base64 + single-table substitution'; strip the surname mapping and it's plain base64."],
    aka: ["百家姓", "百家姓编码", "姓氏编码", "baijiaxing", "赵钱孙李编码", "百家姓base64",
      "姓氏base64", "bai jia xing", "中文姓氏编码", "百家姓映射", "赵钱孙李", "姓名编码"],
  },

  element: {
    what: "Periodic table encoding: maps a character's code to a chemical element symbol (H=1, He=2… Og=118). A string of element symbols is really a string of numbers.",
    principle: "A symbol table ordered by atomic number (H, He, Li, …, Og, 118 total) serves as the alphabet. When encoding, each character's code (1-118) is replaced by the matching element symbol; decoding reverses it. Characters outside 1-118 cannot be encoded.",
    usage: "Paste an element-symbol string (space-separated, e.g. `Hf Db`) to decode; encode direction turns text into element symbols. Only characters with a code of 1-118 are supported.",
    examples: [
      { in: "Hf Db", out: "Hi", desc: "Hf is #72, H has code 72; Db is #105, i has code 105" },
    ],
    tips: ["A string of valid element symbols (capital first letter, optionally one lowercase) that doesn't form a chemical formula → consider element encoding.", "Common trap: iodine is I (#53), not In; zinc is Zn (#30), not Zi — don't use the wrong symbol."],
    aka: ["元素周期表", "元素编码", "化学元素编码", "element", "元素符号编码", "周期表编码",
      "原子序数编码", "periodic table", "化学符号编码", "元素周期表编码", "element cipher", "元素符号"],
  },

  rot8000: {
    what: "ROT8000: a ROT rotation over the whole of Unicode (including CJK). The shift is half the character space, so like ROT13/ROT47 it is reciprocal (rotate twice to return to the original).",
    principle: "It numbers the visible Unicode characters by a contiguous index table and rotates the whole thing by 31702 (≈ half of the 63404 effective total characters). The shift is exactly half a turn, so encode and decode are the same operation. Spaces stay unchanged.",
    usage: "Paste text and convert with one click (run it again to reverse).",
    examples: [
      { in: "籑籲", out: "Hi", desc: "ASCII is rotated into the CJK region too" },
    ],
    tips: ["ASCII plaintext turns into a string of Chinese/rare characters through it; conversely, a jumble of CJK may be ROT8000.", "Reciprocal: if unsure of direction, just run it again — if it returns to readable text, you're done."],
    aka: ["rot8000", "rot 8000", "unicode rot", "cjk旋转", "ROT8000", "rot-8000",
      "Unicode ROT", "全Unicode旋转", "unicode回转", "rot13变体", "自反unicode编码", "汉字rot"],
  },

  makkaPakka: {
    what: "Makka Pakka encoding: borrows the babbling of 'In the Night Garden' characters (Makka Pakka, Upsy Daisy, Igglepiggle…) as an alphabet, encoding each character into a cutesy phrase ending in '轰'.",
    principle: "Each encodable character maps to a fixed Chinese onomatopoeic phrase, all ending in '轰' (which acts as a separator). When decoding, it splits on '轰' and greedily matches the longest phrase to restore each character. Characters not in the table are dropped when encoding.",
    usage: "Paste a Makka Pakka string to decode; encode direction turns text into Makka Pakka.",
    examples: [
      { in: "玛卡巴卡轰阿巴雅卡轰伊卡阿卡噢轰", out: "abc", desc: "One character per segment, separated by '轰'" },
    ],
    tips: ["A screen full of '玛卡巴卡/阿巴雅卡/咿呀呦' with '轰' appearing repeatedly is this one.", "'轰' is the separator, so splitting on 轰 first, then looking up each segment, is the most intuitive approach."],
    aka: ["玛卡巴卡", "花园宝宝", "makkapakka", "阿巴雅卡", "玛卡巴卡编码", "makka pakka",
      "In the Night Garden", "咿呀呦", "轰编码", "花园宝宝编码", "玛卡巴卡语言", "呓语编码"],
  },
};
