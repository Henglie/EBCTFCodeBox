/*
 * fieldPatches.js — T957 游戏求解器多字段输入补丁（MT810/T957 接线）。
 *
 * 由 资料/工程留存/T957/candidates/field-patches.json 逐字生成（不手工誊抄）：
 * 8 个 op 追加 fields/fieldsJoin（UI 自动渲染多字段框，按 fieldsJoin 拼回输入，与旧多行输入等价）；
 * 归一化在 run 入口做：_to_0（华容道 _→0）、dash_to_underscore（短语 -→_，仅 === 之前）。
 * 不改 ops 源文件；在插件 setup 注册时按 id 注入。
 */

const NORMALIZE = {
  _to_0: (t) => String(t).replace(/_/g, "0"),
  dash_to_underscore: (t) => {
    const parts = String(t).split(/^\s*={3,}\s*$/m);
    parts[0] = parts[0].replace(/-/g, "_");
    return parts.join("\n===\n");
  },
};

const PATCHES = {
  "dcode-extras-2026-10/game-sudoku": {
    "fieldsJoin": "\n",
    "fields": [
      {
        "key": "r1",
        "label": "第 1 行",
        "placeholder": "如 1..4 / 53..7....",
        "rows": 1
      },
      {
        "key": "r2",
        "label": "第 2 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r3",
        "label": "第 3 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r4",
        "label": "第 4 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r5",
        "label": "第 5 行（9 阶起填写）",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r6",
        "label": "第 6 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r7",
        "label": "第 7 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r8",
        "label": "第 8 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r9",
        "label": "第 9 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r10",
        "label": "第 10 行（12 阶起填写）",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r11",
        "label": "第 11 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r12",
        "label": "第 12 行",
        "placeholder": "",
        "rows": 1
      }
    ]
  },
  "dcode-extras-2026-10/game-taquin": {
    "fieldsJoin": "\n",
    "fields": [
      {
        "key": "r1",
        "label": "第 1 行（空格用 0，不是 _）",
        "placeholder": "如 1 2 3",
        "rows": 1
      },
      {
        "key": "r2",
        "label": "第 2 行",
        "placeholder": "如 4 5 6",
        "rows": 1
      },
      {
        "key": "r3",
        "label": "第 3 行",
        "placeholder": "如 7 0 8",
        "rows": 1
      },
      {
        "key": "r4",
        "label": "第 4 行（4×4/5×5 填写）",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r5",
        "label": "第 5 行（5×5 填写）",
        "placeholder": "",
        "rows": 1
      }
    ],
    "normalize": "_to_0"
  },
  "dcode-extras-2026-10/game-lightsout": {
    "fieldsJoin": "\n",
    "fields": [
      {
        "key": "r1",
        "label": "第 1 行（0/1）",
        "placeholder": "如 110",
        "rows": 1
      },
      {
        "key": "r2",
        "label": "第 2 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r3",
        "label": "第 3 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r4",
        "label": "第 4 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r5",
        "label": "第 5 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r6",
        "label": "第 6 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r7",
        "label": "第 7 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r8",
        "label": "第 8 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r9",
        "label": "第 9 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r10",
        "label": "第 10 行",
        "placeholder": "",
        "rows": 1
      }
    ]
  },
  "dcode-extras-2026-10/game-takuzu": {
    "fieldsJoin": "\n",
    "fields": [
      {
        "key": "r1",
        "label": "第 1 行（0/1/_/.）",
        "placeholder": "如 0.11",
        "rows": 1
      },
      {
        "key": "r2",
        "label": "第 2 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r3",
        "label": "第 3 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r4",
        "label": "第 4 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r5",
        "label": "第 5 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r6",
        "label": "第 6 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r7",
        "label": "第 7 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r8",
        "label": "第 8 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r9",
        "label": "第 9 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r10",
        "label": "第 10 行",
        "placeholder": "",
        "rows": 1
      }
    ]
  },
  "dcode-extras-2026-10/game-latin": {
    "fieldsJoin": "\n",
    "fields": [
      {
        "key": "r1",
        "label": "第 1 行（空格用 _）",
        "placeholder": "如 1_3",
        "rows": 1
      },
      {
        "key": "r2",
        "label": "第 2 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r3",
        "label": "第 3 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r4",
        "label": "第 4 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r5",
        "label": "第 5 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r6",
        "label": "第 6 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r7",
        "label": "第 7 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r8",
        "label": "第 8 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r9",
        "label": "第 9 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r10",
        "label": "第 10 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r11",
        "label": "第 11 行",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "r12",
        "label": "第 12 行",
        "placeholder": "",
        "rows": 1
      }
    ]
  },
  "dcode-extras-2026-10/game-set": {
    "fieldsJoin": " ",
    "fields": [
      {
        "key": "c1",
        "label": "第 1 张牌",
        "placeholder": "如 1RSS",
        "rows": 1
      },
      {
        "key": "c2",
        "label": "第 2 张牌",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "c3",
        "label": "第 3 张牌",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "c4",
        "label": "第 4 张牌",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "c5",
        "label": "第 5 张牌",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "c6",
        "label": "第 6 张牌",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "c7",
        "label": "第 7 张牌",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "c8",
        "label": "第 8 张牌",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "c9",
        "label": "第 9 张牌",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "c10",
        "label": "第 10 张牌",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "c11",
        "label": "第 11 张牌",
        "placeholder": "",
        "rows": 1
      },
      {
        "key": "c12",
        "label": "第 12 张牌",
        "placeholder": "",
        "rows": 1
      }
    ]
  },
  "dcode-extras-2026-10/d3-letterboxed": {
    "fieldsJoin": " ",
    "fields": [
      {
        "key": "top",
        "label": "上边字母",
        "placeholder": "如 abcd",
        "rows": 1
      },
      {
        "key": "left",
        "label": "左边字母",
        "placeholder": "如 efgh",
        "rows": 1
      },
      {
        "key": "right",
        "label": "右边字母",
        "placeholder": "如 ijkl",
        "rows": 1
      },
      {
        "key": "bottom",
        "label": "下边字母",
        "placeholder": "如 mnop",
        "rows": 1
      }
    ]
  },
  "dcode-extras-2026-10/d3-phrasefilter": {
    "fieldsJoin": "\n===\n",
    "fields": [
      {
        "key": "pattern",
        "label": "短语模式",
        "placeholder": "Q--LL- -ST L- PH--S-",
        "rows": 1
      },
      {
        "key": "phrases",
        "label": "候选短语（一行一条；多行请用原单框）",
        "placeholder": "QUELLE EST LA PHRASE",
        "rows": 2
      }
    ],
    "normalize": "dash_to_underscore"
  }
};

/** 注册前注入字段补丁；返回（可能包装过 run 的）op。 */
export function applyFieldPatch(op) {
  const id = String(op && op.id || "");
  const PREFIX = "dcode-extras-2026-10/";
  const key = PATCHES[id]
    ? id
    : (PATCHES[PREFIX + id] ? PREFIX + id : (id.startsWith(PREFIX) && PATCHES[id.slice(PREFIX.length)] ? id.slice(PREFIX.length) : null));
  const patch = key ? PATCHES[key] : null;
  if (!patch) return op;
  const next = { ...op, fields: patch.fields, fieldsJoin: patch.fieldsJoin };
  if (patch.normalize && typeof op.run === "function") {
    const norm = NORMALIZE[patch.normalize];
    const origRun = op.run;
    next.run = (t, p) => origRun(norm(t), p);
  }
  return next;
}

export const PATCHED_IDS = Object.keys(PATCHES);
