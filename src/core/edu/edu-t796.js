export default {
  httpDechunk: {
    what: "HTTP 分块解码（Dechunk）把 chunked Transfer-Encoding 的响应体还原成原始字节：去掉每个 chunk 的长度行和分隔 CRLF，并读取结尾的 0 长度块。",
    principle:
      "chunked 响应体由若干块组成：每块以十六进制长度开头，后跟 CRLF、块数据再跟 CRLF；长度 0 的块表示结束，之后可跟 trailer 头和最终 CRLF。\n\nDechunk 只做协议层拆封，不解析 gzip/deflate 等 Content-Encoding；如果服务器还压了内容，需要再配合解压。",
    usage:
      "输入可以是完整 HTTP 响应或只有 body 的 chunked 数据；`inputEnc=raw` 表示按原始文本读，hex/base64 用于二进制粘贴。输出为去掉长度行后的原始 body 文本。",
    examples: [
      { in: "4\\r\\nWiki\\r\\n0\\r\\n\\r\\n", param: "inputEnc=raw", out: "Wiki", desc: "单块最小例" },
      { in: "5\\r\\nHello\\r\\n6\\r\\n World\\r\\n0\\r\\n\\r\\n", param: "inputEnc=raw", out: "Hello World", desc: "两块拼接" },
    ],
    tips: [
      "十六进制长度行可能带 chunk extension（;key=value），应以分号截断后再取长度。",
      "结尾 0 块之后可能还有 trailer 头，Dechunk 只应输出 body，不要把 trailer 混进结果。",
      "如果响应是 chunked + gzip，需要先 Dechunk 再 gzip 解压，顺序反了会失败。",
      "CF（Capture File）流量题里常见 chunked 抓包，先重组 TCP 流再做 Dechunk。",
    ],
    aka: ["Dechunk", "HTTP Dechunk", "chunked 解码", "分块传输解码", "Transfer-Encoding chunked", "HTTP 分块", "chunked body", "去 chunk 长度", "HTTP 响应拆封", "chunk 解码", "Dechunk HTTP response", "分块响应解码"],
  },
  splitChannels: {
    what: "拆分颜色通道（Split Colour Channels）把一张 RGBA 图片拆成 R、G、B、A 四张灰度 PNG，每张只保留一个通道，便于逐通道做 LSB/位平面分析。",
    principle:
      "对每个像素 (r,g,b,a)，输出四张图的同一位置分别填 (r,r,r,255)、(g,g,g,255)、(b,b,b,255)、(a,a,a,255)。这样单通道差异会被放大成灰度明暗，隐写痕迹更容易看见。\n\n拆分不改变数据，只是把通道分量可视化；合并回原图需要反向按通道拼装。",
    usage:
      "输入 PNG/BMP 等可解码图片，输出 4 个可下载 PNG（channel_R/G/B/A.png）。透明图也能单独查看 alpha，不会把透明区域误当黑色。",
    examples: [
      { in: "任意 RGBA PNG", param: "默认", out: "channel_R.png / channel_G.png / channel_B.png / channel_A.png", desc: "四通道各一张" },
    ],
    tips: [
      "通道拆分后优先看 LSB 平面；单通道灰度图比原图更容易暴露弱水印。",
      "alpha 通道常被忽略，透明图里也常藏数据。",
      "如果只需要某几个通道，可在得到 4 张后按需取舍，不必额外写 op。",
      "拆分前后的尺寸与像素数应完全一致，尺寸变化说明解码/缩放出了问题。",
    ],
    aka: ["Split Colour Channels", "Split Color Channels", "拆分颜色通道", "通道拆分", "R/G/B/A 拆分", "RGBA 分离", "颜色通道分离", "channel split", "split channels", "图像通道拆解", "色彩通道", "单通道提取"],
  },
};
