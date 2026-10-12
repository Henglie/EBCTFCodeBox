/*
 * eduImages.js — op 科普卡对照图映射（opId → 图鉴对照图）。
 *
 * 定位：图鉴（public/codeimages/）里有一批「能被本箱某个 op 自动解析」的编码对照图
 * （猪圈/培根/盲文/波利比奥斯/敲击码/ADFGX/摩斯变体…）。把这些图挂到对应 op 的
 * 科普卡，用户在解码页就能直接看到字形/坐标对照表，不必翻图鉴。
 *
 * 为什么独立成表（不塞进 eduContent 分片）：
 * eduContent 的 Object.assign 是**浅合并**，同 opId 后一个分片对象会**整个覆盖**前者。
 * 若把 image 塞进新分片，会连带覆盖掉该 op 已有的 {what/principle/examples...}。
 * 故图片映射独立维护，renderEduCard 单独查本表叠加渲染，零覆盖风险、零耦合。
 *
 * 契约：export default { [opId]: { src, cap } | Array<{src,cap}> }。
 * src 相对 index.html 的图片路径（public/codeimages/xxx）
 * cap 图注（中文，说明这张图是什么）
 * 一个 op 可挂多张图（如 morse 有圆形/山形两种变体图）→ 用数组。
 *
 * 红线：纯数据，无 import、无副作用。只填 registry 真实存在的 opId + 图鉴真实存在的文件。
 * polybius/tapcode/adfgx/adfgvx 四张 svg 为本箱自制（公共领域古典密码规则表）。
 * american-morse/morse-rhythm/wabun/futhark/counting-rods/alien-alphabet/chuck-unary/
 * cardan-grille/tadpole/wingdings-zapf 十张 svg 亦为本箱自制（公共领域码表/规则图，
 * 算筹棍形纯几何绘制不依赖字体；来源与许可逐图见 工程留存 sources 台账）。
 * baudot/decabit/pollux/morbit/straddle-checkerboard 五张 svg 同为自制（表值取自本工具
 * op 实跑，逐槽核对 363/0；来源与许可随图登记于工程留存归档 sources.md）。
 */
export default {
  bacon: { src: "public/codeimages/bacon.png", cap: "培根密码 A/B 五位字母对照表" },
  braille: { src: "public/codeimages/braille.png", cap: "盲文 6 点位 ↔ 字母对照表" },
  color: { src: "public/codeimages/color.webp", cap: "颜色编码对照" },
  dna: { src: "public/codeimages/dna.webp", cap: "DNA 碱基密码子 ↔ 字母对照表" },
  foursquare: { src: "public/codeimages/foursquare.webp", cap: "四方密码 4 格方阵示意" },
  pigpen: { src: "public/codeimages/pigpen.webp", cap: "猪圈密码井字/十字格 ↔ 字母对照" },
  semaphore: { src: "public/codeimages/semaphore.webp", cap: "旗语 ↔ 字母对照表" },
  polybius: { src: "public/codeimages/polybius.svg", cap: "波利比奥斯 5×5 方阵（字母→行列坐标）" },
  adfgx: { src: "public/codeimages/adfgx.svg", cap: "ADFGX 5×5 密码表（字母→双码 A/D/F/G/X）" },
  adfgvx: { src: "public/codeimages/adfgvx.svg", cap: "ADFGVX 6×6 密码表（26 字母+10 数字→双码 A/D/F/G/V/X）" },
  tapCode: { src: "public/codeimages/tapcode.svg", cap: "敲击码 5×5 表（行敲击·停顿·列敲击）" },
  morse: [
    { src: "public/codeimages/morseircle.webp", cap: "圆形摩尔斯对照盘" },
    { src: "public/codeimages/morsemountain.webp", cap: "山形摩尔斯对照图" },
  ],
  americanMorse: { src: "public/codeimages/american-morse.svg", cap: "美式摩斯码对照表（.点 -划 _长划，码内空格=内部间隔）" },
  morseRhythm: { src: "public/codeimages/morse-rhythm.svg", cap: "摩斯点划符号变体规范化对照（·−↔.-）" },
  wabun: { src: "public/codeimages/wabun.svg", cap: "和文摩尔斯标准表（片假名/记号 ↔ 点划）" },
  futhark: { src: "public/codeimages/futhark.svg", cap: "卢恩符文对照表（elder 24 符 + younger 16 符 + 解码变体）" },
  countingRods: { src: "public/codeimages/counting-rods.svg", cap: "算筹纵横两式对照（一纵十横：个位纵式、十位横式）" },
  alienAlphabet: { src: "public/codeimages/alien-alphabet.svg", cap: "外星字母 26 符对照表（Unicode 档，dCode 表）" },
  chuckUnary: { src: "public/codeimages/chuck-unary.svg", cap: "Chuck Norris 一元码规则图（位流→游程→0/00 组）" },
  cardanGrille: { src: "public/codeimages/cardan-grille.svg", cap: "卡丹格掩模原理（X 实格 _ 孔，孔位取字）" },
  tadpole: { src: "public/codeimages/tadpole.svg", cap: "蝌蚪文 16 符 ↔ 十六进制 nibble 对照表" },
  wingdings: { src: "public/codeimages/wingdings-zapf.svg", cap: "Zapf Dingbats 编码表（wingdings op zapf 档 0x21-0x7E）" },
  baudot: { src: "public/codeimages/baudot.svg", cap: "博多码对照表（ITA2/ITA1 字母+数字，5 位码）" },
  decabit: { src: "public/codeimages/decabit.svg", cap: "Decabit 脉冲码表（值 0-126 ↔ 10 位 +/− 串）" },
  pollux: { src: "public/codeimages/pollux.svg", cap: "Pollux 密码符号映射（点/划/分隔 三组符号集）" },
  morbit: { src: "public/codeimages/morbit.svg", cap: "Morbit 密码符号对 ↔ 数字对照（9 字符密钥定秩）" },
  straddleCheckerboard: { src: "public/codeimages/straddle-checkerboard.svg", cap: "跨棋盘密码 3×10 棋盘（首行 8 高频字母 + 两空列前缀）" },
};
