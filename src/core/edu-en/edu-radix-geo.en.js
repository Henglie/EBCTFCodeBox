// English edu shard: radix "geo coordinate encoding" group — 4 ops. Pure data, no imports, no side effects.
// geoDms / geoPlusCode / geoMaidenhead / geoUtm (sample values computed by geo.js)
export default {
  geoDms: {
    what: "Converts latitude/longitude between \"degrees-minutes-seconds\" (DMS) and \"decimal degrees\" (DD) notation. The `39°30'0\"N` you see on maps is degrees-minutes-seconds.",
    principle:
      "Decimal degrees to DMS: the integer part is degrees, the fractional part ×60 gives minutes (integer part), and the remainder ×60 gives seconds. Hemisphere is marked with N/S (latitude) and E/W (longitude) for sign.\n\n" +
      "$DD = degrees + \\dfrac{minutes}{60} + \\dfrac{seconds}{3600}$, and the reverse just truncates level by level.",
    usage: "encode turns `lat,lon` (decimal degrees) into DMS. decode turns a DMS string back into decimal degrees.",
    examples: [
      { in: "39.5,116.5", param: "Encode", out: "39°30'0\"N, 116°30'0\"E" },
      { in: "39°30'0\"N, 116°30'0\"E", param: "Decode", out: "39.5,116.5" },
    ],
    formulas: [
      { tex: "DD = D + \\frac{M}{60} + \\frac{S}{3600}", caption: "degrees-minutes-seconds → decimal degrees" },
    ],
    tips: ["GPS devices, marine and aviation mostly use DMS; navigation apps and programming mostly use decimal degrees.", "A minus sign = south latitude / west longitude, equivalent to the S/W hemisphere marker."],
    aka: ["dms", "度分秒", "经纬度", "十进制度", "dd", "degrees minutes seconds",
      "decimal degrees", "经纬度转换", "DMS转DD", "坐标格式转换", "度分秒转换", "GPS坐标"],
  },

  geoPlusCode: {
    what: "Google's Plus Code (Open Location Code, OLC): encodes latitude/longitude into a short code, so even places with no street address can be pinpointed precisely.",
    principle:
      "On the grid of latitude [-90,90] and longitude [-180,180], subdivide level by level: each pair of characters locates one grid layer, with the alphabet `23456789CFGHJMPQRVWX` (easily-confused characters removed).\n\n" +
      "A `+` separator is inserted after the first 8 characters; an 11-character full code pinpoints to about a few meters.",
    usage: "encode turns `lat,lon` into a Plus Code (8-char short code or 11-char full code). decode turns a Plus Code back into the center point of its coordinates.",
    examples: [
      { in: "39.9,116.4", param: "11-char full code", out: "8PFRW92X+2X", desc: "near Beijing" },
    ],
    tips: ["Easy to recognize: a string of uppercase letters and digits with a `+` in the middle, containing no easily-confused characters like 0/1/A/E/I/O/U.", "Search a Plus Code directly in Google Maps to jump to that point, no registered address needed."],
    aka: ["plus code", "olc", "开放位置码", "google plus code", "加号码", "Open Location Code",
      "谷歌位置码", "plus codes", "OLC编码", "加号地址码", "开放地点编码", "google定位码"],
  },

  geoMaidenhead: {
    what: "Maidenhead grid locator: a shorthand coordinate notation used in the amateur radio (HAM) community, like `OM89ev`. Common in radio/HAM challenges in CTF.",
    principle:
      "Divide the earth into large cells (fields, 2 letters) of 20° longitude by 10° latitude, then subdivide by 2°×1° (2 digits), then by 5'×2.5' (2-letter subsquare), and it can extend further.\n\n" +
      "Letters and digits alternate; longer means more precise.",
    usage: "encode turns `lat,lon` into a grid locator (default 6 characters, 3 pairs). decode turns a grid locator back into the center point of its coordinates.",
    examples: [
      { in: "39.9,116.4", param: "6 characters", out: "OM89ev", desc: "grid near Beijing" },
    ],
    tips: ["The format is easy to spot: 2 uppercase letters + 2 digits (+ 2 lowercase letters), like `FN20` or `OM89ev`.", "HAM station spotting reports and satellite contact logs are full of it — see one and think of this."],
    aka: ["maidenhead", "网格定位", "qth locator", "ham网格", "梅登黑德", "Maidenhead Locator",
      "梅登黑德网格", "grid locator", "业余无线电网格", "QTH定位", "网格坐标", "HAM定位系统"],
  },

  geoUtm: {
    what: "UTM coordinates: divide the earth into 60 projection zones each 6° wide, expressing a position with metric coordinates of \"zone number + latitude band letter + easting + northing\", like `50S 448709 4416831`.",
    principle:
      "Based on the WGS84 ellipsoid and the transverse Mercator projection (Snyder/USGS formulas). Zone number `zone = floor((longitude+180)/6)+1` (1-60), and latitude uses band letters C-X (skipping I/O, one band every 8°).\n\n" +
      "Easting and northing are in meters; the central meridian's easting is fixed with +500000 added to avoid negative values.",
    usage: "encode turns `lat,lon` into UTM. decode turns `zone-letter easting northing` back into latitude/longitude.",
    examples: [
      { in: "39.9,116.4", param: "Encode", out: "50S 448709 4416831", desc: "Beijing is in zone 50" },
    ],
    tips: ["Military maps, surveying, and GIS use UTM heavily because it's metric and convenient for measuring distances.", "The latitude bands skip I and O (to avoid confusion with 1 and 0) — this is a fixed rule of UTM lettering."],
    aka: ["utm", "utm坐标", "通用横轴墨卡托", "军用坐标", "投影坐标", "Universal Transverse Mercator",
      "UTM投影", "横轴墨卡托", "UTM网格", "米制坐标", "墨卡托投影坐标", "UTM zone"],
  },
};
