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
 * 图片版权：同类工具 224 编码图（webp/png）归同类工具工作室，本箱内嵌致谢；
 * polybius/tapcode/adfgx/adfgvx 四张 svg 为本箱自制（公共领域古典密码规则表）。
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
};
