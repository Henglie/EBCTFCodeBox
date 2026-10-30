# 中文查字编码码表 · 来源与许可

`public/data/cn/*.tsv`（原 `src/core/data/cn*Data.js` 已移除，避免把词典内嵌进 JS 模块）由 `tools/gen_cn_lookup_data.mjs` 生成，是下列上游数据的衍生数据库。代码本体仍按项目根 `LICENSE`（Apache-2.0）授权；**码表数据保留上游许可**。

| 文件 | 上游 | 许可 |
|---|---|---|
| `wubi.tsv` | [program-in-chinese/npm-wubi-code-data](https://github.com/program-in-chinese/npm-wubi-code-data) 1.0.2（98 表上游 [aardio/wubi-lex](https://github.com/aardio/wubi-lex)，MIT） | ISC |
| `zhengma.tsv` | [yefeijiang/Chinese-characters-code-table](https://github.com/yefeijiang/Chinese-characters-code-table) + [chen32768/zhengma_for_rime](https://github.com/chen32768/zhengma_for_rime)（只取 `zhengma.dict.yaml`，不带同仓拼音表） | BSD-2-Clause + Apache-2.0 |
| `telegraph.tsv` | [Unicode Unihan 18.0.0](https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip) `kMainlandTelegraph` + [lisposter/node-ctc](https://github.com/lisposter/node-ctc) | Unicode License v3 + MIT |
| `fourcorner.tsv` | Unicode Unihan 18.0.0 `kFourCornerCode` | Unicode License v3 |
| `cangjie.tsv` | Unicode Unihan 18.0.0 `kCangjie` | Unicode License v3 |
| 候选词频（生成时使用，不随包） | [ruddfawcett/hanziDB.csv](https://github.com/ruddfawcett/hanziDB.csv)（Jun Da 字频） | MIT |

---

## ISC · wubi-code-data

Copyright (c) nobodxbodon / program-in-chinese contributors

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## BSD-2-Clause · Chinese-characters-code-table

Copyright (c) yefeijiang

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Apache-2.0 · zhengma_for_rime

Copyright (c) chen32768 and contributors

Licensed under the Apache License, Version 2.0. The full license text is in the project root [`LICENSE`](../../../LICENSE). The upstream repository's NOTICE (if any) applies to the derived single-character table.

## MIT · node-ctc

Copyright (c) 2015 Leigh Zhu

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## MIT · hanziDB.csv

Copyright (c) 2017 Rudd Fawcett

The MIT text above applies. The frequency ranks are based on Jun Da's Modern Chinese Character Frequency List.

## Unicode License v3 · Unihan

Copyright © 1991-2026 Unicode, Inc. All rights reserved. Distributed under the Terms of Use in <https://www.unicode.org/copyright.html>.

Permission is hereby granted, free of charge, to any person obtaining a copy of the Unicode data files and any associated documentation (the "Data Files") or Unicode software and any associated documentation (the "Software") to deal in the Data Files or Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, and/or sell copies of the Data Files or Software, and to permit persons to whom the Data Files or Software are furnished to do so, provided that either (a) this copyright and permission notice appear with all copies of the Data Files or Software, or (b) this copyright and permission notice appear in associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF THIRD PARTY RIGHTS. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA FILES OR SOFTWARE.
