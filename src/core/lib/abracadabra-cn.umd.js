/* abracadabra-cn.umd.js — SheepChef Abracadabra v3.7.7（本地化为 ESM）
 * 上游：https://github.com/SheepChef/Abracadabra （@SheepChef）
 * 改造：原 UMD IIFE 挂 globalThis["abracadabra-cn"]，此处原样保留（ESM 下 this=undefined
 * 工厂走 else 分支挂 globalThis），文件末尾补 ESM 具名导出 Abracadabra。
 * 自包含：内联 CryptoJS(AES-256-CTR/SHA256/MD5) + pako(gzip) + UNISHOX2 + MersenneTwister
 * 无 require / process，浏览器与 node 均可直接 import。禁止手改内部算法。
 */
(function(global2, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global2 = typeof globalThis !== "undefined" ? globalThis : global2 || self, factory(global2["abracadabra-cn"] = {}));
})(this, function(exports2) {
  "use strict";var __defProp = Object.defineProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);

  var _input, _output, _res;
  const version = "3.7.7";
  const VERSION = version;
  const _hasBuffer = typeof Buffer === "function";
  const _TD = typeof TextDecoder === "function" ? new TextDecoder() : void 0;
  const _TE = typeof TextEncoder === "function" ? new TextEncoder() : void 0;
  const b64ch = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const b64chs = Array.prototype.slice.call(b64ch);
  const b64tab = ((a) => {
    let tab = {};
    a.forEach((c, i) => tab[c] = i);
    return tab;
  })(b64chs);
  const b64re = /^(?:[A-Za-z\d+\/]{4})*?(?:[A-Za-z\d+\/]{2}(?:==)?|[A-Za-z\d+\/]{3}=?)?$/;
  const _fromCC = String.fromCharCode.bind(String);
  const _U8Afrom = typeof Uint8Array.from === "function" ? Uint8Array.from.bind(Uint8Array) : (it) => new Uint8Array(Array.prototype.slice.call(it, 0));
  const _mkUriSafe = (src) => src.replace(/=/g, "").replace(/[+\/]/g, (m0) => m0 == "+" ? "-" : "_");
  const _tidyB64 = (s) => s.replace(/[^A-Za-z0-9\+\/]/g, "");
  const btoaPolyfill = (bin) => {
    let u32, c0, c1, c2, asc = "";
    const pad = bin.length % 3;
    for (let i = 0; i < bin.length; ) {
      if ((c0 = bin.charCodeAt(i++)) > 255 || (c1 = bin.charCodeAt(i++)) > 255 || (c2 = bin.charCodeAt(i++)) > 255)
        throw new TypeError("invalid character found");
      u32 = c0 << 16 | c1 << 8 | c2;
      asc += b64chs[u32 >> 18 & 63] + b64chs[u32 >> 12 & 63] + b64chs[u32 >> 6 & 63] + b64chs[u32 & 63];
    }
    return pad ? asc.slice(0, pad - 3) + "===".substring(pad) : asc;
  };
  const _btoa = typeof btoa === "function" ? (bin) => btoa(bin) : _hasBuffer ? (bin) => Buffer.from(bin, "binary").toString("base64") : btoaPolyfill;
  const _fromUint8Array = _hasBuffer ? (u8a) => Buffer.from(u8a).toString("base64") : (u8a) => {
    const maxargs = 4096;
    let strs = [];
    for (let i = 0, l = u8a.length; i < l; i += maxargs) {
      strs.push(_fromCC.apply(null, u8a.subarray(i, i + maxargs)));
    }
    return _btoa(strs.join(""));
  };
  const fromUint8Array = (u8a, urlsafe = false) => urlsafe ? _mkUriSafe(_fromUint8Array(u8a)) : _fromUint8Array(u8a);
  const cb_utob = (c) => {
    if (c.length < 2) {
      var cc = c.charCodeAt(0);
      return cc < 128 ? c : cc < 2048 ? _fromCC(192 | cc >>> 6) + _fromCC(128 | cc & 63) : _fromCC(224 | cc >>> 12 & 15) + _fromCC(128 | cc >>> 6 & 63) + _fromCC(128 | cc & 63);
    } else {
      var cc = 65536 + (c.charCodeAt(0) - 55296) * 1024 + (c.charCodeAt(1) - 56320);
      return _fromCC(240 | cc >>> 18 & 7) + _fromCC(128 | cc >>> 12 & 63) + _fromCC(128 | cc >>> 6 & 63) + _fromCC(128 | cc & 63);
    }
  };
  const re_utob = /[\uD800-\uDBFF][\uDC00-\uDFFFF]|[^\x00-\x7F]/g;
  const utob = (u) => u.replace(re_utob, cb_utob);
  const _encode = _hasBuffer ? (s) => Buffer.from(s, "utf8").toString("base64") : _TE ? (s) => _fromUint8Array(_TE.encode(s)) : (s) => _btoa(utob(s));
  const encode = (src, urlsafe = false) => urlsafe ? _mkUriSafe(_encode(src)) : _encode(src);
  const encodeURI = (src) => encode(src, true);
  const re_btou = /[\xC0-\xDF][\x80-\xBF]|[\xE0-\xEF][\x80-\xBF]{2}|[\xF0-\xF7][\x80-\xBF]{3}/g;
  const cb_btou = (cccc) => {
    switch (cccc.length) {
      case 4:
        var cp = (7 & cccc.charCodeAt(0)) << 18 | (63 & cccc.charCodeAt(1)) << 12 | (63 & cccc.charCodeAt(2)) << 6 | 63 & cccc.charCodeAt(3), offset = cp - 65536;
        return _fromCC((offset >>> 10) + 55296) + _fromCC((offset & 1023) + 56320);
      case 3:
        return _fromCC((15 & cccc.charCodeAt(0)) << 12 | (63 & cccc.charCodeAt(1)) << 6 | 63 & cccc.charCodeAt(2));
      default:
        return _fromCC((31 & cccc.charCodeAt(0)) << 6 | 63 & cccc.charCodeAt(1));
    }
  };
  const btou = (b) => b.replace(re_btou, cb_btou);
  const atobPolyfill = (asc) => {
    asc = asc.replace(/\s+/g, "");
    if (!b64re.test(asc))
      throw new TypeError("malformed base64.");
    asc += "==".slice(2 - (asc.length & 3));
    let u24, bin = "", r1, r2;
    for (let i = 0; i < asc.length; ) {
      u24 = b64tab[asc.charAt(i++)] << 18 | b64tab[asc.charAt(i++)] << 12 | (r1 = b64tab[asc.charAt(i++)]) << 6 | (r2 = b64tab[asc.charAt(i++)]);
      bin += r1 === 64 ? _fromCC(u24 >> 16 & 255) : r2 === 64 ? _fromCC(u24 >> 16 & 255, u24 >> 8 & 255) : _fromCC(u24 >> 16 & 255, u24 >> 8 & 255, u24 & 255);
    }
    return bin;
  };
  const _atob = typeof atob === "function" ? (asc) => atob(_tidyB64(asc)) : _hasBuffer ? (asc) => Buffer.from(asc, "base64").toString("binary") : atobPolyfill;
  const _toUint8Array = _hasBuffer ? (a) => _U8Afrom(Buffer.from(a, "base64")) : (a) => _U8Afrom(_atob(a).split("").map((c) => c.charCodeAt(0)));
  const toUint8Array = (a) => _toUint8Array(_unURI(a));
  const _decode = _hasBuffer ? (a) => Buffer.from(a, "base64").toString("utf8") : _TD ? (a) => _TD.decode(_toUint8Array(a)) : (a) => btou(_atob(a));
  const _unURI = (a) => _tidyB64(a.replace(/[-_]/g, (m0) => m0 == "-" ? "+" : "/"));
  const decode = (src) => _decode(_unURI(src));
  const isValid = (src) => {
    if (typeof src !== "string")
      return false;
    const s = src.replace(/\s+/g, "").replace(/={0,2}$/, "");
    return !/[^\s0-9a-zA-Z\+/]/.test(s) || !/[^\s0-9a-zA-Z\-_]/.test(s);
  };
  const _noEnum = (v) => {
    return {
      value: v,
      enumerable: false,
      writable: true,
      configurable: true
    };
  };
  const extendString = function() {
    const _add = (name, body) => Object.defineProperty(String.prototype, name, _noEnum(body));
    _add("fromBase64", function() {
      return decode(this);
    });
    _add("toBase64", function(urlsafe) {
      return encode(this, urlsafe);
    });
    _add("toBase64URI", function() {
      return encode(this, true);
    });
    _add("toBase64URL", function() {
      return encode(this, true);
    });
    _add("toUint8Array", function() {
      return toUint8Array(this);
    });
  };
  const extendUint8Array = function() {
    const _add = (name, body) => Object.defineProperty(Uint8Array.prototype, name, _noEnum(body));
    _add("toBase64", function(urlsafe) {
      return fromUint8Array(this, urlsafe);
    });
    _add("toBase64URI", function() {
      return fromUint8Array(this, true);
    });
    _add("toBase64URL", function() {
      return fromUint8Array(this, true);
    });
  };
  const extendBuiltins = () => {
    extendString();
    extendUint8Array();
  };
  const gBase64 = {
    version,
    VERSION,
    atob: _atob,
    atobPolyfill,
    btoa: _btoa,
    btoaPolyfill,
    fromBase64: decode,
    toBase64: encode,
    encode,
    encodeURI,
    encodeURL: encodeURI,
    utob,
    btou,
    decode,
    isValid,
    fromUint8Array,
    toUint8Array,
    extendString,
    extendUint8Array,
    extendBuiltins
  };
  var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
  function getDefaultExportFromCjs(x) {
    return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
  }
  function getAugmentedNamespace(n) {
    if (n.__esModule) return n;
    var f = n.default;
    if (typeof f == "function") {
      var a = function a2() {
        if (this instanceof a2) {
          return Reflect.construct(f, arguments, this.constructor);
        }
        return f.apply(this, arguments);
      };
      a.prototype = f.prototype;
    } else a = {};
    Object.defineProperty(a, "__esModule", { value: true });
    Object.keys(n).forEach(function(k) {
      var d = Object.getOwnPropertyDescriptor(n, k);
      Object.defineProperty(a, k, d.get ? d : {
        enumerable: true,
        get: function() {
          return n[k];
        }
      });
    });
    return a;
  }
  var cryptoJs = { exports: {} };
  function commonjsRequire(path) {
    throw new Error('Could not dynamically require "' + path + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
  }
  var core = { exports: {} };
  const __viteBrowserExternal = {};
  const __viteBrowserExternal$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    default: __viteBrowserExternal
  }, Symbol.toStringTag, { value: "Module" }));
  const require$$0 = /* @__PURE__ */ getAugmentedNamespace(__viteBrowserExternal$1);
  var hasRequiredCore;
  function requireCore() {
    if (hasRequiredCore) return core.exports;
    hasRequiredCore = 1;
    (function(module2, exports3) {
      (function(root, factory) {
        {
          module2.exports = factory();
        }
      })(commonjsGlobal, function() {
        var CryptoJS2 = CryptoJS2 || function(Math2, undefined$1) {
          var crypto;
          if (typeof window !== "undefined" && window.crypto) {
            crypto = window.crypto;
          }
          if (typeof self !== "undefined" && self.crypto) {
            crypto = self.crypto;
          }
          if (typeof globalThis !== "undefined" && globalThis.crypto) {
            crypto = globalThis.crypto;
          }
          if (!crypto && typeof window !== "undefined" && window.msCrypto) {
            crypto = window.msCrypto;
          }
          if (!crypto && typeof commonjsGlobal !== "undefined" && commonjsGlobal.crypto) {
            crypto = commonjsGlobal.crypto;
          }
          if (!crypto && typeof commonjsRequire === "function") {
            try {
              crypto = require$$0;
            } catch (err2) {
            }
          }
          var cryptoSecureRandomInt = function() {
            if (crypto) {
              if (typeof crypto.getRandomValues === "function") {
                try {
                  return crypto.getRandomValues(new Uint32Array(1))[0];
                } catch (err2) {
                }
              }
              if (typeof crypto.randomBytes === "function") {
                try {
                  return crypto.randomBytes(4).readInt32LE();
                } catch (err2) {
                }
              }
            }
            throw new Error("Native crypto module could not be used to get secure random number.");
          };
          var create = Object.create || /* @__PURE__ */ function() {
            function F() {
            }
            return function(obj) {
              var subtype;
              F.prototype = obj;
              subtype = new F();
              F.prototype = null;
              return subtype;
            };
          }();
          var C = {};
          var C_lib = C.lib = {};
          var Base = C_lib.Base = /* @__PURE__ */ function() {
            return {
 /**
 * Creates a new object that inherits from this object.
 *
 * @param {Object} overrides Properties to copy into the new object.
 *
 * @return {Object} The new object.
 *
 * @static
 *
 * @example
 *
 * var MyType = CryptoJS.lib.Base.extend({
 * field: 'value'
 *
 * method: function {
 * }
 * });
 */
              extend: function(overrides) {
                var subtype = create(this);
                if (overrides) {
                  subtype.mixIn(overrides);
                }
                if (!subtype.hasOwnProperty("init") || this.init === subtype.init) {
                  subtype.init = function() {
                    subtype.$super.init.apply(this, arguments);
                  };
                }
                subtype.init.prototype = subtype;
                subtype.$super = this;
                return subtype;
              },
 /**
 * Extends this object and runs the init method.
 * Arguments to create will be passed to init.
 *
 * @return {Object} The new object.
 *
 * @static
 *
 * @example
 *
 * var instance = MyType.create;
 */
              create: function() {
                var instance = this.extend();
                instance.init.apply(instance, arguments);
                return instance;
              },
 /**
 * Initializes a newly created object.
 * Override this method to add some logic when your objects are created.
 *
 * @example
 *
 * var MyType = CryptoJS.lib.Base.extend({
 * init: function {
 * // ...
 * }
 * });
 */
              init: function() {
              },
 /**
 * Copies properties into this object.
 *
 * @param {Object} properties The properties to mix in.
 *
 * @example
 *
 * MyType.mixIn({
 * field: 'value'
 * });
 */
              mixIn: function(properties) {
                for (var propertyName in properties) {
                  if (properties.hasOwnProperty(propertyName)) {
                    this[propertyName] = properties[propertyName];
                  }
                }
                if (properties.hasOwnProperty("toString")) {
                  this.toString = properties.toString;
                }
              },
 /**
 * Creates a copy of this object.
 *
 * @return {Object} The clone.
 *
 * @example
 *
 * var clone = instance.clone;
 */
              clone: function() {
                return this.init.prototype.extend(this);
              }
            };
          }();
          var WordArray = C_lib.WordArray = Base.extend({
 /**
 * Initializes a newly created word array.
 *
 * @param {Array} words (Optional) An array of 32-bit words.
 * @param {number} sigBytes (Optional) The number of significant bytes in the words.
 *
 * @example
 *
 * var wordArray = CryptoJS.lib.WordArray.create;
 * var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607]);
 * var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607], 6);
 */
            init: function(words, sigBytes) {
              words = this.words = words || [];
              if (sigBytes != undefined$1) {
                this.sigBytes = sigBytes;
              } else {
                this.sigBytes = words.length * 4;
              }
            },
 /**
 * Converts this word array to a string.
 *
 * @param {Encoder} encoder (Optional) The encoding strategy to use. Default: CryptoJS.enc.Hex
 *
 * @return {string} The stringified word array.
 *
 * @example
 *
 * var string = wordArray + '';
 * var string = wordArray.toString;
 * var string = wordArray.toString(CryptoJS.enc.Utf8);
 */
            toString: function(encoder) {
              return (encoder || Hex).stringify(this);
            },
 /**
 * Concatenates a word array to this word array.
 *
 * @param {WordArray} wordArray The word array to append.
 *
 * @return {WordArray} This word array.
 *
 * @example
 *
 * wordArray1.concat(wordArray2);
 */
            concat: function(wordArray) {
              var thisWords = this.words;
              var thatWords = wordArray.words;
              var thisSigBytes = this.sigBytes;
              var thatSigBytes = wordArray.sigBytes;
              this.clamp();
              if (thisSigBytes % 4) {
                for (var i = 0; i < thatSigBytes; i++) {
                  var thatByte = thatWords[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                  thisWords[thisSigBytes + i >>> 2] |= thatByte << 24 - (thisSigBytes + i) % 4 * 8;
                }
              } else {
                for (var j = 0; j < thatSigBytes; j += 4) {
                  thisWords[thisSigBytes + j >>> 2] = thatWords[j >>> 2];
                }
              }
              this.sigBytes += thatSigBytes;
              return this;
            },
 /**
 * Removes insignificant bits.
 *
 * @example
 *
 * wordArray.clamp;
 */
            clamp: function() {
              var words = this.words;
              var sigBytes = this.sigBytes;
              words[sigBytes >>> 2] &= 4294967295 << 32 - sigBytes % 4 * 8;
              words.length = Math2.ceil(sigBytes / 4);
            },
 /**
 * Creates a copy of this word array.
 *
 * @return {WordArray} The clone.
 *
 * @example
 *
 * var clone = wordArray.clone;
 */
            clone: function() {
              var clone = Base.clone.call(this);
              clone.words = this.words.slice(0);
              return clone;
            },
 /**
 * Creates a word array filled with random bytes.
 *
 * @param {number} nBytes The number of random bytes to generate.
 *
 * @return {WordArray} The random word array.
 *
 * @static
 *
 * @example
 *
 * var wordArray = CryptoJS.lib.WordArray.random(16);
 */
            random: function(nBytes) {
              var words = [];
              for (var i = 0; i < nBytes; i += 4) {
                words.push(cryptoSecureRandomInt());
              }
              return new WordArray.init(words, nBytes);
            }
          });
          var C_enc = C.enc = {};
          var Hex = C_enc.Hex = {
 /**
 * Converts a word array to a hex string.
 *
 * @param {WordArray} wordArray The word array.
 *
 * @return {string} The hex string.
 *
 * @static
 *
 * @example
 *
 * var hexString = CryptoJS.enc.Hex.stringify(wordArray);
 */
            stringify: function(wordArray) {
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var hexChars = [];
              for (var i = 0; i < sigBytes; i++) {
                var bite = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                hexChars.push((bite >>> 4).toString(16));
                hexChars.push((bite & 15).toString(16));
              }
              return hexChars.join("");
            },
 /**
 * Converts a hex string to a word array.
 *
 * @param {string} hexStr The hex string.
 *
 * @return {WordArray} The word array.
 *
 * @static
 *
 * @example
 *
 * var wordArray = CryptoJS.enc.Hex.parse(hexString);
 */
            parse: function(hexStr) {
              var hexStrLength = hexStr.length;
              var words = [];
              for (var i = 0; i < hexStrLength; i += 2) {
                words[i >>> 3] |= parseInt(hexStr.substr(i, 2), 16) << 24 - i % 8 * 4;
              }
              return new WordArray.init(words, hexStrLength / 2);
            }
          };
          var Latin1 = C_enc.Latin1 = {
 /**
 * Converts a word array to a Latin1 string.
 *
 * @param {WordArray} wordArray The word array.
 *
 * @return {string} The Latin1 string.
 *
 * @static
 *
 * @example
 *
 * var latin1String = CryptoJS.enc.Latin1.stringify(wordArray);
 */
            stringify: function(wordArray) {
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var latin1Chars = [];
              for (var i = 0; i < sigBytes; i++) {
                var bite = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                latin1Chars.push(String.fromCharCode(bite));
              }
              return latin1Chars.join("");
            },
 /**
 * Converts a Latin1 string to a word array.
 *
 * @param {string} latin1Str The Latin1 string.
 *
 * @return {WordArray} The word array.
 *
 * @static
 *
 * @example
 *
 * var wordArray = CryptoJS.enc.Latin1.parse(latin1String);
 */
            parse: function(latin1Str) {
              var latin1StrLength = latin1Str.length;
              var words = [];
              for (var i = 0; i < latin1StrLength; i++) {
                words[i >>> 2] |= (latin1Str.charCodeAt(i) & 255) << 24 - i % 4 * 8;
              }
              return new WordArray.init(words, latin1StrLength);
            }
          };
          var Utf8 = C_enc.Utf8 = {
 /**
 * Converts a word array to a UTF-8 string.
 *
 * @param {WordArray} wordArray The word array.
 *
 * @return {string} The UTF-8 string.
 *
 * @static
 *
 * @example
 *
 * var utf8String = CryptoJS.enc.Utf8.stringify(wordArray);
 */
            stringify: function(wordArray) {
              try {
                return decodeURIComponent(escape(Latin1.stringify(wordArray)));
              } catch (e) {
                throw new Error("Malformed UTF-8 data");
              }
            },
 /**
 * Converts a UTF-8 string to a word array.
 *
 * @param {string} utf8Str The UTF-8 string.
 *
 * @return {WordArray} The word array.
 *
 * @static
 *
 * @example
 *
 * var wordArray = CryptoJS.enc.Utf8.parse(utf8String);
 */
            parse: function(utf8Str) {
              return Latin1.parse(unescape(encodeURIComponent(utf8Str)));
            }
          };
          var BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm = Base.extend({
 /**
 * Resets this block algorithm's data buffer to its initial state.
 *
 * @example
 *
 * bufferedBlockAlgorithm.reset;
 */
            reset: function() {
              this._data = new WordArray.init();
              this._nDataBytes = 0;
            },
 /**
 * Adds new data to this block algorithm's buffer.
 *
 * @param {WordArray|string} data The data to append. Strings are converted to a WordArray using UTF-8.
 *
 * @example
 *
 * bufferedBlockAlgorithm._append('data');
 * bufferedBlockAlgorithm._append(wordArray);
 */
            _append: function(data) {
              if (typeof data == "string") {
                data = Utf8.parse(data);
              }
              this._data.concat(data);
              this._nDataBytes += data.sigBytes;
            },
 /**
 * Processes available data blocks.
 *
 * This method invokes _doProcessBlock(offset), which must be implemented by a concrete subtype.
 *
 * @param {boolean} doFlush Whether all blocks and partial blocks should be processed.
 *
 * @return {WordArray} The processed data.
 *
 * @example
 *
 * var processedData = bufferedBlockAlgorithm._process;
 * var processedData = bufferedBlockAlgorithm._process(!!'flush');
 */
            _process: function(doFlush) {
              var processedWords;
              var data = this._data;
              var dataWords = data.words;
              var dataSigBytes = data.sigBytes;
              var blockSize = this.blockSize;
              var blockSizeBytes = blockSize * 4;
              var nBlocksReady = dataSigBytes / blockSizeBytes;
              if (doFlush) {
                nBlocksReady = Math2.ceil(nBlocksReady);
              } else {
                nBlocksReady = Math2.max((nBlocksReady | 0) - this._minBufferSize, 0);
              }
              var nWordsReady = nBlocksReady * blockSize;
              var nBytesReady = Math2.min(nWordsReady * 4, dataSigBytes);
              if (nWordsReady) {
                for (var offset = 0; offset < nWordsReady; offset += blockSize) {
                  this._doProcessBlock(dataWords, offset);
                }
                processedWords = dataWords.splice(0, nWordsReady);
                data.sigBytes -= nBytesReady;
              }
              return new WordArray.init(processedWords, nBytesReady);
            },
 /**
 * Creates a copy of this object.
 *
 * @return {Object} The clone.
 *
 * @example
 *
 * var clone = bufferedBlockAlgorithm.clone;
 */
            clone: function() {
              var clone = Base.clone.call(this);
              clone._data = this._data.clone();
              return clone;
            },
            _minBufferSize: 0
          });
          C_lib.Hasher = BufferedBlockAlgorithm.extend({
 /**
 * Configuration options.
 */
            cfg: Base.extend(),
 /**
 * Initializes a newly created hasher.
 *
 * @param {Object} cfg (Optional) The configuration options to use for this hash computation.
 *
 * @example
 *
 * var hasher = CryptoJS.algo.SHA256.create;
 */
            init: function(cfg) {
              this.cfg = this.cfg.extend(cfg);
              this.reset();
            },
 /**
 * Resets this hasher to its initial state.
 *
 * @example
 *
 * hasher.reset;
 */
            reset: function() {
              BufferedBlockAlgorithm.reset.call(this);
              this._doReset();
            },
 /**
 * Updates this hasher with a message.
 *
 * @param {WordArray|string} messageUpdate The message to append.
 *
 * @return {Hasher} This hasher.
 *
 * @example
 *
 * hasher.update('message');
 * hasher.update(wordArray);
 */
            update: function(messageUpdate) {
              this._append(messageUpdate);
              this._process();
              return this;
            },
 /**
 * Finalizes the hash computation.
 * Note that the finalize operation is effectively a destructive, read-once operation.
 *
 * @param {WordArray|string} messageUpdate (Optional) A final message update.
 *
 * @return {WordArray} The hash.
 *
 * @example
 *
 * var hash = hasher.finalize;
 * var hash = hasher.finalize('message');
 * var hash = hasher.finalize(wordArray);
 */
            finalize: function(messageUpdate) {
              if (messageUpdate) {
                this._append(messageUpdate);
              }
              var hash = this._doFinalize();
              return hash;
            },
            blockSize: 512 / 32,
 /**
 * Creates a shortcut function to a hasher's object interface.
 *
 * @param {Hasher} hasher The hasher to create a helper for.
 *
 * @return {Function} The shortcut function.
 *
 * @static
 *
 * @example
 *
 * var SHA256 = CryptoJS.lib.Hasher._createHelper(CryptoJS.algo.SHA256);
 */
            _createHelper: function(hasher) {
              return function(message, cfg) {
                return new hasher.init(cfg).finalize(message);
              };
            },
 /**
 * Creates a shortcut function to the HMAC's object interface.
 *
 * @param {Hasher} hasher The hasher to use in this HMAC helper.
 *
 * @return {Function} The shortcut function.
 *
 * @static
 *
 * @example
 *
 * var HmacSHA256 = CryptoJS.lib.Hasher._createHmacHelper(CryptoJS.algo.SHA256);
 */
            _createHmacHelper: function(hasher) {
              return function(message, key) {
                return new C_algo.HMAC.init(hasher, key).finalize(message);
              };
            }
          });
          var C_algo = C.algo = {};
          return C;
        }(Math);
        return CryptoJS2;
      });
    })(core);
    return core.exports;
  }
  var x64Core = { exports: {} };
  var hasRequiredX64Core;
  function requireX64Core() {
    if (hasRequiredX64Core) return x64Core.exports;
    hasRequiredX64Core = 1;
    (function(module2, exports3) {
      (function(root, factory) {
        {
          module2.exports = factory(requireCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function(undefined$1) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Base = C_lib.Base;
          var X32WordArray = C_lib.WordArray;
          var C_x64 = C.x64 = {};
          C_x64.Word = Base.extend({
 /**
 * Initializes a newly created 64-bit word.
 *
 * @param {number} high The high 32 bits.
 * @param {number} low The low 32 bits.
 *
 * @example
 *
 * var x64Word = CryptoJS.x64.Word.create(0x00010203, 0x04050607);
 */
            init: function(high, low) {
              this.high = high;
              this.low = low;
            }
 /**
 * Bitwise NOTs this word.
 *
 * @return {X64Word} A new x64-Word object after negating.
 *
 * @example
 *
 * var negated = x64Word.not;
 */
 // not: function {
 // var high = ~this.high;
 // var low = ~this.low;
 // return X64Word.create(high, low);
 // }
 /**
 * Bitwise ANDs this word with the passed word.
 *
 * @param {X64Word} word The x64-Word to AND with this word.
 *
 * @return {X64Word} A new x64-Word object after ANDing.
 *
 * @example
 *
 * var anded = x64Word.and(anotherX64Word);
 */
 // and: function (word) {
 // var high = this.high & word.high;
 // var low = this.low & word.low;
 // return X64Word.create(high, low);
 // }
 /**
 * Bitwise ORs this word with the passed word.
 *
 * @param {X64Word} word The x64-Word to OR with this word.
 *
 * @return {X64Word} A new x64-Word object after ORing.
 *
 * @example
 *
 * var ored = x64Word.or(anotherX64Word);
 */
 // or: function (word) {
 // var high = this.high | word.high;
 // var low = this.low | word.low;
 // return X64Word.create(high, low);
 // }
 /**
 * Bitwise XORs this word with the passed word.
 *
 * @param {X64Word} word The x64-Word to XOR with this word.
 *
 * @return {X64Word} A new x64-Word object after XORing.
 *
 * @example
 *
 * var xored = x64Word.xor(anotherX64Word);
 */
 // xor: function (word) {
 // var high = this.high ^ word.high;
 // var low = this.low ^ word.low;
 // return X64Word.create(high, low);
 // }
 /**
 * Shifts this word n bits to the left.
 *
 * @param {number} n The number of bits to shift.
 *
 * @return {X64Word} A new x64-Word object after shifting.
 *
 * @example
 *
 * var shifted = x64Word.shiftL(25);
 */
 // shiftL: function (n) {
 // if (n < 32) {
 // var high = (this.high << n) | (this.low >>> (32 - n));
 // var low = this.low << n;
 // } else {
 // var high = this.low << (n - 32);
 // var low = 0;
 // }
 // return X64Word.create(high, low);
 // }
 /**
 * Shifts this word n bits to the right.
 *
 * @param {number} n The number of bits to shift.
 *
 * @return {X64Word} A new x64-Word object after shifting.
 *
 * @example
 *
 * var shifted = x64Word.shiftR(7);
 */
 // shiftR: function (n) {
 // if (n < 32) {
 // var low = (this.low >>> n) | (this.high << (32 - n));
 // var high = this.high >>> n;
 // } else {
 // var low = this.high >>> (n - 32);
 // var high = 0;
 // }
 // return X64Word.create(high, low);
 // }
 /**
 * Rotates this word n bits to the left.
 *
 * @param {number} n The number of bits to rotate.
 *
 * @return {X64Word} A new x64-Word object after rotating.
 *
 * @example
 *
 * var rotated = x64Word.rotL(25);
 */
 // rotL: function (n) {
 // return this.shiftL(n).or(this.shiftR(64 - n));
 // }
 /**
 * Rotates this word n bits to the right.
 *
 * @param {number} n The number of bits to rotate.
 *
 * @return {X64Word} A new x64-Word object after rotating.
 *
 * @example
 *
 * var rotated = x64Word.rotR(7);
 */
 // rotR: function (n) {
 // return this.shiftR(n).or(this.shiftL(64 - n));
 // }
 /**
 * Adds this word with the passed word.
 *
 * @param {X64Word} word The x64-Word to add with this word.
 *
 * @return {X64Word} A new x64-Word object after adding.
 *
 * @example
 *
 * var added = x64Word.add(anotherX64Word);
 */
 // add: function (word) {
 // var low = (this.low + word.low) | 0;
 // var carry = (low >>> 0) < (this.low >>> 0) ? 1 : 0;
 // var high = (this.high + word.high + carry) | 0;
 // return X64Word.create(high, low);
 // }
          });
          C_x64.WordArray = Base.extend({
 /**
 * Initializes a newly created word array.
 *
 * @param {Array} words (Optional) An array of CryptoJS.x64.Word objects.
 * @param {number} sigBytes (Optional) The number of significant bytes in the words.
 *
 * @example
 *
 * var wordArray = CryptoJS.x64.WordArray.create;
 *
 * var wordArray = CryptoJS.x64.WordArray.create([
 * CryptoJS.x64.Word.create(0x00010203, 0x04050607)
 * CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
 * ]);
 *
 * var wordArray = CryptoJS.x64.WordArray.create([
 * CryptoJS.x64.Word.create(0x00010203, 0x04050607)
 * CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
 * ], 10);
 */
            init: function(words, sigBytes) {
              words = this.words = words || [];
              if (sigBytes != undefined$1) {
                this.sigBytes = sigBytes;
              } else {
                this.sigBytes = words.length * 8;
              }
            },
 /**
 * Converts this 64-bit word array to a 32-bit word array.
 *
 * @return {CryptoJS.lib.WordArray} This word array's data as a 32-bit word array.
 *
 * @example
 *
 * var x32WordArray = x64WordArray.toX32;
 */
            toX32: function() {
              var x64Words = this.words;
              var x64WordsLength = x64Words.length;
              var x32Words = [];
              for (var i = 0; i < x64WordsLength; i++) {
                var x64Word = x64Words[i];
                x32Words.push(x64Word.high);
                x32Words.push(x64Word.low);
              }
              return X32WordArray.create(x32Words, this.sigBytes);
            },
 /**
 * Creates a copy of this word array.
 *
 * @return {X64WordArray} The clone.
 *
 * @example
 *
 * var clone = x64WordArray.clone;
 */
            clone: function() {
              var clone = Base.clone.call(this);
              var words = clone.words = this.words.slice(0);
              var wordsLength = words.length;
              for (var i = 0; i < wordsLength; i++) {
                words[i] = words[i].clone();
              }
              return clone;
            }
          });
        })();
        return CryptoJS2;
      });
    })(x64Core);
    return x64Core.exports;
  }
  var libTypedarrays = { exports: {} };
  var hasRequiredLibTypedarrays;
  function requireLibTypedarrays() {
    if (hasRequiredLibTypedarrays) return libTypedarrays.exports;
    hasRequiredLibTypedarrays = 1;
    (function(module2, exports3) {
      (function(root, factory) {
        {
          module2.exports = factory(requireCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          if (typeof ArrayBuffer != "function") {
            return;
          }
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var superInit = WordArray.init;
          var subInit = WordArray.init = function(typedArray) {
            if (typedArray instanceof ArrayBuffer) {
              typedArray = new Uint8Array(typedArray);
            }
            if (typedArray instanceof Int8Array || typeof Uint8ClampedArray !== "undefined" && typedArray instanceof Uint8ClampedArray || typedArray instanceof Int16Array || typedArray instanceof Uint16Array || typedArray instanceof Int32Array || typedArray instanceof Uint32Array || typedArray instanceof Float32Array || typedArray instanceof Float64Array) {
              typedArray = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
            }
            if (typedArray instanceof Uint8Array) {
              var typedArrayByteLength = typedArray.byteLength;
              var words = [];
              for (var i = 0; i < typedArrayByteLength; i++) {
                words[i >>> 2] |= typedArray[i] << 24 - i % 4 * 8;
              }
              superInit.call(this, words, typedArrayByteLength);
            } else {
              superInit.apply(this, arguments);
            }
          };
          subInit.prototype = WordArray;
        })();
        return CryptoJS2.lib.WordArray;
      });
    })(libTypedarrays);
    return libTypedarrays.exports;
  }
  var encUtf16 = { exports: {} };
  var hasRequiredEncUtf16;
  function requireEncUtf16() {
    if (hasRequiredEncUtf16) return encUtf16.exports;
    hasRequiredEncUtf16 = 1;
    (function(module2, exports3) {
      (function(root, factory) {
        {
          module2.exports = factory(requireCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var C_enc = C.enc;
          C_enc.Utf16 = C_enc.Utf16BE = {
 /**
 * Converts a word array to a UTF-16 BE string.
 *
 * @param {WordArray} wordArray The word array.
 *
 * @return {string} The UTF-16 BE string.
 *
 * @static
 *
 * @example
 *
 * var utf16String = CryptoJS.enc.Utf16.stringify(wordArray);
 */
            stringify: function(wordArray) {
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var utf16Chars = [];
              for (var i = 0; i < sigBytes; i += 2) {
                var codePoint = words[i >>> 2] >>> 16 - i % 4 * 8 & 65535;
                utf16Chars.push(String.fromCharCode(codePoint));
              }
              return utf16Chars.join("");
            },
 /**
 * Converts a UTF-16 BE string to a word array.
 *
 * @param {string} utf16Str The UTF-16 BE string.
 *
 * @return {WordArray} The word array.
 *
 * @static
 *
 * @example
 *
 * var wordArray = CryptoJS.enc.Utf16.parse(utf16String);
 */
            parse: function(utf16Str) {
              var utf16StrLength = utf16Str.length;
              var words = [];
              for (var i = 0; i < utf16StrLength; i++) {
                words[i >>> 1] |= utf16Str.charCodeAt(i) << 16 - i % 2 * 16;
              }
              return WordArray.create(words, utf16StrLength * 2);
            }
          };
          C_enc.Utf16LE = {
 /**
 * Converts a word array to a UTF-16 LE string.
 *
 * @param {WordArray} wordArray The word array.
 *
 * @return {string} The UTF-16 LE string.
 *
 * @static
 *
 * @example
 *
 * var utf16Str = CryptoJS.enc.Utf16LE.stringify(wordArray);
 */
            stringify: function(wordArray) {
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var utf16Chars = [];
              for (var i = 0; i < sigBytes; i += 2) {
                var codePoint = swapEndian(words[i >>> 2] >>> 16 - i % 4 * 8 & 65535);
                utf16Chars.push(String.fromCharCode(codePoint));
              }
              return utf16Chars.join("");
            },
 /**
 * Converts a UTF-16 LE string to a word array.
 *
 * @param {string} utf16Str The UTF-16 LE string.
 *
 * @return {WordArray} The word array.
 *
 * @static
 *
 * @example
 *
 * var wordArray = CryptoJS.enc.Utf16LE.parse(utf16Str);
 */
            parse: function(utf16Str) {
              var utf16StrLength = utf16Str.length;
              var words = [];
              for (var i = 0; i < utf16StrLength; i++) {
                words[i >>> 1] |= swapEndian(utf16Str.charCodeAt(i) << 16 - i % 2 * 16);
              }
              return WordArray.create(words, utf16StrLength * 2);
            }
          };
          function swapEndian(word) {
            return word << 8 & 4278255360 | word >>> 8 & 16711935;
          }
        })();
        return CryptoJS2.enc.Utf16;
      });
    })(encUtf16);
    return encUtf16.exports;
  }
  var encBase64 = { exports: {} };
  var hasRequiredEncBase64;
  function requireEncBase64() {
    if (hasRequiredEncBase64) return encBase64.exports;
    hasRequiredEncBase64 = 1;
    (function(module2, exports3) {
      (function(root, factory) {
        {
          module2.exports = factory(requireCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var C_enc = C.enc;
          C_enc.Base64 = {
 /**
 * Converts a word array to a Base64 string.
 *
 * @param {WordArray} wordArray The word array.
 *
 * @return {string} The Base64 string.
 *
 * @static
 *
 * @example
 *
 * var base64String = CryptoJS.enc.Base64.stringify(wordArray);
 */
            stringify: function(wordArray) {
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var map = this._map;
              wordArray.clamp();
              var base64Chars = [];
              for (var i = 0; i < sigBytes; i += 3) {
                var byte1 = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                var byte2 = words[i + 1 >>> 2] >>> 24 - (i + 1) % 4 * 8 & 255;
                var byte3 = words[i + 2 >>> 2] >>> 24 - (i + 2) % 4 * 8 & 255;
                var triplet = byte1 << 16 | byte2 << 8 | byte3;
                for (var j = 0; j < 4 && i + j * 0.75 < sigBytes; j++) {
                  base64Chars.push(map.charAt(triplet >>> 6 * (3 - j) & 63));
                }
              }
              var paddingChar = map.charAt(64);
              if (paddingChar) {
                while (base64Chars.length % 4) {
                  base64Chars.push(paddingChar);
                }
              }
              return base64Chars.join("");
            },
 /**
 * Converts a Base64 string to a word array.
 *
 * @param {string} base64Str The Base64 string.
 *
 * @return {WordArray} The word array.
 *
 * @static
 *
 * @example
 *
 * var wordArray = CryptoJS.enc.Base64.parse(base64String);
 */
            parse: function(base64Str) {
              var base64StrLength = base64Str.length;
              var map = this._map;
              var reverseMap = this._reverseMap;
              if (!reverseMap) {
                reverseMap = this._reverseMap = [];
                for (var j = 0; j < map.length; j++) {
                  reverseMap[map.charCodeAt(j)] = j;
                }
              }
              var paddingChar = map.charAt(64);
              if (paddingChar) {
                var paddingIndex = base64Str.indexOf(paddingChar);
                if (paddingIndex !== -1) {
                  base64StrLength = paddingIndex;
                }
              }
              return parseLoop(base64Str, base64StrLength, reverseMap);
            },
            _map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
          };
          function parseLoop(base64Str, base64StrLength, reverseMap) {
            var words = [];
            var nBytes = 0;
            for (var i = 0; i < base64StrLength; i++) {
              if (i % 4) {
                var bits1 = reverseMap[base64Str.charCodeAt(i - 1)] << i % 4 * 2;
                var bits2 = reverseMap[base64Str.charCodeAt(i)] >>> 6 - i % 4 * 2;
                var bitsCombined = bits1 | bits2;
                words[nBytes >>> 2] |= bitsCombined << 24 - nBytes % 4 * 8;
                nBytes++;
              }
            }
            return WordArray.create(words, nBytes);
          }
        })();
        return CryptoJS2.enc.Base64;
      });
    })(encBase64);
    return encBase64.exports;
  }
  var encBase64url = { exports: {} };
  var hasRequiredEncBase64url;
  function requireEncBase64url() {
    if (hasRequiredEncBase64url) return encBase64url.exports;
    hasRequiredEncBase64url = 1;
    (function(module2, exports3) {
      (function(root, factory) {
        {
          module2.exports = factory(requireCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var C_enc = C.enc;
          C_enc.Base64url = {
 /**
 * Converts a word array to a Base64url string.
 *
 * @param {WordArray} wordArray The word array.
 *
 * @param {boolean} urlSafe Whether to use url safe
 *
 * @return {string} The Base64url string.
 *
 * @static
 *
 * @example
 *
 * var base64String = CryptoJS.enc.Base64url.stringify(wordArray);
 */
            stringify: function(wordArray, urlSafe) {
              if (urlSafe === void 0) {
                urlSafe = true;
              }
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var map = urlSafe ? this._safe_map : this._map;
              wordArray.clamp();
              var base64Chars = [];
              for (var i = 0; i < sigBytes; i += 3) {
                var byte1 = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                var byte2 = words[i + 1 >>> 2] >>> 24 - (i + 1) % 4 * 8 & 255;
                var byte3 = words[i + 2 >>> 2] >>> 24 - (i + 2) % 4 * 8 & 255;
                var triplet = byte1 << 16 | byte2 << 8 | byte3;
                for (var j = 0; j < 4 && i + j * 0.75 < sigBytes; j++) {
                  base64Chars.push(map.charAt(triplet >>> 6 * (3 - j) & 63));
                }
              }
              var paddingChar = map.charAt(64);
              if (paddingChar) {
                while (base64Chars.length % 4) {
                  base64Chars.push(paddingChar);
                }
              }
              return base64Chars.join("");
            },
 /**
 * Converts a Base64url string to a word array.
 *
 * @param {string} base64Str The Base64url string.
 *
 * @param {boolean} urlSafe Whether to use url safe
 *
 * @return {WordArray} The word array.
 *
 * @static
 *
 * @example
 *
 * var wordArray = CryptoJS.enc.Base64url.parse(base64String);
 */
            parse: function(base64Str, urlSafe) {
              if (urlSafe === void 0) {
                urlSafe = true;
              }
              var base64StrLength = base64Str.length;
              var map = urlSafe ? this._safe_map : this._map;
              var reverseMap = this._reverseMap;
              if (!reverseMap) {
                reverseMap = this._reverseMap = [];
                for (var j = 0; j < map.length; j++) {
                  reverseMap[map.charCodeAt(j)] = j;
                }
              }
              var paddingChar = map.charAt(64);
              if (paddingChar) {
                var paddingIndex = base64Str.indexOf(paddingChar);
                if (paddingIndex !== -1) {
                  base64StrLength = paddingIndex;
                }
              }
              return parseLoop(base64Str, base64StrLength, reverseMap);
            },
            _map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
            _safe_map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
          };
          function parseLoop(base64Str, base64StrLength, reverseMap) {
            var words = [];
            var nBytes = 0;
            for (var i = 0; i < base64StrLength; i++) {
              if (i % 4) {
                var bits1 = reverseMap[base64Str.charCodeAt(i - 1)] << i % 4 * 2;
                var bits2 = reverseMap[base64Str.charCodeAt(i)] >>> 6 - i % 4 * 2;
                var bitsCombined = bits1 | bits2;
                words[nBytes >>> 2] |= bitsCombined << 24 - nBytes % 4 * 8;
                nBytes++;
              }
            }
            return WordArray.create(words, nBytes);
          }
        })();
        return CryptoJS2.enc.Base64url;
      });
    })(encBase64url);
    return encBase64url.exports;
  }
  var md5 = { exports: {} };
  var hasRequiredMd5;
  function requireMd5() {
    if (hasRequiredMd5) return md5.exports;
    hasRequiredMd5 = 1;
    (function(module2, exports3) {
      (function(root, factory) {
        {
          module2.exports = factory(requireCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function(Math2) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var Hasher = C_lib.Hasher;
          var C_algo = C.algo;
          var T = [];
          (function() {
            for (var i = 0; i < 64; i++) {
              T[i] = Math2.abs(Math2.sin(i + 1)) * 4294967296 | 0;
            }
          })();
          var MD5 = C_algo.MD5 = Hasher.extend({
            _doReset: function() {
              this._hash = new WordArray.init([
                1732584193,
                4023233417,
                2562383102,
                271733878
              ]);
            },
            _doProcessBlock: function(M, offset) {
              for (var i = 0; i < 16; i++) {
                var offset_i = offset + i;
                var M_offset_i = M[offset_i];
                M[offset_i] = (M_offset_i << 8 | M_offset_i >>> 24) & 16711935 | (M_offset_i << 24 | M_offset_i >>> 8) & 4278255360;
              }
              var H = this._hash.words;
              var M_offset_0 = M[offset + 0];
              var M_offset_1 = M[offset + 1];
              var M_offset_2 = M[offset + 2];
              var M_offset_3 = M[offset + 3];
              var M_offset_4 = M[offset + 4];
              var M_offset_5 = M[offset + 5];
              var M_offset_6 = M[offset + 6];
              var M_offset_7 = M[offset + 7];
              var M_offset_8 = M[offset + 8];
              var M_offset_9 = M[offset + 9];
              var M_offset_10 = M[offset + 10];
              var M_offset_11 = M[offset + 11];
              var M_offset_12 = M[offset + 12];
              var M_offset_13 = M[offset + 13];
              var M_offset_14 = M[offset + 14];
              var M_offset_15 = M[offset + 15];
              var a = H[0];
              var b = H[1];
              var c = H[2];
              var d = H[3];
              a = FF(a, b, c, d, M_offset_0, 7, T[0]);
              d = FF(d, a, b, c, M_offset_1, 12, T[1]);
              c = FF(c, d, a, b, M_offset_2, 17, T[2]);
              b = FF(b, c, d, a, M_offset_3, 22, T[3]);
              a = FF(a, b, c, d, M_offset_4, 7, T[4]);
              d = FF(d, a, b, c, M_offset_5, 12, T[5]);
              c = FF(c, d, a, b, M_offset_6, 17, T[6]);
              b = FF(b, c, d, a, M_offset_7, 22, T[7]);
              a = FF(a, b, c, d, M_offset_8, 7, T[8]);
              d = FF(d, a, b, c, M_offset_9, 12, T[9]);
              c = FF(c, d, a, b, M_offset_10, 17, T[10]);
              b = FF(b, c, d, a, M_offset_11, 22, T[11]);
              a = FF(a, b, c, d, M_offset_12, 7, T[12]);
              d = FF(d, a, b, c, M_offset_13, 12, T[13]);
              c = FF(c, d, a, b, M_offset_14, 17, T[14]);
              b = FF(b, c, d, a, M_offset_15, 22, T[15]);
              a = GG(a, b, c, d, M_offset_1, 5, T[16]);
              d = GG(d, a, b, c, M_offset_6, 9, T[17]);
              c = GG(c, d, a, b, M_offset_11, 14, T[18]);
              b = GG(b, c, d, a, M_offset_0, 20, T[19]);
              a = GG(a, b, c, d, M_offset_5, 5, T[20]);
              d = GG(d, a, b, c, M_offset_10, 9, T[21]);
              c = GG(c, d, a, b, M_offset_15, 14, T[22]);
              b = GG(b, c, d, a, M_offset_4, 20, T[23]);
              a = GG(a, b, c, d, M_offset_9, 5, T[24]);
              d = GG(d, a, b, c, M_offset_14, 9, T[25]);
              c = GG(c, d, a, b, M_offset_3, 14, T[26]);
              b = GG(b, c, d, a, M_offset_8, 20, T[27]);
              a = GG(a, b, c, d, M_offset_13, 5, T[28]);
              d = GG(d, a, b, c, M_offset_2, 9, T[29]);
              c = GG(c, d, a, b, M_offset_7, 14, T[30]);
              b = GG(b, c, d, a, M_offset_12, 20, T[31]);
              a = HH(a, b, c, d, M_offset_5, 4, T[32]);
              d = HH(d, a, b, c, M_offset_8, 11, T[33]);
              c = HH(c, d, a, b, M_offset_11, 16, T[34]);
              b = HH(b, c, d, a, M_offset_14, 23, T[35]);
              a = HH(a, b, c, d, M_offset_1, 4, T[36]);
              d = HH(d, a, b, c, M_offset_4, 11, T[37]);
              c = HH(c, d, a, b, M_offset_7, 16, T[38]);
              b = HH(b, c, d, a, M_offset_10, 23, T[39]);
              a = HH(a, b, c, d, M_offset_13, 4, T[40]);
              d = HH(d, a, b, c, M_offset_0, 11, T[41]);
              c = HH(c, d, a, b, M_offset_3, 16, T[42]);
              b = HH(b, c, d, a, M_offset_6, 23, T[43]);
              a = HH(a, b, c, d, M_offset_9, 4, T[44]);
              d = HH(d, a, b, c, M_offset_12, 11, T[45]);
              c = HH(c, d, a, b, M_offset_15, 16, T[46]);
              b = HH(b, c, d, a, M_offset_2, 23, T[47]);
              a = II(a, b, c, d, M_offset_0, 6, T[48]);
              d = II(d, a, b, c, M_offset_7, 10, T[49]);
              c = II(c, d, a, b, M_offset_14, 15, T[50]);
              b = II(b, c, d, a, M_offset_5, 21, T[51]);
              a = II(a, b, c, d, M_offset_12, 6, T[52]);
              d = II(d, a, b, c, M_offset_3, 10, T[53]);
              c = II(c, d, a, b, M_offset_10, 15, T[54]);
              b = II(b, c, d, a, M_offset_1, 21, T[55]);
              a = II(a, b, c, d, M_offset_8, 6, T[56]);
              d = II(d, a, b, c, M_offset_15, 10, T[57]);
              c = II(c, d, a, b, M_offset_6, 15, T[58]);
              b = II(b, c, d, a, M_offset_13, 21, T[59]);
              a = II(a, b, c, d, M_offset_4, 6, T[60]);
              d = II(d, a, b, c, M_offset_11, 10, T[61]);
              c = II(c, d, a, b, M_offset_2, 15, T[62]);
              b = II(b, c, d, a, M_offset_9, 21, T[63]);
              H[0] = H[0] + a | 0;
              H[1] = H[1] + b | 0;
              H[2] = H[2] + c | 0;
              H[3] = H[3] + d | 0;
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              var nBitsTotal = this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
              var nBitsTotalH = Math2.floor(nBitsTotal / 4294967296);
              var nBitsTotalL = nBitsTotal;
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 15] = (nBitsTotalH << 8 | nBitsTotalH >>> 24) & 16711935 | (nBitsTotalH << 24 | nBitsTotalH >>> 8) & 4278255360;
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = (nBitsTotalL << 8 | nBitsTotalL >>> 24) & 16711935 | (nBitsTotalL << 24 | nBitsTotalL >>> 8) & 4278255360;
              data.sigBytes = (dataWords.length + 1) * 4;
              this._process();
              var hash = this._hash;
              var H = hash.words;
              for (var i = 0; i < 4; i++) {
                var H_i = H[i];
                H[i] = (H_i << 8 | H_i >>> 24) & 16711935 | (H_i << 24 | H_i >>> 8) & 4278255360;
              }
              return hash;
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              clone._hash = this._hash.clone();
              return clone;
            }
          });
          function FF(a, b, c, d, x, s, t) {
            var n = a + (b & c | ~b & d) + x + t;
            return (n << s | n >>> 32 - s) + b;
          }
          function GG(a, b, c, d, x, s, t) {
            var n = a + (b & d | c & ~d) + x + t;
            return (n << s | n >>> 32 - s) + b;
          }
          function HH(a, b, c, d, x, s, t) {
            var n = a + (b ^ c ^ d) + x + t;
            return (n << s | n >>> 32 - s) + b;
          }
          function II(a, b, c, d, x, s, t) {
            var n = a + (c ^ (b | ~d)) + x + t;
            return (n << s | n >>> 32 - s) + b;
          }
          C.MD5 = Hasher._createHelper(MD5);
          C.HmacMD5 = Hasher._createHmacHelper(MD5);
        })(Math);
        return CryptoJS2.MD5;
      });
    })(md5);
    return md5.exports;
  }
  var sha1 = { exports: {} };
  var hasRequiredSha1;
  function requireSha1() {
    if (hasRequiredSha1) return sha1.exports;
    hasRequiredSha1 = 1;
    (function(module2, exports3) {
      (function(root, factory) {
        {
          module2.exports = factory(requireCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var Hasher = C_lib.Hasher;
          var C_algo = C.algo;
          var W = [];
          var SHA1 = C_algo.SHA1 = Hasher.extend({
            _doReset: function() {
              this._hash = new WordArray.init([
                1732584193,
                4023233417,
                2562383102,
                271733878,
                3285377520
              ]);
            },
            _doProcessBlock: function(M, offset) {
              var H = this._hash.words;
              var a = H[0];
              var b = H[1];
              var c = H[2];
              var d = H[3];
              var e = H[4];
              for (var i = 0; i < 80; i++) {
                if (i < 16) {
                  W[i] = M[offset + i] | 0;
                } else {
                  var n = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16];
                  W[i] = n << 1 | n >>> 31;
                }
                var t = (a << 5 | a >>> 27) + e + W[i];
                if (i < 20) {
                  t += (b & c | ~b & d) + 1518500249;
                } else if (i < 40) {
                  t += (b ^ c ^ d) + 1859775393;
                } else if (i < 60) {
                  t += (b & c | b & d | c & d) - 1894007588;
                } else {
                  t += (b ^ c ^ d) - 899497514;
                }
                e = d;
                d = c;
                c = b << 30 | b >>> 2;
                b = a;
                a = t;
              }
              H[0] = H[0] + a | 0;
              H[1] = H[1] + b | 0;
              H[2] = H[2] + c | 0;
              H[3] = H[3] + d | 0;
              H[4] = H[4] + e | 0;
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              var nBitsTotal = this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = Math.floor(nBitsTotal / 4294967296);
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 15] = nBitsTotal;
              data.sigBytes = dataWords.length * 4;
              this._process();
              return this._hash;
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              clone._hash = this._hash.clone();
              return clone;
            }
          });
          C.SHA1 = Hasher._createHelper(SHA1);
          C.HmacSHA1 = Hasher._createHmacHelper(SHA1);
        })();
        return CryptoJS2.SHA1;
      });
    })(sha1);
    return sha1.exports;
  }
  var sha256 = { exports: {} };
  var hasRequiredSha256;
  function requireSha256() {
    if (hasRequiredSha256) return sha256.exports;
    hasRequiredSha256 = 1;
    (function(module2, exports3) {
      (function(root, factory) {
        {
          module2.exports = factory(requireCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function(Math2) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var Hasher = C_lib.Hasher;
          var C_algo = C.algo;
          var H = [];
          var K = [];
          (function() {
            function isPrime(n2) {
              var sqrtN = Math2.sqrt(n2);
              for (var factor = 2; factor <= sqrtN; factor++) {
                if (!(n2 % factor)) {
                  return false;
                }
              }
              return true;
            }
            function getFractionalBits(n2) {
              return (n2 - (n2 | 0)) * 4294967296 | 0;
            }
            var n = 2;
            var nPrime = 0;
            while (nPrime < 64) {
              if (isPrime(n)) {
                if (nPrime < 8) {
                  H[nPrime] = getFractionalBits(Math2.pow(n, 1 / 2));
                }
                K[nPrime] = getFractionalBits(Math2.pow(n, 1 / 3));
                nPrime++;
              }
              n++;
            }
          })();
          var W = [];
          var SHA256 = C_algo.SHA256 = Hasher.extend({
            _doReset: function() {
              this._hash = new WordArray.init(H.slice(0));
            },
            _doProcessBlock: function(M, offset) {
              var H2 = this._hash.words;
              var a = H2[0];
              var b = H2[1];
              var c = H2[2];
              var d = H2[3];
              var e = H2[4];
              var f = H2[5];
              var g = H2[6];
              var h = H2[7];
              for (var i = 0; i < 64; i++) {
                if (i < 16) {
                  W[i] = M[offset + i] | 0;
                } else {
                  var gamma0x = W[i - 15];
                  var gamma0 = (gamma0x << 25 | gamma0x >>> 7) ^ (gamma0x << 14 | gamma0x >>> 18) ^ gamma0x >>> 3;
                  var gamma1x = W[i - 2];
                  var gamma1 = (gamma1x << 15 | gamma1x >>> 17) ^ (gamma1x << 13 | gamma1x >>> 19) ^ gamma1x >>> 10;
                  W[i] = gamma0 + W[i - 7] + gamma1 + W[i - 16];
                }
                var ch = e & f ^ ~e & g;
                var maj = a & b ^ a & c ^ b & c;
                var sigma0 = (a << 30 | a >>> 2) ^ (a << 19 | a >>> 13) ^ (a << 10 | a >>> 22);
                var sigma1 = (e << 26 | e >>> 6) ^ (e << 21 | e >>> 11) ^ (e << 7 | e >>> 25);
                var t1 = h + sigma1 + ch + K[i] + W[i];
                var t2 = sigma0 + maj;
                h = g;
                g = f;
                f = e;
                e = d + t1 | 0;
                d = c;
                c = b;
                b = a;
                a = t1 + t2 | 0;
              }
              H2[0] = H2[0] + a | 0;
              H2[1] = H2[1] + b | 0;
              H2[2] = H2[2] + c | 0;
              H2[3] = H2[3] + d | 0;
              H2[4] = H2[4] + e | 0;
              H2[5] = H2[5] + f | 0;
              H2[6] = H2[6] + g | 0;
              H2[7] = H2[7] + h | 0;
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              var nBitsTotal = this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = Math2.floor(nBitsTotal / 4294967296);
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 15] = nBitsTotal;
              data.sigBytes = dataWords.length * 4;
              this._process();
              return this._hash;
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              clone._hash = this._hash.clone();
              return clone;
            }
          });
          C.SHA256 = Hasher._createHelper(SHA256);
          C.HmacSHA256 = Hasher._createHmacHelper(SHA256);
        })(Math);
        return CryptoJS2.SHA256;
      });
    })(sha256);
    return sha256.exports;
  }
  var sha224 = { exports: {} };
  var hasRequiredSha224;
  function requireSha224() {
    if (hasRequiredSha224) return sha224.exports;
    hasRequiredSha224 = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireSha256());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var C_algo = C.algo;
          var SHA256 = C_algo.SHA256;
          var SHA224 = C_algo.SHA224 = SHA256.extend({
            _doReset: function() {
              this._hash = new WordArray.init([
                3238371032,
                914150663,
                812702999,
                4144912697,
                4290775857,
                1750603025,
                1694076839,
                3204075428
              ]);
            },
            _doFinalize: function() {
              var hash = SHA256._doFinalize.call(this);
              hash.sigBytes -= 4;
              return hash;
            }
          });
          C.SHA224 = SHA256._createHelper(SHA224);
          C.HmacSHA224 = SHA256._createHmacHelper(SHA224);
        })();
        return CryptoJS2.SHA224;
      });
    })(sha224);
    return sha224.exports;
  }
  var sha512 = { exports: {} };
  var hasRequiredSha512;
  function requireSha512() {
    if (hasRequiredSha512) return sha512.exports;
    hasRequiredSha512 = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireX64Core());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Hasher = C_lib.Hasher;
          var C_x64 = C.x64;
          var X64Word = C_x64.Word;
          var X64WordArray = C_x64.WordArray;
          var C_algo = C.algo;
          function X64Word_create() {
            return X64Word.create.apply(X64Word, arguments);
          }
          var K = [
            X64Word_create(1116352408, 3609767458),
            X64Word_create(1899447441, 602891725),
            X64Word_create(3049323471, 3964484399),
            X64Word_create(3921009573, 2173295548),
            X64Word_create(961987163, 4081628472),
            X64Word_create(1508970993, 3053834265),
            X64Word_create(2453635748, 2937671579),
            X64Word_create(2870763221, 3664609560),
            X64Word_create(3624381080, 2734883394),
            X64Word_create(310598401, 1164996542),
            X64Word_create(607225278, 1323610764),
            X64Word_create(1426881987, 3590304994),
            X64Word_create(1925078388, 4068182383),
            X64Word_create(2162078206, 991336113),
            X64Word_create(2614888103, 633803317),
            X64Word_create(3248222580, 3479774868),
            X64Word_create(3835390401, 2666613458),
            X64Word_create(4022224774, 944711139),
            X64Word_create(264347078, 2341262773),
            X64Word_create(604807628, 2007800933),
            X64Word_create(770255983, 1495990901),
            X64Word_create(1249150122, 1856431235),
            X64Word_create(1555081692, 3175218132),
            X64Word_create(1996064986, 2198950837),
            X64Word_create(2554220882, 3999719339),
            X64Word_create(2821834349, 766784016),
            X64Word_create(2952996808, 2566594879),
            X64Word_create(3210313671, 3203337956),
            X64Word_create(3336571891, 1034457026),
            X64Word_create(3584528711, 2466948901),
            X64Word_create(113926993, 3758326383),
            X64Word_create(338241895, 168717936),
            X64Word_create(666307205, 1188179964),
            X64Word_create(773529912, 1546045734),
            X64Word_create(1294757372, 1522805485),
            X64Word_create(1396182291, 2643833823),
            X64Word_create(1695183700, 2343527390),
            X64Word_create(1986661051, 1014477480),
            X64Word_create(2177026350, 1206759142),
            X64Word_create(2456956037, 344077627),
            X64Word_create(2730485921, 1290863460),
            X64Word_create(2820302411, 3158454273),
            X64Word_create(3259730800, 3505952657),
            X64Word_create(3345764771, 106217008),
            X64Word_create(3516065817, 3606008344),
            X64Word_create(3600352804, 1432725776),
            X64Word_create(4094571909, 1467031594),
            X64Word_create(275423344, 851169720),
            X64Word_create(430227734, 3100823752),
            X64Word_create(506948616, 1363258195),
            X64Word_create(659060556, 3750685593),
            X64Word_create(883997877, 3785050280),
            X64Word_create(958139571, 3318307427),
            X64Word_create(1322822218, 3812723403),
            X64Word_create(1537002063, 2003034995),
            X64Word_create(1747873779, 3602036899),
            X64Word_create(1955562222, 1575990012),
            X64Word_create(2024104815, 1125592928),
            X64Word_create(2227730452, 2716904306),
            X64Word_create(2361852424, 442776044),
            X64Word_create(2428436474, 593698344),
            X64Word_create(2756734187, 3733110249),
            X64Word_create(3204031479, 2999351573),
            X64Word_create(3329325298, 3815920427),
            X64Word_create(3391569614, 3928383900),
            X64Word_create(3515267271, 566280711),
            X64Word_create(3940187606, 3454069534),
            X64Word_create(4118630271, 4000239992),
            X64Word_create(116418474, 1914138554),
            X64Word_create(174292421, 2731055270),
            X64Word_create(289380356, 3203993006),
            X64Word_create(460393269, 320620315),
            X64Word_create(685471733, 587496836),
            X64Word_create(852142971, 1086792851),
            X64Word_create(1017036298, 365543100),
            X64Word_create(1126000580, 2618297676),
            X64Word_create(1288033470, 3409855158),
            X64Word_create(1501505948, 4234509866),
            X64Word_create(1607167915, 987167468),
            X64Word_create(1816402316, 1246189591)
          ];
          var W = [];
          (function() {
            for (var i = 0; i < 80; i++) {
              W[i] = X64Word_create();
            }
          })();
          var SHA512 = C_algo.SHA512 = Hasher.extend({
            _doReset: function() {
              this._hash = new X64WordArray.init([
                new X64Word.init(1779033703, 4089235720),
                new X64Word.init(3144134277, 2227873595),
                new X64Word.init(1013904242, 4271175723),
                new X64Word.init(2773480762, 1595750129),
                new X64Word.init(1359893119, 2917565137),
                new X64Word.init(2600822924, 725511199),
                new X64Word.init(528734635, 4215389547),
                new X64Word.init(1541459225, 327033209)
              ]);
            },
            _doProcessBlock: function(M, offset) {
              var H = this._hash.words;
              var H0 = H[0];
              var H1 = H[1];
              var H2 = H[2];
              var H3 = H[3];
              var H4 = H[4];
              var H5 = H[5];
              var H6 = H[6];
              var H7 = H[7];
              var H0h = H0.high;
              var H0l = H0.low;
              var H1h = H1.high;
              var H1l = H1.low;
              var H2h = H2.high;
              var H2l = H2.low;
              var H3h = H3.high;
              var H3l = H3.low;
              var H4h = H4.high;
              var H4l = H4.low;
              var H5h = H5.high;
              var H5l = H5.low;
              var H6h = H6.high;
              var H6l = H6.low;
              var H7h = H7.high;
              var H7l = H7.low;
              var ah = H0h;
              var al = H0l;
              var bh = H1h;
              var bl = H1l;
              var ch = H2h;
              var cl = H2l;
              var dh = H3h;
              var dl = H3l;
              var eh = H4h;
              var el = H4l;
              var fh = H5h;
              var fl = H5l;
              var gh = H6h;
              var gl = H6l;
              var hh = H7h;
              var hl = H7l;
              for (var i = 0; i < 80; i++) {
                var Wil;
                var Wih;
                var Wi = W[i];
                if (i < 16) {
                  Wih = Wi.high = M[offset + i * 2] | 0;
                  Wil = Wi.low = M[offset + i * 2 + 1] | 0;
                } else {
                  var gamma0x = W[i - 15];
                  var gamma0xh = gamma0x.high;
                  var gamma0xl = gamma0x.low;
                  var gamma0h = (gamma0xh >>> 1 | gamma0xl << 31) ^ (gamma0xh >>> 8 | gamma0xl << 24) ^ gamma0xh >>> 7;
                  var gamma0l = (gamma0xl >>> 1 | gamma0xh << 31) ^ (gamma0xl >>> 8 | gamma0xh << 24) ^ (gamma0xl >>> 7 | gamma0xh << 25);
                  var gamma1x = W[i - 2];
                  var gamma1xh = gamma1x.high;
                  var gamma1xl = gamma1x.low;
                  var gamma1h = (gamma1xh >>> 19 | gamma1xl << 13) ^ (gamma1xh << 3 | gamma1xl >>> 29) ^ gamma1xh >>> 6;
                  var gamma1l = (gamma1xl >>> 19 | gamma1xh << 13) ^ (gamma1xl << 3 | gamma1xh >>> 29) ^ (gamma1xl >>> 6 | gamma1xh << 26);
                  var Wi7 = W[i - 7];
                  var Wi7h = Wi7.high;
                  var Wi7l = Wi7.low;
                  var Wi16 = W[i - 16];
                  var Wi16h = Wi16.high;
                  var Wi16l = Wi16.low;
                  Wil = gamma0l + Wi7l;
                  Wih = gamma0h + Wi7h + (Wil >>> 0 < gamma0l >>> 0 ? 1 : 0);
                  Wil = Wil + gamma1l;
                  Wih = Wih + gamma1h + (Wil >>> 0 < gamma1l >>> 0 ? 1 : 0);
                  Wil = Wil + Wi16l;
                  Wih = Wih + Wi16h + (Wil >>> 0 < Wi16l >>> 0 ? 1 : 0);
                  Wi.high = Wih;
                  Wi.low = Wil;
                }
                var chh = eh & fh ^ ~eh & gh;
                var chl = el & fl ^ ~el & gl;
                var majh = ah & bh ^ ah & ch ^ bh & ch;
                var majl = al & bl ^ al & cl ^ bl & cl;
                var sigma0h = (ah >>> 28 | al << 4) ^ (ah << 30 | al >>> 2) ^ (ah << 25 | al >>> 7);
                var sigma0l = (al >>> 28 | ah << 4) ^ (al << 30 | ah >>> 2) ^ (al << 25 | ah >>> 7);
                var sigma1h = (eh >>> 14 | el << 18) ^ (eh >>> 18 | el << 14) ^ (eh << 23 | el >>> 9);
                var sigma1l = (el >>> 14 | eh << 18) ^ (el >>> 18 | eh << 14) ^ (el << 23 | eh >>> 9);
                var Ki = K[i];
                var Kih = Ki.high;
                var Kil = Ki.low;
                var t1l = hl + sigma1l;
                var t1h = hh + sigma1h + (t1l >>> 0 < hl >>> 0 ? 1 : 0);
                var t1l = t1l + chl;
                var t1h = t1h + chh + (t1l >>> 0 < chl >>> 0 ? 1 : 0);
                var t1l = t1l + Kil;
                var t1h = t1h + Kih + (t1l >>> 0 < Kil >>> 0 ? 1 : 0);
                var t1l = t1l + Wil;
                var t1h = t1h + Wih + (t1l >>> 0 < Wil >>> 0 ? 1 : 0);
                var t2l = sigma0l + majl;
                var t2h = sigma0h + majh + (t2l >>> 0 < sigma0l >>> 0 ? 1 : 0);
                hh = gh;
                hl = gl;
                gh = fh;
                gl = fl;
                fh = eh;
                fl = el;
                el = dl + t1l | 0;
                eh = dh + t1h + (el >>> 0 < dl >>> 0 ? 1 : 0) | 0;
                dh = ch;
                dl = cl;
                ch = bh;
                cl = bl;
                bh = ah;
                bl = al;
                al = t1l + t2l | 0;
                ah = t1h + t2h + (al >>> 0 < t1l >>> 0 ? 1 : 0) | 0;
              }
              H0l = H0.low = H0l + al;
              H0.high = H0h + ah + (H0l >>> 0 < al >>> 0 ? 1 : 0);
              H1l = H1.low = H1l + bl;
              H1.high = H1h + bh + (H1l >>> 0 < bl >>> 0 ? 1 : 0);
              H2l = H2.low = H2l + cl;
              H2.high = H2h + ch + (H2l >>> 0 < cl >>> 0 ? 1 : 0);
              H3l = H3.low = H3l + dl;
              H3.high = H3h + dh + (H3l >>> 0 < dl >>> 0 ? 1 : 0);
              H4l = H4.low = H4l + el;
              H4.high = H4h + eh + (H4l >>> 0 < el >>> 0 ? 1 : 0);
              H5l = H5.low = H5l + fl;
              H5.high = H5h + fh + (H5l >>> 0 < fl >>> 0 ? 1 : 0);
              H6l = H6.low = H6l + gl;
              H6.high = H6h + gh + (H6l >>> 0 < gl >>> 0 ? 1 : 0);
              H7l = H7.low = H7l + hl;
              H7.high = H7h + hh + (H7l >>> 0 < hl >>> 0 ? 1 : 0);
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              var nBitsTotal = this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
              dataWords[(nBitsLeft + 128 >>> 10 << 5) + 30] = Math.floor(nBitsTotal / 4294967296);
              dataWords[(nBitsLeft + 128 >>> 10 << 5) + 31] = nBitsTotal;
              data.sigBytes = dataWords.length * 4;
              this._process();
              var hash = this._hash.toX32();
              return hash;
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              clone._hash = this._hash.clone();
              return clone;
            },
            blockSize: 1024 / 32
          });
          C.SHA512 = Hasher._createHelper(SHA512);
          C.HmacSHA512 = Hasher._createHmacHelper(SHA512);
        })();
        return CryptoJS2.SHA512;
      });
    })(sha512);
    return sha512.exports;
  }
  var sha384 = { exports: {} };
  var hasRequiredSha384;
  function requireSha384() {
    if (hasRequiredSha384) return sha384.exports;
    hasRequiredSha384 = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireX64Core(), requireSha512());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_x64 = C.x64;
          var X64Word = C_x64.Word;
          var X64WordArray = C_x64.WordArray;
          var C_algo = C.algo;
          var SHA512 = C_algo.SHA512;
          var SHA384 = C_algo.SHA384 = SHA512.extend({
            _doReset: function() {
              this._hash = new X64WordArray.init([
                new X64Word.init(3418070365, 3238371032),
                new X64Word.init(1654270250, 914150663),
                new X64Word.init(2438529370, 812702999),
                new X64Word.init(355462360, 4144912697),
                new X64Word.init(1731405415, 4290775857),
                new X64Word.init(2394180231, 1750603025),
                new X64Word.init(3675008525, 1694076839),
                new X64Word.init(1203062813, 3204075428)
              ]);
            },
            _doFinalize: function() {
              var hash = SHA512._doFinalize.call(this);
              hash.sigBytes -= 16;
              return hash;
            }
          });
          C.SHA384 = SHA512._createHelper(SHA384);
          C.HmacSHA384 = SHA512._createHmacHelper(SHA384);
        })();
        return CryptoJS2.SHA384;
      });
    })(sha384);
    return sha384.exports;
  }
  var sha3 = { exports: {} };
  var hasRequiredSha3;
  function requireSha3() {
    if (hasRequiredSha3) return sha3.exports;
    hasRequiredSha3 = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireX64Core());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function(Math2) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var Hasher = C_lib.Hasher;
          var C_x64 = C.x64;
          var X64Word = C_x64.Word;
          var C_algo = C.algo;
          var RHO_OFFSETS = [];
          var PI_INDEXES = [];
          var ROUND_CONSTANTS = [];
          (function() {
            var x = 1, y = 0;
            for (var t = 0; t < 24; t++) {
              RHO_OFFSETS[x + 5 * y] = (t + 1) * (t + 2) / 2 % 64;
              var newX = y % 5;
              var newY = (2 * x + 3 * y) % 5;
              x = newX;
              y = newY;
            }
            for (var x = 0; x < 5; x++) {
              for (var y = 0; y < 5; y++) {
                PI_INDEXES[x + 5 * y] = y + (2 * x + 3 * y) % 5 * 5;
              }
            }
            var LFSR = 1;
            for (var i = 0; i < 24; i++) {
              var roundConstantMsw = 0;
              var roundConstantLsw = 0;
              for (var j = 0; j < 7; j++) {
                if (LFSR & 1) {
                  var bitPosition = (1 << j) - 1;
                  if (bitPosition < 32) {
                    roundConstantLsw ^= 1 << bitPosition;
                  } else {
                    roundConstantMsw ^= 1 << bitPosition - 32;
                  }
                }
                if (LFSR & 128) {
                  LFSR = LFSR << 1 ^ 113;
                } else {
                  LFSR <<= 1;
                }
              }
              ROUND_CONSTANTS[i] = X64Word.create(roundConstantMsw, roundConstantLsw);
            }
          })();
          var T = [];
          (function() {
            for (var i = 0; i < 25; i++) {
              T[i] = X64Word.create();
            }
          })();
          var SHA3 = C_algo.SHA3 = Hasher.extend({
 /**
 * Configuration options.
 *
 * @property {number} outputLength
 * The desired number of bits in the output hash.
 * Only values permitted are: 224, 256, 384, 512.
 * Default: 512
 */
            cfg: Hasher.cfg.extend({
              outputLength: 512
            }),
            _doReset: function() {
              var state = this._state = [];
              for (var i = 0; i < 25; i++) {
                state[i] = new X64Word.init();
              }
              this.blockSize = (1600 - 2 * this.cfg.outputLength) / 32;
            },
            _doProcessBlock: function(M, offset) {
              var state = this._state;
              var nBlockSizeLanes = this.blockSize / 2;
              for (var i = 0; i < nBlockSizeLanes; i++) {
                var M2i = M[offset + 2 * i];
                var M2i1 = M[offset + 2 * i + 1];
                M2i = (M2i << 8 | M2i >>> 24) & 16711935 | (M2i << 24 | M2i >>> 8) & 4278255360;
                M2i1 = (M2i1 << 8 | M2i1 >>> 24) & 16711935 | (M2i1 << 24 | M2i1 >>> 8) & 4278255360;
                var lane = state[i];
                lane.high ^= M2i1;
                lane.low ^= M2i;
              }
              for (var round = 0; round < 24; round++) {
                for (var x = 0; x < 5; x++) {
                  var tMsw = 0, tLsw = 0;
                  for (var y = 0; y < 5; y++) {
                    var lane = state[x + 5 * y];
                    tMsw ^= lane.high;
                    tLsw ^= lane.low;
                  }
                  var Tx = T[x];
                  Tx.high = tMsw;
                  Tx.low = tLsw;
                }
                for (var x = 0; x < 5; x++) {
                  var Tx4 = T[(x + 4) % 5];
                  var Tx1 = T[(x + 1) % 5];
                  var Tx1Msw = Tx1.high;
                  var Tx1Lsw = Tx1.low;
                  var tMsw = Tx4.high ^ (Tx1Msw << 1 | Tx1Lsw >>> 31);
                  var tLsw = Tx4.low ^ (Tx1Lsw << 1 | Tx1Msw >>> 31);
                  for (var y = 0; y < 5; y++) {
                    var lane = state[x + 5 * y];
                    lane.high ^= tMsw;
                    lane.low ^= tLsw;
                  }
                }
                for (var laneIndex = 1; laneIndex < 25; laneIndex++) {
                  var tMsw;
                  var tLsw;
                  var lane = state[laneIndex];
                  var laneMsw = lane.high;
                  var laneLsw = lane.low;
                  var rhoOffset = RHO_OFFSETS[laneIndex];
                  if (rhoOffset < 32) {
                    tMsw = laneMsw << rhoOffset | laneLsw >>> 32 - rhoOffset;
                    tLsw = laneLsw << rhoOffset | laneMsw >>> 32 - rhoOffset;
                  } else {
                    tMsw = laneLsw << rhoOffset - 32 | laneMsw >>> 64 - rhoOffset;
                    tLsw = laneMsw << rhoOffset - 32 | laneLsw >>> 64 - rhoOffset;
                  }
                  var TPiLane = T[PI_INDEXES[laneIndex]];
                  TPiLane.high = tMsw;
                  TPiLane.low = tLsw;
                }
                var T0 = T[0];
                var state0 = state[0];
                T0.high = state0.high;
                T0.low = state0.low;
                for (var x = 0; x < 5; x++) {
                  for (var y = 0; y < 5; y++) {
                    var laneIndex = x + 5 * y;
                    var lane = state[laneIndex];
                    var TLane = T[laneIndex];
                    var Tx1Lane = T[(x + 1) % 5 + 5 * y];
                    var Tx2Lane = T[(x + 2) % 5 + 5 * y];
                    lane.high = TLane.high ^ ~Tx1Lane.high & Tx2Lane.high;
                    lane.low = TLane.low ^ ~Tx1Lane.low & Tx2Lane.low;
                  }
                }
                var lane = state[0];
                var roundConstant = ROUND_CONSTANTS[round];
                lane.high ^= roundConstant.high;
                lane.low ^= roundConstant.low;
              }
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              var blockSizeBits = this.blockSize * 32;
              dataWords[nBitsLeft >>> 5] |= 1 << 24 - nBitsLeft % 32;
              dataWords[(Math2.ceil((nBitsLeft + 1) / blockSizeBits) * blockSizeBits >>> 5) - 1] |= 128;
              data.sigBytes = dataWords.length * 4;
              this._process();
              var state = this._state;
              var outputLengthBytes = this.cfg.outputLength / 8;
              var outputLengthLanes = outputLengthBytes / 8;
              var hashWords = [];
              for (var i = 0; i < outputLengthLanes; i++) {
                var lane = state[i];
                var laneMsw = lane.high;
                var laneLsw = lane.low;
                laneMsw = (laneMsw << 8 | laneMsw >>> 24) & 16711935 | (laneMsw << 24 | laneMsw >>> 8) & 4278255360;
                laneLsw = (laneLsw << 8 | laneLsw >>> 24) & 16711935 | (laneLsw << 24 | laneLsw >>> 8) & 4278255360;
                hashWords.push(laneLsw);
                hashWords.push(laneMsw);
              }
              return new WordArray.init(hashWords, outputLengthBytes);
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              var state = clone._state = this._state.slice(0);
              for (var i = 0; i < 25; i++) {
                state[i] = state[i].clone();
              }
              return clone;
            }
          });
          C.SHA3 = Hasher._createHelper(SHA3);
          C.HmacSHA3 = Hasher._createHmacHelper(SHA3);
        })(Math);
        return CryptoJS2.SHA3;
      });
    })(sha3);
    return sha3.exports;
  }
  var ripemd160 = { exports: {} };
  var hasRequiredRipemd160;
  function requireRipemd160() {
    if (hasRequiredRipemd160) return ripemd160.exports;
    hasRequiredRipemd160 = 1;
    (function(module2, exports3) {
      (function(root, factory) {
        {
          module2.exports = factory(requireCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
 /** @preserve
          			(c) 2012 by Cédric Mesnil. All rights reserved.
        
          			Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
        
          			    - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
          			    - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
        
          			THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 			*/
        (function(Math2) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var Hasher = C_lib.Hasher;
          var C_algo = C.algo;
          var _zl = WordArray.create([
            0,
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            12,
            13,
            14,
            15,
            7,
            4,
            13,
            1,
            10,
            6,
            15,
            3,
            12,
            0,
            9,
            5,
            2,
            14,
            11,
            8,
            3,
            10,
            14,
            4,
            9,
            15,
            8,
            1,
            2,
            7,
            0,
            6,
            13,
            11,
            5,
            12,
            1,
            9,
            11,
            10,
            0,
            8,
            12,
            4,
            13,
            3,
            7,
            15,
            14,
            5,
            6,
            2,
            4,
            0,
            5,
            9,
            7,
            12,
            2,
            10,
            14,
            1,
            3,
            8,
            11,
            6,
            15,
            13
          ]);
          var _zr = WordArray.create([
            5,
            14,
            7,
            0,
            9,
            2,
            11,
            4,
            13,
            6,
            15,
            8,
            1,
            10,
            3,
            12,
            6,
            11,
            3,
            7,
            0,
            13,
            5,
            10,
            14,
            15,
            8,
            12,
            4,
            9,
            1,
            2,
            15,
            5,
            1,
            3,
            7,
            14,
            6,
            9,
            11,
            8,
            12,
            2,
            10,
            0,
            4,
            13,
            8,
            6,
            4,
            1,
            3,
            11,
            15,
            0,
            5,
            12,
            2,
            13,
            9,
            7,
            10,
            14,
            12,
            15,
            10,
            4,
            1,
            5,
            8,
            7,
            6,
            2,
            13,
            14,
            0,
            3,
            9,
            11
          ]);
          var _sl = WordArray.create([
            11,
            14,
            15,
            12,
            5,
            8,
            7,
            9,
            11,
            13,
            14,
            15,
            6,
            7,
            9,
            8,
            7,
            6,
            8,
            13,
            11,
            9,
            7,
            15,
            7,
            12,
            15,
            9,
            11,
            7,
            13,
            12,
            11,
            13,
            6,
            7,
            14,
            9,
            13,
            15,
            14,
            8,
            13,
            6,
            5,
            12,
            7,
            5,
            11,
            12,
            14,
            15,
            14,
            15,
            9,
            8,
            9,
            14,
            5,
            6,
            8,
            6,
            5,
            12,
            9,
            15,
            5,
            11,
            6,
            8,
            13,
            12,
            5,
            12,
            13,
            14,
            11,
            8,
            5,
            6
          ]);
          var _sr = WordArray.create([
            8,
            9,
            9,
            11,
            13,
            15,
            15,
            5,
            7,
            7,
            8,
            11,
            14,
            14,
            12,
            6,
            9,
            13,
            15,
            7,
            12,
            8,
            9,
            11,
            7,
            7,
            12,
            7,
            6,
            15,
            13,
            11,
            9,
            7,
            15,
            11,
            8,
            6,
            6,
            14,
            12,
            13,
            5,
            14,
            13,
            13,
            7,
            5,
            15,
            5,
            8,
            11,
            14,
            14,
            6,
            14,
            6,
            9,
            12,
            9,
            12,
            5,
            15,
            8,
            8,
            5,
            12,
            9,
            12,
            5,
            14,
            6,
            8,
            13,
            6,
            5,
            15,
            13,
            11,
            11
          ]);
          var _hl = WordArray.create([0, 1518500249, 1859775393, 2400959708, 2840853838]);
          var _hr = WordArray.create([1352829926, 1548603684, 1836072691, 2053994217, 0]);
          var RIPEMD160 = C_algo.RIPEMD160 = Hasher.extend({
            _doReset: function() {
              this._hash = WordArray.create([1732584193, 4023233417, 2562383102, 271733878, 3285377520]);
            },
            _doProcessBlock: function(M, offset) {
              for (var i = 0; i < 16; i++) {
                var offset_i = offset + i;
                var M_offset_i = M[offset_i];
                M[offset_i] = (M_offset_i << 8 | M_offset_i >>> 24) & 16711935 | (M_offset_i << 24 | M_offset_i >>> 8) & 4278255360;
              }
              var H = this._hash.words;
              var hl = _hl.words;
              var hr = _hr.words;
              var zl = _zl.words;
              var zr = _zr.words;
              var sl = _sl.words;
              var sr = _sr.words;
              var al, bl, cl, dl, el;
              var ar, br, cr, dr, er;
              ar = al = H[0];
              br = bl = H[1];
              cr = cl = H[2];
              dr = dl = H[3];
              er = el = H[4];
              var t;
              for (var i = 0; i < 80; i += 1) {
                t = al + M[offset + zl[i]] | 0;
                if (i < 16) {
                  t += f1(bl, cl, dl) + hl[0];
                } else if (i < 32) {
                  t += f2(bl, cl, dl) + hl[1];
                } else if (i < 48) {
                  t += f3(bl, cl, dl) + hl[2];
                } else if (i < 64) {
                  t += f4(bl, cl, dl) + hl[3];
                } else {
                  t += f5(bl, cl, dl) + hl[4];
                }
                t = t | 0;
                t = rotl(t, sl[i]);
                t = t + el | 0;
                al = el;
                el = dl;
                dl = rotl(cl, 10);
                cl = bl;
                bl = t;
                t = ar + M[offset + zr[i]] | 0;
                if (i < 16) {
                  t += f5(br, cr, dr) + hr[0];
                } else if (i < 32) {
                  t += f4(br, cr, dr) + hr[1];
                } else if (i < 48) {
                  t += f3(br, cr, dr) + hr[2];
                } else if (i < 64) {
                  t += f2(br, cr, dr) + hr[3];
                } else {
                  t += f1(br, cr, dr) + hr[4];
                }
                t = t | 0;
                t = rotl(t, sr[i]);
                t = t + er | 0;
                ar = er;
                er = dr;
                dr = rotl(cr, 10);
                cr = br;
                br = t;
              }
              t = H[1] + cl + dr | 0;
              H[1] = H[2] + dl + er | 0;
              H[2] = H[3] + el + ar | 0;
              H[3] = H[4] + al + br | 0;
              H[4] = H[0] + bl + cr | 0;
              H[0] = t;
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              var nBitsTotal = this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = (nBitsTotal << 8 | nBitsTotal >>> 24) & 16711935 | (nBitsTotal << 24 | nBitsTotal >>> 8) & 4278255360;
              data.sigBytes = (dataWords.length + 1) * 4;
              this._process();
              var hash = this._hash;
              var H = hash.words;
              for (var i = 0; i < 5; i++) {
                var H_i = H[i];
                H[i] = (H_i << 8 | H_i >>> 24) & 16711935 | (H_i << 24 | H_i >>> 8) & 4278255360;
              }
              return hash;
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              clone._hash = this._hash.clone();
              return clone;
            }
          });
          function f1(x, y, z) {
            return x ^ y ^ z;
          }
          function f2(x, y, z) {
            return x & y | ~x & z;
          }
          function f3(x, y, z) {
            return (x | ~y) ^ z;
          }
          function f4(x, y, z) {
            return x & z | y & ~z;
          }
          function f5(x, y, z) {
            return x ^ (y | ~z);
          }
          function rotl(x, n) {
            return x << n | x >>> 32 - n;
          }
          C.RIPEMD160 = Hasher._createHelper(RIPEMD160);
          C.HmacRIPEMD160 = Hasher._createHmacHelper(RIPEMD160);
        })();
        return CryptoJS2.RIPEMD160;
      });
    })(ripemd160);
    return ripemd160.exports;
  }
  var hmac = { exports: {} };
  var hasRequiredHmac;
  function requireHmac() {
    if (hasRequiredHmac) return hmac.exports;
    hasRequiredHmac = 1;
    (function(module2, exports3) {
      (function(root, factory) {
        {
          module2.exports = factory(requireCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Base = C_lib.Base;
          var C_enc = C.enc;
          var Utf8 = C_enc.Utf8;
          var C_algo = C.algo;
          C_algo.HMAC = Base.extend({
 /**
 * Initializes a newly created HMAC.
 *
 * @param {Hasher} hasher The hash algorithm to use.
 * @param {WordArray|string} key The secret key.
 *
 * @example
 *
 * var hmacHasher = CryptoJS.algo.HMAC.create(CryptoJS.algo.SHA256, key);
 */
            init: function(hasher, key) {
              hasher = this._hasher = new hasher.init();
              if (typeof key == "string") {
                key = Utf8.parse(key);
              }
              var hasherBlockSize = hasher.blockSize;
              var hasherBlockSizeBytes = hasherBlockSize * 4;
              if (key.sigBytes > hasherBlockSizeBytes) {
                key = hasher.finalize(key);
              }
              key.clamp();
              var oKey = this._oKey = key.clone();
              var iKey = this._iKey = key.clone();
              var oKeyWords = oKey.words;
              var iKeyWords = iKey.words;
              for (var i = 0; i < hasherBlockSize; i++) {
                oKeyWords[i] ^= 1549556828;
                iKeyWords[i] ^= 909522486;
              }
              oKey.sigBytes = iKey.sigBytes = hasherBlockSizeBytes;
              this.reset();
            },
 /**
 * Resets this HMAC to its initial state.
 *
 * @example
 *
 * hmacHasher.reset;
 */
            reset: function() {
              var hasher = this._hasher;
              hasher.reset();
              hasher.update(this._iKey);
            },
 /**
 * Updates this HMAC with a message.
 *
 * @param {WordArray|string} messageUpdate The message to append.
 *
 * @return {HMAC} This HMAC instance.
 *
 * @example
 *
 * hmacHasher.update('message');
 * hmacHasher.update(wordArray);
 */
            update: function(messageUpdate) {
              this._hasher.update(messageUpdate);
              return this;
            },
 /**
 * Finalizes the HMAC computation.
 * Note that the finalize operation is effectively a destructive, read-once operation.
 *
 * @param {WordArray|string} messageUpdate (Optional) A final message update.
 *
 * @return {WordArray} The HMAC.
 *
 * @example
 *
 * var hmac = hmacHasher.finalize;
 * var hmac = hmacHasher.finalize('message');
 * var hmac = hmacHasher.finalize(wordArray);
 */
            finalize: function(messageUpdate) {
              var hasher = this._hasher;
              var innerHash = hasher.finalize(messageUpdate);
              hasher.reset();
              var hmac2 = hasher.finalize(this._oKey.clone().concat(innerHash));
              return hmac2;
            }
          });
        })();
      });
    })(hmac);
    return hmac.exports;
  }
  var pbkdf2 = { exports: {} };
  var hasRequiredPbkdf2;
  function requirePbkdf2() {
    if (hasRequiredPbkdf2) return pbkdf2.exports;
    hasRequiredPbkdf2 = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireSha256(), requireHmac());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Base = C_lib.Base;
          var WordArray = C_lib.WordArray;
          var C_algo = C.algo;
          var SHA256 = C_algo.SHA256;
          var HMAC = C_algo.HMAC;
          var PBKDF2 = C_algo.PBKDF2 = Base.extend({
 /**
 * Configuration options.
 *
 * @property {number} keySize The key size in words to generate. Default: 4 (128 bits)
 * @property {Hasher} hasher The hasher to use. Default: SHA256
 * @property {number} iterations The number of iterations to perform. Default: 250000
 */
            cfg: Base.extend({
              keySize: 128 / 32,
              hasher: SHA256,
              iterations: 25e4
            }),
 /**
 * Initializes a newly created key derivation function.
 *
 * @param {Object} cfg (Optional) The configuration options to use for the derivation.
 *
 * @example
 *
 * var kdf = CryptoJS.algo.PBKDF2.create;
 * var kdf = CryptoJS.algo.PBKDF2.create({ keySize: 8 });
 * var kdf = CryptoJS.algo.PBKDF2.create({ keySize: 8, iterations: 1000 });
 */
            init: function(cfg) {
              this.cfg = this.cfg.extend(cfg);
            },
 /**
 * Computes the Password-Based Key Derivation Function 2.
 *
 * @param {WordArray|string} password The password.
 * @param {WordArray|string} salt A salt.
 *
 * @return {WordArray} The derived key.
 *
 * @example
 *
 * var key = kdf.compute(password, salt);
 */
            compute: function(password, salt) {
              var cfg = this.cfg;
              var hmac2 = HMAC.create(cfg.hasher, password);
              var derivedKey = WordArray.create();
              var blockIndex = WordArray.create([1]);
              var derivedKeyWords = derivedKey.words;
              var blockIndexWords = blockIndex.words;
              var keySize = cfg.keySize;
              var iterations = cfg.iterations;
              while (derivedKeyWords.length < keySize) {
                var block = hmac2.update(salt).finalize(blockIndex);
                hmac2.reset();
                var blockWords = block.words;
                var blockWordsLength = blockWords.length;
                var intermediate = block;
                for (var i = 1; i < iterations; i++) {
                  intermediate = hmac2.finalize(intermediate);
                  hmac2.reset();
                  var intermediateWords = intermediate.words;
                  for (var j = 0; j < blockWordsLength; j++) {
                    blockWords[j] ^= intermediateWords[j];
                  }
                }
                derivedKey.concat(block);
                blockIndexWords[0]++;
              }
              derivedKey.sigBytes = keySize * 4;
              return derivedKey;
            }
          });
          C.PBKDF2 = function(password, salt, cfg) {
            return PBKDF2.create(cfg).compute(password, salt);
          };
        })();
        return CryptoJS2.PBKDF2;
      });
    })(pbkdf2);
    return pbkdf2.exports;
  }
  var evpkdf = { exports: {} };
  var hasRequiredEvpkdf;
  function requireEvpkdf() {
    if (hasRequiredEvpkdf) return evpkdf.exports;
    hasRequiredEvpkdf = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireSha1(), requireHmac());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Base = C_lib.Base;
          var WordArray = C_lib.WordArray;
          var C_algo = C.algo;
          var MD5 = C_algo.MD5;
          var EvpKDF = C_algo.EvpKDF = Base.extend({
 /**
 * Configuration options.
 *
 * @property {number} keySize The key size in words to generate. Default: 4 (128 bits)
 * @property {Hasher} hasher The hash algorithm to use. Default: MD5
 * @property {number} iterations The number of iterations to perform. Default: 1
 */
            cfg: Base.extend({
              keySize: 128 / 32,
              hasher: MD5,
              iterations: 1
            }),
 /**
 * Initializes a newly created key derivation function.
 *
 * @param {Object} cfg (Optional) The configuration options to use for the derivation.
 *
 * @example
 *
 * var kdf = CryptoJS.algo.EvpKDF.create;
 * var kdf = CryptoJS.algo.EvpKDF.create({ keySize: 8 });
 * var kdf = CryptoJS.algo.EvpKDF.create({ keySize: 8, iterations: 1000 });
 */
            init: function(cfg) {
              this.cfg = this.cfg.extend(cfg);
            },
 /**
 * Derives a key from a password.
 *
 * @param {WordArray|string} password The password.
 * @param {WordArray|string} salt A salt.
 *
 * @return {WordArray} The derived key.
 *
 * @example
 *
 * var key = kdf.compute(password, salt);
 */
            compute: function(password, salt) {
              var block;
              var cfg = this.cfg;
              var hasher = cfg.hasher.create();
              var derivedKey = WordArray.create();
              var derivedKeyWords = derivedKey.words;
              var keySize = cfg.keySize;
              var iterations = cfg.iterations;
              while (derivedKeyWords.length < keySize) {
                if (block) {
                  hasher.update(block);
                }
                block = hasher.update(password).finalize(salt);
                hasher.reset();
                for (var i = 1; i < iterations; i++) {
                  block = hasher.finalize(block);
                  hasher.reset();
                }
                derivedKey.concat(block);
              }
              derivedKey.sigBytes = keySize * 4;
              return derivedKey;
            }
          });
          C.EvpKDF = function(password, salt, cfg) {
            return EvpKDF.create(cfg).compute(password, salt);
          };
        })();
        return CryptoJS2.EvpKDF;
      });
    })(evpkdf);
    return evpkdf.exports;
  }
  var cipherCore = { exports: {} };
  var hasRequiredCipherCore;
  function requireCipherCore() {
    if (hasRequiredCipherCore) return cipherCore.exports;
    hasRequiredCipherCore = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireEvpkdf());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        CryptoJS2.lib.Cipher || function(undefined$1) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Base = C_lib.Base;
          var WordArray = C_lib.WordArray;
          var BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm;
          var C_enc = C.enc;
          C_enc.Utf8;
          var Base64 = C_enc.Base64;
          var C_algo = C.algo;
          var EvpKDF = C_algo.EvpKDF;
          var Cipher = C_lib.Cipher = BufferedBlockAlgorithm.extend({
 /**
 * Configuration options.
 *
 * @property {WordArray} iv The IV to use for this operation.
 */
            cfg: Base.extend(),
 /**
 * Creates this cipher in encryption mode.
 *
 * @param {WordArray} key The key.
 * @param {Object} cfg (Optional) The configuration options to use for this operation.
 *
 * @return {Cipher} A cipher instance.
 *
 * @static
 *
 * @example
 *
 * var cipher = CryptoJS.algo.AES.createEncryptor(keyWordArray, { iv: ivWordArray });
 */
            createEncryptor: function(key, cfg) {
              return this.create(this._ENC_XFORM_MODE, key, cfg);
            },
 /**
 * Creates this cipher in decryption mode.
 *
 * @param {WordArray} key The key.
 * @param {Object} cfg (Optional) The configuration options to use for this operation.
 *
 * @return {Cipher} A cipher instance.
 *
 * @static
 *
 * @example
 *
 * var cipher = CryptoJS.algo.AES.createDecryptor(keyWordArray, { iv: ivWordArray });
 */
            createDecryptor: function(key, cfg) {
              return this.create(this._DEC_XFORM_MODE, key, cfg);
            },
 /**
 * Initializes a newly created cipher.
 *
 * @param {number} xformMode Either the encryption or decryption transormation mode constant.
 * @param {WordArray} key The key.
 * @param {Object} cfg (Optional) The configuration options to use for this operation.
 *
 * @example
 *
 * var cipher = CryptoJS.algo.AES.create(CryptoJS.algo.AES._ENC_XFORM_MODE, keyWordArray, { iv: ivWordArray });
 */
            init: function(xformMode, key, cfg) {
              this.cfg = this.cfg.extend(cfg);
              this._xformMode = xformMode;
              this._key = key;
              this.reset();
            },
 /**
 * Resets this cipher to its initial state.
 *
 * @example
 *
 * cipher.reset;
 */
            reset: function() {
              BufferedBlockAlgorithm.reset.call(this);
              this._doReset();
            },
 /**
 * Adds data to be encrypted or decrypted.
 *
 * @param {WordArray|string} dataUpdate The data to encrypt or decrypt.
 *
 * @return {WordArray} The data after processing.
 *
 * @example
 *
 * var encrypted = cipher.process('data');
 * var encrypted = cipher.process(wordArray);
 */
            process: function(dataUpdate) {
              this._append(dataUpdate);
              return this._process();
            },
 /**
 * Finalizes the encryption or decryption process.
 * Note that the finalize operation is effectively a destructive, read-once operation.
 *
 * @param {WordArray|string} dataUpdate The final data to encrypt or decrypt.
 *
 * @return {WordArray} The data after final processing.
 *
 * @example
 *
 * var encrypted = cipher.finalize;
 * var encrypted = cipher.finalize('data');
 * var encrypted = cipher.finalize(wordArray);
 */
            finalize: function(dataUpdate) {
              if (dataUpdate) {
                this._append(dataUpdate);
              }
              var finalProcessedData = this._doFinalize();
              return finalProcessedData;
            },
            keySize: 128 / 32,
            ivSize: 128 / 32,
            _ENC_XFORM_MODE: 1,
            _DEC_XFORM_MODE: 2,
 /**
 * Creates shortcut functions to a cipher's object interface.
 *
 * @param {Cipher} cipher The cipher to create a helper for.
 *
 * @return {Object} An object with encrypt and decrypt shortcut functions.
 *
 * @static
 *
 * @example
 *
 * var AES = CryptoJS.lib.Cipher._createHelper(CryptoJS.algo.AES);
 */
            _createHelper: /* @__PURE__ */ function() {
              function selectCipherStrategy(key) {
                if (typeof key == "string") {
                  return PasswordBasedCipher;
                } else {
                  return SerializableCipher;
                }
              }
              return function(cipher) {
                return {
                  encrypt: function(message, key, cfg) {
                    return selectCipherStrategy(key).encrypt(cipher, message, key, cfg);
                  },
                  decrypt: function(ciphertext, key, cfg) {
                    return selectCipherStrategy(key).decrypt(cipher, ciphertext, key, cfg);
                  }
                };
              };
            }()
          });
          C_lib.StreamCipher = Cipher.extend({
            _doFinalize: function() {
              var finalProcessedBlocks = this._process(true);
              return finalProcessedBlocks;
            },
            blockSize: 1
          });
          var C_mode = C.mode = {};
          var BlockCipherMode = C_lib.BlockCipherMode = Base.extend({
 /**
 * Creates this mode for encryption.
 *
 * @param {Cipher} cipher A block cipher instance.
 * @param {Array} iv The IV words.
 *
 * @static
 *
 * @example
 *
 * var mode = CryptoJS.mode.CBC.createEncryptor(cipher, iv.words);
 */
            createEncryptor: function(cipher, iv) {
              return this.Encryptor.create(cipher, iv);
            },
 /**
 * Creates this mode for decryption.
 *
 * @param {Cipher} cipher A block cipher instance.
 * @param {Array} iv The IV words.
 *
 * @static
 *
 * @example
 *
 * var mode = CryptoJS.mode.CBC.createDecryptor(cipher, iv.words);
 */
            createDecryptor: function(cipher, iv) {
              return this.Decryptor.create(cipher, iv);
            },
 /**
 * Initializes a newly created mode.
 *
 * @param {Cipher} cipher A block cipher instance.
 * @param {Array} iv The IV words.
 *
 * @example
 *
 * var mode = CryptoJS.mode.CBC.Encryptor.create(cipher, iv.words);
 */
            init: function(cipher, iv) {
              this._cipher = cipher;
              this._iv = iv;
            }
          });
          var CBC = C_mode.CBC = function() {
            var CBC2 = BlockCipherMode.extend();
            CBC2.Encryptor = CBC2.extend({
 /**
 * Processes the data block at offset.
 *
 * @param {Array} words The data words to operate on.
 * @param {number} offset The offset where the block starts.
 *
 * @example
 *
 * mode.processBlock(data.words, offset);
 */
              processBlock: function(words, offset) {
                var cipher = this._cipher;
                var blockSize = cipher.blockSize;
                xorBlock.call(this, words, offset, blockSize);
                cipher.encryptBlock(words, offset);
                this._prevBlock = words.slice(offset, offset + blockSize);
              }
            });
            CBC2.Decryptor = CBC2.extend({
 /**
 * Processes the data block at offset.
 *
 * @param {Array} words The data words to operate on.
 * @param {number} offset The offset where the block starts.
 *
 * @example
 *
 * mode.processBlock(data.words, offset);
 */
              processBlock: function(words, offset) {
                var cipher = this._cipher;
                var blockSize = cipher.blockSize;
                var thisBlock = words.slice(offset, offset + blockSize);
                cipher.decryptBlock(words, offset);
                xorBlock.call(this, words, offset, blockSize);
                this._prevBlock = thisBlock;
              }
            });
            function xorBlock(words, offset, blockSize) {
              var block;
              var iv = this._iv;
              if (iv) {
                block = iv;
                this._iv = undefined$1;
              } else {
                block = this._prevBlock;
              }
              for (var i = 0; i < blockSize; i++) {
                words[offset + i] ^= block[i];
              }
            }
            return CBC2;
          }();
          var C_pad = C.pad = {};
          var Pkcs7 = C_pad.Pkcs7 = {
 /**
 * Pads data using the algorithm defined in PKCS #5/7.
 *
 * @param {WordArray} data The data to pad.
 * @param {number} blockSize The multiple that the data should be padded to.
 *
 * @static
 *
 * @example
 *
 * CryptoJS.pad.Pkcs7.pad(wordArray, 4);
 */
            pad: function(data, blockSize) {
              var blockSizeBytes = blockSize * 4;
              var nPaddingBytes = blockSizeBytes - data.sigBytes % blockSizeBytes;
              var paddingWord = nPaddingBytes << 24 | nPaddingBytes << 16 | nPaddingBytes << 8 | nPaddingBytes;
              var paddingWords = [];
              for (var i = 0; i < nPaddingBytes; i += 4) {
                paddingWords.push(paddingWord);
              }
              var padding = WordArray.create(paddingWords, nPaddingBytes);
              data.concat(padding);
            },
 /**
 * Unpads data that had been padded using the algorithm defined in PKCS #5/7.
 *
 * @param {WordArray} data The data to unpad.
 *
 * @static
 *
 * @example
 *
 * CryptoJS.pad.Pkcs7.unpad(wordArray);
 */
            unpad: function(data) {
              var nPaddingBytes = data.words[data.sigBytes - 1 >>> 2] & 255;
              data.sigBytes -= nPaddingBytes;
            }
          };
          C_lib.BlockCipher = Cipher.extend({
 /**
 * Configuration options.
 *
 * @property {Mode} mode The block mode to use. Default: CBC
 * @property {Padding} padding The padding strategy to use. Default: Pkcs7
 */
            cfg: Cipher.cfg.extend({
              mode: CBC,
              padding: Pkcs7
            }),
            reset: function() {
              var modeCreator;
              Cipher.reset.call(this);
              var cfg = this.cfg;
              var iv = cfg.iv;
              var mode = cfg.mode;
              if (this._xformMode == this._ENC_XFORM_MODE) {
                modeCreator = mode.createEncryptor;
              } else {
                modeCreator = mode.createDecryptor;
                this._minBufferSize = 1;
              }
              if (this._mode && this._mode.__creator == modeCreator) {
                this._mode.init(this, iv && iv.words);
              } else {
                this._mode = modeCreator.call(mode, this, iv && iv.words);
                this._mode.__creator = modeCreator;
              }
            },
            _doProcessBlock: function(words, offset) {
              this._mode.processBlock(words, offset);
            },
            _doFinalize: function() {
              var finalProcessedBlocks;
              var padding = this.cfg.padding;
              if (this._xformMode == this._ENC_XFORM_MODE) {
                padding.pad(this._data, this.blockSize);
                finalProcessedBlocks = this._process(true);
              } else {
                finalProcessedBlocks = this._process(true);
                padding.unpad(finalProcessedBlocks);
              }
              return finalProcessedBlocks;
            },
            blockSize: 128 / 32
          });
          var CipherParams = C_lib.CipherParams = Base.extend({
 /**
 * Initializes a newly created cipher params object.
 *
 * @param {Object} cipherParams An object with any of the possible cipher parameters.
 *
 * @example
 *
 * var cipherParams = CryptoJS.lib.CipherParams.create({
 * ciphertext: ciphertextWordArray
 * key: keyWordArray
 * iv: ivWordArray
 * salt: saltWordArray
 * algorithm: CryptoJS.algo.AES
 * mode: CryptoJS.mode.CBC
 * padding: CryptoJS.pad.PKCS7
 * blockSize: 4
 * formatter: CryptoJS.format.OpenSSL
 * });
 */
            init: function(cipherParams) {
              this.mixIn(cipherParams);
            },
 /**
 * Converts this cipher params object to a string.
 *
 * @param {Format} formatter (Optional) The formatting strategy to use.
 *
 * @return {string} The stringified cipher params.
 *
 * @throws Error If neither the formatter nor the default formatter is set.
 *
 * @example
 *
 * var string = cipherParams + '';
 * var string = cipherParams.toString;
 * var string = cipherParams.toString(CryptoJS.format.OpenSSL);
 */
            toString: function(formatter) {
              return (formatter || this.formatter).stringify(this);
            }
          });
          var C_format = C.format = {};
          var OpenSSLFormatter = C_format.OpenSSL = {
 /**
 * Converts a cipher params object to an OpenSSL-compatible string.
 *
 * @param {CipherParams} cipherParams The cipher params object.
 *
 * @return {string} The OpenSSL-compatible string.
 *
 * @static
 *
 * @example
 *
 * var openSSLString = CryptoJS.format.OpenSSL.stringify(cipherParams);
 */
            stringify: function(cipherParams) {
              var wordArray;
              var ciphertext = cipherParams.ciphertext;
              var salt = cipherParams.salt;
              if (salt) {
                wordArray = WordArray.create([1398893684, 1701076831]).concat(salt).concat(ciphertext);
              } else {
                wordArray = ciphertext;
              }
              return wordArray.toString(Base64);
            },
 /**
 * Converts an OpenSSL-compatible string to a cipher params object.
 *
 * @param {string} openSSLStr The OpenSSL-compatible string.
 *
 * @return {CipherParams} The cipher params object.
 *
 * @static
 *
 * @example
 *
 * var cipherParams = CryptoJS.format.OpenSSL.parse(openSSLString);
 */
            parse: function(openSSLStr) {
              var salt;
              var ciphertext = Base64.parse(openSSLStr);
              var ciphertextWords = ciphertext.words;
              if (ciphertextWords[0] == 1398893684 && ciphertextWords[1] == 1701076831) {
                salt = WordArray.create(ciphertextWords.slice(2, 4));
                ciphertextWords.splice(0, 4);
                ciphertext.sigBytes -= 16;
              }
              return CipherParams.create({ ciphertext, salt });
            }
          };
          var SerializableCipher = C_lib.SerializableCipher = Base.extend({
 /**
 * Configuration options.
 *
 * @property {Formatter} format The formatting strategy to convert cipher param objects to and from a string. Default: OpenSSL
 */
            cfg: Base.extend({
              format: OpenSSLFormatter
            }),
 /**
 * Encrypts a message.
 *
 * @param {Cipher} cipher The cipher algorithm to use.
 * @param {WordArray|string} message The message to encrypt.
 * @param {WordArray} key The key.
 * @param {Object} cfg (Optional) The configuration options to use for this operation.
 *
 * @return {CipherParams} A cipher params object.
 *
 * @static
 *
 * @example
 *
 * var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key);
 * var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key, { iv: iv });
 * var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key, { iv: iv, format: CryptoJS.format.OpenSSL });
 */
            encrypt: function(cipher, message, key, cfg) {
              cfg = this.cfg.extend(cfg);
              var encryptor = cipher.createEncryptor(key, cfg);
              var ciphertext = encryptor.finalize(message);
              var cipherCfg = encryptor.cfg;
              return CipherParams.create({
                ciphertext,
                key,
                iv: cipherCfg.iv,
                algorithm: cipher,
                mode: cipherCfg.mode,
                padding: cipherCfg.padding,
                blockSize: cipher.blockSize,
                formatter: cfg.format
              });
            },
 /**
 * Decrypts serialized ciphertext.
 *
 * @param {Cipher} cipher The cipher algorithm to use.
 * @param {CipherParams|string} ciphertext The ciphertext to decrypt.
 * @param {WordArray} key The key.
 * @param {Object} cfg (Optional) The configuration options to use for this operation.
 *
 * @return {WordArray} The plaintext.
 *
 * @static
 *
 * @example
 *
 * var plaintext = CryptoJS.lib.SerializableCipher.decrypt(CryptoJS.algo.AES, formattedCiphertext, key, { iv: iv, format: CryptoJS.format.OpenSSL });
 * var plaintext = CryptoJS.lib.SerializableCipher.decrypt(CryptoJS.algo.AES, ciphertextParams, key, { iv: iv, format: CryptoJS.format.OpenSSL });
 */
            decrypt: function(cipher, ciphertext, key, cfg) {
              cfg = this.cfg.extend(cfg);
              ciphertext = this._parse(ciphertext, cfg.format);
              var plaintext = cipher.createDecryptor(key, cfg).finalize(ciphertext.ciphertext);
              return plaintext;
            },
 /**
 * Converts serialized ciphertext to CipherParams
 * else assumed CipherParams already and returns ciphertext unchanged.
 *
 * @param {CipherParams|string} ciphertext The ciphertext.
 * @param {Formatter} format The formatting strategy to use to parse serialized ciphertext.
 *
 * @return {CipherParams} The unserialized ciphertext.
 *
 * @static
 *
 * @example
 *
 * var ciphertextParams = CryptoJS.lib.SerializableCipher._parse(ciphertextStringOrParams, format);
 */
            _parse: function(ciphertext, format) {
              if (typeof ciphertext == "string") {
                return format.parse(ciphertext, this);
              } else {
                return ciphertext;
              }
            }
          });
          var C_kdf = C.kdf = {};
          var OpenSSLKdf = C_kdf.OpenSSL = {
 /**
 * Derives a key and IV from a password.
 *
 * @param {string} password The password to derive from.
 * @param {number} keySize The size in words of the key to generate.
 * @param {number} ivSize The size in words of the IV to generate.
 * @param {WordArray|string} salt (Optional) A 64-bit salt to use. If omitted, a salt will be generated randomly.
 *
 * @return {CipherParams} A cipher params object with the key, IV, and salt.
 *
 * @static
 *
 * @example
 *
 * var derivedParams = CryptoJS.kdf.OpenSSL.execute('Password', 256/32, 128/32);
 * var derivedParams = CryptoJS.kdf.OpenSSL.execute('Password', 256/32, 128/32, 'saltsalt');
 */
            execute: function(password, keySize, ivSize, salt, hasher) {
              if (!salt) {
                salt = WordArray.random(64 / 8);
              }
              if (!hasher) {
                var key = EvpKDF.create({ keySize: keySize + ivSize }).compute(password, salt);
              } else {
                var key = EvpKDF.create({ keySize: keySize + ivSize, hasher }).compute(password, salt);
              }
              var iv = WordArray.create(key.words.slice(keySize), ivSize * 4);
              key.sigBytes = keySize * 4;
              return CipherParams.create({ key, iv, salt });
            }
          };
          var PasswordBasedCipher = C_lib.PasswordBasedCipher = SerializableCipher.extend({
 /**
 * Configuration options.
 *
 * @property {KDF} kdf The key derivation function to use to generate a key and IV from a password. Default: OpenSSL
 */
            cfg: SerializableCipher.cfg.extend({
              kdf: OpenSSLKdf
            }),
 /**
 * Encrypts a message using a password.
 *
 * @param {Cipher} cipher The cipher algorithm to use.
 * @param {WordArray|string} message The message to encrypt.
 * @param {string} password The password.
 * @param {Object} cfg (Optional) The configuration options to use for this operation.
 *
 * @return {CipherParams} A cipher params object.
 *
 * @static
 *
 * @example
 *
 * var ciphertextParams = CryptoJS.lib.PasswordBasedCipher.encrypt(CryptoJS.algo.AES, message, 'password');
 * var ciphertextParams = CryptoJS.lib.PasswordBasedCipher.encrypt(CryptoJS.algo.AES, message, 'password', { format: CryptoJS.format.OpenSSL });
 */
            encrypt: function(cipher, message, password, cfg) {
              cfg = this.cfg.extend(cfg);
              var derivedParams = cfg.kdf.execute(password, cipher.keySize, cipher.ivSize, cfg.salt, cfg.hasher);
              cfg.iv = derivedParams.iv;
              var ciphertext = SerializableCipher.encrypt.call(this, cipher, message, derivedParams.key, cfg);
              ciphertext.mixIn(derivedParams);
              return ciphertext;
            },
 /**
 * Decrypts serialized ciphertext using a password.
 *
 * @param {Cipher} cipher The cipher algorithm to use.
 * @param {CipherParams|string} ciphertext The ciphertext to decrypt.
 * @param {string} password The password.
 * @param {Object} cfg (Optional) The configuration options to use for this operation.
 *
 * @return {WordArray} The plaintext.
 *
 * @static
 *
 * @example
 *
 * var plaintext = CryptoJS.lib.PasswordBasedCipher.decrypt(CryptoJS.algo.AES, formattedCiphertext, 'password', { format: CryptoJS.format.OpenSSL });
 * var plaintext = CryptoJS.lib.PasswordBasedCipher.decrypt(CryptoJS.algo.AES, ciphertextParams, 'password', { format: CryptoJS.format.OpenSSL });
 */
            decrypt: function(cipher, ciphertext, password, cfg) {
              cfg = this.cfg.extend(cfg);
              ciphertext = this._parse(ciphertext, cfg.format);
              var derivedParams = cfg.kdf.execute(password, cipher.keySize, cipher.ivSize, ciphertext.salt, cfg.hasher);
              cfg.iv = derivedParams.iv;
              var plaintext = SerializableCipher.decrypt.call(this, cipher, ciphertext, derivedParams.key, cfg);
              return plaintext;
            }
          });
        }();
      });
    })(cipherCore);
    return cipherCore.exports;
  }
  var modeCfb = { exports: {} };
  var hasRequiredModeCfb;
  function requireModeCfb() {
    if (hasRequiredModeCfb) return modeCfb.exports;
    hasRequiredModeCfb = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        CryptoJS2.mode.CFB = function() {
          var CFB = CryptoJS2.lib.BlockCipherMode.extend();
          CFB.Encryptor = CFB.extend({
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              generateKeystreamAndEncrypt.call(this, words, offset, blockSize, cipher);
              this._prevBlock = words.slice(offset, offset + blockSize);
            }
          });
          CFB.Decryptor = CFB.extend({
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              var thisBlock = words.slice(offset, offset + blockSize);
              generateKeystreamAndEncrypt.call(this, words, offset, blockSize, cipher);
              this._prevBlock = thisBlock;
            }
          });
          function generateKeystreamAndEncrypt(words, offset, blockSize, cipher) {
            var keystream;
            var iv = this._iv;
            if (iv) {
              keystream = iv.slice(0);
              this._iv = void 0;
            } else {
              keystream = this._prevBlock;
            }
            cipher.encryptBlock(keystream, 0);
            for (var i = 0; i < blockSize; i++) {
              words[offset + i] ^= keystream[i];
            }
          }
          return CFB;
        }();
        return CryptoJS2.mode.CFB;
      });
    })(modeCfb);
    return modeCfb.exports;
  }
  var modeCtr = { exports: {} };
  var hasRequiredModeCtr;
  function requireModeCtr() {
    if (hasRequiredModeCtr) return modeCtr.exports;
    hasRequiredModeCtr = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        CryptoJS2.mode.CTR = function() {
          var CTR = CryptoJS2.lib.BlockCipherMode.extend();
          var Encryptor = CTR.Encryptor = CTR.extend({
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              var iv = this._iv;
              var counter = this._counter;
              if (iv) {
                counter = this._counter = iv.slice(0);
                this._iv = void 0;
              }
              var keystream = counter.slice(0);
              cipher.encryptBlock(keystream, 0);
              counter[blockSize - 1] = counter[blockSize - 1] + 1 | 0;
              for (var i = 0; i < blockSize; i++) {
                words[offset + i] ^= keystream[i];
              }
            }
          });
          CTR.Decryptor = Encryptor;
          return CTR;
        }();
        return CryptoJS2.mode.CTR;
      });
    })(modeCtr);
    return modeCtr.exports;
  }
  var modeCtrGladman = { exports: {} };
  var hasRequiredModeCtrGladman;
  function requireModeCtrGladman() {
    if (hasRequiredModeCtrGladman) return modeCtrGladman.exports;
    hasRequiredModeCtrGladman = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
 /** @preserve
 * Counter block mode compatible with Dr Brian Gladman fileenc.c
 * derived from CryptoJS.mode.CTR
 * Jan Hruby jhruby.web@gmail.com
 */
        CryptoJS2.mode.CTRGladman = function() {
          var CTRGladman = CryptoJS2.lib.BlockCipherMode.extend();
          function incWord(word) {
            if ((word >> 24 & 255) === 255) {
              var b1 = word >> 16 & 255;
              var b2 = word >> 8 & 255;
              var b3 = word & 255;
              if (b1 === 255) {
                b1 = 0;
                if (b2 === 255) {
                  b2 = 0;
                  if (b3 === 255) {
                    b3 = 0;
                  } else {
                    ++b3;
                  }
                } else {
                  ++b2;
                }
              } else {
                ++b1;
              }
              word = 0;
              word += b1 << 16;
              word += b2 << 8;
              word += b3;
            } else {
              word += 1 << 24;
            }
            return word;
          }
          function incCounter(counter) {
            if ((counter[0] = incWord(counter[0])) === 0) {
              counter[1] = incWord(counter[1]);
            }
            return counter;
          }
          var Encryptor = CTRGladman.Encryptor = CTRGladman.extend({
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              var iv = this._iv;
              var counter = this._counter;
              if (iv) {
                counter = this._counter = iv.slice(0);
                this._iv = void 0;
              }
              incCounter(counter);
              var keystream = counter.slice(0);
              cipher.encryptBlock(keystream, 0);
              for (var i = 0; i < blockSize; i++) {
                words[offset + i] ^= keystream[i];
              }
            }
          });
          CTRGladman.Decryptor = Encryptor;
          return CTRGladman;
        }();
        return CryptoJS2.mode.CTRGladman;
      });
    })(modeCtrGladman);
    return modeCtrGladman.exports;
  }
  var modeOfb = { exports: {} };
  var hasRequiredModeOfb;
  function requireModeOfb() {
    if (hasRequiredModeOfb) return modeOfb.exports;
    hasRequiredModeOfb = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        CryptoJS2.mode.OFB = function() {
          var OFB = CryptoJS2.lib.BlockCipherMode.extend();
          var Encryptor = OFB.Encryptor = OFB.extend({
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              var iv = this._iv;
              var keystream = this._keystream;
              if (iv) {
                keystream = this._keystream = iv.slice(0);
                this._iv = void 0;
              }
              cipher.encryptBlock(keystream, 0);
              for (var i = 0; i < blockSize; i++) {
                words[offset + i] ^= keystream[i];
              }
            }
          });
          OFB.Decryptor = Encryptor;
          return OFB;
        }();
        return CryptoJS2.mode.OFB;
      });
    })(modeOfb);
    return modeOfb.exports;
  }
  var modeEcb = { exports: {} };
  var hasRequiredModeEcb;
  function requireModeEcb() {
    if (hasRequiredModeEcb) return modeEcb.exports;
    hasRequiredModeEcb = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        CryptoJS2.mode.ECB = function() {
          var ECB = CryptoJS2.lib.BlockCipherMode.extend();
          ECB.Encryptor = ECB.extend({
            processBlock: function(words, offset) {
              this._cipher.encryptBlock(words, offset);
            }
          });
          ECB.Decryptor = ECB.extend({
            processBlock: function(words, offset) {
              this._cipher.decryptBlock(words, offset);
            }
          });
          return ECB;
        }();
        return CryptoJS2.mode.ECB;
      });
    })(modeEcb);
    return modeEcb.exports;
  }
  var padAnsix923 = { exports: {} };
  var hasRequiredPadAnsix923;
  function requirePadAnsix923() {
    if (hasRequiredPadAnsix923) return padAnsix923.exports;
    hasRequiredPadAnsix923 = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        CryptoJS2.pad.AnsiX923 = {
          pad: function(data, blockSize) {
            var dataSigBytes = data.sigBytes;
            var blockSizeBytes = blockSize * 4;
            var nPaddingBytes = blockSizeBytes - dataSigBytes % blockSizeBytes;
            var lastBytePos = dataSigBytes + nPaddingBytes - 1;
            data.clamp();
            data.words[lastBytePos >>> 2] |= nPaddingBytes << 24 - lastBytePos % 4 * 8;
            data.sigBytes += nPaddingBytes;
          },
          unpad: function(data) {
            var nPaddingBytes = data.words[data.sigBytes - 1 >>> 2] & 255;
            data.sigBytes -= nPaddingBytes;
          }
        };
        return CryptoJS2.pad.Ansix923;
      });
    })(padAnsix923);
    return padAnsix923.exports;
  }
  var padIso10126 = { exports: {} };
  var hasRequiredPadIso10126;
  function requirePadIso10126() {
    if (hasRequiredPadIso10126) return padIso10126.exports;
    hasRequiredPadIso10126 = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        CryptoJS2.pad.Iso10126 = {
          pad: function(data, blockSize) {
            var blockSizeBytes = blockSize * 4;
            var nPaddingBytes = blockSizeBytes - data.sigBytes % blockSizeBytes;
            data.concat(CryptoJS2.lib.WordArray.random(nPaddingBytes - 1)).concat(CryptoJS2.lib.WordArray.create([nPaddingBytes << 24], 1));
          },
          unpad: function(data) {
            var nPaddingBytes = data.words[data.sigBytes - 1 >>> 2] & 255;
            data.sigBytes -= nPaddingBytes;
          }
        };
        return CryptoJS2.pad.Iso10126;
      });
    })(padIso10126);
    return padIso10126.exports;
  }
  var padIso97971 = { exports: {} };
  var hasRequiredPadIso97971;
  function requirePadIso97971() {
    if (hasRequiredPadIso97971) return padIso97971.exports;
    hasRequiredPadIso97971 = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        CryptoJS2.pad.Iso97971 = {
          pad: function(data, blockSize) {
            data.concat(CryptoJS2.lib.WordArray.create([2147483648], 1));
            CryptoJS2.pad.ZeroPadding.pad(data, blockSize);
          },
          unpad: function(data) {
            CryptoJS2.pad.ZeroPadding.unpad(data);
            data.sigBytes--;
          }
        };
        return CryptoJS2.pad.Iso97971;
      });
    })(padIso97971);
    return padIso97971.exports;
  }
  var padZeropadding = { exports: {} };
  var hasRequiredPadZeropadding;
  function requirePadZeropadding() {
    if (hasRequiredPadZeropadding) return padZeropadding.exports;
    hasRequiredPadZeropadding = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        CryptoJS2.pad.ZeroPadding = {
          pad: function(data, blockSize) {
            var blockSizeBytes = blockSize * 4;
            data.clamp();
            data.sigBytes += blockSizeBytes - (data.sigBytes % blockSizeBytes || blockSizeBytes);
          },
          unpad: function(data) {
            var dataWords = data.words;
            var i = data.sigBytes - 1;
            for (var i = data.sigBytes - 1; i >= 0; i--) {
              if (dataWords[i >>> 2] >>> 24 - i % 4 * 8 & 255) {
                data.sigBytes = i + 1;
                break;
              }
            }
          }
        };
        return CryptoJS2.pad.ZeroPadding;
      });
    })(padZeropadding);
    return padZeropadding.exports;
  }
  var padNopadding = { exports: {} };
  var hasRequiredPadNopadding;
  function requirePadNopadding() {
    if (hasRequiredPadNopadding) return padNopadding.exports;
    hasRequiredPadNopadding = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        CryptoJS2.pad.NoPadding = {
          pad: function() {
          },
          unpad: function() {
          }
        };
        return CryptoJS2.pad.NoPadding;
      });
    })(padNopadding);
    return padNopadding.exports;
  }
  var formatHex = { exports: {} };
  var hasRequiredFormatHex;
  function requireFormatHex() {
    if (hasRequiredFormatHex) return formatHex.exports;
    hasRequiredFormatHex = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function(undefined$1) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var CipherParams = C_lib.CipherParams;
          var C_enc = C.enc;
          var Hex = C_enc.Hex;
          var C_format = C.format;
          C_format.Hex = {
 /**
 * Converts the ciphertext of a cipher params object to a hexadecimally encoded string.
 *
 * @param {CipherParams} cipherParams The cipher params object.
 *
 * @return {string} The hexadecimally encoded string.
 *
 * @static
 *
 * @example
 *
 * var hexString = CryptoJS.format.Hex.stringify(cipherParams);
 */
            stringify: function(cipherParams) {
              return cipherParams.ciphertext.toString(Hex);
            },
 /**
 * Converts a hexadecimally encoded ciphertext string to a cipher params object.
 *
 * @param {string} input The hexadecimally encoded string.
 *
 * @return {CipherParams} The cipher params object.
 *
 * @static
 *
 * @example
 *
 * var cipherParams = CryptoJS.format.Hex.parse(hexString);
 */
            parse: function(input) {
              var ciphertext = Hex.parse(input);
              return CipherParams.create({ ciphertext });
            }
          };
        })();
        return CryptoJS2.format.Hex;
      });
    })(formatHex);
    return formatHex.exports;
  }
  var aes = { exports: {} };
  var hasRequiredAes;
  function requireAes() {
    if (hasRequiredAes) return aes.exports;
    hasRequiredAes = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireEncBase64(), requireMd5(), requireEvpkdf(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var BlockCipher = C_lib.BlockCipher;
          var C_algo = C.algo;
          var SBOX = [];
          var INV_SBOX = [];
          var SUB_MIX_0 = [];
          var SUB_MIX_1 = [];
          var SUB_MIX_2 = [];
          var SUB_MIX_3 = [];
          var INV_SUB_MIX_0 = [];
          var INV_SUB_MIX_1 = [];
          var INV_SUB_MIX_2 = [];
          var INV_SUB_MIX_3 = [];
          (function() {
            var d = [];
            for (var i = 0; i < 256; i++) {
              if (i < 128) {
                d[i] = i << 1;
              } else {
                d[i] = i << 1 ^ 283;
              }
            }
            var x = 0;
            var xi = 0;
            for (var i = 0; i < 256; i++) {
              var sx = xi ^ xi << 1 ^ xi << 2 ^ xi << 3 ^ xi << 4;
              sx = sx >>> 8 ^ sx & 255 ^ 99;
              SBOX[x] = sx;
              INV_SBOX[sx] = x;
              var x2 = d[x];
              var x4 = d[x2];
              var x8 = d[x4];
              var t = d[sx] * 257 ^ sx * 16843008;
              SUB_MIX_0[x] = t << 24 | t >>> 8;
              SUB_MIX_1[x] = t << 16 | t >>> 16;
              SUB_MIX_2[x] = t << 8 | t >>> 24;
              SUB_MIX_3[x] = t;
              var t = x8 * 16843009 ^ x4 * 65537 ^ x2 * 257 ^ x * 16843008;
              INV_SUB_MIX_0[sx] = t << 24 | t >>> 8;
              INV_SUB_MIX_1[sx] = t << 16 | t >>> 16;
              INV_SUB_MIX_2[sx] = t << 8 | t >>> 24;
              INV_SUB_MIX_3[sx] = t;
              if (!x) {
                x = xi = 1;
              } else {
                x = x2 ^ d[d[d[x8 ^ x2]]];
                xi ^= d[d[xi]];
              }
            }
          })();
          var RCON = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
          var AES = C_algo.AES = BlockCipher.extend({
            _doReset: function() {
              var t;
              if (this._nRounds && this._keyPriorReset === this._key) {
                return;
              }
              var key = this._keyPriorReset = this._key;
              var keyWords = key.words;
              var keySize = key.sigBytes / 4;
              var nRounds = this._nRounds = keySize + 6;
              var ksRows = (nRounds + 1) * 4;
              var keySchedule = this._keySchedule = [];
              for (var ksRow = 0; ksRow < ksRows; ksRow++) {
                if (ksRow < keySize) {
                  keySchedule[ksRow] = keyWords[ksRow];
                } else {
                  t = keySchedule[ksRow - 1];
                  if (!(ksRow % keySize)) {
                    t = t << 8 | t >>> 24;
                    t = SBOX[t >>> 24] << 24 | SBOX[t >>> 16 & 255] << 16 | SBOX[t >>> 8 & 255] << 8 | SBOX[t & 255];
                    t ^= RCON[ksRow / keySize | 0] << 24;
                  } else if (keySize > 6 && ksRow % keySize == 4) {
                    t = SBOX[t >>> 24] << 24 | SBOX[t >>> 16 & 255] << 16 | SBOX[t >>> 8 & 255] << 8 | SBOX[t & 255];
                  }
                  keySchedule[ksRow] = keySchedule[ksRow - keySize] ^ t;
                }
              }
              var invKeySchedule = this._invKeySchedule = [];
              for (var invKsRow = 0; invKsRow < ksRows; invKsRow++) {
                var ksRow = ksRows - invKsRow;
                if (invKsRow % 4) {
                  var t = keySchedule[ksRow];
                } else {
                  var t = keySchedule[ksRow - 4];
                }
                if (invKsRow < 4 || ksRow <= 4) {
                  invKeySchedule[invKsRow] = t;
                } else {
                  invKeySchedule[invKsRow] = INV_SUB_MIX_0[SBOX[t >>> 24]] ^ INV_SUB_MIX_1[SBOX[t >>> 16 & 255]] ^ INV_SUB_MIX_2[SBOX[t >>> 8 & 255]] ^ INV_SUB_MIX_3[SBOX[t & 255]];
                }
              }
            },
            encryptBlock: function(M, offset) {
              this._doCryptBlock(M, offset, this._keySchedule, SUB_MIX_0, SUB_MIX_1, SUB_MIX_2, SUB_MIX_3, SBOX);
            },
            decryptBlock: function(M, offset) {
              var t = M[offset + 1];
              M[offset + 1] = M[offset + 3];
              M[offset + 3] = t;
              this._doCryptBlock(M, offset, this._invKeySchedule, INV_SUB_MIX_0, INV_SUB_MIX_1, INV_SUB_MIX_2, INV_SUB_MIX_3, INV_SBOX);
              var t = M[offset + 1];
              M[offset + 1] = M[offset + 3];
              M[offset + 3] = t;
            },
            _doCryptBlock: function(M, offset, keySchedule, SUB_MIX_02, SUB_MIX_12, SUB_MIX_22, SUB_MIX_32, SBOX2) {
              var nRounds = this._nRounds;
              var s0 = M[offset] ^ keySchedule[0];
              var s1 = M[offset + 1] ^ keySchedule[1];
              var s2 = M[offset + 2] ^ keySchedule[2];
              var s3 = M[offset + 3] ^ keySchedule[3];
              var ksRow = 4;
              for (var round = 1; round < nRounds; round++) {
                var t0 = SUB_MIX_02[s0 >>> 24] ^ SUB_MIX_12[s1 >>> 16 & 255] ^ SUB_MIX_22[s2 >>> 8 & 255] ^ SUB_MIX_32[s3 & 255] ^ keySchedule[ksRow++];
                var t1 = SUB_MIX_02[s1 >>> 24] ^ SUB_MIX_12[s2 >>> 16 & 255] ^ SUB_MIX_22[s3 >>> 8 & 255] ^ SUB_MIX_32[s0 & 255] ^ keySchedule[ksRow++];
                var t2 = SUB_MIX_02[s2 >>> 24] ^ SUB_MIX_12[s3 >>> 16 & 255] ^ SUB_MIX_22[s0 >>> 8 & 255] ^ SUB_MIX_32[s1 & 255] ^ keySchedule[ksRow++];
                var t3 = SUB_MIX_02[s3 >>> 24] ^ SUB_MIX_12[s0 >>> 16 & 255] ^ SUB_MIX_22[s1 >>> 8 & 255] ^ SUB_MIX_32[s2 & 255] ^ keySchedule[ksRow++];
                s0 = t0;
                s1 = t1;
                s2 = t2;
                s3 = t3;
              }
              var t0 = (SBOX2[s0 >>> 24] << 24 | SBOX2[s1 >>> 16 & 255] << 16 | SBOX2[s2 >>> 8 & 255] << 8 | SBOX2[s3 & 255]) ^ keySchedule[ksRow++];
              var t1 = (SBOX2[s1 >>> 24] << 24 | SBOX2[s2 >>> 16 & 255] << 16 | SBOX2[s3 >>> 8 & 255] << 8 | SBOX2[s0 & 255]) ^ keySchedule[ksRow++];
              var t2 = (SBOX2[s2 >>> 24] << 24 | SBOX2[s3 >>> 16 & 255] << 16 | SBOX2[s0 >>> 8 & 255] << 8 | SBOX2[s1 & 255]) ^ keySchedule[ksRow++];
              var t3 = (SBOX2[s3 >>> 24] << 24 | SBOX2[s0 >>> 16 & 255] << 16 | SBOX2[s1 >>> 8 & 255] << 8 | SBOX2[s2 & 255]) ^ keySchedule[ksRow++];
              M[offset] = t0;
              M[offset + 1] = t1;
              M[offset + 2] = t2;
              M[offset + 3] = t3;
            },
            keySize: 256 / 32
          });
          C.AES = BlockCipher._createHelper(AES);
        })();
        return CryptoJS2.AES;
      });
    })(aes);
    return aes.exports;
  }
  var tripledes = { exports: {} };
  var hasRequiredTripledes;
  function requireTripledes() {
    if (hasRequiredTripledes) return tripledes.exports;
    hasRequiredTripledes = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireEncBase64(), requireMd5(), requireEvpkdf(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var BlockCipher = C_lib.BlockCipher;
          var C_algo = C.algo;
          var PC1 = [
            57,
            49,
            41,
            33,
            25,
            17,
            9,
            1,
            58,
            50,
            42,
            34,
            26,
            18,
            10,
            2,
            59,
            51,
            43,
            35,
            27,
            19,
            11,
            3,
            60,
            52,
            44,
            36,
            63,
            55,
            47,
            39,
            31,
            23,
            15,
            7,
            62,
            54,
            46,
            38,
            30,
            22,
            14,
            6,
            61,
            53,
            45,
            37,
            29,
            21,
            13,
            5,
            28,
            20,
            12,
            4
          ];
          var PC2 = [
            14,
            17,
            11,
            24,
            1,
            5,
            3,
            28,
            15,
            6,
            21,
            10,
            23,
            19,
            12,
            4,
            26,
            8,
            16,
            7,
            27,
            20,
            13,
            2,
            41,
            52,
            31,
            37,
            47,
            55,
            30,
            40,
            51,
            45,
            33,
            48,
            44,
            49,
            39,
            56,
            34,
            53,
            46,
            42,
            50,
            36,
            29,
            32
          ];
          var BIT_SHIFTS = [1, 2, 4, 6, 8, 10, 12, 14, 15, 17, 19, 21, 23, 25, 27, 28];
          var SBOX_P = [
            {
              0: 8421888,
              268435456: 32768,
              536870912: 8421378,
              805306368: 2,
              1073741824: 512,
              1342177280: 8421890,
              1610612736: 8389122,
              1879048192: 8388608,
              2147483648: 514,
              2415919104: 8389120,
              2684354560: 33280,
              2952790016: 8421376,
              3221225472: 32770,
              3489660928: 8388610,
              3758096384: 0,
              4026531840: 33282,
              134217728: 0,
              402653184: 8421890,
              671088640: 33282,
              939524096: 32768,
              1207959552: 8421888,
              1476395008: 512,
              1744830464: 8421378,
              2013265920: 2,
              2281701376: 8389120,
              2550136832: 33280,
              2818572288: 8421376,
              3087007744: 8389122,
              3355443200: 8388610,
              3623878656: 32770,
              3892314112: 514,
              4160749568: 8388608,
              1: 32768,
              268435457: 2,
              536870913: 8421888,
              805306369: 8388608,
              1073741825: 8421378,
              1342177281: 33280,
              1610612737: 512,
              1879048193: 8389122,
              2147483649: 8421890,
              2415919105: 8421376,
              2684354561: 8388610,
              2952790017: 33282,
              3221225473: 514,
              3489660929: 8389120,
              3758096385: 32770,
              4026531841: 0,
              134217729: 8421890,
              402653185: 8421376,
              671088641: 8388608,
              939524097: 512,
              1207959553: 32768,
              1476395009: 8388610,
              1744830465: 2,
              2013265921: 33282,
              2281701377: 32770,
              2550136833: 8389122,
              2818572289: 514,
              3087007745: 8421888,
              3355443201: 8389120,
              3623878657: 0,
              3892314113: 33280,
              4160749569: 8421378
            },
            {
              0: 1074282512,
              16777216: 16384,
              33554432: 524288,
              50331648: 1074266128,
              67108864: 1073741840,
              83886080: 1074282496,
              100663296: 1073758208,
              117440512: 16,
              134217728: 540672,
              150994944: 1073758224,
              167772160: 1073741824,
              184549376: 540688,
              201326592: 524304,
              218103808: 0,
              234881024: 16400,
              251658240: 1074266112,
              8388608: 1073758208,
              25165824: 540688,
              41943040: 16,
              58720256: 1073758224,
              75497472: 1074282512,
              92274688: 1073741824,
              109051904: 524288,
              125829120: 1074266128,
              142606336: 524304,
              159383552: 0,
              176160768: 16384,
              192937984: 1074266112,
              209715200: 1073741840,
              226492416: 540672,
              243269632: 1074282496,
              260046848: 16400,
              268435456: 0,
              285212672: 1074266128,
              301989888: 1073758224,
              318767104: 1074282496,
              335544320: 1074266112,
              352321536: 16,
              369098752: 540688,
              385875968: 16384,
              402653184: 16400,
              419430400: 524288,
              436207616: 524304,
              452984832: 1073741840,
              469762048: 540672,
              486539264: 1073758208,
              503316480: 1073741824,
              520093696: 1074282512,
              276824064: 540688,
              293601280: 524288,
              310378496: 1074266112,
              327155712: 16384,
              343932928: 1073758208,
              360710144: 1074282512,
              377487360: 16,
              394264576: 1073741824,
              411041792: 1074282496,
              427819008: 1073741840,
              444596224: 1073758224,
              461373440: 524304,
              478150656: 0,
              494927872: 16400,
              511705088: 1074266128,
              528482304: 540672
            },
            {
              0: 260,
              1048576: 0,
              2097152: 67109120,
              3145728: 65796,
              4194304: 65540,
              5242880: 67108868,
              6291456: 67174660,
              7340032: 67174400,
              8388608: 67108864,
              9437184: 67174656,
              10485760: 65792,
              11534336: 67174404,
              12582912: 67109124,
              13631488: 65536,
              14680064: 4,
              15728640: 256,
              524288: 67174656,
              1572864: 67174404,
              2621440: 0,
              3670016: 67109120,
              4718592: 67108868,
              5767168: 65536,
              6815744: 65540,
              7864320: 260,
              8912896: 4,
              9961472: 256,
              11010048: 67174400,
              12058624: 65796,
              13107200: 65792,
              14155776: 67109124,
              15204352: 67174660,
              16252928: 67108864,
              16777216: 67174656,
              17825792: 65540,
              18874368: 65536,
              19922944: 67109120,
              20971520: 256,
              22020096: 67174660,
              23068672: 67108868,
              24117248: 0,
              25165824: 67109124,
              26214400: 67108864,
              27262976: 4,
              28311552: 65792,
              29360128: 67174400,
              30408704: 260,
              31457280: 65796,
              32505856: 67174404,
              17301504: 67108864,
              18350080: 260,
              19398656: 67174656,
              20447232: 0,
              21495808: 65540,
              22544384: 67109120,
              23592960: 256,
              24641536: 67174404,
              25690112: 65536,
              26738688: 67174660,
              27787264: 65796,
              28835840: 67108868,
              29884416: 67109124,
              30932992: 67174400,
              31981568: 4,
              33030144: 65792
            },
            {
              0: 2151682048,
              65536: 2147487808,
              131072: 4198464,
              196608: 2151677952,
              262144: 0,
              327680: 4198400,
              393216: 2147483712,
              458752: 4194368,
              524288: 2147483648,
              589824: 4194304,
              655360: 64,
              720896: 2147487744,
              786432: 2151678016,
              851968: 4160,
              917504: 4096,
              983040: 2151682112,
              32768: 2147487808,
              98304: 64,
              163840: 2151678016,
              229376: 2147487744,
              294912: 4198400,
              360448: 2151682112,
              425984: 0,
              491520: 2151677952,
              557056: 4096,
              622592: 2151682048,
              688128: 4194304,
              753664: 4160,
              819200: 2147483648,
              884736: 4194368,
              950272: 4198464,
              1015808: 2147483712,
              1048576: 4194368,
              1114112: 4198400,
              1179648: 2147483712,
              1245184: 0,
              1310720: 4160,
              1376256: 2151678016,
              1441792: 2151682048,
              1507328: 2147487808,
              1572864: 2151682112,
              1638400: 2147483648,
              1703936: 2151677952,
              1769472: 4198464,
              1835008: 2147487744,
              1900544: 4194304,
              1966080: 64,
              2031616: 4096,
              1081344: 2151677952,
              1146880: 2151682112,
              1212416: 0,
              1277952: 4198400,
              1343488: 4194368,
              1409024: 2147483648,
              1474560: 2147487808,
              1540096: 64,
              1605632: 2147483712,
              1671168: 4096,
              1736704: 2147487744,
              1802240: 2151678016,
              1867776: 4160,
              1933312: 2151682048,
              1998848: 4194304,
              2064384: 4198464
            },
            {
              0: 128,
              4096: 17039360,
              8192: 262144,
              12288: 536870912,
              16384: 537133184,
              20480: 16777344,
              24576: 553648256,
              28672: 262272,
              32768: 16777216,
              36864: 537133056,
              40960: 536871040,
              45056: 553910400,
              49152: 553910272,
              53248: 0,
              57344: 17039488,
              61440: 553648128,
              2048: 17039488,
              6144: 553648256,
              10240: 128,
              14336: 17039360,
              18432: 262144,
              22528: 537133184,
              26624: 553910272,
              30720: 536870912,
              34816: 537133056,
              38912: 0,
              43008: 553910400,
              47104: 16777344,
              51200: 536871040,
              55296: 553648128,
              59392: 16777216,
              63488: 262272,
              65536: 262144,
              69632: 128,
              73728: 536870912,
              77824: 553648256,
              81920: 16777344,
              86016: 553910272,
              90112: 537133184,
              94208: 16777216,
              98304: 553910400,
              102400: 553648128,
              106496: 17039360,
              110592: 537133056,
              114688: 262272,
              118784: 536871040,
              122880: 0,
              126976: 17039488,
              67584: 553648256,
              71680: 16777216,
              75776: 17039360,
              79872: 537133184,
              83968: 536870912,
              88064: 17039488,
              92160: 128,
              96256: 553910272,
              100352: 262272,
              104448: 553910400,
              108544: 0,
              112640: 553648128,
              116736: 16777344,
              120832: 262144,
              124928: 537133056,
              129024: 536871040
            },
            {
              0: 268435464,
              256: 8192,
              512: 270532608,
              768: 270540808,
              1024: 268443648,
              1280: 2097152,
              1536: 2097160,
              1792: 268435456,
              2048: 0,
              2304: 268443656,
              2560: 2105344,
              2816: 8,
              3072: 270532616,
              3328: 2105352,
              3584: 8200,
              3840: 270540800,
              128: 270532608,
              384: 270540808,
              640: 8,
              896: 2097152,
              1152: 2105352,
              1408: 268435464,
              1664: 268443648,
              1920: 8200,
              2176: 2097160,
              2432: 8192,
              2688: 268443656,
              2944: 270532616,
              3200: 0,
              3456: 270540800,
              3712: 2105344,
              3968: 268435456,
              4096: 268443648,
              4352: 270532616,
              4608: 270540808,
              4864: 8200,
              5120: 2097152,
              5376: 268435456,
              5632: 268435464,
              5888: 2105344,
              6144: 2105352,
              6400: 0,
              6656: 8,
              6912: 270532608,
              7168: 8192,
              7424: 268443656,
              7680: 270540800,
              7936: 2097160,
              4224: 8,
              4480: 2105344,
              4736: 2097152,
              4992: 268435464,
              5248: 268443648,
              5504: 8200,
              5760: 270540808,
              6016: 270532608,
              6272: 270540800,
              6528: 270532616,
              6784: 8192,
              7040: 2105352,
              7296: 2097160,
              7552: 0,
              7808: 268435456,
              8064: 268443656
            },
            {
              0: 1048576,
              16: 33555457,
              32: 1024,
              48: 1049601,
              64: 34604033,
              80: 0,
              96: 1,
              112: 34603009,
              128: 33555456,
              144: 1048577,
              160: 33554433,
              176: 34604032,
              192: 34603008,
              208: 1025,
              224: 1049600,
              240: 33554432,
              8: 34603009,
              24: 0,
              40: 33555457,
              56: 34604032,
              72: 1048576,
              88: 33554433,
              104: 33554432,
              120: 1025,
              136: 1049601,
              152: 33555456,
              168: 34603008,
              184: 1048577,
              200: 1024,
              216: 34604033,
              232: 1,
              248: 1049600,
              256: 33554432,
              272: 1048576,
              288: 33555457,
              304: 34603009,
              320: 1048577,
              336: 33555456,
              352: 34604032,
              368: 1049601,
              384: 1025,
              400: 34604033,
              416: 1049600,
              432: 1,
              448: 0,
              464: 34603008,
              480: 33554433,
              496: 1024,
              264: 1049600,
              280: 33555457,
              296: 34603009,
              312: 1,
              328: 33554432,
              344: 1048576,
              360: 1025,
              376: 34604032,
              392: 33554433,
              408: 34603008,
              424: 0,
              440: 34604033,
              456: 1049601,
              472: 1024,
              488: 33555456,
              504: 1048577
            },
            {
              0: 134219808,
              1: 131072,
              2: 134217728,
              3: 32,
              4: 131104,
              5: 134350880,
              6: 134350848,
              7: 2048,
              8: 134348800,
              9: 134219776,
              10: 133120,
              11: 134348832,
              12: 2080,
              13: 0,
              14: 134217760,
              15: 133152,
              2147483648: 2048,
              2147483649: 134350880,
              2147483650: 134219808,
              2147483651: 134217728,
              2147483652: 134348800,
              2147483653: 133120,
              2147483654: 133152,
              2147483655: 32,
              2147483656: 134217760,
              2147483657: 2080,
              2147483658: 131104,
              2147483659: 134350848,
              2147483660: 0,
              2147483661: 134348832,
              2147483662: 134219776,
              2147483663: 131072,
              16: 133152,
              17: 134350848,
              18: 32,
              19: 2048,
              20: 134219776,
              21: 134217760,
              22: 134348832,
              23: 131072,
              24: 0,
              25: 131104,
              26: 134348800,
              27: 134219808,
              28: 134350880,
              29: 133120,
              30: 2080,
              31: 134217728,
              2147483664: 131072,
              2147483665: 2048,
              2147483666: 134348832,
              2147483667: 133152,
              2147483668: 32,
              2147483669: 134348800,
              2147483670: 134217728,
              2147483671: 134219808,
              2147483672: 134350880,
              2147483673: 134217760,
              2147483674: 134219776,
              2147483675: 0,
              2147483676: 133120,
              2147483677: 2080,
              2147483678: 131104,
              2147483679: 134350848
            }
          ];
          var SBOX_MASK = [
            4160749569,
            528482304,
            33030144,
            2064384,
            129024,
            8064,
            504,
            2147483679
          ];
          var DES = C_algo.DES = BlockCipher.extend({
            _doReset: function() {
              var key = this._key;
              var keyWords = key.words;
              var keyBits = [];
              for (var i = 0; i < 56; i++) {
                var keyBitPos = PC1[i] - 1;
                keyBits[i] = keyWords[keyBitPos >>> 5] >>> 31 - keyBitPos % 32 & 1;
              }
              var subKeys = this._subKeys = [];
              for (var nSubKey = 0; nSubKey < 16; nSubKey++) {
                var subKey = subKeys[nSubKey] = [];
                var bitShift = BIT_SHIFTS[nSubKey];
                for (var i = 0; i < 24; i++) {
                  subKey[i / 6 | 0] |= keyBits[(PC2[i] - 1 + bitShift) % 28] << 31 - i % 6;
                  subKey[4 + (i / 6 | 0)] |= keyBits[28 + (PC2[i + 24] - 1 + bitShift) % 28] << 31 - i % 6;
                }
                subKey[0] = subKey[0] << 1 | subKey[0] >>> 31;
                for (var i = 1; i < 7; i++) {
                  subKey[i] = subKey[i] >>> (i - 1) * 4 + 3;
                }
                subKey[7] = subKey[7] << 5 | subKey[7] >>> 27;
              }
              var invSubKeys = this._invSubKeys = [];
              for (var i = 0; i < 16; i++) {
                invSubKeys[i] = subKeys[15 - i];
              }
            },
            encryptBlock: function(M, offset) {
              this._doCryptBlock(M, offset, this._subKeys);
            },
            decryptBlock: function(M, offset) {
              this._doCryptBlock(M, offset, this._invSubKeys);
            },
            _doCryptBlock: function(M, offset, subKeys) {
              this._lBlock = M[offset];
              this._rBlock = M[offset + 1];
              exchangeLR.call(this, 4, 252645135);
              exchangeLR.call(this, 16, 65535);
              exchangeRL.call(this, 2, 858993459);
              exchangeRL.call(this, 8, 16711935);
              exchangeLR.call(this, 1, 1431655765);
              for (var round = 0; round < 16; round++) {
                var subKey = subKeys[round];
                var lBlock = this._lBlock;
                var rBlock = this._rBlock;
                var f = 0;
                for (var i = 0; i < 8; i++) {
                  f |= SBOX_P[i][((rBlock ^ subKey[i]) & SBOX_MASK[i]) >>> 0];
                }
                this._lBlock = rBlock;
                this._rBlock = lBlock ^ f;
              }
              var t = this._lBlock;
              this._lBlock = this._rBlock;
              this._rBlock = t;
              exchangeLR.call(this, 1, 1431655765);
              exchangeRL.call(this, 8, 16711935);
              exchangeRL.call(this, 2, 858993459);
              exchangeLR.call(this, 16, 65535);
              exchangeLR.call(this, 4, 252645135);
              M[offset] = this._lBlock;
              M[offset + 1] = this._rBlock;
            },
            keySize: 64 / 32,
            ivSize: 64 / 32,
            blockSize: 64 / 32
          });
          function exchangeLR(offset, mask) {
            var t = (this._lBlock >>> offset ^ this._rBlock) & mask;
            this._rBlock ^= t;
            this._lBlock ^= t << offset;
          }
          function exchangeRL(offset, mask) {
            var t = (this._rBlock >>> offset ^ this._lBlock) & mask;
            this._lBlock ^= t;
            this._rBlock ^= t << offset;
          }
          C.DES = BlockCipher._createHelper(DES);
          var TripleDES = C_algo.TripleDES = BlockCipher.extend({
            _doReset: function() {
              var key = this._key;
              var keyWords = key.words;
              if (keyWords.length !== 2 && keyWords.length !== 4 && keyWords.length < 6) {
                throw new Error("Invalid key length - 3DES requires the key length to be 64, 128, 192 or >192.");
              }
              var key1 = keyWords.slice(0, 2);
              var key2 = keyWords.length < 4 ? keyWords.slice(0, 2) : keyWords.slice(2, 4);
              var key3 = keyWords.length < 6 ? keyWords.slice(0, 2) : keyWords.slice(4, 6);
              this._des1 = DES.createEncryptor(WordArray.create(key1));
              this._des2 = DES.createEncryptor(WordArray.create(key2));
              this._des3 = DES.createEncryptor(WordArray.create(key3));
            },
            encryptBlock: function(M, offset) {
              this._des1.encryptBlock(M, offset);
              this._des2.decryptBlock(M, offset);
              this._des3.encryptBlock(M, offset);
            },
            decryptBlock: function(M, offset) {
              this._des3.decryptBlock(M, offset);
              this._des2.encryptBlock(M, offset);
              this._des1.decryptBlock(M, offset);
            },
            keySize: 192 / 32,
            ivSize: 64 / 32,
            blockSize: 64 / 32
          });
          C.TripleDES = BlockCipher._createHelper(TripleDES);
        })();
        return CryptoJS2.TripleDES;
      });
    })(tripledes);
    return tripledes.exports;
  }
  var rc4 = { exports: {} };
  var hasRequiredRc4;
  function requireRc4() {
    if (hasRequiredRc4) return rc4.exports;
    hasRequiredRc4 = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireEncBase64(), requireMd5(), requireEvpkdf(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var StreamCipher = C_lib.StreamCipher;
          var C_algo = C.algo;
          var RC4 = C_algo.RC4 = StreamCipher.extend({
            _doReset: function() {
              var key = this._key;
              var keyWords = key.words;
              var keySigBytes = key.sigBytes;
              var S = this._S = [];
              for (var i = 0; i < 256; i++) {
                S[i] = i;
              }
              for (var i = 0, j = 0; i < 256; i++) {
                var keyByteIndex = i % keySigBytes;
                var keyByte = keyWords[keyByteIndex >>> 2] >>> 24 - keyByteIndex % 4 * 8 & 255;
                j = (j + S[i] + keyByte) % 256;
                var t = S[i];
                S[i] = S[j];
                S[j] = t;
              }
              this._i = this._j = 0;
            },
            _doProcessBlock: function(M, offset) {
              M[offset] ^= generateKeystreamWord.call(this);
            },
            keySize: 256 / 32,
            ivSize: 0
          });
          function generateKeystreamWord() {
            var S = this._S;
            var i = this._i;
            var j = this._j;
            var keystreamWord = 0;
            for (var n = 0; n < 4; n++) {
              i = (i + 1) % 256;
              j = (j + S[i]) % 256;
              var t = S[i];
              S[i] = S[j];
              S[j] = t;
              keystreamWord |= S[(S[i] + S[j]) % 256] << 24 - n * 8;
            }
            this._i = i;
            this._j = j;
            return keystreamWord;
          }
          C.RC4 = StreamCipher._createHelper(RC4);
          var RC4Drop = C_algo.RC4Drop = RC4.extend({
 /**
 * Configuration options.
 *
 * @property {number} drop The number of keystream words to drop. Default 192
 */
            cfg: RC4.cfg.extend({
              drop: 192
            }),
            _doReset: function() {
              RC4._doReset.call(this);
              for (var i = this.cfg.drop; i > 0; i--) {
                generateKeystreamWord.call(this);
              }
            }
          });
          C.RC4Drop = StreamCipher._createHelper(RC4Drop);
        })();
        return CryptoJS2.RC4;
      });
    })(rc4);
    return rc4.exports;
  }
  var rabbit = { exports: {} };
  var hasRequiredRabbit;
  function requireRabbit() {
    if (hasRequiredRabbit) return rabbit.exports;
    hasRequiredRabbit = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireEncBase64(), requireMd5(), requireEvpkdf(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var StreamCipher = C_lib.StreamCipher;
          var C_algo = C.algo;
          var S = [];
          var C_ = [];
          var G = [];
          var Rabbit = C_algo.Rabbit = StreamCipher.extend({
            _doReset: function() {
              var K = this._key.words;
              var iv = this.cfg.iv;
              for (var i = 0; i < 4; i++) {
                K[i] = (K[i] << 8 | K[i] >>> 24) & 16711935 | (K[i] << 24 | K[i] >>> 8) & 4278255360;
              }
              var X = this._X = [
                K[0],
                K[3] << 16 | K[2] >>> 16,
                K[1],
                K[0] << 16 | K[3] >>> 16,
                K[2],
                K[1] << 16 | K[0] >>> 16,
                K[3],
                K[2] << 16 | K[1] >>> 16
              ];
              var C2 = this._C = [
                K[2] << 16 | K[2] >>> 16,
                K[0] & 4294901760 | K[1] & 65535,
                K[3] << 16 | K[3] >>> 16,
                K[1] & 4294901760 | K[2] & 65535,
                K[0] << 16 | K[0] >>> 16,
                K[2] & 4294901760 | K[3] & 65535,
                K[1] << 16 | K[1] >>> 16,
                K[3] & 4294901760 | K[0] & 65535
              ];
              this._b = 0;
              for (var i = 0; i < 4; i++) {
                nextState.call(this);
              }
              for (var i = 0; i < 8; i++) {
                C2[i] ^= X[i + 4 & 7];
              }
              if (iv) {
                var IV = iv.words;
                var IV_0 = IV[0];
                var IV_1 = IV[1];
                var i0 = (IV_0 << 8 | IV_0 >>> 24) & 16711935 | (IV_0 << 24 | IV_0 >>> 8) & 4278255360;
                var i2 = (IV_1 << 8 | IV_1 >>> 24) & 16711935 | (IV_1 << 24 | IV_1 >>> 8) & 4278255360;
                var i1 = i0 >>> 16 | i2 & 4294901760;
                var i3 = i2 << 16 | i0 & 65535;
                C2[0] ^= i0;
                C2[1] ^= i1;
                C2[2] ^= i2;
                C2[3] ^= i3;
                C2[4] ^= i0;
                C2[5] ^= i1;
                C2[6] ^= i2;
                C2[7] ^= i3;
                for (var i = 0; i < 4; i++) {
                  nextState.call(this);
                }
              }
            },
            _doProcessBlock: function(M, offset) {
              var X = this._X;
              nextState.call(this);
              S[0] = X[0] ^ X[5] >>> 16 ^ X[3] << 16;
              S[1] = X[2] ^ X[7] >>> 16 ^ X[5] << 16;
              S[2] = X[4] ^ X[1] >>> 16 ^ X[7] << 16;
              S[3] = X[6] ^ X[3] >>> 16 ^ X[1] << 16;
              for (var i = 0; i < 4; i++) {
                S[i] = (S[i] << 8 | S[i] >>> 24) & 16711935 | (S[i] << 24 | S[i] >>> 8) & 4278255360;
                M[offset + i] ^= S[i];
              }
            },
            blockSize: 128 / 32,
            ivSize: 64 / 32
          });
          function nextState() {
            var X = this._X;
            var C2 = this._C;
            for (var i = 0; i < 8; i++) {
              C_[i] = C2[i];
            }
            C2[0] = C2[0] + 1295307597 + this._b | 0;
            C2[1] = C2[1] + 3545052371 + (C2[0] >>> 0 < C_[0] >>> 0 ? 1 : 0) | 0;
            C2[2] = C2[2] + 886263092 + (C2[1] >>> 0 < C_[1] >>> 0 ? 1 : 0) | 0;
            C2[3] = C2[3] + 1295307597 + (C2[2] >>> 0 < C_[2] >>> 0 ? 1 : 0) | 0;
            C2[4] = C2[4] + 3545052371 + (C2[3] >>> 0 < C_[3] >>> 0 ? 1 : 0) | 0;
            C2[5] = C2[5] + 886263092 + (C2[4] >>> 0 < C_[4] >>> 0 ? 1 : 0) | 0;
            C2[6] = C2[6] + 1295307597 + (C2[5] >>> 0 < C_[5] >>> 0 ? 1 : 0) | 0;
            C2[7] = C2[7] + 3545052371 + (C2[6] >>> 0 < C_[6] >>> 0 ? 1 : 0) | 0;
            this._b = C2[7] >>> 0 < C_[7] >>> 0 ? 1 : 0;
            for (var i = 0; i < 8; i++) {
              var gx = X[i] + C2[i];
              var ga = gx & 65535;
              var gb = gx >>> 16;
              var gh = ((ga * ga >>> 17) + ga * gb >>> 15) + gb * gb;
              var gl = ((gx & 4294901760) * gx | 0) + ((gx & 65535) * gx | 0);
              G[i] = gh ^ gl;
            }
            X[0] = G[0] + (G[7] << 16 | G[7] >>> 16) + (G[6] << 16 | G[6] >>> 16) | 0;
            X[1] = G[1] + (G[0] << 8 | G[0] >>> 24) + G[7] | 0;
            X[2] = G[2] + (G[1] << 16 | G[1] >>> 16) + (G[0] << 16 | G[0] >>> 16) | 0;
            X[3] = G[3] + (G[2] << 8 | G[2] >>> 24) + G[1] | 0;
            X[4] = G[4] + (G[3] << 16 | G[3] >>> 16) + (G[2] << 16 | G[2] >>> 16) | 0;
            X[5] = G[5] + (G[4] << 8 | G[4] >>> 24) + G[3] | 0;
            X[6] = G[6] + (G[5] << 16 | G[5] >>> 16) + (G[4] << 16 | G[4] >>> 16) | 0;
            X[7] = G[7] + (G[6] << 8 | G[6] >>> 24) + G[5] | 0;
          }
          C.Rabbit = StreamCipher._createHelper(Rabbit);
        })();
        return CryptoJS2.Rabbit;
      });
    })(rabbit);
    return rabbit.exports;
  }
  var rabbitLegacy = { exports: {} };
  var hasRequiredRabbitLegacy;
  function requireRabbitLegacy() {
    if (hasRequiredRabbitLegacy) return rabbitLegacy.exports;
    hasRequiredRabbitLegacy = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireEncBase64(), requireMd5(), requireEvpkdf(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var StreamCipher = C_lib.StreamCipher;
          var C_algo = C.algo;
          var S = [];
          var C_ = [];
          var G = [];
          var RabbitLegacy = C_algo.RabbitLegacy = StreamCipher.extend({
            _doReset: function() {
              var K = this._key.words;
              var iv = this.cfg.iv;
              var X = this._X = [
                K[0],
                K[3] << 16 | K[2] >>> 16,
                K[1],
                K[0] << 16 | K[3] >>> 16,
                K[2],
                K[1] << 16 | K[0] >>> 16,
                K[3],
                K[2] << 16 | K[1] >>> 16
              ];
              var C2 = this._C = [
                K[2] << 16 | K[2] >>> 16,
                K[0] & 4294901760 | K[1] & 65535,
                K[3] << 16 | K[3] >>> 16,
                K[1] & 4294901760 | K[2] & 65535,
                K[0] << 16 | K[0] >>> 16,
                K[2] & 4294901760 | K[3] & 65535,
                K[1] << 16 | K[1] >>> 16,
                K[3] & 4294901760 | K[0] & 65535
              ];
              this._b = 0;
              for (var i = 0; i < 4; i++) {
                nextState.call(this);
              }
              for (var i = 0; i < 8; i++) {
                C2[i] ^= X[i + 4 & 7];
              }
              if (iv) {
                var IV = iv.words;
                var IV_0 = IV[0];
                var IV_1 = IV[1];
                var i0 = (IV_0 << 8 | IV_0 >>> 24) & 16711935 | (IV_0 << 24 | IV_0 >>> 8) & 4278255360;
                var i2 = (IV_1 << 8 | IV_1 >>> 24) & 16711935 | (IV_1 << 24 | IV_1 >>> 8) & 4278255360;
                var i1 = i0 >>> 16 | i2 & 4294901760;
                var i3 = i2 << 16 | i0 & 65535;
                C2[0] ^= i0;
                C2[1] ^= i1;
                C2[2] ^= i2;
                C2[3] ^= i3;
                C2[4] ^= i0;
                C2[5] ^= i1;
                C2[6] ^= i2;
                C2[7] ^= i3;
                for (var i = 0; i < 4; i++) {
                  nextState.call(this);
                }
              }
            },
            _doProcessBlock: function(M, offset) {
              var X = this._X;
              nextState.call(this);
              S[0] = X[0] ^ X[5] >>> 16 ^ X[3] << 16;
              S[1] = X[2] ^ X[7] >>> 16 ^ X[5] << 16;
              S[2] = X[4] ^ X[1] >>> 16 ^ X[7] << 16;
              S[3] = X[6] ^ X[3] >>> 16 ^ X[1] << 16;
              for (var i = 0; i < 4; i++) {
                S[i] = (S[i] << 8 | S[i] >>> 24) & 16711935 | (S[i] << 24 | S[i] >>> 8) & 4278255360;
                M[offset + i] ^= S[i];
              }
            },
            blockSize: 128 / 32,
            ivSize: 64 / 32
          });
          function nextState() {
            var X = this._X;
            var C2 = this._C;
            for (var i = 0; i < 8; i++) {
              C_[i] = C2[i];
            }
            C2[0] = C2[0] + 1295307597 + this._b | 0;
            C2[1] = C2[1] + 3545052371 + (C2[0] >>> 0 < C_[0] >>> 0 ? 1 : 0) | 0;
            C2[2] = C2[2] + 886263092 + (C2[1] >>> 0 < C_[1] >>> 0 ? 1 : 0) | 0;
            C2[3] = C2[3] + 1295307597 + (C2[2] >>> 0 < C_[2] >>> 0 ? 1 : 0) | 0;
            C2[4] = C2[4] + 3545052371 + (C2[3] >>> 0 < C_[3] >>> 0 ? 1 : 0) | 0;
            C2[5] = C2[5] + 886263092 + (C2[4] >>> 0 < C_[4] >>> 0 ? 1 : 0) | 0;
            C2[6] = C2[6] + 1295307597 + (C2[5] >>> 0 < C_[5] >>> 0 ? 1 : 0) | 0;
            C2[7] = C2[7] + 3545052371 + (C2[6] >>> 0 < C_[6] >>> 0 ? 1 : 0) | 0;
            this._b = C2[7] >>> 0 < C_[7] >>> 0 ? 1 : 0;
            for (var i = 0; i < 8; i++) {
              var gx = X[i] + C2[i];
              var ga = gx & 65535;
              var gb = gx >>> 16;
              var gh = ((ga * ga >>> 17) + ga * gb >>> 15) + gb * gb;
              var gl = ((gx & 4294901760) * gx | 0) + ((gx & 65535) * gx | 0);
              G[i] = gh ^ gl;
            }
            X[0] = G[0] + (G[7] << 16 | G[7] >>> 16) + (G[6] << 16 | G[6] >>> 16) | 0;
            X[1] = G[1] + (G[0] << 8 | G[0] >>> 24) + G[7] | 0;
            X[2] = G[2] + (G[1] << 16 | G[1] >>> 16) + (G[0] << 16 | G[0] >>> 16) | 0;
            X[3] = G[3] + (G[2] << 8 | G[2] >>> 24) + G[1] | 0;
            X[4] = G[4] + (G[3] << 16 | G[3] >>> 16) + (G[2] << 16 | G[2] >>> 16) | 0;
            X[5] = G[5] + (G[4] << 8 | G[4] >>> 24) + G[3] | 0;
            X[6] = G[6] + (G[5] << 16 | G[5] >>> 16) + (G[4] << 16 | G[4] >>> 16) | 0;
            X[7] = G[7] + (G[6] << 8 | G[6] >>> 24) + G[5] | 0;
          }
          C.RabbitLegacy = StreamCipher._createHelper(RabbitLegacy);
        })();
        return CryptoJS2.RabbitLegacy;
      });
    })(rabbitLegacy);
    return rabbitLegacy.exports;
  }
  var blowfish = { exports: {} };
  var hasRequiredBlowfish;
  function requireBlowfish() {
    if (hasRequiredBlowfish) return blowfish.exports;
    hasRequiredBlowfish = 1;
    (function(module2, exports3) {
      (function(root, factory, undef) {
        {
          module2.exports = factory(requireCore(), requireEncBase64(), requireMd5(), requireEvpkdf(), requireCipherCore());
        }
      })(commonjsGlobal, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var BlockCipher = C_lib.BlockCipher;
          var C_algo = C.algo;
          const N = 16;
          const ORIG_P = [
            608135816,
            2242054355,
            320440878,
            57701188,
            2752067618,
            698298832,
            137296536,
            3964562569,
            1160258022,
            953160567,
            3193202383,
            887688300,
            3232508343,
            3380367581,
            1065670069,
            3041331479,
            2450970073,
            2306472731
          ];
          const ORIG_S = [
            [
              3509652390,
              2564797868,
              805139163,
              3491422135,
              3101798381,
              1780907670,
              3128725573,
              4046225305,
              614570311,
              3012652279,
              134345442,
              2240740374,
              1667834072,
              1901547113,
              2757295779,
              4103290238,
              227898511,
              1921955416,
              1904987480,
              2182433518,
              2069144605,
              3260701109,
              2620446009,
              720527379,
              3318853667,
              677414384,
              3393288472,
              3101374703,
              2390351024,
              1614419982,
              1822297739,
              2954791486,
              3608508353,
              3174124327,
              2024746970,
              1432378464,
              3864339955,
              2857741204,
              1464375394,
              1676153920,
              1439316330,
              715854006,
              3033291828,
              289532110,
              2706671279,
              2087905683,
              3018724369,
              1668267050,
              732546397,
              1947742710,
              3462151702,
              2609353502,
              2950085171,
              1814351708,
              2050118529,
              680887927,
              999245976,
              1800124847,
              3300911131,
              1713906067,
              1641548236,
              4213287313,
              1216130144,
              1575780402,
              4018429277,
              3917837745,
              3693486850,
              3949271944,
              596196993,
              3549867205,
              258830323,
              2213823033,
              772490370,
              2760122372,
              1774776394,
              2652871518,
              566650946,
              4142492826,
              1728879713,
              2882767088,
              1783734482,
              3629395816,
              2517608232,
              2874225571,
              1861159788,
              326777828,
              3124490320,
              2130389656,
              2716951837,
              967770486,
              1724537150,
              2185432712,
              2364442137,
              1164943284,
              2105845187,
              998989502,
              3765401048,
              2244026483,
              1075463327,
              1455516326,
              1322494562,
              910128902,
              469688178,
              1117454909,
              936433444,
              3490320968,
              3675253459,
              1240580251,
              122909385,
              2157517691,
              634681816,
              4142456567,
              3825094682,
              3061402683,
              2540495037,
              79693498,
              3249098678,
              1084186820,
              1583128258,
              426386531,
              1761308591,
              1047286709,
              322548459,
              995290223,
              1845252383,
              2603652396,
              3431023940,
              2942221577,
              3202600964,
              3727903485,
              1712269319,
              422464435,
              3234572375,
              1170764815,
              3523960633,
              3117677531,
              1434042557,
              442511882,
              3600875718,
              1076654713,
              1738483198,
              4213154764,
              2393238008,
              3677496056,
              1014306527,
              4251020053,
              793779912,
              2902807211,
              842905082,
              4246964064,
              1395751752,
              1040244610,
              2656851899,
              3396308128,
              445077038,
              3742853595,
              3577915638,
              679411651,
              2892444358,
              2354009459,
              1767581616,
              3150600392,
              3791627101,
              3102740896,
              284835224,
              4246832056,
              1258075500,
              768725851,
              2589189241,
              3069724005,
              3532540348,
              1274779536,
              3789419226,
              2764799539,
              1660621633,
              3471099624,
              4011903706,
              913787905,
              3497959166,
              737222580,
              2514213453,
              2928710040,
              3937242737,
              1804850592,
              3499020752,
              2949064160,
              2386320175,
              2390070455,
              2415321851,
              4061277028,
              2290661394,
              2416832540,
              1336762016,
              1754252060,
              3520065937,
              3014181293,
              791618072,
              3188594551,
              3933548030,
              2332172193,
              3852520463,
              3043980520,
              413987798,
              3465142937,
              3030929376,
              4245938359,
              2093235073,
              3534596313,
              375366246,
              2157278981,
              2479649556,
              555357303,
              3870105701,
              2008414854,
              3344188149,
              4221384143,
              3956125452,
              2067696032,
              3594591187,
              2921233993,
              2428461,
              544322398,
              577241275,
              1471733935,
              610547355,
              4027169054,
              1432588573,
              1507829418,
              2025931657,
              3646575487,
              545086370,
              48609733,
              2200306550,
              1653985193,
              298326376,
              1316178497,
              3007786442,
              2064951626,
              458293330,
              2589141269,
              3591329599,
              3164325604,
              727753846,
              2179363840,
              146436021,
              1461446943,
              4069977195,
              705550613,
              3059967265,
              3887724982,
              4281599278,
              3313849956,
              1404054877,
              2845806497,
              146425753,
              1854211946
            ],
            [
              1266315497,
              3048417604,
              3681880366,
              3289982499,
              290971e4,
              1235738493,
              2632868024,
              2414719590,
              3970600049,
              1771706367,
              1449415276,
              3266420449,
              422970021,
              1963543593,
              2690192192,
              3826793022,
              1062508698,
              1531092325,
              1804592342,
              2583117782,
              2714934279,
              4024971509,
              1294809318,
              4028980673,
              1289560198,
              2221992742,
              1669523910,
              35572830,
              157838143,
              1052438473,
              1016535060,
              1802137761,
              1753167236,
              1386275462,
              3080475397,
              2857371447,
              1040679964,
              2145300060,
              2390574316,
              1461121720,
              2956646967,
              4031777805,
              4028374788,
              33600511,
              2920084762,
              1018524850,
              629373528,
              3691585981,
              3515945977,
              2091462646,
              2486323059,
              586499841,
              988145025,
              935516892,
              3367335476,
              2599673255,
              2839830854,
              265290510,
              3972581182,
              2759138881,
              3795373465,
              1005194799,
              847297441,
              406762289,
              1314163512,
              1332590856,
              1866599683,
              4127851711,
              750260880,
              613907577,
              1450815602,
              3165620655,
              3734664991,
              3650291728,
              3012275730,
              3704569646,
              1427272223,
              778793252,
              1343938022,
              2676280711,
              2052605720,
              1946737175,
              3164576444,
              3914038668,
              3967478842,
              3682934266,
              1661551462,
              3294938066,
              4011595847,
              840292616,
              3712170807,
              616741398,
              312560963,
              711312465,
              1351876610,
              322626781,
              1910503582,
              271666773,
              2175563734,
              1594956187,
              70604529,
              3617834859,
              1007753275,
              1495573769,
              4069517037,
              2549218298,
              2663038764,
              504708206,
              2263041392,
              3941167025,
              2249088522,
              1514023603,
              1998579484,
              1312622330,
              694541497,
              2582060303,
              2151582166,
              1382467621,
              776784248,
              2618340202,
              3323268794,
              2497899128,
              2784771155,
              503983604,
              4076293799,
              907881277,
              423175695,
              432175456,
              1378068232,
              4145222326,
              3954048622,
              3938656102,
              3820766613,
              2793130115,
              2977904593,
              26017576,
              3274890735,
              3194772133,
              1700274565,
              1756076034,
              4006520079,
              3677328699,
              720338349,
              1533947780,
              354530856,
              688349552,
              3973924725,
              1637815568,
              332179504,
              3949051286,
              53804574,
              2852348879,
              3044236432,
              1282449977,
              3583942155,
              3416972820,
              4006381244,
              1617046695,
              2628476075,
              3002303598,
              1686838959,
              431878346,
              2686675385,
              1700445008,
              1080580658,
              1009431731,
              832498133,
              3223435511,
              2605976345,
              2271191193,
              2516031870,
              1648197032,
              4164389018,
              2548247927,
              300782431,
              375919233,
              238389289,
              3353747414,
              2531188641,
              2019080857,
              1475708069,
              455242339,
              2609103871,
              448939670,
              3451063019,
              1395535956,
              2413381860,
              1841049896,
              1491858159,
              885456874,
              4264095073,
              4001119347,
              1565136089,
              3898914787,
              1108368660,
              540939232,
              1173283510,
              2745871338,
              3681308437,
              4207628240,
              3343053890,
              4016749493,
              1699691293,
              1103962373,
              3625875870,
              2256883143,
              3830138730,
              1031889488,
              3479347698,
              1535977030,
              4236805024,
              3251091107,
              2132092099,
              1774941330,
              1199868427,
              1452454533,
              157007616,
              2904115357,
              342012276,
              595725824,
              1480756522,
              206960106,
              497939518,
              591360097,
              863170706,
              2375253569,
              3596610801,
              1814182875,
              2094937945,
              3421402208,
              1082520231,
              3463918190,
              2785509508,
              435703966,
              3908032597,
              1641649973,
              2842273706,
              3305899714,
              1510255612,
              2148256476,
              2655287854,
              3276092548,
              4258621189,
              236887753,
              3681803219,
              274041037,
              1734335097,
              3815195456,
              3317970021,
              1899903192,
              1026095262,
              4050517792,
              356393447,
              2410691914,
              3873677099,
              3682840055
            ],
            [
              3913112168,
              2491498743,
              4132185628,
              2489919796,
              1091903735,
              1979897079,
              3170134830,
              3567386728,
              3557303409,
              857797738,
              1136121015,
              1342202287,
              507115054,
              2535736646,
              337727348,
              3213592640,
              1301675037,
              2528481711,
              1895095763,
              1721773893,
              3216771564,
              62756741,
              2142006736,
              835421444,
              2531993523,
              1442658625,
              3659876326,
              2882144922,
              676362277,
              1392781812,
              170690266,
              3921047035,
              1759253602,
              3611846912,
              1745797284,
              664899054,
              1329594018,
              3901205900,
              3045908486,
              2062866102,
              2865634940,
              3543621612,
              3464012697,
              1080764994,
              553557557,
              3656615353,
              3996768171,
              991055499,
              499776247,
              1265440854,
              648242737,
              3940784050,
              980351604,
              3713745714,
              1749149687,
              3396870395,
              4211799374,
              3640570775,
              1161844396,
              3125318951,
              1431517754,
              545492359,
              4268468663,
              3499529547,
              1437099964,
              2702547544,
              3433638243,
              2581715763,
              2787789398,
              1060185593,
              1593081372,
              2418618748,
              4260947970,
              69676912,
              2159744348,
              86519011,
              2512459080,
              3838209314,
              1220612927,
              3339683548,
              133810670,
              1090789135,
              1078426020,
              1569222167,
              845107691,
              3583754449,
              4072456591,
              1091646820,
              628848692,
              1613405280,
              3757631651,
              526609435,
              236106946,
              48312990,
              2942717905,
              3402727701,
              1797494240,
              859738849,
              992217954,
              4005476642,
              2243076622,
              3870952857,
              3732016268,
              765654824,
              3490871365,
              2511836413,
              1685915746,
              3888969200,
              1414112111,
              2273134842,
              3281911079,
              4080962846,
              172450625,
              2569994100,
              980381355,
              4109958455,
              2819808352,
              2716589560,
              2568741196,
              3681446669,
              3329971472,
              1835478071,
              660984891,
              3704678404,
              4045999559,
              3422617507,
              3040415634,
              1762651403,
              1719377915,
              3470491036,
              2693910283,
              3642056355,
              3138596744,
              1364962596,
              2073328063,
              1983633131,
              926494387,
              3423689081,
              2150032023,
              4096667949,
              1749200295,
              3328846651,
              309677260,
              2016342300,
              1779581495,
              3079819751,
              111262694,
              1274766160,
              443224088,
              298511866,
              1025883608,
              3806446537,
              1145181785,
              168956806,
              3641502830,
              3584813610,
              1689216846,
              3666258015,
              3200248200,
              1692713982,
              2646376535,
              4042768518,
              1618508792,
              1610833997,
              3523052358,
              4130873264,
              2001055236,
              3610705100,
              2202168115,
              4028541809,
              2961195399,
              1006657119,
              2006996926,
              3186142756,
              1430667929,
              3210227297,
              1314452623,
              4074634658,
              4101304120,
              2273951170,
              1399257539,
              3367210612,
              3027628629,
              1190975929,
              2062231137,
              2333990788,
              2221543033,
              2438960610,
              1181637006,
              548689776,
              2362791313,
              3372408396,
              3104550113,
              3145860560,
              296247880,
              1970579870,
              3078560182,
              3769228297,
              1714227617,
              3291629107,
              3898220290,
              166772364,
              1251581989,
              493813264,
              448347421,
              195405023,
              2709975567,
              677966185,
              3703036547,
              1463355134,
              2715995803,
              1338867538,
              1343315457,
              2802222074,
              2684532164,
              233230375,
              2599980071,
              2000651841,
              3277868038,
              1638401717,
              4028070440,
              3237316320,
              6314154,
              819756386,
              300326615,
              590932579,
              1405279636,
              3267499572,
              3150704214,
              2428286686,
              3959192993,
              3461946742,
              1862657033,
              1266418056,
              963775037,
              2089974820,
              2263052895,
              1917689273,
              448879540,
              3550394620,
              3981727096,
              150775221,
              3627908307,
              1303187396,
              508620638,
              2975983352,
              2726630617,
              1817252668,
              1876281319,
              1457606340,
              908771278,
              3720792119,
              3617206836,
              2455994898,
              1729034894,
              1080033504
            ],
            [
              976866871,
              3556439503,
              2881648439,
              1522871579,
              1555064734,
              1336096578,
              3548522304,
              2579274686,
              3574697629,
              3205460757,
              3593280638,
              3338716283,
              3079412587,
              564236357,
              2993598910,
              1781952180,
              1464380207,
              3163844217,
              3332601554,
              1699332808,
              1393555694,
              1183702653,
              3581086237,
              1288719814,
              691649499,
              2847557200,
              2895455976,
              3193889540,
              2717570544,
              1781354906,
              1676643554,
              2592534050,
              3230253752,
              1126444790,
              2770207658,
              2633158820,
              2210423226,
              2615765581,
              2414155088,
              3127139286,
              673620729,
              2805611233,
              1269405062,
              4015350505,
              3341807571,
              4149409754,
              1057255273,
              2012875353,
              2162469141,
              2276492801,
              2601117357,
              993977747,
              3918593370,
              2654263191,
              753973209,
              36408145,
              2530585658,
              25011837,
              3520020182,
              2088578344,
              530523599,
              2918365339,
              1524020338,
              1518925132,
              3760827505,
              3759777254,
              1202760957,
              3985898139,
              3906192525,
              674977740,
              4174734889,
              2031300136,
              2019492241,
              3983892565,
              4153806404,
              3822280332,
              352677332,
              2297720250,
              60907813,
              90501309,
              3286998549,
              1016092578,
              2535922412,
              2839152426,
              457141659,
              509813237,
              4120667899,
              652014361,
              1966332200,
              2975202805,
              55981186,
              2327461051,
              676427537,
              3255491064,
              2882294119,
              3433927263,
              1307055953,
              942726286,
              933058658,
              2468411793,
              3933900994,
              4215176142,
              1361170020,
              2001714738,
              2830558078,
              3274259782,
              1222529897,
              1679025792,
              2729314320,
              3714953764,
              1770335741,
              151462246,
              3013232138,
              1682292957,
              1483529935,
              471910574,
              1539241949,
              458788160,
              3436315007,
              1807016891,
              3718408830,
              978976581,
              1043663428,
              3165965781,
              1927990952,
              4200891579,
              2372276910,
              3208408903,
              3533431907,
              1412390302,
              2931980059,
              4132332400,
              1947078029,
              3881505623,
              4168226417,
              2941484381,
              1077988104,
              1320477388,
              886195818,
              18198404,
              3786409e3,
              2509781533,
              112762804,
              3463356488,
              1866414978,
              891333506,
              18488651,
              661792760,
              1628790961,
              3885187036,
              3141171499,
              876946877,
              2693282273,
              1372485963,
              791857591,
              2686433993,
              3759982718,
              3167212022,
              3472953795,
              2716379847,
              445679433,
              3561995674,
              3504004811,
              3574258232,
              54117162,
              3331405415,
              2381918588,
              3769707343,
              4154350007,
              1140177722,
              4074052095,
              668550556,
              3214352940,
              367459370,
              261225585,
              2610173221,
              4209349473,
              3468074219,
              3265815641,
              314222801,
              3066103646,
              3808782860,
              282218597,
              3406013506,
              3773591054,
              379116347,
              1285071038,
              846784868,
              2669647154,
              3771962079,
              3550491691,
              2305946142,
              453669953,
              1268987020,
              3317592352,
              3279303384,
              3744833421,
              2610507566,
              3859509063,
              266596637,
              3847019092,
              517658769,
              3462560207,
              3443424879,
              370717030,
              4247526661,
              2224018117,
              4143653529,
              4112773975,
              2788324899,
              2477274417,
              1456262402,
              2901442914,
              1517677493,
              1846949527,
              2295493580,
              3734397586,
              2176403920,
              1280348187,
              1908823572,
              3871786941,
              846861322,
              1172426758,
              3287448474,
              3383383037,
              1655181056,
              3139813346,
              901632758,
              1897031941,
              2986607138,
              3066810236,
              3447102507,
              1393639104,
              373351379,
              950779232,
              625454576,
              3124240540,
              4148612726,
              2007998917,
              544563296,
              2244738638,
              2330496472,
              2058025392,
              1291430526,
              424198748,
              50039436,
              29584100,
              3605783033,
              2429876329,
              2791104160,
              1057563949,
              3255363231,
              3075367218,
              3463963227,
              1469046755,
              985887462
            ]
          ];
          var BLOWFISH_CTX = {
            pbox: [],
            sbox: []
          };
          function F(ctx, x) {
            let a = x >> 24 & 255;
            let b = x >> 16 & 255;
            let c = x >> 8 & 255;
            let d = x & 255;
            let y = ctx.sbox[0][a] + ctx.sbox[1][b];
            y = y ^ ctx.sbox[2][c];
            y = y + ctx.sbox[3][d];
            return y;
          }
          function BlowFish_Encrypt(ctx, left, right) {
            let Xl = left;
            let Xr = right;
            let temp;
            for (let i = 0; i < N; ++i) {
              Xl = Xl ^ ctx.pbox[i];
              Xr = F(ctx, Xl) ^ Xr;
              temp = Xl;
              Xl = Xr;
              Xr = temp;
            }
            temp = Xl;
            Xl = Xr;
            Xr = temp;
            Xr = Xr ^ ctx.pbox[N];
            Xl = Xl ^ ctx.pbox[N + 1];
            return { left: Xl, right: Xr };
          }
          function BlowFish_Decrypt(ctx, left, right) {
            let Xl = left;
            let Xr = right;
            let temp;
            for (let i = N + 1; i > 1; --i) {
              Xl = Xl ^ ctx.pbox[i];
              Xr = F(ctx, Xl) ^ Xr;
              temp = Xl;
              Xl = Xr;
              Xr = temp;
            }
            temp = Xl;
            Xl = Xr;
            Xr = temp;
            Xr = Xr ^ ctx.pbox[1];
            Xl = Xl ^ ctx.pbox[0];
            return { left: Xl, right: Xr };
          }
          function BlowFishInit(ctx, key, keysize) {
            for (let Row = 0; Row < 4; Row++) {
              ctx.sbox[Row] = [];
              for (let Col = 0; Col < 256; Col++) {
                ctx.sbox[Row][Col] = ORIG_S[Row][Col];
              }
            }
            let keyIndex = 0;
            for (let index = 0; index < N + 2; index++) {
              ctx.pbox[index] = ORIG_P[index] ^ key[keyIndex];
              keyIndex++;
              if (keyIndex >= keysize) {
                keyIndex = 0;
              }
            }
            let Data1 = 0;
            let Data2 = 0;
            let res = 0;
            for (let i = 0; i < N + 2; i += 2) {
              res = BlowFish_Encrypt(ctx, Data1, Data2);
              Data1 = res.left;
              Data2 = res.right;
              ctx.pbox[i] = Data1;
              ctx.pbox[i + 1] = Data2;
            }
            for (let i = 0; i < 4; i++) {
              for (let j = 0; j < 256; j += 2) {
                res = BlowFish_Encrypt(ctx, Data1, Data2);
                Data1 = res.left;
                Data2 = res.right;
                ctx.sbox[i][j] = Data1;
                ctx.sbox[i][j + 1] = Data2;
              }
            }
            return true;
          }
          var Blowfish = C_algo.Blowfish = BlockCipher.extend({
            _doReset: function() {
              if (this._keyPriorReset === this._key) {
                return;
              }
              var key = this._keyPriorReset = this._key;
              var keyWords = key.words;
              var keySize = key.sigBytes / 4;
              BlowFishInit(BLOWFISH_CTX, keyWords, keySize);
            },
            encryptBlock: function(M, offset) {
              var res = BlowFish_Encrypt(BLOWFISH_CTX, M[offset], M[offset + 1]);
              M[offset] = res.left;
              M[offset + 1] = res.right;
            },
            decryptBlock: function(M, offset) {
              var res = BlowFish_Decrypt(BLOWFISH_CTX, M[offset], M[offset + 1]);
              M[offset] = res.left;
              M[offset + 1] = res.right;
            },
            blockSize: 64 / 32,
            keySize: 128 / 32,
            ivSize: 64 / 32
          });
          C.Blowfish = BlockCipher._createHelper(Blowfish);
        })();
        return CryptoJS2.Blowfish;
      });
    })(blowfish);
    return blowfish.exports;
  }
  (function(module2, exports3) {
    (function(root, factory, undef) {
      {
        module2.exports = factory(requireCore(), requireX64Core(), requireLibTypedarrays(), requireEncUtf16(), requireEncBase64(), requireEncBase64url(), requireMd5(), requireSha1(), requireSha256(), requireSha224(), requireSha512(), requireSha384(), requireSha3(), requireRipemd160(), requireHmac(), requirePbkdf2(), requireEvpkdf(), requireCipherCore(), requireModeCfb(), requireModeCtr(), requireModeCtrGladman(), requireModeOfb(), requireModeEcb(), requirePadAnsix923(), requirePadIso10126(), requirePadIso97971(), requirePadZeropadding(), requirePadNopadding(), requireFormatHex(), requireAes(), requireTripledes(), requireRc4(), requireRabbit(), requireRabbitLegacy(), requireBlowfish());
      }
    })(commonjsGlobal, function(CryptoJS2) {
      return CryptoJS2;
    });
  })(cryptoJs);
  var cryptoJsExports = cryptoJs.exports;
  const CryptoJS = /* @__PURE__ */ getDefaultExportFromCjs(cryptoJsExports);
 /*! pako 2.1.0 https://github.com/nodeca/pako @license (MIT AND Zlib) */
  const Z_FIXED$1 = 4;
  const Z_BINARY = 0;
  const Z_TEXT = 1;
  const Z_UNKNOWN$1 = 2;
  function zero$1(buf) {
    let len = buf.length;
    while (--len >= 0) {
      buf[len] = 0;
    }
  }
  const STORED_BLOCK = 0;
  const STATIC_TREES = 1;
  const DYN_TREES = 2;
  const MIN_MATCH$1 = 3;
  const MAX_MATCH$1 = 258;
  const LENGTH_CODES$1 = 29;
  const LITERALS$1 = 256;
  const L_CODES$1 = LITERALS$1 + 1 + LENGTH_CODES$1;
  const D_CODES$1 = 30;
  const BL_CODES$1 = 19;
  const HEAP_SIZE$1 = 2 * L_CODES$1 + 1;
  const MAX_BITS$1 = 15;
  const Buf_size = 16;
  const MAX_BL_BITS = 7;
  const END_BLOCK = 256;
  const REP_3_6 = 16;
  const REPZ_3_10 = 17;
  const REPZ_11_138 = 18;
  const extra_lbits = (
 /* extra bits for each length code */
    new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0])
  );
  const extra_dbits = (
 /* extra bits for each distance code */
    new Uint8Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13])
  );
  const extra_blbits = (
 /* extra bits for each bit length code */
    new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7])
  );
  const bl_order = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  const DIST_CODE_LEN = 512;
  const static_ltree = new Array((L_CODES$1 + 2) * 2);
  zero$1(static_ltree);
  const static_dtree = new Array(D_CODES$1 * 2);
  zero$1(static_dtree);
  const _dist_code = new Array(DIST_CODE_LEN);
  zero$1(_dist_code);
  const _length_code = new Array(MAX_MATCH$1 - MIN_MATCH$1 + 1);
  zero$1(_length_code);
  const base_length = new Array(LENGTH_CODES$1);
  zero$1(base_length);
  const base_dist = new Array(D_CODES$1);
  zero$1(base_dist);
  function StaticTreeDesc(static_tree, extra_bits, extra_base, elems, max_length) {
    this.static_tree = static_tree;
    this.extra_bits = extra_bits;
    this.extra_base = extra_base;
    this.elems = elems;
    this.max_length = max_length;
    this.has_stree = static_tree && static_tree.length;
  }
  let static_l_desc;
  let static_d_desc;
  let static_bl_desc;
  function TreeDesc(dyn_tree, stat_desc) {
    this.dyn_tree = dyn_tree;
    this.max_code = 0;
    this.stat_desc = stat_desc;
  }
  const d_code = (dist) => {
    return dist < 256 ? _dist_code[dist] : _dist_code[256 + (dist >>> 7)];
  };
  const put_short = (s, w) => {
    s.pending_buf[s.pending++] = w & 255;
    s.pending_buf[s.pending++] = w >>> 8 & 255;
  };
  const send_bits = (s, value, length) => {
    if (s.bi_valid > Buf_size - length) {
      s.bi_buf |= value << s.bi_valid & 65535;
      put_short(s, s.bi_buf);
      s.bi_buf = value >> Buf_size - s.bi_valid;
      s.bi_valid += length - Buf_size;
    } else {
      s.bi_buf |= value << s.bi_valid & 65535;
      s.bi_valid += length;
    }
  };
  const send_code = (s, c, tree) => {
    send_bits(
      s,
      tree[c * 2],
      tree[c * 2 + 1]
 /*.Len*/
    );
  };
  const bi_reverse = (code, len) => {
    let res = 0;
    do {
      res |= code & 1;
      code >>>= 1;
      res <<= 1;
    } while (--len > 0);
    return res >>> 1;
  };
  const bi_flush = (s) => {
    if (s.bi_valid === 16) {
      put_short(s, s.bi_buf);
      s.bi_buf = 0;
      s.bi_valid = 0;
    } else if (s.bi_valid >= 8) {
      s.pending_buf[s.pending++] = s.bi_buf & 255;
      s.bi_buf >>= 8;
      s.bi_valid -= 8;
    }
  };
  const gen_bitlen = (s, desc) => {
    const tree = desc.dyn_tree;
    const max_code = desc.max_code;
    const stree = desc.stat_desc.static_tree;
    const has_stree = desc.stat_desc.has_stree;
    const extra = desc.stat_desc.extra_bits;
    const base = desc.stat_desc.extra_base;
    const max_length = desc.stat_desc.max_length;
    let h;
    let n, m;
    let bits;
    let xbits;
    let f;
    let overflow = 0;
    for (bits = 0; bits <= MAX_BITS$1; bits++) {
      s.bl_count[bits] = 0;
    }
    tree[s.heap[s.heap_max] * 2 + 1] = 0;
    for (h = s.heap_max + 1; h < HEAP_SIZE$1; h++) {
      n = s.heap[h];
      bits = tree[tree[n * 2 + 1] * 2 + 1] + 1;
      if (bits > max_length) {
        bits = max_length;
        overflow++;
      }
      tree[n * 2 + 1] = bits;
      if (n > max_code) {
        continue;
      }
      s.bl_count[bits]++;
      xbits = 0;
      if (n >= base) {
        xbits = extra[n - base];
      }
      f = tree[n * 2];
      s.opt_len += f * (bits + xbits);
      if (has_stree) {
        s.static_len += f * (stree[n * 2 + 1] + xbits);
      }
    }
    if (overflow === 0) {
      return;
    }
    do {
      bits = max_length - 1;
      while (s.bl_count[bits] === 0) {
        bits--;
      }
      s.bl_count[bits]--;
      s.bl_count[bits + 1] += 2;
      s.bl_count[max_length]--;
      overflow -= 2;
    } while (overflow > 0);
    for (bits = max_length; bits !== 0; bits--) {
      n = s.bl_count[bits];
      while (n !== 0) {
        m = s.heap[--h];
        if (m > max_code) {
          continue;
        }
        if (tree[m * 2 + 1] !== bits) {
          s.opt_len += (bits - tree[m * 2 + 1]) * tree[m * 2];
          tree[m * 2 + 1] = bits;
        }
        n--;
      }
    }
  };
  const gen_codes = (tree, max_code, bl_count) => {
    const next_code = new Array(MAX_BITS$1 + 1);
    let code = 0;
    let bits;
    let n;
    for (bits = 1; bits <= MAX_BITS$1; bits++) {
      code = code + bl_count[bits - 1] << 1;
      next_code[bits] = code;
    }
    for (n = 0; n <= max_code; n++) {
      let len = tree[n * 2 + 1];
      if (len === 0) {
        continue;
      }
      tree[n * 2] = bi_reverse(next_code[len]++, len);
    }
  };
  const tr_static_init = () => {
    let n;
    let bits;
    let length;
    let code;
    let dist;
    const bl_count = new Array(MAX_BITS$1 + 1);
    length = 0;
    for (code = 0; code < LENGTH_CODES$1 - 1; code++) {
      base_length[code] = length;
      for (n = 0; n < 1 << extra_lbits[code]; n++) {
        _length_code[length++] = code;
      }
    }
    _length_code[length - 1] = code;
    dist = 0;
    for (code = 0; code < 16; code++) {
      base_dist[code] = dist;
      for (n = 0; n < 1 << extra_dbits[code]; n++) {
        _dist_code[dist++] = code;
      }
    }
    dist >>= 7;
    for (; code < D_CODES$1; code++) {
      base_dist[code] = dist << 7;
      for (n = 0; n < 1 << extra_dbits[code] - 7; n++) {
        _dist_code[256 + dist++] = code;
      }
    }
    for (bits = 0; bits <= MAX_BITS$1; bits++) {
      bl_count[bits] = 0;
    }
    n = 0;
    while (n <= 143) {
      static_ltree[n * 2 + 1] = 8;
      n++;
      bl_count[8]++;
    }
    while (n <= 255) {
      static_ltree[n * 2 + 1] = 9;
      n++;
      bl_count[9]++;
    }
    while (n <= 279) {
      static_ltree[n * 2 + 1] = 7;
      n++;
      bl_count[7]++;
    }
    while (n <= 287) {
      static_ltree[n * 2 + 1] = 8;
      n++;
      bl_count[8]++;
    }
    gen_codes(static_ltree, L_CODES$1 + 1, bl_count);
    for (n = 0; n < D_CODES$1; n++) {
      static_dtree[n * 2 + 1] = 5;
      static_dtree[n * 2] = bi_reverse(n, 5);
    }
    static_l_desc = new StaticTreeDesc(static_ltree, extra_lbits, LITERALS$1 + 1, L_CODES$1, MAX_BITS$1);
    static_d_desc = new StaticTreeDesc(static_dtree, extra_dbits, 0, D_CODES$1, MAX_BITS$1);
    static_bl_desc = new StaticTreeDesc(new Array(0), extra_blbits, 0, BL_CODES$1, MAX_BL_BITS);
  };
  const init_block = (s) => {
    let n;
    for (n = 0; n < L_CODES$1; n++) {
      s.dyn_ltree[n * 2] = 0;
    }
    for (n = 0; n < D_CODES$1; n++) {
      s.dyn_dtree[n * 2] = 0;
    }
    for (n = 0; n < BL_CODES$1; n++) {
      s.bl_tree[n * 2] = 0;
    }
    s.dyn_ltree[END_BLOCK * 2] = 1;
    s.opt_len = s.static_len = 0;
    s.sym_next = s.matches = 0;
  };
  const bi_windup = (s) => {
    if (s.bi_valid > 8) {
      put_short(s, s.bi_buf);
    } else if (s.bi_valid > 0) {
      s.pending_buf[s.pending++] = s.bi_buf;
    }
    s.bi_buf = 0;
    s.bi_valid = 0;
  };
  const smaller = (tree, n, m, depth) => {
    const _n2 = n * 2;
    const _m2 = m * 2;
    return tree[_n2] < tree[_m2] || tree[_n2] === tree[_m2] && depth[n] <= depth[m];
  };
  const pqdownheap = (s, tree, k) => {
    const v = s.heap[k];
    let j = k << 1;
    while (j <= s.heap_len) {
      if (j < s.heap_len && smaller(tree, s.heap[j + 1], s.heap[j], s.depth)) {
        j++;
      }
      if (smaller(tree, v, s.heap[j], s.depth)) {
        break;
      }
      s.heap[k] = s.heap[j];
      k = j;
      j <<= 1;
    }
    s.heap[k] = v;
  };
  const compress_block = (s, ltree, dtree) => {
    let dist;
    let lc;
    let sx = 0;
    let code;
    let extra;
    if (s.sym_next !== 0) {
      do {
        dist = s.pending_buf[s.sym_buf + sx++] & 255;
        dist += (s.pending_buf[s.sym_buf + sx++] & 255) << 8;
        lc = s.pending_buf[s.sym_buf + sx++];
        if (dist === 0) {
          send_code(s, lc, ltree);
        } else {
          code = _length_code[lc];
          send_code(s, code + LITERALS$1 + 1, ltree);
          extra = extra_lbits[code];
          if (extra !== 0) {
            lc -= base_length[code];
            send_bits(s, lc, extra);
          }
          dist--;
          code = d_code(dist);
          send_code(s, code, dtree);
          extra = extra_dbits[code];
          if (extra !== 0) {
            dist -= base_dist[code];
            send_bits(s, dist, extra);
          }
        }
      } while (sx < s.sym_next);
    }
    send_code(s, END_BLOCK, ltree);
  };
  const build_tree = (s, desc) => {
    const tree = desc.dyn_tree;
    const stree = desc.stat_desc.static_tree;
    const has_stree = desc.stat_desc.has_stree;
    const elems = desc.stat_desc.elems;
    let n, m;
    let max_code = -1;
    let node;
    s.heap_len = 0;
    s.heap_max = HEAP_SIZE$1;
    for (n = 0; n < elems; n++) {
      if (tree[n * 2] !== 0) {
        s.heap[++s.heap_len] = max_code = n;
        s.depth[n] = 0;
      } else {
        tree[n * 2 + 1] = 0;
      }
    }
    while (s.heap_len < 2) {
      node = s.heap[++s.heap_len] = max_code < 2 ? ++max_code : 0;
      tree[node * 2] = 1;
      s.depth[node] = 0;
      s.opt_len--;
      if (has_stree) {
        s.static_len -= stree[node * 2 + 1];
      }
    }
    desc.max_code = max_code;
    for (n = s.heap_len >> 1; n >= 1; n--) {
      pqdownheap(s, tree, n);
    }
    node = elems;
    do {
      n = s.heap[
        1
 /*SMALLEST*/
      ];
      s.heap[
        1
 /*SMALLEST*/
      ] = s.heap[s.heap_len--];
      pqdownheap(
        s,
        tree,
        1
 /*SMALLEST*/
      );
      m = s.heap[
        1
 /*SMALLEST*/
      ];
      s.heap[--s.heap_max] = n;
      s.heap[--s.heap_max] = m;
      tree[node * 2] = tree[n * 2] + tree[m * 2];
      s.depth[node] = (s.depth[n] >= s.depth[m] ? s.depth[n] : s.depth[m]) + 1;
      tree[n * 2 + 1] = tree[m * 2 + 1] = node;
      s.heap[
        1
 /*SMALLEST*/
      ] = node++;
      pqdownheap(
        s,
        tree,
        1
 /*SMALLEST*/
      );
    } while (s.heap_len >= 2);
    s.heap[--s.heap_max] = s.heap[
      1
 /*SMALLEST*/
    ];
    gen_bitlen(s, desc);
    gen_codes(tree, max_code, s.bl_count);
  };
  const scan_tree = (s, tree, max_code) => {
    let n;
    let prevlen = -1;
    let curlen;
    let nextlen = tree[0 * 2 + 1];
    let count = 0;
    let max_count = 7;
    let min_count = 4;
    if (nextlen === 0) {
      max_count = 138;
      min_count = 3;
    }
    tree[(max_code + 1) * 2 + 1] = 65535;
    for (n = 0; n <= max_code; n++) {
      curlen = nextlen;
      nextlen = tree[(n + 1) * 2 + 1];
      if (++count < max_count && curlen === nextlen) {
        continue;
      } else if (count < min_count) {
        s.bl_tree[curlen * 2] += count;
      } else if (curlen !== 0) {
        if (curlen !== prevlen) {
          s.bl_tree[curlen * 2]++;
        }
        s.bl_tree[REP_3_6 * 2]++;
      } else if (count <= 10) {
        s.bl_tree[REPZ_3_10 * 2]++;
      } else {
        s.bl_tree[REPZ_11_138 * 2]++;
      }
      count = 0;
      prevlen = curlen;
      if (nextlen === 0) {
        max_count = 138;
        min_count = 3;
      } else if (curlen === nextlen) {
        max_count = 6;
        min_count = 3;
      } else {
        max_count = 7;
        min_count = 4;
      }
    }
  };
  const send_tree = (s, tree, max_code) => {
    let n;
    let prevlen = -1;
    let curlen;
    let nextlen = tree[0 * 2 + 1];
    let count = 0;
    let max_count = 7;
    let min_count = 4;
    if (nextlen === 0) {
      max_count = 138;
      min_count = 3;
    }
    for (n = 0; n <= max_code; n++) {
      curlen = nextlen;
      nextlen = tree[(n + 1) * 2 + 1];
      if (++count < max_count && curlen === nextlen) {
        continue;
      } else if (count < min_count) {
        do {
          send_code(s, curlen, s.bl_tree);
        } while (--count !== 0);
      } else if (curlen !== 0) {
        if (curlen !== prevlen) {
          send_code(s, curlen, s.bl_tree);
          count--;
        }
        send_code(s, REP_3_6, s.bl_tree);
        send_bits(s, count - 3, 2);
      } else if (count <= 10) {
        send_code(s, REPZ_3_10, s.bl_tree);
        send_bits(s, count - 3, 3);
      } else {
        send_code(s, REPZ_11_138, s.bl_tree);
        send_bits(s, count - 11, 7);
      }
      count = 0;
      prevlen = curlen;
      if (nextlen === 0) {
        max_count = 138;
        min_count = 3;
      } else if (curlen === nextlen) {
        max_count = 6;
        min_count = 3;
      } else {
        max_count = 7;
        min_count = 4;
      }
    }
  };
  const build_bl_tree = (s) => {
    let max_blindex;
    scan_tree(s, s.dyn_ltree, s.l_desc.max_code);
    scan_tree(s, s.dyn_dtree, s.d_desc.max_code);
    build_tree(s, s.bl_desc);
    for (max_blindex = BL_CODES$1 - 1; max_blindex >= 3; max_blindex--) {
      if (s.bl_tree[bl_order[max_blindex] * 2 + 1] !== 0) {
        break;
      }
    }
    s.opt_len += 3 * (max_blindex + 1) + 5 + 5 + 4;
    return max_blindex;
  };
  const send_all_trees = (s, lcodes, dcodes, blcodes) => {
    let rank2;
    send_bits(s, lcodes - 257, 5);
    send_bits(s, dcodes - 1, 5);
    send_bits(s, blcodes - 4, 4);
    for (rank2 = 0; rank2 < blcodes; rank2++) {
      send_bits(s, s.bl_tree[bl_order[rank2] * 2 + 1], 3);
    }
    send_tree(s, s.dyn_ltree, lcodes - 1);
    send_tree(s, s.dyn_dtree, dcodes - 1);
  };
  const detect_data_type = (s) => {
    let block_mask = 4093624447;
    let n;
    for (n = 0; n <= 31; n++, block_mask >>>= 1) {
      if (block_mask & 1 && s.dyn_ltree[n * 2] !== 0) {
        return Z_BINARY;
      }
    }
    if (s.dyn_ltree[9 * 2] !== 0 || s.dyn_ltree[10 * 2] !== 0 || s.dyn_ltree[13 * 2] !== 0) {
      return Z_TEXT;
    }
    for (n = 32; n < LITERALS$1; n++) {
      if (s.dyn_ltree[n * 2] !== 0) {
        return Z_TEXT;
      }
    }
    return Z_BINARY;
  };
  let static_init_done = false;
  const _tr_init$1 = (s) => {
    if (!static_init_done) {
      tr_static_init();
      static_init_done = true;
    }
    s.l_desc = new TreeDesc(s.dyn_ltree, static_l_desc);
    s.d_desc = new TreeDesc(s.dyn_dtree, static_d_desc);
    s.bl_desc = new TreeDesc(s.bl_tree, static_bl_desc);
    s.bi_buf = 0;
    s.bi_valid = 0;
    init_block(s);
  };
  const _tr_stored_block$1 = (s, buf, stored_len, last) => {
    send_bits(s, (STORED_BLOCK << 1) + (last ? 1 : 0), 3);
    bi_windup(s);
    put_short(s, stored_len);
    put_short(s, ~stored_len);
    if (stored_len) {
      s.pending_buf.set(s.window.subarray(buf, buf + stored_len), s.pending);
    }
    s.pending += stored_len;
  };
  const _tr_align$1 = (s) => {
    send_bits(s, STATIC_TREES << 1, 3);
    send_code(s, END_BLOCK, static_ltree);
    bi_flush(s);
  };
  const _tr_flush_block$1 = (s, buf, stored_len, last) => {
    let opt_lenb, static_lenb;
    let max_blindex = 0;
    if (s.level > 0) {
      if (s.strm.data_type === Z_UNKNOWN$1) {
        s.strm.data_type = detect_data_type(s);
      }
      build_tree(s, s.l_desc);
      build_tree(s, s.d_desc);
      max_blindex = build_bl_tree(s);
      opt_lenb = s.opt_len + 3 + 7 >>> 3;
      static_lenb = s.static_len + 3 + 7 >>> 3;
      if (static_lenb <= opt_lenb) {
        opt_lenb = static_lenb;
      }
    } else {
      opt_lenb = static_lenb = stored_len + 5;
    }
    if (stored_len + 4 <= opt_lenb && buf !== -1) {
      _tr_stored_block$1(s, buf, stored_len, last);
    } else if (s.strategy === Z_FIXED$1 || static_lenb === opt_lenb) {
      send_bits(s, (STATIC_TREES << 1) + (last ? 1 : 0), 3);
      compress_block(s, static_ltree, static_dtree);
    } else {
      send_bits(s, (DYN_TREES << 1) + (last ? 1 : 0), 3);
      send_all_trees(s, s.l_desc.max_code + 1, s.d_desc.max_code + 1, max_blindex + 1);
      compress_block(s, s.dyn_ltree, s.dyn_dtree);
    }
    init_block(s);
    if (last) {
      bi_windup(s);
    }
  };
  const _tr_tally$1 = (s, dist, lc) => {
    s.pending_buf[s.sym_buf + s.sym_next++] = dist;
    s.pending_buf[s.sym_buf + s.sym_next++] = dist >> 8;
    s.pending_buf[s.sym_buf + s.sym_next++] = lc;
    if (dist === 0) {
      s.dyn_ltree[lc * 2]++;
    } else {
      s.matches++;
      dist--;
      s.dyn_ltree[(_length_code[lc] + LITERALS$1 + 1) * 2]++;
      s.dyn_dtree[d_code(dist) * 2]++;
    }
    return s.sym_next === s.sym_end;
  };
  var _tr_init_1 = _tr_init$1;
  var _tr_stored_block_1 = _tr_stored_block$1;
  var _tr_flush_block_1 = _tr_flush_block$1;
  var _tr_tally_1 = _tr_tally$1;
  var _tr_align_1 = _tr_align$1;
  var trees = {
    _tr_init: _tr_init_1,
    _tr_stored_block: _tr_stored_block_1,
    _tr_flush_block: _tr_flush_block_1,
    _tr_tally: _tr_tally_1,
    _tr_align: _tr_align_1
  };
  const adler32 = (adler, buf, len, pos) => {
    let s1 = adler & 65535 | 0, s2 = adler >>> 16 & 65535 | 0, n = 0;
    while (len !== 0) {
      n = len > 2e3 ? 2e3 : len;
      len -= n;
      do {
        s1 = s1 + buf[pos++] | 0;
        s2 = s2 + s1 | 0;
      } while (--n);
      s1 %= 65521;
      s2 %= 65521;
    }
    return s1 | s2 << 16 | 0;
  };
  var adler32_1 = adler32;
  const makeTable = () => {
    let c, table = [];
    for (var n = 0; n < 256; n++) {
      c = n;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      }
      table[n] = c;
    }
    return table;
  };
  const crcTable = new Uint32Array(makeTable());
  const crc32 = (crc, buf, len, pos) => {
    const t = crcTable;
    const end = pos + len;
    crc ^= -1;
    for (let i = pos; i < end; i++) {
      crc = crc >>> 8 ^ t[(crc ^ buf[i]) & 255];
    }
    return crc ^ -1;
  };
  var crc32_1 = crc32;
  var messages = {
    2: "need dictionary",
 /* Z_NEED_DICT 2 */
    1: "stream end",
 /* Z_STREAM_END 1 */
    0: "",
 /* Z_OK 0 */
    "-1": "file error",
 /* Z_ERRNO (-1) */
    "-2": "stream error",
 /* Z_STREAM_ERROR (-2) */
    "-3": "data error",
 /* Z_DATA_ERROR (-3) */
    "-4": "insufficient memory",
 /* Z_MEM_ERROR (-4) */
    "-5": "buffer error",
 /* Z_BUF_ERROR (-5) */
    "-6": "incompatible version"
 /* Z_VERSION_ERROR (-6) */
  };
  var constants$2 = {
 /* Allowed flush values; see deflate and inflate below for details */
    Z_NO_FLUSH: 0,
    Z_PARTIAL_FLUSH: 1,
    Z_SYNC_FLUSH: 2,
    Z_FULL_FLUSH: 3,
    Z_FINISH: 4,
    Z_BLOCK: 5,
    Z_TREES: 6,
 /* Return codes for the compression/decompression functions. Negative values
 * are errors, positive values are used for special but normal events.
 */
    Z_OK: 0,
    Z_STREAM_END: 1,
    Z_NEED_DICT: 2,
    Z_ERRNO: -1,
    Z_STREAM_ERROR: -2,
    Z_DATA_ERROR: -3,
    Z_MEM_ERROR: -4,
    Z_BUF_ERROR: -5,
 //Z_VERSION_ERROR: -6
 /* compression levels */
    Z_NO_COMPRESSION: 0,
    Z_BEST_SPEED: 1,
    Z_BEST_COMPRESSION: 9,
    Z_DEFAULT_COMPRESSION: -1,
    Z_FILTERED: 1,
    Z_HUFFMAN_ONLY: 2,
    Z_RLE: 3,
    Z_FIXED: 4,
    Z_DEFAULT_STRATEGY: 0,
 /* Possible values of the data_type field (though see inflate) */
    Z_BINARY: 0,
    Z_TEXT: 1,
 //Z_ASCII: 1, // = Z_TEXT (deprecated)
    Z_UNKNOWN: 2,
 /* The deflate compression method */
    Z_DEFLATED: 8
 //Z_NULL: null // Use -1 or null inline, depending on var type
  };
  const { _tr_init, _tr_stored_block, _tr_flush_block, _tr_tally, _tr_align } = trees;
  const {
    Z_NO_FLUSH: Z_NO_FLUSH$2,
    Z_PARTIAL_FLUSH,
    Z_FULL_FLUSH: Z_FULL_FLUSH$1,
    Z_FINISH: Z_FINISH$3,
    Z_BLOCK: Z_BLOCK$1,
    Z_OK: Z_OK$3,
    Z_STREAM_END: Z_STREAM_END$3,
    Z_STREAM_ERROR: Z_STREAM_ERROR$2,
    Z_DATA_ERROR: Z_DATA_ERROR$2,
    Z_BUF_ERROR: Z_BUF_ERROR$1,
    Z_DEFAULT_COMPRESSION: Z_DEFAULT_COMPRESSION$1,
    Z_FILTERED,
    Z_HUFFMAN_ONLY,
    Z_RLE,
    Z_FIXED,
    Z_DEFAULT_STRATEGY: Z_DEFAULT_STRATEGY$1,
    Z_UNKNOWN,
    Z_DEFLATED: Z_DEFLATED$2
  } = constants$2;
  const MAX_MEM_LEVEL = 9;
  const MAX_WBITS$1 = 15;
  const DEF_MEM_LEVEL = 8;
  const LENGTH_CODES = 29;
  const LITERALS = 256;
  const L_CODES = LITERALS + 1 + LENGTH_CODES;
  const D_CODES = 30;
  const BL_CODES = 19;
  const HEAP_SIZE = 2 * L_CODES + 1;
  const MAX_BITS = 15;
  const MIN_MATCH = 3;
  const MAX_MATCH = 258;
  const MIN_LOOKAHEAD = MAX_MATCH + MIN_MATCH + 1;
  const PRESET_DICT = 32;
  const INIT_STATE = 42;
  const GZIP_STATE = 57;
  const EXTRA_STATE = 69;
  const NAME_STATE = 73;
  const COMMENT_STATE = 91;
  const HCRC_STATE = 103;
  const BUSY_STATE = 113;
  const FINISH_STATE = 666;
  const BS_NEED_MORE = 1;
  const BS_BLOCK_DONE = 2;
  const BS_FINISH_STARTED = 3;
  const BS_FINISH_DONE = 4;
  const OS_CODE = 3;
  const err = (strm, errorCode) => {
    strm.msg = messages[errorCode];
    return errorCode;
  };
  const rank = (f) => {
    return f * 2 - (f > 4 ? 9 : 0);
  };
  const zero = (buf) => {
    let len = buf.length;
    while (--len >= 0) {
      buf[len] = 0;
    }
  };
  const slide_hash = (s) => {
    let n, m;
    let p;
    let wsize = s.w_size;
    n = s.hash_size;
    p = n;
    do {
      m = s.head[--p];
      s.head[p] = m >= wsize ? m - wsize : 0;
    } while (--n);
    n = wsize;
    p = n;
    do {
      m = s.prev[--p];
      s.prev[p] = m >= wsize ? m - wsize : 0;
    } while (--n);
  };
  let HASH_ZLIB = (s, prev, data) => (prev << s.hash_shift ^ data) & s.hash_mask;
  let HASH = HASH_ZLIB;
  const flush_pending = (strm) => {
    const s = strm.state;
    let len = s.pending;
    if (len > strm.avail_out) {
      len = strm.avail_out;
    }
    if (len === 0) {
      return;
    }
    strm.output.set(s.pending_buf.subarray(s.pending_out, s.pending_out + len), strm.next_out);
    strm.next_out += len;
    s.pending_out += len;
    strm.total_out += len;
    strm.avail_out -= len;
    s.pending -= len;
    if (s.pending === 0) {
      s.pending_out = 0;
    }
  };
  const flush_block_only = (s, last) => {
    _tr_flush_block(s, s.block_start >= 0 ? s.block_start : -1, s.strstart - s.block_start, last);
    s.block_start = s.strstart;
    flush_pending(s.strm);
  };
  const put_byte = (s, b) => {
    s.pending_buf[s.pending++] = b;
  };
  const putShortMSB = (s, b) => {
    s.pending_buf[s.pending++] = b >>> 8 & 255;
    s.pending_buf[s.pending++] = b & 255;
  };
  const read_buf = (strm, buf, start, size) => {
    let len = strm.avail_in;
    if (len > size) {
      len = size;
    }
    if (len === 0) {
      return 0;
    }
    strm.avail_in -= len;
    buf.set(strm.input.subarray(strm.next_in, strm.next_in + len), start);
    if (strm.state.wrap === 1) {
      strm.adler = adler32_1(strm.adler, buf, len, start);
    } else if (strm.state.wrap === 2) {
      strm.adler = crc32_1(strm.adler, buf, len, start);
    }
    strm.next_in += len;
    strm.total_in += len;
    return len;
  };
  const longest_match = (s, cur_match) => {
    let chain_length = s.max_chain_length;
    let scan = s.strstart;
    let match;
    let len;
    let best_len = s.prev_length;
    let nice_match = s.nice_match;
    const limit = s.strstart > s.w_size - MIN_LOOKAHEAD ? s.strstart - (s.w_size - MIN_LOOKAHEAD) : 0;
    const _win = s.window;
    const wmask = s.w_mask;
    const prev = s.prev;
    const strend = s.strstart + MAX_MATCH;
    let scan_end1 = _win[scan + best_len - 1];
    let scan_end = _win[scan + best_len];
    if (s.prev_length >= s.good_match) {
      chain_length >>= 2;
    }
    if (nice_match > s.lookahead) {
      nice_match = s.lookahead;
    }
    do {
      match = cur_match;
      if (_win[match + best_len] !== scan_end || _win[match + best_len - 1] !== scan_end1 || _win[match] !== _win[scan] || _win[++match] !== _win[scan + 1]) {
        continue;
      }
      scan += 2;
      match++;
      do {
      } while (_win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && scan < strend);
      len = MAX_MATCH - (strend - scan);
      scan = strend - MAX_MATCH;
      if (len > best_len) {
        s.match_start = cur_match;
        best_len = len;
        if (len >= nice_match) {
          break;
        }
        scan_end1 = _win[scan + best_len - 1];
        scan_end = _win[scan + best_len];
      }
    } while ((cur_match = prev[cur_match & wmask]) > limit && --chain_length !== 0);
    if (best_len <= s.lookahead) {
      return best_len;
    }
    return s.lookahead;
  };
  const fill_window = (s) => {
    const _w_size = s.w_size;
    let n, more, str;
    do {
      more = s.window_size - s.lookahead - s.strstart;
      if (s.strstart >= _w_size + (_w_size - MIN_LOOKAHEAD)) {
        s.window.set(s.window.subarray(_w_size, _w_size + _w_size - more), 0);
        s.match_start -= _w_size;
        s.strstart -= _w_size;
        s.block_start -= _w_size;
        if (s.insert > s.strstart) {
          s.insert = s.strstart;
        }
        slide_hash(s);
        more += _w_size;
      }
      if (s.strm.avail_in === 0) {
        break;
      }
      n = read_buf(s.strm, s.window, s.strstart + s.lookahead, more);
      s.lookahead += n;
      if (s.lookahead + s.insert >= MIN_MATCH) {
        str = s.strstart - s.insert;
        s.ins_h = s.window[str];
        s.ins_h = HASH(s, s.ins_h, s.window[str + 1]);
        while (s.insert) {
          s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);
          s.prev[str & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = str;
          str++;
          s.insert--;
          if (s.lookahead + s.insert < MIN_MATCH) {
            break;
          }
        }
      }
    } while (s.lookahead < MIN_LOOKAHEAD && s.strm.avail_in !== 0);
  };
  const deflate_stored = (s, flush) => {
    let min_block = s.pending_buf_size - 5 > s.w_size ? s.w_size : s.pending_buf_size - 5;
    let len, left, have, last = 0;
    let used = s.strm.avail_in;
    do {
      len = 65535;
      have = s.bi_valid + 42 >> 3;
      if (s.strm.avail_out < have) {
        break;
      }
      have = s.strm.avail_out - have;
      left = s.strstart - s.block_start;
      if (len > left + s.strm.avail_in) {
        len = left + s.strm.avail_in;
      }
      if (len > have) {
        len = have;
      }
      if (len < min_block && (len === 0 && flush !== Z_FINISH$3 || flush === Z_NO_FLUSH$2 || len !== left + s.strm.avail_in)) {
        break;
      }
      last = flush === Z_FINISH$3 && len === left + s.strm.avail_in ? 1 : 0;
      _tr_stored_block(s, 0, 0, last);
      s.pending_buf[s.pending - 4] = len;
      s.pending_buf[s.pending - 3] = len >> 8;
      s.pending_buf[s.pending - 2] = ~len;
      s.pending_buf[s.pending - 1] = ~len >> 8;
      flush_pending(s.strm);
      if (left) {
        if (left > len) {
          left = len;
        }
        s.strm.output.set(s.window.subarray(s.block_start, s.block_start + left), s.strm.next_out);
        s.strm.next_out += left;
        s.strm.avail_out -= left;
        s.strm.total_out += left;
        s.block_start += left;
        len -= left;
      }
      if (len) {
        read_buf(s.strm, s.strm.output, s.strm.next_out, len);
        s.strm.next_out += len;
        s.strm.avail_out -= len;
        s.strm.total_out += len;
      }
    } while (last === 0);
    used -= s.strm.avail_in;
    if (used) {
      if (used >= s.w_size) {
        s.matches = 2;
        s.window.set(s.strm.input.subarray(s.strm.next_in - s.w_size, s.strm.next_in), 0);
        s.strstart = s.w_size;
        s.insert = s.strstart;
      } else {
        if (s.window_size - s.strstart <= used) {
          s.strstart -= s.w_size;
          s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
          if (s.matches < 2) {
            s.matches++;
          }
          if (s.insert > s.strstart) {
            s.insert = s.strstart;
          }
        }
        s.window.set(s.strm.input.subarray(s.strm.next_in - used, s.strm.next_in), s.strstart);
        s.strstart += used;
        s.insert += used > s.w_size - s.insert ? s.w_size - s.insert : used;
      }
      s.block_start = s.strstart;
    }
    if (s.high_water < s.strstart) {
      s.high_water = s.strstart;
    }
    if (last) {
      return BS_FINISH_DONE;
    }
    if (flush !== Z_NO_FLUSH$2 && flush !== Z_FINISH$3 && s.strm.avail_in === 0 && s.strstart === s.block_start) {
      return BS_BLOCK_DONE;
    }
    have = s.window_size - s.strstart;
    if (s.strm.avail_in > have && s.block_start >= s.w_size) {
      s.block_start -= s.w_size;
      s.strstart -= s.w_size;
      s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
      if (s.matches < 2) {
        s.matches++;
      }
      have += s.w_size;
      if (s.insert > s.strstart) {
        s.insert = s.strstart;
      }
    }
    if (have > s.strm.avail_in) {
      have = s.strm.avail_in;
    }
    if (have) {
      read_buf(s.strm, s.window, s.strstart, have);
      s.strstart += have;
      s.insert += have > s.w_size - s.insert ? s.w_size - s.insert : have;
    }
    if (s.high_water < s.strstart) {
      s.high_water = s.strstart;
    }
    have = s.bi_valid + 42 >> 3;
    have = s.pending_buf_size - have > 65535 ? 65535 : s.pending_buf_size - have;
    min_block = have > s.w_size ? s.w_size : have;
    left = s.strstart - s.block_start;
    if (left >= min_block || (left || flush === Z_FINISH$3) && flush !== Z_NO_FLUSH$2 && s.strm.avail_in === 0 && left <= have) {
      len = left > have ? have : left;
      last = flush === Z_FINISH$3 && s.strm.avail_in === 0 && len === left ? 1 : 0;
      _tr_stored_block(s, s.block_start, len, last);
      s.block_start += len;
      flush_pending(s.strm);
    }
    return last ? BS_FINISH_STARTED : BS_NEED_MORE;
  };
  const deflate_fast = (s, flush) => {
    let hash_head;
    let bflush;
    for (; ; ) {
      if (s.lookahead < MIN_LOOKAHEAD) {
        fill_window(s);
        if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH$2) {
          return BS_NEED_MORE;
        }
        if (s.lookahead === 0) {
          break;
        }
      }
      hash_head = 0;
      if (s.lookahead >= MIN_MATCH) {
        s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
        hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
        s.head[s.ins_h] = s.strstart;
      }
      if (hash_head !== 0 && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) {
        s.match_length = longest_match(s, hash_head);
      }
      if (s.match_length >= MIN_MATCH) {
        bflush = _tr_tally(s, s.strstart - s.match_start, s.match_length - MIN_MATCH);
        s.lookahead -= s.match_length;
        if (s.match_length <= s.max_lazy_match && s.lookahead >= MIN_MATCH) {
          s.match_length--;
          do {
            s.strstart++;
            s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
            hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
            s.head[s.ins_h] = s.strstart;
          } while (--s.match_length !== 0);
          s.strstart++;
        } else {
          s.strstart += s.match_length;
          s.match_length = 0;
          s.ins_h = s.window[s.strstart];
          s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + 1]);
        }
      } else {
        bflush = _tr_tally(s, 0, s.window[s.strstart]);
        s.lookahead--;
        s.strstart++;
      }
      if (bflush) {
        flush_block_only(s, false);
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
      }
    }
    s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
    if (flush === Z_FINISH$3) {
      flush_block_only(s, true);
      if (s.strm.avail_out === 0) {
        return BS_FINISH_STARTED;
      }
      return BS_FINISH_DONE;
    }
    if (s.sym_next) {
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
    }
    return BS_BLOCK_DONE;
  };
  const deflate_slow = (s, flush) => {
    let hash_head;
    let bflush;
    let max_insert;
    for (; ; ) {
      if (s.lookahead < MIN_LOOKAHEAD) {
        fill_window(s);
        if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH$2) {
          return BS_NEED_MORE;
        }
        if (s.lookahead === 0) {
          break;
        }
      }
      hash_head = 0;
      if (s.lookahead >= MIN_MATCH) {
        s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
        hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
        s.head[s.ins_h] = s.strstart;
      }
      s.prev_length = s.match_length;
      s.prev_match = s.match_start;
      s.match_length = MIN_MATCH - 1;
      if (hash_head !== 0 && s.prev_length < s.max_lazy_match && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) {
        s.match_length = longest_match(s, hash_head);
        if (s.match_length <= 5 && (s.strategy === Z_FILTERED || s.match_length === MIN_MATCH && s.strstart - s.match_start > 4096)) {
          s.match_length = MIN_MATCH - 1;
        }
      }
      if (s.prev_length >= MIN_MATCH && s.match_length <= s.prev_length) {
        max_insert = s.strstart + s.lookahead - MIN_MATCH;
        bflush = _tr_tally(s, s.strstart - 1 - s.prev_match, s.prev_length - MIN_MATCH);
        s.lookahead -= s.prev_length - 1;
        s.prev_length -= 2;
        do {
          if (++s.strstart <= max_insert) {
            s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
            hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
            s.head[s.ins_h] = s.strstart;
          }
        } while (--s.prev_length !== 0);
        s.match_available = 0;
        s.match_length = MIN_MATCH - 1;
        s.strstart++;
        if (bflush) {
          flush_block_only(s, false);
          if (s.strm.avail_out === 0) {
            return BS_NEED_MORE;
          }
        }
      } else if (s.match_available) {
        bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);
        if (bflush) {
          flush_block_only(s, false);
        }
        s.strstart++;
        s.lookahead--;
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
      } else {
        s.match_available = 1;
        s.strstart++;
        s.lookahead--;
      }
    }
    if (s.match_available) {
      bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);
      s.match_available = 0;
    }
    s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
    if (flush === Z_FINISH$3) {
      flush_block_only(s, true);
      if (s.strm.avail_out === 0) {
        return BS_FINISH_STARTED;
      }
      return BS_FINISH_DONE;
    }
    if (s.sym_next) {
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
    }
    return BS_BLOCK_DONE;
  };
  const deflate_rle = (s, flush) => {
    let bflush;
    let prev;
    let scan, strend;
    const _win = s.window;
    for (; ; ) {
      if (s.lookahead <= MAX_MATCH) {
        fill_window(s);
        if (s.lookahead <= MAX_MATCH && flush === Z_NO_FLUSH$2) {
          return BS_NEED_MORE;
        }
        if (s.lookahead === 0) {
          break;
        }
      }
      s.match_length = 0;
      if (s.lookahead >= MIN_MATCH && s.strstart > 0) {
        scan = s.strstart - 1;
        prev = _win[scan];
        if (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan]) {
          strend = s.strstart + MAX_MATCH;
          do {
          } while (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && scan < strend);
          s.match_length = MAX_MATCH - (strend - scan);
          if (s.match_length > s.lookahead) {
            s.match_length = s.lookahead;
          }
        }
      }
      if (s.match_length >= MIN_MATCH) {
        bflush = _tr_tally(s, 1, s.match_length - MIN_MATCH);
        s.lookahead -= s.match_length;
        s.strstart += s.match_length;
        s.match_length = 0;
      } else {
        bflush = _tr_tally(s, 0, s.window[s.strstart]);
        s.lookahead--;
        s.strstart++;
      }
      if (bflush) {
        flush_block_only(s, false);
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
      }
    }
    s.insert = 0;
    if (flush === Z_FINISH$3) {
      flush_block_only(s, true);
      if (s.strm.avail_out === 0) {
        return BS_FINISH_STARTED;
      }
      return BS_FINISH_DONE;
    }
    if (s.sym_next) {
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
    }
    return BS_BLOCK_DONE;
  };
  const deflate_huff = (s, flush) => {
    let bflush;
    for (; ; ) {
      if (s.lookahead === 0) {
        fill_window(s);
        if (s.lookahead === 0) {
          if (flush === Z_NO_FLUSH$2) {
            return BS_NEED_MORE;
          }
          break;
        }
      }
      s.match_length = 0;
      bflush = _tr_tally(s, 0, s.window[s.strstart]);
      s.lookahead--;
      s.strstart++;
      if (bflush) {
        flush_block_only(s, false);
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
      }
    }
    s.insert = 0;
    if (flush === Z_FINISH$3) {
      flush_block_only(s, true);
      if (s.strm.avail_out === 0) {
        return BS_FINISH_STARTED;
      }
      return BS_FINISH_DONE;
    }
    if (s.sym_next) {
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
    }
    return BS_BLOCK_DONE;
  };
  function Config(good_length, max_lazy, nice_length, max_chain, func) {
    this.good_length = good_length;
    this.max_lazy = max_lazy;
    this.nice_length = nice_length;
    this.max_chain = max_chain;
    this.func = func;
  }
  const configuration_table = [
 /* good lazy nice chain */
    new Config(0, 0, 0, 0, deflate_stored),
 /* 0 store only */
    new Config(4, 4, 8, 4, deflate_fast),
 /* 1 max speed, no lazy matches */
    new Config(4, 5, 16, 8, deflate_fast),
 /* 2 */
    new Config(4, 6, 32, 32, deflate_fast),
 /* 3 */
    new Config(4, 4, 16, 16, deflate_slow),
 /* 4 lazy matches */
    new Config(8, 16, 32, 32, deflate_slow),
 /* 5 */
    new Config(8, 16, 128, 128, deflate_slow),
 /* 6 */
    new Config(8, 32, 128, 256, deflate_slow),
 /* 7 */
    new Config(32, 128, 258, 1024, deflate_slow),
 /* 8 */
    new Config(32, 258, 258, 4096, deflate_slow)
 /* 9 max compression */
  ];
  const lm_init = (s) => {
    s.window_size = 2 * s.w_size;
    zero(s.head);
    s.max_lazy_match = configuration_table[s.level].max_lazy;
    s.good_match = configuration_table[s.level].good_length;
    s.nice_match = configuration_table[s.level].nice_length;
    s.max_chain_length = configuration_table[s.level].max_chain;
    s.strstart = 0;
    s.block_start = 0;
    s.lookahead = 0;
    s.insert = 0;
    s.match_length = s.prev_length = MIN_MATCH - 1;
    s.match_available = 0;
    s.ins_h = 0;
  };
  function DeflateState() {
    this.strm = null;
    this.status = 0;
    this.pending_buf = null;
    this.pending_buf_size = 0;
    this.pending_out = 0;
    this.pending = 0;
    this.wrap = 0;
    this.gzhead = null;
    this.gzindex = 0;
    this.method = Z_DEFLATED$2;
    this.last_flush = -1;
    this.w_size = 0;
    this.w_bits = 0;
    this.w_mask = 0;
    this.window = null;
    this.window_size = 0;
    this.prev = null;
    this.head = null;
    this.ins_h = 0;
    this.hash_size = 0;
    this.hash_bits = 0;
    this.hash_mask = 0;
    this.hash_shift = 0;
    this.block_start = 0;
    this.match_length = 0;
    this.prev_match = 0;
    this.match_available = 0;
    this.strstart = 0;
    this.match_start = 0;
    this.lookahead = 0;
    this.prev_length = 0;
    this.max_chain_length = 0;
    this.max_lazy_match = 0;
    this.level = 0;
    this.strategy = 0;
    this.good_match = 0;
    this.nice_match = 0;
    this.dyn_ltree = new Uint16Array(HEAP_SIZE * 2);
    this.dyn_dtree = new Uint16Array((2 * D_CODES + 1) * 2);
    this.bl_tree = new Uint16Array((2 * BL_CODES + 1) * 2);
    zero(this.dyn_ltree);
    zero(this.dyn_dtree);
    zero(this.bl_tree);
    this.l_desc = null;
    this.d_desc = null;
    this.bl_desc = null;
    this.bl_count = new Uint16Array(MAX_BITS + 1);
    this.heap = new Uint16Array(2 * L_CODES + 1);
    zero(this.heap);
    this.heap_len = 0;
    this.heap_max = 0;
    this.depth = new Uint16Array(2 * L_CODES + 1);
    zero(this.depth);
    this.sym_buf = 0;
    this.lit_bufsize = 0;
    this.sym_next = 0;
    this.sym_end = 0;
    this.opt_len = 0;
    this.static_len = 0;
    this.matches = 0;
    this.insert = 0;
    this.bi_buf = 0;
    this.bi_valid = 0;
  }
  const deflateStateCheck = (strm) => {
    if (!strm) {
      return 1;
    }
    const s = strm.state;
    if (!s || s.strm !== strm || s.status !== INIT_STATE && //#ifdef GZIP
    s.status !== GZIP_STATE && //#endif
    s.status !== EXTRA_STATE && s.status !== NAME_STATE && s.status !== COMMENT_STATE && s.status !== HCRC_STATE && s.status !== BUSY_STATE && s.status !== FINISH_STATE) {
      return 1;
    }
    return 0;
  };
  const deflateResetKeep = (strm) => {
    if (deflateStateCheck(strm)) {
      return err(strm, Z_STREAM_ERROR$2);
    }
    strm.total_in = strm.total_out = 0;
    strm.data_type = Z_UNKNOWN;
    const s = strm.state;
    s.pending = 0;
    s.pending_out = 0;
    if (s.wrap < 0) {
      s.wrap = -s.wrap;
    }
    s.status = //#ifdef GZIP
    s.wrap === 2 ? GZIP_STATE : (
 //#endif
      s.wrap ? INIT_STATE : BUSY_STATE
    );
    strm.adler = s.wrap === 2 ? 0 : 1;
    s.last_flush = -2;
    _tr_init(s);
    return Z_OK$3;
  };
  const deflateReset = (strm) => {
    const ret = deflateResetKeep(strm);
    if (ret === Z_OK$3) {
      lm_init(strm.state);
    }
    return ret;
  };
  const deflateSetHeader = (strm, head) => {
    if (deflateStateCheck(strm) || strm.state.wrap !== 2) {
      return Z_STREAM_ERROR$2;
    }
    strm.state.gzhead = head;
    return Z_OK$3;
  };
  const deflateInit2 = (strm, level, method, windowBits, memLevel, strategy) => {
    if (!strm) {
      return Z_STREAM_ERROR$2;
    }
    let wrap = 1;
    if (level === Z_DEFAULT_COMPRESSION$1) {
      level = 6;
    }
    if (windowBits < 0) {
      wrap = 0;
      windowBits = -windowBits;
    } else if (windowBits > 15) {
      wrap = 2;
      windowBits -= 16;
    }
    if (memLevel < 1 || memLevel > MAX_MEM_LEVEL || method !== Z_DEFLATED$2 || windowBits < 8 || windowBits > 15 || level < 0 || level > 9 || strategy < 0 || strategy > Z_FIXED || windowBits === 8 && wrap !== 1) {
      return err(strm, Z_STREAM_ERROR$2);
    }
    if (windowBits === 8) {
      windowBits = 9;
    }
    const s = new DeflateState();
    strm.state = s;
    s.strm = strm;
    s.status = INIT_STATE;
    s.wrap = wrap;
    s.gzhead = null;
    s.w_bits = windowBits;
    s.w_size = 1 << s.w_bits;
    s.w_mask = s.w_size - 1;
    s.hash_bits = memLevel + 7;
    s.hash_size = 1 << s.hash_bits;
    s.hash_mask = s.hash_size - 1;
    s.hash_shift = ~~((s.hash_bits + MIN_MATCH - 1) / MIN_MATCH);
    s.window = new Uint8Array(s.w_size * 2);
    s.head = new Uint16Array(s.hash_size);
    s.prev = new Uint16Array(s.w_size);
    s.lit_bufsize = 1 << memLevel + 6;
    s.pending_buf_size = s.lit_bufsize * 4;
    s.pending_buf = new Uint8Array(s.pending_buf_size);
    s.sym_buf = s.lit_bufsize;
    s.sym_end = (s.lit_bufsize - 1) * 3;
    s.level = level;
    s.strategy = strategy;
    s.method = method;
    return deflateReset(strm);
  };
  const deflateInit = (strm, level) => {
    return deflateInit2(strm, level, Z_DEFLATED$2, MAX_WBITS$1, DEF_MEM_LEVEL, Z_DEFAULT_STRATEGY$1);
  };
  const deflate$2 = (strm, flush) => {
    if (deflateStateCheck(strm) || flush > Z_BLOCK$1 || flush < 0) {
      return strm ? err(strm, Z_STREAM_ERROR$2) : Z_STREAM_ERROR$2;
    }
    const s = strm.state;
    if (!strm.output || strm.avail_in !== 0 && !strm.input || s.status === FINISH_STATE && flush !== Z_FINISH$3) {
      return err(strm, strm.avail_out === 0 ? Z_BUF_ERROR$1 : Z_STREAM_ERROR$2);
    }
    const old_flush = s.last_flush;
    s.last_flush = flush;
    if (s.pending !== 0) {
      flush_pending(strm);
      if (strm.avail_out === 0) {
        s.last_flush = -1;
        return Z_OK$3;
      }
    } else if (strm.avail_in === 0 && rank(flush) <= rank(old_flush) && flush !== Z_FINISH$3) {
      return err(strm, Z_BUF_ERROR$1);
    }
    if (s.status === FINISH_STATE && strm.avail_in !== 0) {
      return err(strm, Z_BUF_ERROR$1);
    }
    if (s.status === INIT_STATE && s.wrap === 0) {
      s.status = BUSY_STATE;
    }
    if (s.status === INIT_STATE) {
      let header = Z_DEFLATED$2 + (s.w_bits - 8 << 4) << 8;
      let level_flags = -1;
      if (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2) {
        level_flags = 0;
      } else if (s.level < 6) {
        level_flags = 1;
      } else if (s.level === 6) {
        level_flags = 2;
      } else {
        level_flags = 3;
      }
      header |= level_flags << 6;
      if (s.strstart !== 0) {
        header |= PRESET_DICT;
      }
      header += 31 - header % 31;
      putShortMSB(s, header);
      if (s.strstart !== 0) {
        putShortMSB(s, strm.adler >>> 16);
        putShortMSB(s, strm.adler & 65535);
      }
      strm.adler = 1;
      s.status = BUSY_STATE;
      flush_pending(strm);
      if (s.pending !== 0) {
        s.last_flush = -1;
        return Z_OK$3;
      }
    }
    if (s.status === GZIP_STATE) {
      strm.adler = 0;
      put_byte(s, 31);
      put_byte(s, 139);
      put_byte(s, 8);
      if (!s.gzhead) {
        put_byte(s, 0);
        put_byte(s, 0);
        put_byte(s, 0);
        put_byte(s, 0);
        put_byte(s, 0);
        put_byte(s, s.level === 9 ? 2 : s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ? 4 : 0);
        put_byte(s, OS_CODE);
        s.status = BUSY_STATE;
        flush_pending(strm);
        if (s.pending !== 0) {
          s.last_flush = -1;
          return Z_OK$3;
        }
      } else {
        put_byte(
          s,
          (s.gzhead.text ? 1 : 0) + (s.gzhead.hcrc ? 2 : 0) + (!s.gzhead.extra ? 0 : 4) + (!s.gzhead.name ? 0 : 8) + (!s.gzhead.comment ? 0 : 16)
        );
        put_byte(s, s.gzhead.time & 255);
        put_byte(s, s.gzhead.time >> 8 & 255);
        put_byte(s, s.gzhead.time >> 16 & 255);
        put_byte(s, s.gzhead.time >> 24 & 255);
        put_byte(s, s.level === 9 ? 2 : s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ? 4 : 0);
        put_byte(s, s.gzhead.os & 255);
        if (s.gzhead.extra && s.gzhead.extra.length) {
          put_byte(s, s.gzhead.extra.length & 255);
          put_byte(s, s.gzhead.extra.length >> 8 & 255);
        }
        if (s.gzhead.hcrc) {
          strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending, 0);
        }
        s.gzindex = 0;
        s.status = EXTRA_STATE;
      }
    }
    if (s.status === EXTRA_STATE) {
      if (s.gzhead.extra) {
        let beg = s.pending;
        let left = (s.gzhead.extra.length & 65535) - s.gzindex;
        while (s.pending + left > s.pending_buf_size) {
          let copy = s.pending_buf_size - s.pending;
          s.pending_buf.set(s.gzhead.extra.subarray(s.gzindex, s.gzindex + copy), s.pending);
          s.pending = s.pending_buf_size;
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          s.gzindex += copy;
          flush_pending(strm);
          if (s.pending !== 0) {
            s.last_flush = -1;
            return Z_OK$3;
          }
          beg = 0;
          left -= copy;
        }
        let gzhead_extra = new Uint8Array(s.gzhead.extra);
        s.pending_buf.set(gzhead_extra.subarray(s.gzindex, s.gzindex + left), s.pending);
        s.pending += left;
        if (s.gzhead.hcrc && s.pending > beg) {
          strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
        }
        s.gzindex = 0;
      }
      s.status = NAME_STATE;
    }
    if (s.status === NAME_STATE) {
      if (s.gzhead.name) {
        let beg = s.pending;
        let val;
        do {
          if (s.pending === s.pending_buf_size) {
            if (s.gzhead.hcrc && s.pending > beg) {
              strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
            }
            flush_pending(strm);
            if (s.pending !== 0) {
              s.last_flush = -1;
              return Z_OK$3;
            }
            beg = 0;
          }
          if (s.gzindex < s.gzhead.name.length) {
            val = s.gzhead.name.charCodeAt(s.gzindex++) & 255;
          } else {
            val = 0;
          }
          put_byte(s, val);
        } while (val !== 0);
        if (s.gzhead.hcrc && s.pending > beg) {
          strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
        }
        s.gzindex = 0;
      }
      s.status = COMMENT_STATE;
    }
    if (s.status === COMMENT_STATE) {
      if (s.gzhead.comment) {
        let beg = s.pending;
        let val;
        do {
          if (s.pending === s.pending_buf_size) {
            if (s.gzhead.hcrc && s.pending > beg) {
              strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
            }
            flush_pending(strm);
            if (s.pending !== 0) {
              s.last_flush = -1;
              return Z_OK$3;
            }
            beg = 0;
          }
          if (s.gzindex < s.gzhead.comment.length) {
            val = s.gzhead.comment.charCodeAt(s.gzindex++) & 255;
          } else {
            val = 0;
          }
          put_byte(s, val);
        } while (val !== 0);
        if (s.gzhead.hcrc && s.pending > beg) {
          strm.adler = crc32_1(strm.adler, s.pending_buf, s.pending - beg, beg);
        }
      }
      s.status = HCRC_STATE;
    }
    if (s.status === HCRC_STATE) {
      if (s.gzhead.hcrc) {
        if (s.pending + 2 > s.pending_buf_size) {
          flush_pending(strm);
          if (s.pending !== 0) {
            s.last_flush = -1;
            return Z_OK$3;
          }
        }
        put_byte(s, strm.adler & 255);
        put_byte(s, strm.adler >> 8 & 255);
        strm.adler = 0;
      }
      s.status = BUSY_STATE;
      flush_pending(strm);
      if (s.pending !== 0) {
        s.last_flush = -1;
        return Z_OK$3;
      }
    }
    if (strm.avail_in !== 0 || s.lookahead !== 0 || flush !== Z_NO_FLUSH$2 && s.status !== FINISH_STATE) {
      let bstate = s.level === 0 ? deflate_stored(s, flush) : s.strategy === Z_HUFFMAN_ONLY ? deflate_huff(s, flush) : s.strategy === Z_RLE ? deflate_rle(s, flush) : configuration_table[s.level].func(s, flush);
      if (bstate === BS_FINISH_STARTED || bstate === BS_FINISH_DONE) {
        s.status = FINISH_STATE;
      }
      if (bstate === BS_NEED_MORE || bstate === BS_FINISH_STARTED) {
        if (strm.avail_out === 0) {
          s.last_flush = -1;
        }
        return Z_OK$3;
      }
      if (bstate === BS_BLOCK_DONE) {
        if (flush === Z_PARTIAL_FLUSH) {
          _tr_align(s);
        } else if (flush !== Z_BLOCK$1) {
          _tr_stored_block(s, 0, 0, false);
          if (flush === Z_FULL_FLUSH$1) {
            zero(s.head);
            if (s.lookahead === 0) {
              s.strstart = 0;
              s.block_start = 0;
              s.insert = 0;
            }
          }
        }
        flush_pending(strm);
        if (strm.avail_out === 0) {
          s.last_flush = -1;
          return Z_OK$3;
        }
      }
    }
    if (flush !== Z_FINISH$3) {
      return Z_OK$3;
    }
    if (s.wrap <= 0) {
      return Z_STREAM_END$3;
    }
    if (s.wrap === 2) {
      put_byte(s, strm.adler & 255);
      put_byte(s, strm.adler >> 8 & 255);
      put_byte(s, strm.adler >> 16 & 255);
      put_byte(s, strm.adler >> 24 & 255);
      put_byte(s, strm.total_in & 255);
      put_byte(s, strm.total_in >> 8 & 255);
      put_byte(s, strm.total_in >> 16 & 255);
      put_byte(s, strm.total_in >> 24 & 255);
    } else {
      putShortMSB(s, strm.adler >>> 16);
      putShortMSB(s, strm.adler & 65535);
    }
    flush_pending(strm);
    if (s.wrap > 0) {
      s.wrap = -s.wrap;
    }
    return s.pending !== 0 ? Z_OK$3 : Z_STREAM_END$3;
  };
  const deflateEnd = (strm) => {
    if (deflateStateCheck(strm)) {
      return Z_STREAM_ERROR$2;
    }
    const status = strm.state.status;
    strm.state = null;
    return status === BUSY_STATE ? err(strm, Z_DATA_ERROR$2) : Z_OK$3;
  };
  const deflateSetDictionary = (strm, dictionary) => {
    let dictLength = dictionary.length;
    if (deflateStateCheck(strm)) {
      return Z_STREAM_ERROR$2;
    }
    const s = strm.state;
    const wrap = s.wrap;
    if (wrap === 2 || wrap === 1 && s.status !== INIT_STATE || s.lookahead) {
      return Z_STREAM_ERROR$2;
    }
    if (wrap === 1) {
      strm.adler = adler32_1(strm.adler, dictionary, dictLength, 0);
    }
    s.wrap = 0;
    if (dictLength >= s.w_size) {
      if (wrap === 0) {
        zero(s.head);
        s.strstart = 0;
        s.block_start = 0;
        s.insert = 0;
      }
      let tmpDict = new Uint8Array(s.w_size);
      tmpDict.set(dictionary.subarray(dictLength - s.w_size, dictLength), 0);
      dictionary = tmpDict;
      dictLength = s.w_size;
    }
    const avail = strm.avail_in;
    const next = strm.next_in;
    const input = strm.input;
    strm.avail_in = dictLength;
    strm.next_in = 0;
    strm.input = dictionary;
    fill_window(s);
    while (s.lookahead >= MIN_MATCH) {
      let str = s.strstart;
      let n = s.lookahead - (MIN_MATCH - 1);
      do {
        s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);
        s.prev[str & s.w_mask] = s.head[s.ins_h];
        s.head[s.ins_h] = str;
        str++;
      } while (--n);
      s.strstart = str;
      s.lookahead = MIN_MATCH - 1;
      fill_window(s);
    }
    s.strstart += s.lookahead;
    s.block_start = s.strstart;
    s.insert = s.lookahead;
    s.lookahead = 0;
    s.match_length = s.prev_length = MIN_MATCH - 1;
    s.match_available = 0;
    strm.next_in = next;
    strm.input = input;
    strm.avail_in = avail;
    s.wrap = wrap;
    return Z_OK$3;
  };
  var deflateInit_1 = deflateInit;
  var deflateInit2_1 = deflateInit2;
  var deflateReset_1 = deflateReset;
  var deflateResetKeep_1 = deflateResetKeep;
  var deflateSetHeader_1 = deflateSetHeader;
  var deflate_2$1 = deflate$2;
  var deflateEnd_1 = deflateEnd;
  var deflateSetDictionary_1 = deflateSetDictionary;
  var deflateInfo = "pako deflate (from Nodeca project)";
  var deflate_1$2 = {
    deflateInit: deflateInit_1,
    deflateInit2: deflateInit2_1,
    deflateReset: deflateReset_1,
    deflateResetKeep: deflateResetKeep_1,
    deflateSetHeader: deflateSetHeader_1,
    deflate: deflate_2$1,
    deflateEnd: deflateEnd_1,
    deflateSetDictionary: deflateSetDictionary_1,
    deflateInfo
  };
  const _has = (obj, key) => {
    return Object.prototype.hasOwnProperty.call(obj, key);
  };
  var assign = function(obj) {
    const sources = Array.prototype.slice.call(arguments, 1);
    while (sources.length) {
      const source = sources.shift();
      if (!source) {
        continue;
      }
      if (typeof source !== "object") {
        throw new TypeError(source + "must be non-object");
      }
      for (const p in source) {
        if (_has(source, p)) {
          obj[p] = source[p];
        }
      }
    }
    return obj;
  };
  var flattenChunks = (chunks) => {
    let len = 0;
    for (let i = 0, l = chunks.length; i < l; i++) {
      len += chunks[i].length;
    }
    const result = new Uint8Array(len);
    for (let i = 0, pos = 0, l = chunks.length; i < l; i++) {
      let chunk = chunks[i];
      result.set(chunk, pos);
      pos += chunk.length;
    }
    return result;
  };
  var common = {
    assign,
    flattenChunks
  };
  let STR_APPLY_UIA_OK = true;
  try {
    String.fromCharCode.apply(null, new Uint8Array(1));
  } catch (__) {
    STR_APPLY_UIA_OK = false;
  }
  const _utf8len = new Uint8Array(256);
  for (let q = 0; q < 256; q++) {
    _utf8len[q] = q >= 252 ? 6 : q >= 248 ? 5 : q >= 240 ? 4 : q >= 224 ? 3 : q >= 192 ? 2 : 1;
  }
  _utf8len[254] = _utf8len[254] = 1;
  var string2buf = (str) => {
    if (typeof TextEncoder === "function" && TextEncoder.prototype.encode) {
      return new TextEncoder().encode(str);
    }
    let buf, c, c2, m_pos, i, str_len = str.length, buf_len = 0;
    for (m_pos = 0; m_pos < str_len; m_pos++) {
      c = str.charCodeAt(m_pos);
      if ((c & 64512) === 55296 && m_pos + 1 < str_len) {
        c2 = str.charCodeAt(m_pos + 1);
        if ((c2 & 64512) === 56320) {
          c = 65536 + (c - 55296 << 10) + (c2 - 56320);
          m_pos++;
        }
      }
      buf_len += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4;
    }
    buf = new Uint8Array(buf_len);
    for (i = 0, m_pos = 0; i < buf_len; m_pos++) {
      c = str.charCodeAt(m_pos);
      if ((c & 64512) === 55296 && m_pos + 1 < str_len) {
        c2 = str.charCodeAt(m_pos + 1);
        if ((c2 & 64512) === 56320) {
          c = 65536 + (c - 55296 << 10) + (c2 - 56320);
          m_pos++;
        }
      }
      if (c < 128) {
        buf[i++] = c;
      } else if (c < 2048) {
        buf[i++] = 192 | c >>> 6;
        buf[i++] = 128 | c & 63;
      } else if (c < 65536) {
        buf[i++] = 224 | c >>> 12;
        buf[i++] = 128 | c >>> 6 & 63;
        buf[i++] = 128 | c & 63;
      } else {
        buf[i++] = 240 | c >>> 18;
        buf[i++] = 128 | c >>> 12 & 63;
        buf[i++] = 128 | c >>> 6 & 63;
        buf[i++] = 128 | c & 63;
      }
    }
    return buf;
  };
  const buf2binstring = (buf, len) => {
    if (len < 65534) {
      if (buf.subarray && STR_APPLY_UIA_OK) {
        return String.fromCharCode.apply(null, buf.length === len ? buf : buf.subarray(0, len));
      }
    }
    let result = "";
    for (let i = 0; i < len; i++) {
      result += String.fromCharCode(buf[i]);
    }
    return result;
  };
  var buf2string = (buf, max) => {
    const len = max || buf.length;
    if (typeof TextDecoder === "function" && TextDecoder.prototype.decode) {
      return new TextDecoder().decode(buf.subarray(0, max));
    }
    let i, out;
    const utf16buf = new Array(len * 2);
    for (out = 0, i = 0; i < len; ) {
      let c = buf[i++];
      if (c < 128) {
        utf16buf[out++] = c;
        continue;
      }
      let c_len = _utf8len[c];
      if (c_len > 4) {
        utf16buf[out++] = 65533;
        i += c_len - 1;
        continue;
      }
      c &= c_len === 2 ? 31 : c_len === 3 ? 15 : 7;
      while (c_len > 1 && i < len) {
        c = c << 6 | buf[i++] & 63;
        c_len--;
      }
      if (c_len > 1) {
        utf16buf[out++] = 65533;
        continue;
      }
      if (c < 65536) {
        utf16buf[out++] = c;
      } else {
        c -= 65536;
        utf16buf[out++] = 55296 | c >> 10 & 1023;
        utf16buf[out++] = 56320 | c & 1023;
      }
    }
    return buf2binstring(utf16buf, out);
  };
  var utf8border = (buf, max) => {
    max = max || buf.length;
    if (max > buf.length) {
      max = buf.length;
    }
    let pos = max - 1;
    while (pos >= 0 && (buf[pos] & 192) === 128) {
      pos--;
    }
    if (pos < 0) {
      return max;
    }
    if (pos === 0) {
      return max;
    }
    return pos + _utf8len[buf[pos]] > max ? pos : max;
  };
  var strings = {
    string2buf,
    buf2string,
    utf8border
  };
  function ZStream() {
    this.input = null;
    this.next_in = 0;
    this.avail_in = 0;
    this.total_in = 0;
    this.output = null;
    this.next_out = 0;
    this.avail_out = 0;
    this.total_out = 0;
    this.msg = "";
    this.state = null;
    this.data_type = 2;
    this.adler = 0;
  }
  var zstream = ZStream;
  const toString$1 = Object.prototype.toString;
  const {
    Z_NO_FLUSH: Z_NO_FLUSH$1,
    Z_SYNC_FLUSH,
    Z_FULL_FLUSH,
    Z_FINISH: Z_FINISH$2,
    Z_OK: Z_OK$2,
    Z_STREAM_END: Z_STREAM_END$2,
    Z_DEFAULT_COMPRESSION,
    Z_DEFAULT_STRATEGY,
    Z_DEFLATED: Z_DEFLATED$1
  } = constants$2;
  function Deflate$1(options) {
    this.options = common.assign({
      level: Z_DEFAULT_COMPRESSION,
      method: Z_DEFLATED$1,
      chunkSize: 16384,
      windowBits: 15,
      memLevel: 8,
      strategy: Z_DEFAULT_STRATEGY
    }, options || {});
    let opt = this.options;
    if (opt.raw && opt.windowBits > 0) {
      opt.windowBits = -opt.windowBits;
    } else if (opt.gzip && opt.windowBits > 0 && opt.windowBits < 16) {
      opt.windowBits += 16;
    }
    this.err = 0;
    this.msg = "";
    this.ended = false;
    this.chunks = [];
    this.strm = new zstream();
    this.strm.avail_out = 0;
    let status = deflate_1$2.deflateInit2(
      this.strm,
      opt.level,
      opt.method,
      opt.windowBits,
      opt.memLevel,
      opt.strategy
    );
    if (status !== Z_OK$2) {
      throw new Error(messages[status]);
    }
    if (opt.header) {
      deflate_1$2.deflateSetHeader(this.strm, opt.header);
    }
    if (opt.dictionary) {
      let dict;
      if (typeof opt.dictionary === "string") {
        dict = strings.string2buf(opt.dictionary);
      } else if (toString$1.call(opt.dictionary) === "[object ArrayBuffer]") {
        dict = new Uint8Array(opt.dictionary);
      } else {
        dict = opt.dictionary;
      }
      status = deflate_1$2.deflateSetDictionary(this.strm, dict);
      if (status !== Z_OK$2) {
        throw new Error(messages[status]);
      }
      this._dict_set = true;
    }
  }
  Deflate$1.prototype.push = function(data, flush_mode) {
    const strm = this.strm;
    const chunkSize = this.options.chunkSize;
    let status, _flush_mode;
    if (this.ended) {
      return false;
    }
    if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
    else _flush_mode = flush_mode === true ? Z_FINISH$2 : Z_NO_FLUSH$1;
    if (typeof data === "string") {
      strm.input = strings.string2buf(data);
    } else if (toString$1.call(data) === "[object ArrayBuffer]") {
      strm.input = new Uint8Array(data);
    } else {
      strm.input = data;
    }
    strm.next_in = 0;
    strm.avail_in = strm.input.length;
    for (; ; ) {
      if (strm.avail_out === 0) {
        strm.output = new Uint8Array(chunkSize);
        strm.next_out = 0;
        strm.avail_out = chunkSize;
      }
      if ((_flush_mode === Z_SYNC_FLUSH || _flush_mode === Z_FULL_FLUSH) && strm.avail_out <= 6) {
        this.onData(strm.output.subarray(0, strm.next_out));
        strm.avail_out = 0;
        continue;
      }
      status = deflate_1$2.deflate(strm, _flush_mode);
      if (status === Z_STREAM_END$2) {
        if (strm.next_out > 0) {
          this.onData(strm.output.subarray(0, strm.next_out));
        }
        status = deflate_1$2.deflateEnd(this.strm);
        this.onEnd(status);
        this.ended = true;
        return status === Z_OK$2;
      }
      if (strm.avail_out === 0) {
        this.onData(strm.output);
        continue;
      }
      if (_flush_mode > 0 && strm.next_out > 0) {
        this.onData(strm.output.subarray(0, strm.next_out));
        strm.avail_out = 0;
        continue;
      }
      if (strm.avail_in === 0) break;
    }
    return true;
  };
  Deflate$1.prototype.onData = function(chunk) {
    this.chunks.push(chunk);
  };
  Deflate$1.prototype.onEnd = function(status) {
    if (status === Z_OK$2) {
      this.result = common.flattenChunks(this.chunks);
    }
    this.chunks = [];
    this.err = status;
    this.msg = this.strm.msg;
  };
  function deflate$1(input, options) {
    const deflator = new Deflate$1(options);
    deflator.push(input, true);
    if (deflator.err) {
      throw deflator.msg || messages[deflator.err];
    }
    return deflator.result;
  }
  function deflateRaw$1(input, options) {
    options = options || {};
    options.raw = true;
    return deflate$1(input, options);
  }
  function gzip$1(input, options) {
    options = options || {};
    options.gzip = true;
    return deflate$1(input, options);
  }
  var Deflate_1$1 = Deflate$1;
  var deflate_2 = deflate$1;
  var deflateRaw_1$1 = deflateRaw$1;
  var gzip_1$1 = gzip$1;
  var constants$1 = constants$2;
  var deflate_1$1 = {
    Deflate: Deflate_1$1,
    deflate: deflate_2,
    deflateRaw: deflateRaw_1$1,
    gzip: gzip_1$1,
    constants: constants$1
  };
  const BAD$1 = 16209;
  const TYPE$1 = 16191;
  var inffast = function inflate_fast(strm, start) {
    let _in;
    let last;
    let _out;
    let beg;
    let end;
    let dmax;
    let wsize;
    let whave;
    let wnext;
    let s_window;
    let hold;
    let bits;
    let lcode;
    let dcode;
    let lmask;
    let dmask;
    let here;
    let op;
    let len;
    let dist;
    let from;
    let from_source;
    let input, output;
    const state = strm.state;
    _in = strm.next_in;
    input = strm.input;
    last = _in + (strm.avail_in - 5);
    _out = strm.next_out;
    output = strm.output;
    beg = _out - (start - strm.avail_out);
    end = _out + (strm.avail_out - 257);
    dmax = state.dmax;
    wsize = state.wsize;
    whave = state.whave;
    wnext = state.wnext;
    s_window = state.window;
    hold = state.hold;
    bits = state.bits;
    lcode = state.lencode;
    dcode = state.distcode;
    lmask = (1 << state.lenbits) - 1;
    dmask = (1 << state.distbits) - 1;
    top:
      do {
        if (bits < 15) {
          hold += input[_in++] << bits;
          bits += 8;
          hold += input[_in++] << bits;
          bits += 8;
        }
        here = lcode[hold & lmask];
        dolen:
          for (; ; ) {
            op = here >>> 24;
            hold >>>= op;
            bits -= op;
            op = here >>> 16 & 255;
            if (op === 0) {
              output[_out++] = here & 65535;
            } else if (op & 16) {
              len = here & 65535;
              op &= 15;
              if (op) {
                if (bits < op) {
                  hold += input[_in++] << bits;
                  bits += 8;
                }
                len += hold & (1 << op) - 1;
                hold >>>= op;
                bits -= op;
              }
              if (bits < 15) {
                hold += input[_in++] << bits;
                bits += 8;
                hold += input[_in++] << bits;
                bits += 8;
              }
              here = dcode[hold & dmask];
              dodist:
                for (; ; ) {
                  op = here >>> 24;
                  hold >>>= op;
                  bits -= op;
                  op = here >>> 16 & 255;
                  if (op & 16) {
                    dist = here & 65535;
                    op &= 15;
                    if (bits < op) {
                      hold += input[_in++] << bits;
                      bits += 8;
                      if (bits < op) {
                        hold += input[_in++] << bits;
                        bits += 8;
                      }
                    }
                    dist += hold & (1 << op) - 1;
                    if (dist > dmax) {
                      strm.msg = "invalid distance too far back";
                      state.mode = BAD$1;
                      break top;
                    }
                    hold >>>= op;
                    bits -= op;
                    op = _out - beg;
                    if (dist > op) {
                      op = dist - op;
                      if (op > whave) {
                        if (state.sane) {
                          strm.msg = "invalid distance too far back";
                          state.mode = BAD$1;
                          break top;
                        }
                      }
                      from = 0;
                      from_source = s_window;
                      if (wnext === 0) {
                        from += wsize - op;
                        if (op < len) {
                          len -= op;
                          do {
                            output[_out++] = s_window[from++];
                          } while (--op);
                          from = _out - dist;
                          from_source = output;
                        }
                      } else if (wnext < op) {
                        from += wsize + wnext - op;
                        op -= wnext;
                        if (op < len) {
                          len -= op;
                          do {
                            output[_out++] = s_window[from++];
                          } while (--op);
                          from = 0;
                          if (wnext < len) {
                            op = wnext;
                            len -= op;
                            do {
                              output[_out++] = s_window[from++];
                            } while (--op);
                            from = _out - dist;
                            from_source = output;
                          }
                        }
                      } else {
                        from += wnext - op;
                        if (op < len) {
                          len -= op;
                          do {
                            output[_out++] = s_window[from++];
                          } while (--op);
                          from = _out - dist;
                          from_source = output;
                        }
                      }
                      while (len > 2) {
                        output[_out++] = from_source[from++];
                        output[_out++] = from_source[from++];
                        output[_out++] = from_source[from++];
                        len -= 3;
                      }
                      if (len) {
                        output[_out++] = from_source[from++];
                        if (len > 1) {
                          output[_out++] = from_source[from++];
                        }
                      }
                    } else {
                      from = _out - dist;
                      do {
                        output[_out++] = output[from++];
                        output[_out++] = output[from++];
                        output[_out++] = output[from++];
                        len -= 3;
                      } while (len > 2);
                      if (len) {
                        output[_out++] = output[from++];
                        if (len > 1) {
                          output[_out++] = output[from++];
                        }
                      }
                    }
                  } else if ((op & 64) === 0) {
                    here = dcode[(here & 65535) + (hold & (1 << op) - 1)];
                    continue dodist;
                  } else {
                    strm.msg = "invalid distance code";
                    state.mode = BAD$1;
                    break top;
                  }
                  break;
                }
            } else if ((op & 64) === 0) {
              here = lcode[(here & 65535) + (hold & (1 << op) - 1)];
              continue dolen;
            } else if (op & 32) {
              state.mode = TYPE$1;
              break top;
            } else {
              strm.msg = "invalid literal/length code";
              state.mode = BAD$1;
              break top;
            }
            break;
          }
      } while (_in < last && _out < end);
    len = bits >> 3;
    _in -= len;
    bits -= len << 3;
    hold &= (1 << bits) - 1;
    strm.next_in = _in;
    strm.next_out = _out;
    strm.avail_in = _in < last ? 5 + (last - _in) : 5 - (_in - last);
    strm.avail_out = _out < end ? 257 + (end - _out) : 257 - (_out - end);
    state.hold = hold;
    state.bits = bits;
    return;
  };
  const MAXBITS = 15;
  const ENOUGH_LENS$1 = 852;
  const ENOUGH_DISTS$1 = 592;
  const CODES$1 = 0;
  const LENS$1 = 1;
  const DISTS$1 = 2;
  const lbase = new Uint16Array([
 /* Length codes 257..285 base */
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    13,
    15,
    17,
    19,
    23,
    27,
    31,
    35,
    43,
    51,
    59,
    67,
    83,
    99,
    115,
    131,
    163,
    195,
    227,
    258,
    0,
    0
  ]);
  const lext = new Uint8Array([
 /* Length codes 257..285 extra */
    16,
    16,
    16,
    16,
    16,
    16,
    16,
    16,
    17,
    17,
    17,
    17,
    18,
    18,
    18,
    18,
    19,
    19,
    19,
    19,
    20,
    20,
    20,
    20,
    21,
    21,
    21,
    21,
    16,
    72,
    78
  ]);
  const dbase = new Uint16Array([
 /* Distance codes 0..29 base */
    1,
    2,
    3,
    4,
    5,
    7,
    9,
    13,
    17,
    25,
    33,
    49,
    65,
    97,
    129,
    193,
    257,
    385,
    513,
    769,
    1025,
    1537,
    2049,
    3073,
    4097,
    6145,
    8193,
    12289,
    16385,
    24577,
    0,
    0
  ]);
  const dext = new Uint8Array([
 /* Distance codes 0..29 extra */
    16,
    16,
    16,
    16,
    17,
    17,
    18,
    18,
    19,
    19,
    20,
    20,
    21,
    21,
    22,
    22,
    23,
    23,
    24,
    24,
    25,
    25,
    26,
    26,
    27,
    27,
    28,
    28,
    29,
    29,
    64,
    64
  ]);
  const inflate_table = (type, lens, lens_index, codes, table, table_index, work, opts) => {
    const bits = opts.bits;
    let len = 0;
    let sym = 0;
    let min = 0, max = 0;
    let root = 0;
    let curr = 0;
    let drop = 0;
    let left = 0;
    let used = 0;
    let huff = 0;
    let incr;
    let fill;
    let low;
    let mask;
    let next;
    let base = null;
    let match;
    const count = new Uint16Array(MAXBITS + 1);
    const offs = new Uint16Array(MAXBITS + 1);
    let extra = null;
    let here_bits, here_op, here_val;
    for (len = 0; len <= MAXBITS; len++) {
      count[len] = 0;
    }
    for (sym = 0; sym < codes; sym++) {
      count[lens[lens_index + sym]]++;
    }
    root = bits;
    for (max = MAXBITS; max >= 1; max--) {
      if (count[max] !== 0) {
        break;
      }
    }
    if (root > max) {
      root = max;
    }
    if (max === 0) {
      table[table_index++] = 1 << 24 | 64 << 16 | 0;
      table[table_index++] = 1 << 24 | 64 << 16 | 0;
      opts.bits = 1;
      return 0;
    }
    for (min = 1; min < max; min++) {
      if (count[min] !== 0) {
        break;
      }
    }
    if (root < min) {
      root = min;
    }
    left = 1;
    for (len = 1; len <= MAXBITS; len++) {
      left <<= 1;
      left -= count[len];
      if (left < 0) {
        return -1;
      }
    }
    if (left > 0 && (type === CODES$1 || max !== 1)) {
      return -1;
    }
    offs[1] = 0;
    for (len = 1; len < MAXBITS; len++) {
      offs[len + 1] = offs[len] + count[len];
    }
    for (sym = 0; sym < codes; sym++) {
      if (lens[lens_index + sym] !== 0) {
        work[offs[lens[lens_index + sym]]++] = sym;
      }
    }
    if (type === CODES$1) {
      base = extra = work;
      match = 20;
    } else if (type === LENS$1) {
      base = lbase;
      extra = lext;
      match = 257;
    } else {
      base = dbase;
      extra = dext;
      match = 0;
    }
    huff = 0;
    sym = 0;
    len = min;
    next = table_index;
    curr = root;
    drop = 0;
    low = -1;
    used = 1 << root;
    mask = used - 1;
    if (type === LENS$1 && used > ENOUGH_LENS$1 || type === DISTS$1 && used > ENOUGH_DISTS$1) {
      return 1;
    }
    for (; ; ) {
      here_bits = len - drop;
      if (work[sym] + 1 < match) {
        here_op = 0;
        here_val = work[sym];
      } else if (work[sym] >= match) {
        here_op = extra[work[sym] - match];
        here_val = base[work[sym] - match];
      } else {
        here_op = 32 + 64;
        here_val = 0;
      }
      incr = 1 << len - drop;
      fill = 1 << curr;
      min = fill;
      do {
        fill -= incr;
        table[next + (huff >> drop) + fill] = here_bits << 24 | here_op << 16 | here_val | 0;
      } while (fill !== 0);
      incr = 1 << len - 1;
      while (huff & incr) {
        incr >>= 1;
      }
      if (incr !== 0) {
        huff &= incr - 1;
        huff += incr;
      } else {
        huff = 0;
      }
      sym++;
      if (--count[len] === 0) {
        if (len === max) {
          break;
        }
        len = lens[lens_index + work[sym]];
      }
      if (len > root && (huff & mask) !== low) {
        if (drop === 0) {
          drop = root;
        }
        next += min;
        curr = len - drop;
        left = 1 << curr;
        while (curr + drop < max) {
          left -= count[curr + drop];
          if (left <= 0) {
            break;
          }
          curr++;
          left <<= 1;
        }
        used += 1 << curr;
        if (type === LENS$1 && used > ENOUGH_LENS$1 || type === DISTS$1 && used > ENOUGH_DISTS$1) {
          return 1;
        }
        low = huff & mask;
        table[low] = root << 24 | curr << 16 | next - table_index | 0;
      }
    }
    if (huff !== 0) {
      table[next + huff] = len - drop << 24 | 64 << 16 | 0;
    }
    opts.bits = root;
    return 0;
  };
  var inftrees = inflate_table;
  const CODES = 0;
  const LENS = 1;
  const DISTS = 2;
  const {
    Z_FINISH: Z_FINISH$1,
    Z_BLOCK,
    Z_TREES,
    Z_OK: Z_OK$1,
    Z_STREAM_END: Z_STREAM_END$1,
    Z_NEED_DICT: Z_NEED_DICT$1,
    Z_STREAM_ERROR: Z_STREAM_ERROR$1,
    Z_DATA_ERROR: Z_DATA_ERROR$1,
    Z_MEM_ERROR: Z_MEM_ERROR$1,
    Z_BUF_ERROR,
    Z_DEFLATED
  } = constants$2;
  const HEAD = 16180;
  const FLAGS = 16181;
  const TIME = 16182;
  const OS = 16183;
  const EXLEN = 16184;
  const EXTRA = 16185;
  const NAME = 16186;
  const COMMENT = 16187;
  const HCRC = 16188;
  const DICTID = 16189;
  const DICT = 16190;
  const TYPE = 16191;
  const TYPEDO = 16192;
  const STORED = 16193;
  const COPY_ = 16194;
  const COPY = 16195;
  const TABLE = 16196;
  const LENLENS = 16197;
  const CODELENS = 16198;
  const LEN_ = 16199;
  const LEN = 16200;
  const LENEXT = 16201;
  const DIST = 16202;
  const DISTEXT = 16203;
  const MATCH = 16204;
  const LIT = 16205;
  const CHECK = 16206;
  const LENGTH = 16207;
  const DONE = 16208;
  const BAD = 16209;
  const MEM = 16210;
  const SYNC = 16211;
  const ENOUGH_LENS = 852;
  const ENOUGH_DISTS = 592;
  const MAX_WBITS = 15;
  const DEF_WBITS = MAX_WBITS;
  const zswap32 = (q) => {
    return (q >>> 24 & 255) + (q >>> 8 & 65280) + ((q & 65280) << 8) + ((q & 255) << 24);
  };
  function InflateState() {
    this.strm = null;
    this.mode = 0;
    this.last = false;
    this.wrap = 0;
    this.havedict = false;
    this.flags = 0;
    this.dmax = 0;
    this.check = 0;
    this.total = 0;
    this.head = null;
    this.wbits = 0;
    this.wsize = 0;
    this.whave = 0;
    this.wnext = 0;
    this.window = null;
    this.hold = 0;
    this.bits = 0;
    this.length = 0;
    this.offset = 0;
    this.extra = 0;
    this.lencode = null;
    this.distcode = null;
    this.lenbits = 0;
    this.distbits = 0;
    this.ncode = 0;
    this.nlen = 0;
    this.ndist = 0;
    this.have = 0;
    this.next = null;
    this.lens = new Uint16Array(320);
    this.work = new Uint16Array(288);
    this.lendyn = null;
    this.distdyn = null;
    this.sane = 0;
    this.back = 0;
    this.was = 0;
  }
  const inflateStateCheck = (strm) => {
    if (!strm) {
      return 1;
    }
    const state = strm.state;
    if (!state || state.strm !== strm || state.mode < HEAD || state.mode > SYNC) {
      return 1;
    }
    return 0;
  };
  const inflateResetKeep = (strm) => {
    if (inflateStateCheck(strm)) {
      return Z_STREAM_ERROR$1;
    }
    const state = strm.state;
    strm.total_in = strm.total_out = state.total = 0;
    strm.msg = "";
    if (state.wrap) {
      strm.adler = state.wrap & 1;
    }
    state.mode = HEAD;
    state.last = 0;
    state.havedict = 0;
    state.flags = -1;
    state.dmax = 32768;
    state.head = null;
    state.hold = 0;
    state.bits = 0;
    state.lencode = state.lendyn = new Int32Array(ENOUGH_LENS);
    state.distcode = state.distdyn = new Int32Array(ENOUGH_DISTS);
    state.sane = 1;
    state.back = -1;
    return Z_OK$1;
  };
  const inflateReset = (strm) => {
    if (inflateStateCheck(strm)) {
      return Z_STREAM_ERROR$1;
    }
    const state = strm.state;
    state.wsize = 0;
    state.whave = 0;
    state.wnext = 0;
    return inflateResetKeep(strm);
  };
  const inflateReset2 = (strm, windowBits) => {
    let wrap;
    if (inflateStateCheck(strm)) {
      return Z_STREAM_ERROR$1;
    }
    const state = strm.state;
    if (windowBits < 0) {
      wrap = 0;
      windowBits = -windowBits;
    } else {
      wrap = (windowBits >> 4) + 5;
      if (windowBits < 48) {
        windowBits &= 15;
      }
    }
    if (windowBits && (windowBits < 8 || windowBits > 15)) {
      return Z_STREAM_ERROR$1;
    }
    if (state.window !== null && state.wbits !== windowBits) {
      state.window = null;
    }
    state.wrap = wrap;
    state.wbits = windowBits;
    return inflateReset(strm);
  };
  const inflateInit2 = (strm, windowBits) => {
    if (!strm) {
      return Z_STREAM_ERROR$1;
    }
    const state = new InflateState();
    strm.state = state;
    state.strm = strm;
    state.window = null;
    state.mode = HEAD;
    const ret = inflateReset2(strm, windowBits);
    if (ret !== Z_OK$1) {
      strm.state = null;
    }
    return ret;
  };
  const inflateInit = (strm) => {
    return inflateInit2(strm, DEF_WBITS);
  };
  let virgin = true;
  let lenfix, distfix;
  const fixedtables = (state) => {
    if (virgin) {
      lenfix = new Int32Array(512);
      distfix = new Int32Array(32);
      let sym = 0;
      while (sym < 144) {
        state.lens[sym++] = 8;
      }
      while (sym < 256) {
        state.lens[sym++] = 9;
      }
      while (sym < 280) {
        state.lens[sym++] = 7;
      }
      while (sym < 288) {
        state.lens[sym++] = 8;
      }
      inftrees(LENS, state.lens, 0, 288, lenfix, 0, state.work, { bits: 9 });
      sym = 0;
      while (sym < 32) {
        state.lens[sym++] = 5;
      }
      inftrees(DISTS, state.lens, 0, 32, distfix, 0, state.work, { bits: 5 });
      virgin = false;
    }
    state.lencode = lenfix;
    state.lenbits = 9;
    state.distcode = distfix;
    state.distbits = 5;
  };
  const updatewindow = (strm, src, end, copy) => {
    let dist;
    const state = strm.state;
    if (state.window === null) {
      state.wsize = 1 << state.wbits;
      state.wnext = 0;
      state.whave = 0;
      state.window = new Uint8Array(state.wsize);
    }
    if (copy >= state.wsize) {
      state.window.set(src.subarray(end - state.wsize, end), 0);
      state.wnext = 0;
      state.whave = state.wsize;
    } else {
      dist = state.wsize - state.wnext;
      if (dist > copy) {
        dist = copy;
      }
      state.window.set(src.subarray(end - copy, end - copy + dist), state.wnext);
      copy -= dist;
      if (copy) {
        state.window.set(src.subarray(end - copy, end), 0);
        state.wnext = copy;
        state.whave = state.wsize;
      } else {
        state.wnext += dist;
        if (state.wnext === state.wsize) {
          state.wnext = 0;
        }
        if (state.whave < state.wsize) {
          state.whave += dist;
        }
      }
    }
    return 0;
  };
  const inflate$2 = (strm, flush) => {
    let state;
    let input, output;
    let next;
    let put;
    let have, left;
    let hold;
    let bits;
    let _in, _out;
    let copy;
    let from;
    let from_source;
    let here = 0;
    let here_bits, here_op, here_val;
    let last_bits, last_op, last_val;
    let len;
    let ret;
    const hbuf = new Uint8Array(4);
    let opts;
    let n;
    const order = (
 /* permutation of code lengths */
      new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15])
    );
    if (inflateStateCheck(strm) || !strm.output || !strm.input && strm.avail_in !== 0) {
      return Z_STREAM_ERROR$1;
    }
    state = strm.state;
    if (state.mode === TYPE) {
      state.mode = TYPEDO;
    }
    put = strm.next_out;
    output = strm.output;
    left = strm.avail_out;
    next = strm.next_in;
    input = strm.input;
    have = strm.avail_in;
    hold = state.hold;
    bits = state.bits;
    _in = have;
    _out = left;
    ret = Z_OK$1;
    inf_leave:
      for (; ; ) {
        switch (state.mode) {
          case HEAD:
            if (state.wrap === 0) {
              state.mode = TYPEDO;
              break;
            }
            while (bits < 16) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (state.wrap & 2 && hold === 35615) {
              if (state.wbits === 0) {
                state.wbits = 15;
              }
              state.check = 0;
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              state.check = crc32_1(state.check, hbuf, 2, 0);
              hold = 0;
              bits = 0;
              state.mode = FLAGS;
              break;
            }
            if (state.head) {
              state.head.done = false;
            }
            if (!(state.wrap & 1) || /* check if zlib header allowed */
            (((hold & 255) << 8) + (hold >> 8)) % 31) {
              strm.msg = "incorrect header check";
              state.mode = BAD;
              break;
            }
            if ((hold & 15) !== Z_DEFLATED) {
              strm.msg = "unknown compression method";
              state.mode = BAD;
              break;
            }
            hold >>>= 4;
            bits -= 4;
            len = (hold & 15) + 8;
            if (state.wbits === 0) {
              state.wbits = len;
            }
            if (len > 15 || len > state.wbits) {
              strm.msg = "invalid window size";
              state.mode = BAD;
              break;
            }
            state.dmax = 1 << state.wbits;
            state.flags = 0;
            strm.adler = state.check = 1;
            state.mode = hold & 512 ? DICTID : TYPE;
            hold = 0;
            bits = 0;
            break;
          case FLAGS:
            while (bits < 16) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.flags = hold;
            if ((state.flags & 255) !== Z_DEFLATED) {
              strm.msg = "unknown compression method";
              state.mode = BAD;
              break;
            }
            if (state.flags & 57344) {
              strm.msg = "unknown header flags set";
              state.mode = BAD;
              break;
            }
            if (state.head) {
              state.head.text = hold >> 8 & 1;
            }
            if (state.flags & 512 && state.wrap & 4) {
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              state.check = crc32_1(state.check, hbuf, 2, 0);
            }
            hold = 0;
            bits = 0;
            state.mode = TIME;
          case TIME:
            while (bits < 32) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (state.head) {
              state.head.time = hold;
            }
            if (state.flags & 512 && state.wrap & 4) {
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              hbuf[2] = hold >>> 16 & 255;
              hbuf[3] = hold >>> 24 & 255;
              state.check = crc32_1(state.check, hbuf, 4, 0);
            }
            hold = 0;
            bits = 0;
            state.mode = OS;
          case OS:
            while (bits < 16) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (state.head) {
              state.head.xflags = hold & 255;
              state.head.os = hold >> 8;
            }
            if (state.flags & 512 && state.wrap & 4) {
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              state.check = crc32_1(state.check, hbuf, 2, 0);
            }
            hold = 0;
            bits = 0;
            state.mode = EXLEN;
          case EXLEN:
            if (state.flags & 1024) {
              while (bits < 16) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.length = hold;
              if (state.head) {
                state.head.extra_len = hold;
              }
              if (state.flags & 512 && state.wrap & 4) {
                hbuf[0] = hold & 255;
                hbuf[1] = hold >>> 8 & 255;
                state.check = crc32_1(state.check, hbuf, 2, 0);
              }
              hold = 0;
              bits = 0;
            } else if (state.head) {
              state.head.extra = null;
            }
            state.mode = EXTRA;
          case EXTRA:
            if (state.flags & 1024) {
              copy = state.length;
              if (copy > have) {
                copy = have;
              }
              if (copy) {
                if (state.head) {
                  len = state.head.extra_len - state.length;
                  if (!state.head.extra) {
                    state.head.extra = new Uint8Array(state.head.extra_len);
                  }
                  state.head.extra.set(
                    input.subarray(
                      next,
 // extra field is limited to 65536 bytes
 // - no need for additional size check
                      next + copy
                    ),
 /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
                    len
                  );
                }
                if (state.flags & 512 && state.wrap & 4) {
                  state.check = crc32_1(state.check, input, copy, next);
                }
                have -= copy;
                next += copy;
                state.length -= copy;
              }
              if (state.length) {
                break inf_leave;
              }
            }
            state.length = 0;
            state.mode = NAME;
          case NAME:
            if (state.flags & 2048) {
              if (have === 0) {
                break inf_leave;
              }
              copy = 0;
              do {
                len = input[next + copy++];
                if (state.head && len && state.length < 65536) {
                  state.head.name += String.fromCharCode(len);
                }
              } while (len && copy < have);
              if (state.flags & 512 && state.wrap & 4) {
                state.check = crc32_1(state.check, input, copy, next);
              }
              have -= copy;
              next += copy;
              if (len) {
                break inf_leave;
              }
            } else if (state.head) {
              state.head.name = null;
            }
            state.length = 0;
            state.mode = COMMENT;
          case COMMENT:
            if (state.flags & 4096) {
              if (have === 0) {
                break inf_leave;
              }
              copy = 0;
              do {
                len = input[next + copy++];
                if (state.head && len && state.length < 65536) {
                  state.head.comment += String.fromCharCode(len);
                }
              } while (len && copy < have);
              if (state.flags & 512 && state.wrap & 4) {
                state.check = crc32_1(state.check, input, copy, next);
              }
              have -= copy;
              next += copy;
              if (len) {
                break inf_leave;
              }
            } else if (state.head) {
              state.head.comment = null;
            }
            state.mode = HCRC;
          case HCRC:
            if (state.flags & 512) {
              while (bits < 16) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (state.wrap & 4 && hold !== (state.check & 65535)) {
                strm.msg = "header crc mismatch";
                state.mode = BAD;
                break;
              }
              hold = 0;
              bits = 0;
            }
            if (state.head) {
              state.head.hcrc = state.flags >> 9 & 1;
              state.head.done = true;
            }
            strm.adler = state.check = 0;
            state.mode = TYPE;
            break;
          case DICTID:
            while (bits < 32) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            strm.adler = state.check = zswap32(hold);
            hold = 0;
            bits = 0;
            state.mode = DICT;
          case DICT:
            if (state.havedict === 0) {
              strm.next_out = put;
              strm.avail_out = left;
              strm.next_in = next;
              strm.avail_in = have;
              state.hold = hold;
              state.bits = bits;
              return Z_NEED_DICT$1;
            }
            strm.adler = state.check = 1;
            state.mode = TYPE;
          case TYPE:
            if (flush === Z_BLOCK || flush === Z_TREES) {
              break inf_leave;
            }
          case TYPEDO:
            if (state.last) {
              hold >>>= bits & 7;
              bits -= bits & 7;
              state.mode = CHECK;
              break;
            }
            while (bits < 3) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.last = hold & 1;
            hold >>>= 1;
            bits -= 1;
            switch (hold & 3) {
              case 0:
                state.mode = STORED;
                break;
              case 1:
                fixedtables(state);
                state.mode = LEN_;
                if (flush === Z_TREES) {
                  hold >>>= 2;
                  bits -= 2;
                  break inf_leave;
                }
                break;
              case 2:
                state.mode = TABLE;
                break;
              case 3:
                strm.msg = "invalid block type";
                state.mode = BAD;
            }
            hold >>>= 2;
            bits -= 2;
            break;
          case STORED:
            hold >>>= bits & 7;
            bits -= bits & 7;
            while (bits < 32) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if ((hold & 65535) !== (hold >>> 16 ^ 65535)) {
              strm.msg = "invalid stored block lengths";
              state.mode = BAD;
              break;
            }
            state.length = hold & 65535;
            hold = 0;
            bits = 0;
            state.mode = COPY_;
            if (flush === Z_TREES) {
              break inf_leave;
            }
          case COPY_:
            state.mode = COPY;
          case COPY:
            copy = state.length;
            if (copy) {
              if (copy > have) {
                copy = have;
              }
              if (copy > left) {
                copy = left;
              }
              if (copy === 0) {
                break inf_leave;
              }
              output.set(input.subarray(next, next + copy), put);
              have -= copy;
              next += copy;
              left -= copy;
              put += copy;
              state.length -= copy;
              break;
            }
            state.mode = TYPE;
            break;
          case TABLE:
            while (bits < 14) {
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.nlen = (hold & 31) + 257;
            hold >>>= 5;
            bits -= 5;
            state.ndist = (hold & 31) + 1;
            hold >>>= 5;
            bits -= 5;
            state.ncode = (hold & 15) + 4;
            hold >>>= 4;
            bits -= 4;
            if (state.nlen > 286 || state.ndist > 30) {
              strm.msg = "too many length or distance symbols";
              state.mode = BAD;
              break;
            }
            state.have = 0;
            state.mode = LENLENS;
          case LENLENS:
            while (state.have < state.ncode) {
              while (bits < 3) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.lens[order[state.have++]] = hold & 7;
              hold >>>= 3;
              bits -= 3;
            }
            while (state.have < 19) {
              state.lens[order[state.have++]] = 0;
            }
            state.lencode = state.lendyn;
            state.lenbits = 7;
            opts = { bits: state.lenbits };
            ret = inftrees(CODES, state.lens, 0, 19, state.lencode, 0, state.work, opts);
            state.lenbits = opts.bits;
            if (ret) {
              strm.msg = "invalid code lengths set";
              state.mode = BAD;
              break;
            }
            state.have = 0;
            state.mode = CODELENS;
          case CODELENS:
            while (state.have < state.nlen + state.ndist) {
              for (; ; ) {
                here = state.lencode[hold & (1 << state.lenbits) - 1];
                here_bits = here >>> 24;
                here_op = here >>> 16 & 255;
                here_val = here & 65535;
                if (here_bits <= bits) {
                  break;
                }
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (here_val < 16) {
                hold >>>= here_bits;
                bits -= here_bits;
                state.lens[state.have++] = here_val;
              } else {
                if (here_val === 16) {
                  n = here_bits + 2;
                  while (bits < n) {
                    if (have === 0) {
                      break inf_leave;
                    }
                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }
                  hold >>>= here_bits;
                  bits -= here_bits;
                  if (state.have === 0) {
                    strm.msg = "invalid bit length repeat";
                    state.mode = BAD;
                    break;
                  }
                  len = state.lens[state.have - 1];
                  copy = 3 + (hold & 3);
                  hold >>>= 2;
                  bits -= 2;
                } else if (here_val === 17) {
                  n = here_bits + 3;
                  while (bits < n) {
                    if (have === 0) {
                      break inf_leave;
                    }
                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }
                  hold >>>= here_bits;
                  bits -= here_bits;
                  len = 0;
                  copy = 3 + (hold & 7);
                  hold >>>= 3;
                  bits -= 3;
                } else {
                  n = here_bits + 7;
                  while (bits < n) {
                    if (have === 0) {
                      break inf_leave;
                    }
                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }
                  hold >>>= here_bits;
                  bits -= here_bits;
                  len = 0;
                  copy = 11 + (hold & 127);
                  hold >>>= 7;
                  bits -= 7;
                }
                if (state.have + copy > state.nlen + state.ndist) {
                  strm.msg = "invalid bit length repeat";
                  state.mode = BAD;
                  break;
                }
                while (copy--) {
                  state.lens[state.have++] = len;
                }
              }
            }
            if (state.mode === BAD) {
              break;
            }
            if (state.lens[256] === 0) {
              strm.msg = "invalid code -- missing end-of-block";
              state.mode = BAD;
              break;
            }
            state.lenbits = 9;
            opts = { bits: state.lenbits };
            ret = inftrees(LENS, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts);
            state.lenbits = opts.bits;
            if (ret) {
              strm.msg = "invalid literal/lengths set";
              state.mode = BAD;
              break;
            }
            state.distbits = 6;
            state.distcode = state.distdyn;
            opts = { bits: state.distbits };
            ret = inftrees(DISTS, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts);
            state.distbits = opts.bits;
            if (ret) {
              strm.msg = "invalid distances set";
              state.mode = BAD;
              break;
            }
            state.mode = LEN_;
            if (flush === Z_TREES) {
              break inf_leave;
            }
          case LEN_:
            state.mode = LEN;
          case LEN:
            if (have >= 6 && left >= 258) {
              strm.next_out = put;
              strm.avail_out = left;
              strm.next_in = next;
              strm.avail_in = have;
              state.hold = hold;
              state.bits = bits;
              inffast(strm, _out);
              put = strm.next_out;
              output = strm.output;
              left = strm.avail_out;
              next = strm.next_in;
              input = strm.input;
              have = strm.avail_in;
              hold = state.hold;
              bits = state.bits;
              if (state.mode === TYPE) {
                state.back = -1;
              }
              break;
            }
            state.back = 0;
            for (; ; ) {
              here = state.lencode[hold & (1 << state.lenbits) - 1];
              here_bits = here >>> 24;
              here_op = here >>> 16 & 255;
              here_val = here & 65535;
              if (here_bits <= bits) {
                break;
              }
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (here_op && (here_op & 240) === 0) {
              last_bits = here_bits;
              last_op = here_op;
              last_val = here_val;
              for (; ; ) {
                here = state.lencode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                here_bits = here >>> 24;
                here_op = here >>> 16 & 255;
                here_val = here & 65535;
                if (last_bits + here_bits <= bits) {
                  break;
                }
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              hold >>>= last_bits;
              bits -= last_bits;
              state.back += last_bits;
            }
            hold >>>= here_bits;
            bits -= here_bits;
            state.back += here_bits;
            state.length = here_val;
            if (here_op === 0) {
              state.mode = LIT;
              break;
            }
            if (here_op & 32) {
              state.back = -1;
              state.mode = TYPE;
              break;
            }
            if (here_op & 64) {
              strm.msg = "invalid literal/length code";
              state.mode = BAD;
              break;
            }
            state.extra = here_op & 15;
            state.mode = LENEXT;
          case LENEXT:
            if (state.extra) {
              n = state.extra;
              while (bits < n) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.length += hold & (1 << state.extra) - 1;
              hold >>>= state.extra;
              bits -= state.extra;
              state.back += state.extra;
            }
            state.was = state.length;
            state.mode = DIST;
          case DIST:
            for (; ; ) {
              here = state.distcode[hold & (1 << state.distbits) - 1];
              here_bits = here >>> 24;
              here_op = here >>> 16 & 255;
              here_val = here & 65535;
              if (here_bits <= bits) {
                break;
              }
              if (have === 0) {
                break inf_leave;
              }
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if ((here_op & 240) === 0) {
              last_bits = here_bits;
              last_op = here_op;
              last_val = here_val;
              for (; ; ) {
                here = state.distcode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                here_bits = here >>> 24;
                here_op = here >>> 16 & 255;
                here_val = here & 65535;
                if (last_bits + here_bits <= bits) {
                  break;
                }
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              hold >>>= last_bits;
              bits -= last_bits;
              state.back += last_bits;
            }
            hold >>>= here_bits;
            bits -= here_bits;
            state.back += here_bits;
            if (here_op & 64) {
              strm.msg = "invalid distance code";
              state.mode = BAD;
              break;
            }
            state.offset = here_val;
            state.extra = here_op & 15;
            state.mode = DISTEXT;
          case DISTEXT:
            if (state.extra) {
              n = state.extra;
              while (bits < n) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.offset += hold & (1 << state.extra) - 1;
              hold >>>= state.extra;
              bits -= state.extra;
              state.back += state.extra;
            }
            if (state.offset > state.dmax) {
              strm.msg = "invalid distance too far back";
              state.mode = BAD;
              break;
            }
            state.mode = MATCH;
          case MATCH:
            if (left === 0) {
              break inf_leave;
            }
            copy = _out - left;
            if (state.offset > copy) {
              copy = state.offset - copy;
              if (copy > state.whave) {
                if (state.sane) {
                  strm.msg = "invalid distance too far back";
                  state.mode = BAD;
                  break;
                }
              }
              if (copy > state.wnext) {
                copy -= state.wnext;
                from = state.wsize - copy;
              } else {
                from = state.wnext - copy;
              }
              if (copy > state.length) {
                copy = state.length;
              }
              from_source = state.window;
            } else {
              from_source = output;
              from = put - state.offset;
              copy = state.length;
            }
            if (copy > left) {
              copy = left;
            }
            left -= copy;
            state.length -= copy;
            do {
              output[put++] = from_source[from++];
            } while (--copy);
            if (state.length === 0) {
              state.mode = LEN;
            }
            break;
          case LIT:
            if (left === 0) {
              break inf_leave;
            }
            output[put++] = state.length;
            left--;
            state.mode = LEN;
            break;
          case CHECK:
            if (state.wrap) {
              while (bits < 32) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold |= input[next++] << bits;
                bits += 8;
              }
              _out -= left;
              strm.total_out += _out;
              state.total += _out;
              if (state.wrap & 4 && _out) {
                strm.adler = state.check = /*UPDATE_CHECK(state.check, put - _out, _out);*/
                state.flags ? crc32_1(state.check, output, _out, put - _out) : adler32_1(state.check, output, _out, put - _out);
              }
              _out = left;
              if (state.wrap & 4 && (state.flags ? hold : zswap32(hold)) !== state.check) {
                strm.msg = "incorrect data check";
                state.mode = BAD;
                break;
              }
              hold = 0;
              bits = 0;
            }
            state.mode = LENGTH;
          case LENGTH:
            if (state.wrap && state.flags) {
              while (bits < 32) {
                if (have === 0) {
                  break inf_leave;
                }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (state.wrap & 4 && hold !== (state.total & 4294967295)) {
                strm.msg = "incorrect length check";
                state.mode = BAD;
                break;
              }
              hold = 0;
              bits = 0;
            }
            state.mode = DONE;
          case DONE:
            ret = Z_STREAM_END$1;
            break inf_leave;
          case BAD:
            ret = Z_DATA_ERROR$1;
            break inf_leave;
          case MEM:
            return Z_MEM_ERROR$1;
          case SYNC:
          default:
            return Z_STREAM_ERROR$1;
        }
      }
    strm.next_out = put;
    strm.avail_out = left;
    strm.next_in = next;
    strm.avail_in = have;
    state.hold = hold;
    state.bits = bits;
    if (state.wsize || _out !== strm.avail_out && state.mode < BAD && (state.mode < CHECK || flush !== Z_FINISH$1)) {
      if (updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out)) ;
    }
    _in -= strm.avail_in;
    _out -= strm.avail_out;
    strm.total_in += _in;
    strm.total_out += _out;
    state.total += _out;
    if (state.wrap & 4 && _out) {
      strm.adler = state.check = /*UPDATE_CHECK(state.check, strm.next_out - _out, _out);*/
      state.flags ? crc32_1(state.check, output, _out, strm.next_out - _out) : adler32_1(state.check, output, _out, strm.next_out - _out);
    }
    strm.data_type = state.bits + (state.last ? 64 : 0) + (state.mode === TYPE ? 128 : 0) + (state.mode === LEN_ || state.mode === COPY_ ? 256 : 0);
    if ((_in === 0 && _out === 0 || flush === Z_FINISH$1) && ret === Z_OK$1) {
      ret = Z_BUF_ERROR;
    }
    return ret;
  };
  const inflateEnd = (strm) => {
    if (inflateStateCheck(strm)) {
      return Z_STREAM_ERROR$1;
    }
    let state = strm.state;
    if (state.window) {
      state.window = null;
    }
    strm.state = null;
    return Z_OK$1;
  };
  const inflateGetHeader = (strm, head) => {
    if (inflateStateCheck(strm)) {
      return Z_STREAM_ERROR$1;
    }
    const state = strm.state;
    if ((state.wrap & 2) === 0) {
      return Z_STREAM_ERROR$1;
    }
    state.head = head;
    head.done = false;
    return Z_OK$1;
  };
  const inflateSetDictionary = (strm, dictionary) => {
    const dictLength = dictionary.length;
    let state;
    let dictid;
    let ret;
    if (inflateStateCheck(strm)) {
      return Z_STREAM_ERROR$1;
    }
    state = strm.state;
    if (state.wrap !== 0 && state.mode !== DICT) {
      return Z_STREAM_ERROR$1;
    }
    if (state.mode === DICT) {
      dictid = 1;
      dictid = adler32_1(dictid, dictionary, dictLength, 0);
      if (dictid !== state.check) {
        return Z_DATA_ERROR$1;
      }
    }
    ret = updatewindow(strm, dictionary, dictLength, dictLength);
    if (ret) {
      state.mode = MEM;
      return Z_MEM_ERROR$1;
    }
    state.havedict = 1;
    return Z_OK$1;
  };
  var inflateReset_1 = inflateReset;
  var inflateReset2_1 = inflateReset2;
  var inflateResetKeep_1 = inflateResetKeep;
  var inflateInit_1 = inflateInit;
  var inflateInit2_1 = inflateInit2;
  var inflate_2$1 = inflate$2;
  var inflateEnd_1 = inflateEnd;
  var inflateGetHeader_1 = inflateGetHeader;
  var inflateSetDictionary_1 = inflateSetDictionary;
  var inflateInfo = "pako inflate (from Nodeca project)";
  var inflate_1$2 = {
    inflateReset: inflateReset_1,
    inflateReset2: inflateReset2_1,
    inflateResetKeep: inflateResetKeep_1,
    inflateInit: inflateInit_1,
    inflateInit2: inflateInit2_1,
    inflate: inflate_2$1,
    inflateEnd: inflateEnd_1,
    inflateGetHeader: inflateGetHeader_1,
    inflateSetDictionary: inflateSetDictionary_1,
    inflateInfo
  };
  function GZheader() {
    this.text = 0;
    this.time = 0;
    this.xflags = 0;
    this.os = 0;
    this.extra = null;
    this.extra_len = 0;
    this.name = "";
    this.comment = "";
    this.hcrc = 0;
    this.done = false;
  }
  var gzheader = GZheader;
  const toString = Object.prototype.toString;
  const {
    Z_NO_FLUSH,
    Z_FINISH,
    Z_OK,
    Z_STREAM_END,
    Z_NEED_DICT,
    Z_STREAM_ERROR,
    Z_DATA_ERROR,
    Z_MEM_ERROR
  } = constants$2;
  function Inflate$1(options) {
    this.options = common.assign({
      chunkSize: 1024 * 64,
      windowBits: 15,
      to: ""
    }, options || {});
    const opt = this.options;
    if (opt.raw && opt.windowBits >= 0 && opt.windowBits < 16) {
      opt.windowBits = -opt.windowBits;
      if (opt.windowBits === 0) {
        opt.windowBits = -15;
      }
    }
    if (opt.windowBits >= 0 && opt.windowBits < 16 && !(options && options.windowBits)) {
      opt.windowBits += 32;
    }
    if (opt.windowBits > 15 && opt.windowBits < 48) {
      if ((opt.windowBits & 15) === 0) {
        opt.windowBits |= 15;
      }
    }
    this.err = 0;
    this.msg = "";
    this.ended = false;
    this.chunks = [];
    this.strm = new zstream();
    this.strm.avail_out = 0;
    let status = inflate_1$2.inflateInit2(
      this.strm,
      opt.windowBits
    );
    if (status !== Z_OK) {
      throw new Error(messages[status]);
    }
    this.header = new gzheader();
    inflate_1$2.inflateGetHeader(this.strm, this.header);
    if (opt.dictionary) {
      if (typeof opt.dictionary === "string") {
        opt.dictionary = strings.string2buf(opt.dictionary);
      } else if (toString.call(opt.dictionary) === "[object ArrayBuffer]") {
        opt.dictionary = new Uint8Array(opt.dictionary);
      }
      if (opt.raw) {
        status = inflate_1$2.inflateSetDictionary(this.strm, opt.dictionary);
        if (status !== Z_OK) {
          throw new Error(messages[status]);
        }
      }
    }
  }
  Inflate$1.prototype.push = function(data, flush_mode) {
    const strm = this.strm;
    const chunkSize = this.options.chunkSize;
    const dictionary = this.options.dictionary;
    let status, _flush_mode, last_avail_out;
    if (this.ended) return false;
    if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
    else _flush_mode = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;
    if (toString.call(data) === "[object ArrayBuffer]") {
      strm.input = new Uint8Array(data);
    } else {
      strm.input = data;
    }
    strm.next_in = 0;
    strm.avail_in = strm.input.length;
    for (; ; ) {
      if (strm.avail_out === 0) {
        strm.output = new Uint8Array(chunkSize);
        strm.next_out = 0;
        strm.avail_out = chunkSize;
      }
      status = inflate_1$2.inflate(strm, _flush_mode);
      if (status === Z_NEED_DICT && dictionary) {
        status = inflate_1$2.inflateSetDictionary(strm, dictionary);
        if (status === Z_OK) {
          status = inflate_1$2.inflate(strm, _flush_mode);
        } else if (status === Z_DATA_ERROR) {
          status = Z_NEED_DICT;
        }
      }
      while (strm.avail_in > 0 && status === Z_STREAM_END && strm.state.wrap > 0 && data[strm.next_in] !== 0) {
        inflate_1$2.inflateReset(strm);
        status = inflate_1$2.inflate(strm, _flush_mode);
      }
      switch (status) {
        case Z_STREAM_ERROR:
        case Z_DATA_ERROR:
        case Z_NEED_DICT:
        case Z_MEM_ERROR:
          this.onEnd(status);
          this.ended = true;
          return false;
      }
      last_avail_out = strm.avail_out;
      if (strm.next_out) {
        if (strm.avail_out === 0 || status === Z_STREAM_END) {
          if (this.options.to === "string") {
            let next_out_utf8 = strings.utf8border(strm.output, strm.next_out);
            let tail = strm.next_out - next_out_utf8;
            let utf8str = strings.buf2string(strm.output, next_out_utf8);
            strm.next_out = tail;
            strm.avail_out = chunkSize - tail;
            if (tail) strm.output.set(strm.output.subarray(next_out_utf8, next_out_utf8 + tail), 0);
            this.onData(utf8str);
          } else {
            this.onData(strm.output.length === strm.next_out ? strm.output : strm.output.subarray(0, strm.next_out));
          }
        }
      }
      if (status === Z_OK && last_avail_out === 0) continue;
      if (status === Z_STREAM_END) {
        status = inflate_1$2.inflateEnd(this.strm);
        this.onEnd(status);
        this.ended = true;
        return true;
      }
      if (strm.avail_in === 0) break;
    }
    return true;
  };
  Inflate$1.prototype.onData = function(chunk) {
    this.chunks.push(chunk);
  };
  Inflate$1.prototype.onEnd = function(status) {
    if (status === Z_OK) {
      if (this.options.to === "string") {
        this.result = this.chunks.join("");
      } else {
        this.result = common.flattenChunks(this.chunks);
      }
    }
    this.chunks = [];
    this.err = status;
    this.msg = this.strm.msg;
  };
  function inflate$1(input, options) {
    const inflator = new Inflate$1(options);
    inflator.push(input);
    if (inflator.err) throw inflator.msg || messages[inflator.err];
    return inflator.result;
  }
  function inflateRaw$1(input, options) {
    options = options || {};
    options.raw = true;
    return inflate$1(input, options);
  }
  var Inflate_1$1 = Inflate$1;
  var inflate_2 = inflate$1;
  var inflateRaw_1$1 = inflateRaw$1;
  var ungzip$1 = inflate$1;
  var constants = constants$2;
  var inflate_1$1 = {
    Inflate: Inflate_1$1,
    inflate: inflate_2,
    inflateRaw: inflateRaw_1$1,
    ungzip: ungzip$1,
    constants
  };
  const { Deflate, deflate, deflateRaw, gzip } = deflate_1$1;
  const { Inflate, inflate, inflateRaw, ungzip } = inflate_1$1;
  var Deflate_1 = Deflate;
  var deflate_1 = deflate;
  var deflateRaw_1 = deflateRaw;
  var gzip_1 = gzip;
  var Inflate_1 = Inflate;
  var inflate_1 = inflate;
  var inflateRaw_1 = inflateRaw;
  var ungzip_1 = ungzip;
  var constants_1 = constants$2;
  var pako = {
    Deflate: Deflate_1,
    deflate: deflate_1,
    deflateRaw: deflateRaw_1,
    gzip: gzip_1,
    Inflate: Inflate_1,
    inflate: inflate_1,
    inflateRaw: inflateRaw_1,
    ungzip: ungzip_1,
    constants: constants_1
  };
  var USX_HCODES_DFLT = new Uint8Array([0, 64, 128, 192, 224]);
  var USX_HCODE_LENS_DFLT = new Uint8Array([2, 2, 2, 3, 3]);
  var USX_FREQ_SEQ_DFLT = ['": "', '": ', "</", '="', '":"', "://"];
  var USX_TEMPLATES = [
    "tfff-of-tfTtf:rf:rf.fffZ",
    "tfff-of-tf",
    "(fff) fff-ffff",
    "tf:rf:rf",
    0
  ];
  const USX_ALPHA = 0;
  const USX_SYM = 1;
  const USX_NUM = 2;
  const USX_DICT = 3;
  const USX_DELTA = 4;
  var usx_sets = [
    "\0 etaoinsrlcdhupmbgwfyvkqjxz",
    "\"{}_<>:\n\0[]\\;'	@*&?!^|\r~`\0\0\0",
    "\0,.01925-/34678() =+$%#\0\0\0\0\0"
  ];
  var usx_code_94 = new Array(94);
  var usx_vcodes = new Uint8Array([
    0,
    64,
    96,
    128,
    144,
    160,
    176,
    192,
    208,
    216,
    224,
    228,
    232,
    236,
    238,
    240,
    242,
    244,
    246,
    247,
    248,
    249,
    250,
    251,
    252,
    253,
    254,
    255
  ]);
  var usx_vcode_lens = new Uint8Array([
    2,
    3,
    3,
    4,
    4,
    4,
    4,
    4,
    5,
    5,
    6,
    6,
    6,
    7,
    7,
    7,
    7,
    7,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    8,
    8
  ]);
  var usx_freq_codes = new Uint8Array([
    (1 << 5) + 25,
    (1 << 5) + 26,
    (1 << 5) + 27,
    (2 << 5) + 23,
    (2 << 5) + 24,
    (2 << 5) + 25
  ]);
  var NICE_LEN = 5;
  const RPT_CODE = (2 << 5) + 26;
  const TERM_CODE = (2 << 5) + 27;
  const LF_CODE = (1 << 5) + 7;
  const CRLF_CODE = (1 << 5) + 8;
  const CR_CODE = (1 << 5) + 22;
  const TAB_CODE = (1 << 5) + 14;
  const NUM_SPC_CODE = (2 << 5) + 17;
  const UNI_STATE_SPL_CODE = 248;
  const UNI_STATE_SPL_CODE_LEN = 5;
  const UNI_STATE_SW_CODE = 128;
  const UNI_STATE_SW_CODE_LEN = 2;
  const SW_CODE = 0;
  const SW_CODE_LEN = 2;
  const TERM_BYTE_PRESET_1 = 0;
  const TERM_BYTE_PRESET_1_LEN_LOWER = 6;
  const TERM_BYTE_PRESET_1_LEN_UPPER = 4;
  const USX_OFFSET_94 = 33;
  function memset(array, val, size) {
    for (var i = 0; i < size; ++i) {
      array[i] = val;
    }
  }
  var is_inited = 0;
  function init_coder() {
    if (is_inited) return;
    memset(usx_code_94, "\0", 94);
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 28; j++) {
        var c = usx_sets[i].charCodeAt(j);
        if (c !== 0 && c > 32) {
          usx_code_94[c - USX_OFFSET_94] = (i << 5) + j;
          if (c >= 97 && c <= 122)
            usx_code_94[c - USX_OFFSET_94 - (97 - 65)] = (i << 5) + j;
        }
      }
    }
    is_inited = 1;
  }
  var usx_mask = new Uint8Array([128, 192, 224, 240, 248, 252, 254, 255]);
  function append_bits(out, olen, ol, code, clen) {
    var cur_bit;
    var blen;
    var a_byte;
    var oidx;
    while (clen > 0) {
      cur_bit = ol % 8;
      blen = clen;
      a_byte = code & usx_mask[blen - 1];
      a_byte >>= cur_bit;
      if (blen + cur_bit > 8) blen = 8 - cur_bit;
      oidx = ol / 8;
      if (oidx < 0 || olen <= oidx) return -1;
      if (cur_bit == 0) out[ol >> 3] = a_byte;
      else out[ol >> 3] |= a_byte;
      code <<= blen;
      ol += blen;
      clen -= blen;
    }
    return ol;
  }
  function append_switch_code(out, olen, ol, state) {
    if (state == USX_DELTA) {
      ol = append_bits(out, olen, ol, UNI_STATE_SPL_CODE, UNI_STATE_SPL_CODE_LEN);
      ol = append_bits(out, olen, ol, UNI_STATE_SW_CODE, UNI_STATE_SW_CODE_LEN);
    } else ol = append_bits(out, olen, ol, SW_CODE, SW_CODE_LEN);
    return ol;
  }
  function append_code(out, olen, ol, code, state, usx_hcodes, usx_hcode_lens) {
    var hcode = code >> 5;
    var vcode = code & 31;
    if (usx_hcode_lens[hcode] == 0 && hcode != USX_ALPHA) return [ol, state];
    switch (hcode) {
      case USX_ALPHA:
        if (state != USX_ALPHA) {
          ol = append_switch_code(out, olen, ol, state);
          ol = append_bits(
            out,
            olen,
            ol,
            usx_hcodes[USX_ALPHA],
            usx_hcode_lens[USX_ALPHA]
          );
          state = USX_ALPHA;
        }
        break;
      case USX_SYM:
        ol = append_switch_code(out, olen, ol, state);
        ol = append_bits(
          out,
          olen,
          ol,
          usx_hcodes[USX_SYM],
          usx_hcode_lens[USX_SYM]
        );
        break;
      case USX_NUM:
        if (state != USX_NUM) {
          ol = append_switch_code(out, olen, ol, state);
          ol = append_bits(
            out,
            olen,
            ol,
            usx_hcodes[USX_NUM],
            usx_hcode_lens[USX_NUM]
          );
          if (usx_sets[hcode].charCodeAt(vcode) >= 48 && usx_sets[hcode].charCodeAt(vcode) <= 57)
            state = USX_NUM;
        }
    }
    return [
      append_bits(out, olen, ol, usx_vcodes[vcode], usx_vcode_lens[vcode]),
      state
    ];
  }
  const count_bit_lens = new Uint8Array([2, 4, 7, 11, 16]);
  const count_adder = [4, 20, 148, 2196, 67732];
  const count_codes = new Uint8Array([1, 130, 195, 228, 244]);
  function encodeCount(out, olen, ol, count) {
    for (var i = 0; i < 5; i++) {
      if (count < count_adder[i]) {
        ol = append_bits(
          out,
          olen,
          ol,
          count_codes[i] & 248,
          count_codes[i] & 7
        );
        var count16 = count - (i > 0 ? count_adder[i - 1] : 0) << 16 - count_bit_lens[i];
        if (count_bit_lens[i] > 8) {
          ol = append_bits(out, olen, ol, count16 >> 8, 8);
          ol = append_bits(out, olen, ol, count16 & 255, count_bit_lens[i] - 8);
        } else ol = append_bits(out, olen, ol, count16 >> 8, count_bit_lens[i]);
        return ol;
      }
    }
    return ol;
  }
  const uni_bit_len = new Uint8Array([6, 12, 14, 16, 21]);
  const uni_adder = [0, 64, 4160, 20544, 86080];
  function encodeUnicode(out, olen, ol, code, prev_code) {
    const codes = new Uint8Array([1, 130, 195, 228, 245, 253]);
    var till = 0;
    var diff = code - prev_code;
    if (diff < 0) diff = -diff;
    for (var i = 0; i < 5; i++) {
      till += 1 << uni_bit_len[i];
      if (diff < till) {
        ol = append_bits(out, olen, ol, codes[i] & 248, codes[i] & 7);
        ol = append_bits(out, olen, ol, prev_code > code ? 128 : 0, 1);
        var val = diff - uni_adder[i];
        if (uni_bit_len[i] > 16) {
          val <<= 24 - uni_bit_len[i];
          ol = append_bits(out, olen, ol, val >> 16, 8);
          ol = append_bits(out, olen, ol, val >> 8 & 255, 8);
          ol = append_bits(out, olen, ol, val & 255, uni_bit_len[i] - 16);
        } else if (uni_bit_len[i] > 8) {
          val <<= 16 - uni_bit_len[i];
          ol = append_bits(out, olen, ol, val >> 8, 8);
          ol = append_bits(out, olen, ol, val & 255, uni_bit_len[i] - 8);
        } else {
          val <<= 8 - uni_bit_len[i];
          ol = append_bits(out, olen, ol, val & 255, uni_bit_len[i]);
        }
        return ol;
      }
    }
    return ol;
  }
  function readUTF8(input, len, l) {
    var ret = 0;
    if (typeof input == "string") {
      ret = input.codePointAt(l);
      return [ret, ret === input.charCodeAt(l) ? 1 : 2];
    }
    var utf8len = 0;
    if (l < len - 1 && (input[l] & 224) == 192 && (input[l + 1] & 192) == 128) {
      utf8len = 2;
      ret = input[l] & 31;
      ret <<= 6;
      ret += input[l + 1] & 63;
      if (ret < 128) ret = 0;
    } else if (l < len - 2 && (input[l] & 240) == 224 && (input[l + 1] & 192) == 128 && (input[l + 2] & 192) == 128) {
      utf8len = 3;
      ret = input[l] & 15;
      ret <<= 6;
      ret += input[l + 1] & 63;
      ret <<= 6;
      ret += input[l + 2] & 63;
      if (ret < 2048) ret = 0;
    } else if (l < len - 3 && (input[l] & 248) == 240 && (input[l + 1] & 192) == 128 && (input[l + 2] & 192) == 128 && (input[l + 3] & 192) == 128) {
      utf8len = 4;
      ret = input[l] & 7;
      ret <<= 6;
      ret += input[l + 1] & 63;
      ret <<= 6;
      ret += input[l + 2] & 63;
      ret <<= 6;
      ret += input[l + 3] & 63;
      if (ret < 65536) ret = 0;
    }
    return [ret, utf8len];
  }
  function matchOccurance(input, len, l, out, olen, ol, state, usx_hcodes, usx_hcode_lens) {
    var j, k;
    var longest_dist = 0;
    var longest_len = 0;
    for (j = l - NICE_LEN; j >= 0; j--) {
      for (k = l; k < len && j + k - l < l; k++) {
        if (input[k] != input[j + k - l]) break;
      }
      while (input[k] >> 6 == 2) k--;
      if (k - l > NICE_LEN - 1) {
        var match_len = k - l - NICE_LEN;
        var match_dist = l - j - NICE_LEN + 1;
        if (match_len > longest_len) {
          longest_len = match_len;
          longest_dist = match_dist;
        }
      }
    }
    if (longest_len > 0) {
      ol = append_switch_code(out, olen, ol, state);
      ol = append_bits(
        out,
        olen,
        ol,
        usx_hcodes[USX_DICT],
        usx_hcode_lens[USX_DICT]
      );
      ol = encodeCount(out, olen, ol, longest_len);
      ol = encodeCount(out, olen, ol, longest_dist);
      l += longest_len + NICE_LEN;
      l--;
      return [l, ol];
    }
    return [-l, ol];
  }
  function matchLine(input, len, l, out, olen, ol, prev_lines, prev_lines_idx, state, usx_hcodes, usx_hcode_lens) {
    var last_ol = ol;
    var last_len = 0;
    var last_dist = 0;
    var last_ctx = 0;
    var line_ctr = 0;
    var j = 0;
    do {
      var i, k;
      var prev_line = prev_lines[prev_lines_idx - line_ctr];
      var line_len = prev_line.length;
      var limit = line_ctr == 0 ? l : line_len;
      for (; j < limit; j++) {
        for (i = l, k = j; k < line_len && k < limit && i < len; k++, i++) {
          if (prev_line[k] !== input[i]) break;
        }
        while (prev_line[k] >> 6 == 2) k--;
        if (k - j >= NICE_LEN) {
          if (last_len > 0) {
            if (j > last_dist) continue;
            ol = last_ol;
          }
          last_len = k - j;
          last_dist = j;
          last_ctx = line_ctr;
          ol = append_switch_code(out, olen, ol, state);
          ol = append_bits(
            out,
            olen,
            ol,
            usx_hcodes[USX_DICT],
            usx_hcode_lens[USX_DICT]
          );
          ol = encodeCount(out, olen, ol, last_len - NICE_LEN);
          ol = encodeCount(out, olen, ol, last_dist);
          ol = encodeCount(out, olen, ol, last_ctx);
          j += last_len;
        }
      }
    } while (line_ctr++ < prev_lines_idx);
    if (last_len > 0) {
      l += last_len;
      l--;
      return [l, ol];
    }
    return [-l, ol];
  }
  function getBaseCode(ch) {
    if (ch >= 48 && ch <= 57) return ch - 48 << 4;
    else if (ch >= 65 && ch <= 70) return ch - 65 + 10 << 4;
    else if (ch >= 97 && ch <= 102) return ch - 97 + 10 << 4;
    return 0;
  }
  const USX_NIB_NUM = 0;
  const USX_NIB_HEX_LOWER = 1;
  const USX_NIB_HEX_UPPER = 2;
  const USX_NIB_NOT = 3;
  function getNibbleType(ch) {
    if (ch >= 48 && ch <= 57) return USX_NIB_NUM;
    else if (ch >= 97 && ch <= 102) return USX_NIB_HEX_LOWER;
    else if (ch >= 65 && ch <= 70) return USX_NIB_HEX_UPPER;
    return USX_NIB_NOT;
  }
  function append_nibble_escape(out, olen, ol, state, usx_hcodes, usx_hcode_lens) {
    ol = append_switch_code(out, olen, ol, state);
    ol = append_bits(out, olen, ol, usx_hcodes[USX_NUM], usx_hcode_lens[USX_NUM]);
    ol = append_bits(out, olen, ol, 0, 2);
    return ol;
  }
  function append_final_bits(out, olen, ol, state, is_all_upper, usx_hcodes, usx_hcode_lens) {
    if (usx_hcode_lens[USX_ALPHA]) {
      if (USX_NUM != state) {
        ol = append_switch_code(out, olen, ol, state);
        ol = append_bits(
          out,
          olen,
          ol,
          usx_hcodes[USX_NUM],
          usx_hcode_lens[USX_NUM]
        );
      }
      ol = append_bits(
        out,
        olen,
        ol,
        usx_vcodes[TERM_CODE & 31],
        usx_vcode_lens[TERM_CODE & 31]
      );
    } else {
      ol = append_bits(
        out,
        olen,
        ol,
        TERM_BYTE_PRESET_1,
        is_all_upper ? TERM_BYTE_PRESET_1_LEN_UPPER : TERM_BYTE_PRESET_1_LEN_LOWER
      );
    }
    ol = append_bits(
      out,
      olen,
      ol,
      ol == 0 || out[(ol - 1) / 8] << (ol - 1 & 7) >= 0 ? 0 : 255,
      8 - ol % 8 & 7
    );
    return ol;
  }
  function compare_arr(arr1, arr2, is_str) {
    if (is_str) return arr1 === arr2;
    else {
      if (arr1.length !== arr2.length) return false;
      for (var i = 0; i < arr2.length; i++) {
        if (arr1.charCodeAt(i) !== arr2[i]) return false;
      }
    }
    return true;
  }
  const usx_spl_code = new Uint8Array([0, 224, 192, 240]);
  const usx_spl_code_len = new Uint8Array([1, 4, 3, 4]);
  function unishox2_compress(input, len, out, usx_hcodes, usx_hcode_lens, usx_freq_seq, usx_templates, ignoreHex) {
    var state;
    var l, ll, ol;
    var c_in, c_next;
    var prev_uni;
    var is_upper, is_all_upper;
    var prev_lines_arr = null;
    var prev_lines_idx;
    if (input instanceof Array) {
      prev_lines_arr = input;
      prev_lines_idx = len;
      input = prev_lines_arr[prev_lines_idx];
      len = input.length;
    }
    var olen = out.length;
    var is_str = typeof input == "string";
    init_coder();
    ol = 0;
    prev_uni = 0;
    state = USX_ALPHA;
    is_all_upper = false;
    ol = append_bits(out, olen, ol, 128, 1);
    for (l = 0; l < len; l++) {
      if (usx_hcode_lens[USX_DICT] > 0 && l < len - NICE_LEN + 1) {
        if (prev_lines_arr !== void 0 && prev_lines_arr != null) {
          [l, ol] = matchLine(
            input,
            len,
            l,
            out,
            olen,
            ol,
            prev_lines_arr,
            prev_lines_idx,
            state,
            usx_hcodes,
            usx_hcode_lens
          );
          if (l > 0) {
            continue;
          } else if (l < 0 && ol < 0) {
            return olen + 1;
          }
          l = -l;
        } else {
          [l, ol] = matchOccurance(
            input,
            len,
            l,
            out,
            olen,
            ol,
            state,
            usx_hcodes,
            usx_hcode_lens
          );
          if (l > 0) {
            continue;
          } else if (l < 0 && ol < 0) {
            return olen + 1;
          }
          l = -l;
        }
      }
      c_in = input[l];
      if (l > 0 && len > 4 && l < len - 4 && usx_hcode_lens[USX_NUM] > 0 && c_in <= (is_str ? "~" : 126)) {
        if (c_in == input[l - 1] && c_in == input[l + 1] && c_in == input[l + 2] && c_in == input[l + 3]) {
          var rpt_count = l + 4;
          while (rpt_count < len && input[rpt_count] == c_in) rpt_count++;
          rpt_count -= l;
          [ol, state] = append_code(
            out,
            olen,
            ol,
            RPT_CODE,
            state,
            usx_hcodes,
            usx_hcode_lens
          );
          ol = encodeCount(out, olen, ol, rpt_count - 4);
          l += rpt_count;
          l--;
          continue;
        }
      }
      if (l <= len - 36 && usx_hcode_lens[USX_NUM] > 0) {
        var hyp_code = is_str ? "-" : 45;
        var hex_type = USX_NIB_NUM;
        if (input[l + 8] === hyp_code && input[l + 13] === hyp_code && input[l + 18] === hyp_code && input[l + 23] === hyp_code) {
          var uid_pos = l;
          for (; uid_pos < l + 36; uid_pos++) {
            var c_uid = is_str ? input.charCodeAt(uid_pos) : input[uid_pos];
            if (c_uid === 45 && (uid_pos == 8 || uid_pos == 13 || uid_pos == 18 || uid_pos == 23))
              continue;
            var nib_type = getNibbleType(c_uid);
            if (nib_type == USX_NIB_NOT || ignoreHex) break;
            if (nib_type != USX_NIB_NUM) {
              if (hex_type != USX_NIB_NUM && hex_type != nib_type) break;
              hex_type = nib_type;
            }
          }
          if (uid_pos == l + 36) {
            ol = append_nibble_escape(
              out,
              olen,
              ol,
              state,
              usx_hcodes,
              usx_hcode_lens
            );
            ol = append_bits(
              out,
              olen,
              ol,
              hex_type == USX_NIB_HEX_LOWER ? 192 : 240,
              hex_type == USX_NIB_HEX_LOWER ? 3 : 5
            );
            for (uid_pos = l; uid_pos < l + 36; uid_pos++) {
              var c_uid = is_str ? input.charCodeAt(uid_pos) : input[uid_pos];
              if (c_uid !== 45)
                ol = append_bits(out, olen, ol, getBaseCode(c_uid), 4);
            }
            l += 35;
            continue;
          }
        }
      }
      if (l < len - 5 && usx_hcode_lens[USX_NUM] > 0) {
        var hex_type = USX_NIB_NUM;
        var hex_len = 0;
        do {
          var c_uid = is_str ? input.charCodeAt(l + hex_len) : input[l + hex_len];
          var nib_type = getNibbleType(c_uid);
          if (nib_type == USX_NIB_NOT || ignoreHex) break;
          if (nib_type != USX_NIB_NUM) {
            if (hex_type != USX_NIB_NUM && hex_type != nib_type) break;
            hex_type = nib_type;
          }
          hex_len++;
        } while (l + hex_len < len);
        if (hex_len > 10 && hex_type == USX_NIB_NUM) hex_type = USX_NIB_HEX_LOWER;
        if ((hex_type == USX_NIB_HEX_LOWER || hex_type == USX_NIB_HEX_UPPER) && hex_len > 3) {
          ol = append_nibble_escape(
            out,
            olen,
            ol,
            state,
            usx_hcodes,
            usx_hcode_lens
          );
          ol = append_bits(
            out,
            olen,
            ol,
            hex_type == USX_NIB_HEX_LOWER ? 128 : 224,
            hex_type == USX_NIB_HEX_LOWER ? 2 : 4
          );
          ol = encodeCount(out, olen, ol, hex_len);
          do {
            var c_uid = is_str ? input.charCodeAt(l) : input[l];
            ol = append_bits(out, olen, ol, getBaseCode(c_uid), 4);
            l++;
          } while (--hex_len > 0);
          l--;
          continue;
        }
      }
      if (usx_templates != null && usx_templates != void 0) {
        var i;
        for (i = 0; i < 5; i++) {
          if (typeof usx_templates[i] == "string") {
            var rem = usx_templates[i].length;
            var j = 0;
            for (; j < rem && l + j < len; j++) {
              var c_t = usx_templates[i][j];
              c_in = is_str ? input.charCodeAt(l + j) : input[l + j];
              if (c_t === "f" || c_t === "F") {
                if (getNibbleType(c_in) != (c_t === "f" ? USX_NIB_HEX_LOWER : USX_NIB_HEX_UPPER) && getNibbleType(c_in) != USX_NIB_NUM) {
                  break;
                }
              } else if (c_t === "r" || c_t === "t" || c_t === "o") {
                if (c_in < 48 || c_in > (c_t === "r" ? 55 : c_t === "t" ? 51 : 49))
                  break;
              } else if (c_t.charCodeAt(0) !== c_in) break;
            }
            if (j / rem > 0.66) {
              rem = rem - j;
              ol = append_nibble_escape(
                out,
                olen,
                ol,
                state,
                usx_hcodes,
                usx_hcode_lens
              );
              ol = append_bits(out, olen, ol, 0, 1);
              ol = append_bits(
                out,
                olen,
                ol,
                count_codes[i] & 248,
                count_codes[i] & 7
              );
              ol = encodeCount(out, olen, ol, rem);
              for (var k = 0; k < j; k++) {
                var c_t = usx_templates[i][k];
                c_in = is_str ? input.charCodeAt(l + k) : input[l + k];
                if (c_t === "f" || c_t === "F") {
                  ol = append_bits(out, olen, ol, getBaseCode(c_in), 4);
                } else if (c_t === "r" || c_t === "t" || c_t === "o") {
                  c_t = c_t === "r" ? 3 : c_t === "t" ? 2 : 1;
                  ol = append_bits(out, olen, ol, c_in - 48 << 8 - c_t, c_t);
                }
              }
              l += j;
              l--;
              break;
            }
          }
        }
        if (i < 5) continue;
      }
      if (usx_freq_seq != null) {
        var i;
        for (i = 0; i < 6; i++) {
          var seq_len = usx_freq_seq[i].length;
          if (len - seq_len >= 0 && l <= len - seq_len) {
            if (usx_hcode_lens[usx_freq_codes[i] >> 5] && compare_arr(
              usx_freq_seq[i].slice(0, seq_len),
              input.slice(l, l + seq_len),
              is_str
            )) {
              [ol, state] = append_code(
                out,
                olen,
                ol,
                usx_freq_codes[i],
                state,
                usx_hcodes,
                usx_hcode_lens
              );
              l += seq_len;
              l--;
              break;
            }
          }
        }
        if (i < 6) continue;
      }
      c_in = is_str ? input.charCodeAt(l) : input[l];
      is_upper = false;
      if (c_in >= 65 && c_in <= 90)
        is_upper = true;
      else {
        if (is_all_upper) {
          is_all_upper = false;
          ol = append_switch_code(out, olen, ol, state);
          ol = append_bits(
            out,
            olen,
            ol,
            usx_hcodes[USX_ALPHA],
            usx_hcode_lens[USX_ALPHA]
          );
          state = USX_ALPHA;
        }
      }
      if (is_upper && !is_all_upper) {
        if (state == USX_NUM) {
          ol = append_switch_code(out, olen, ol, state);
          ol = append_bits(
            out,
            olen,
            ol,
            usx_hcodes[USX_ALPHA],
            usx_hcode_lens[USX_ALPHA]
          );
          state = USX_ALPHA;
        }
        ol = append_switch_code(out, olen, ol, state);
        ol = append_bits(
          out,
          olen,
          ol,
          usx_hcodes[USX_ALPHA],
          usx_hcode_lens[USX_ALPHA]
        );
        if (state == USX_DELTA) {
          state = USX_ALPHA;
          ol = append_switch_code(out, olen, ol, state);
          ol = append_bits(
            out,
            olen,
            ol,
            usx_hcodes[USX_ALPHA],
            usx_hcode_lens[USX_ALPHA]
          );
        }
      }
      c_next = 0;
      if (l + 1 < len) c_next = is_str ? input.charCodeAt(l + 1) : input[l + 1];
      if (c_in >= 32 && c_in <= 126) {
        if (is_upper && !is_all_upper) {
          for (ll = l + 4; ll >= l && ll < len; ll--) {
            var c_u = is_str ? input.charCodeAt(ll) : input[ll];
            if (c_u < 65 || c_u > 90)
              break;
          }
          if (ll == l - 1) {
            ol = append_switch_code(out, olen, ol, state);
            ol = append_bits(
              out,
              olen,
              ol,
              usx_hcodes[USX_ALPHA],
              usx_hcode_lens[USX_ALPHA]
            );
            state = USX_ALPHA;
            is_all_upper = true;
          }
        }
        if (state == USX_DELTA) {
          var ch_idx = " .,".indexOf(String.fromCharCode(c_in));
          if (ch_idx != -1) {
            ol = append_bits(
              out,
              olen,
              ol,
              UNI_STATE_SPL_CODE,
              UNI_STATE_SPL_CODE_LEN
            );
            ol = append_bits(
              out,
              olen,
              ol,
              usx_spl_code[ch_idx],
              usx_spl_code_len[ch_idx]
            );
            continue;
          }
        }
        c_in -= 32;
        if (is_all_upper && is_upper) c_in += 32;
        if (c_in === 0) {
          if (state == USX_NUM)
            ol = append_bits(
              out,
              olen,
              ol,
              usx_vcodes[NUM_SPC_CODE & 31],
              usx_vcode_lens[NUM_SPC_CODE & 31]
            );
          else ol = append_bits(out, olen, ol, usx_vcodes[1], usx_vcode_lens[1]);
        } else {
          c_in = c_in - 1;
          [ol, state] = append_code(
            out,
            olen,
            ol,
            usx_code_94[c_in],
            state,
            usx_hcodes,
            usx_hcode_lens
          );
        }
      } else if (c_in === 13 && c_next === 10) {
        [ol, state] = append_code(
          out,
          olen,
          ol,
          CRLF_CODE,
          state,
          usx_hcodes,
          usx_hcode_lens
        );
        l++;
      } else if (c_in === 10) {
        if (state == USX_DELTA) {
          ol = append_bits(
            out,
            olen,
            ol,
            UNI_STATE_SPL_CODE,
            UNI_STATE_SPL_CODE_LEN
          );
          ol = append_bits(out, olen, ol, 240, 4);
        } else
          [ol, state] = append_code(
            out,
            olen,
            ol,
            LF_CODE,
            state,
            usx_hcodes,
            usx_hcode_lens
          );
      } else if (c_in === 13) {
        [ol, state] = append_code(
          out,
          olen,
          ol,
          CR_CODE,
          state,
          usx_hcodes,
          usx_hcode_lens
        );
      } else if (c_in === 9) {
        [ol, state] = append_code(
          out,
          olen,
          ol,
          TAB_CODE,
          state,
          usx_hcodes,
          usx_hcode_lens
        );
      } else {
        var uni, utf8len, uni2;
        [uni, utf8len] = readUTF8(input, len, l);
        if (uni > 0) {
          l += utf8len;
          if (state != USX_DELTA) {
            [uni2, utf8len] = readUTF8(input, len, l);
            if (uni2 > 0) {
              if (state != USX_ALPHA) {
                ol = append_switch_code(out, olen, ol, state);
                ol = append_bits(
                  out,
                  olen,
                  ol,
                  usx_hcodes[USX_ALPHA],
                  usx_hcode_lens[USX_ALPHA]
                );
              }
              ol = append_switch_code(out, olen, ol, state);
              ol = append_bits(
                out,
                olen,
                ol,
                usx_hcodes[USX_ALPHA],
                usx_hcode_lens[USX_ALPHA]
              );
              ol = append_bits(out, olen, ol, usx_vcodes[1], usx_vcode_lens[1]);
              state = USX_DELTA;
            } else {
              ol = append_switch_code(out, olen, ol, state);
              ol = append_bits(
                out,
                olen,
                ol,
                usx_hcodes[USX_DELTA],
                usx_hcode_lens[USX_DELTA]
              );
            }
          }
          ol = encodeUnicode(out, olen, ol, uni, prev_uni);
          prev_uni = uni;
          l--;
        } else {
          var bin_count = 1;
          for (var bi = l + 1; bi < len; bi++) {
            var c_bi = input[bi];
            if (readUTF8(input, len, bi) > 0) break;
            if (bi < len - 4 && c_bi === input[bi - 1] && c_bi === input[bi + 1] && c_bi === input[bi + 2] && c_bi === input[bi + 3])
              break;
            bin_count++;
          }
          ol = append_nibble_escape(
            out,
            olen,
            ol,
            state,
            usx_hcodes,
            usx_hcode_lens
          );
          ol = append_bits(out, olen, ol, 248, 5);
          ol = encodeCount(out, olen, ol, bin_count);
          do {
            ol = append_bits(out, olen, ol, input[l++], 8);
          } while (--bin_count > 0);
          l--;
        }
      }
    }
    {
      var rst = (ol + 7) / 8;
      ol = append_final_bits(
        out,
        rst,
        ol,
        state,
        is_all_upper,
        usx_hcodes,
        usx_hcode_lens
      );
      return rst;
    }
  }
  function unishox2_compress_simple(input, len, out, feq = USX_FREQ_SEQ_DFLT) {
    let CompressedStrCharArrayTest = new Uint8Array(2048);
    let Op1, Op2;
    Op1 = unishox2_compress(
      input,
      len,
      CompressedStrCharArrayTest,
      USX_HCODES_DFLT,
      USX_HCODE_LENS_DFLT,
      feq,
      USX_TEMPLATES,
      false
    );
    Op2 = unishox2_compress(
      input,
      len,
      CompressedStrCharArrayTest,
      USX_HCODES_DFLT,
      USX_HCODE_LENS_DFLT,
      feq,
      USX_TEMPLATES,
      true
    );
    CompressedStrCharArrayTest = void 0;
    if (Op1 >= Op2) {
      return unishox2_compress(
        input,
        len,
        out,
        USX_HCODES_DFLT,
        USX_HCODE_LENS_DFLT,
        feq,
        USX_TEMPLATES,
        true
      );
    } else {
      return unishox2_compress(
        input,
        len,
        out,
        USX_HCODES_DFLT,
        USX_HCODE_LENS_DFLT,
        feq,
        USX_TEMPLATES,
        false
      );
    }
  }
  function readBit(input, bit_no) {
    return input[bit_no >> 3] & 128 >> bit_no % 8;
  }
  function read8bitCode(input, len, bit_no) {
    var bit_pos = bit_no & 7;
    var char_pos = bit_no >> 3;
    len >>= 3;
    var code = input[char_pos] << bit_pos & 255;
    char_pos++;
    if (char_pos < len) {
      code |= input[char_pos] >> 8 - bit_pos;
    } else code |= 255 >> 8 - bit_pos;
    return [code, bit_no];
  }
  const SECTION_COUNT = 5;
  const usx_vsections = new Uint8Array([127, 191, 223, 239, 255]);
  const usx_vsection_pos = new Uint8Array([0, 4, 8, 12, 20]);
  const usx_vsection_mask = new Uint8Array([127, 63, 31, 15, 15]);
  const usx_vsection_shift = new Uint8Array([5, 4, 3, 1, 0]);
  const usx_vcode_lookup = new Uint8Array([
    (1 << 5) + 0,
    (1 << 5) + 0,
    (2 << 5) + 1,
    (2 << 5) + 2,
 // Section 1
    (3 << 5) + 3,
    (3 << 5) + 4,
    (3 << 5) + 5,
    (3 << 5) + 6,
 // Section 2
    (3 << 5) + 7,
    (3 << 5) + 7,
    (4 << 5) + 8,
    (4 << 5) + 9,
 // Section 3
    (5 << 5) + 10,
    (5 << 5) + 10,
    (5 << 5) + 11,
    (5 << 5) + 11,
 // Section 4
    (5 << 5) + 12,
    (5 << 5) + 12,
    (6 << 5) + 13,
    (6 << 5) + 14,
    (6 << 5) + 15,
    (6 << 5) + 15,
    (6 << 5) + 16,
    (6 << 5) + 16,
 // Section 5
    (6 << 5) + 17,
    (6 << 5) + 17,
    (7 << 5) + 18,
    (7 << 5) + 19,
    (7 << 5) + 20,
    (7 << 5) + 21,
    (7 << 5) + 22,
    (7 << 5) + 23,
    (7 << 5) + 24,
    (7 << 5) + 25,
    (7 << 5) + 26,
    (7 << 5) + 27
  ]);
  function readVCodeIdx(input, len, bit_no) {
    if (bit_no < len) {
      var code;
      [code, bit_no] = read8bitCode(input, len, bit_no);
      var i = 0;
      do {
        if (code <= usx_vsections[i]) {
          var vcode = usx_vcode_lookup[usx_vsection_pos[i] + ((code & usx_vsection_mask[i]) >> usx_vsection_shift[i])];
          bit_no += (vcode >> 5) + 1;
          if (bit_no > len) return [99, bit_no];
          return [vcode & 31, bit_no];
        }
      } while (++i < SECTION_COUNT);
    }
    return [99, bit_no];
  }
  const len_masks = new Uint8Array([
    128,
    192,
    224,
    240,
    248,
    252,
    254,
    255
  ]);
  function readHCodeIdx(input, len, bit_no, usx_hcodes, usx_hcode_lens) {
    if (!usx_hcode_lens[USX_ALPHA]) return [USX_ALPHA, bit_no];
    if (bit_no < len) {
      var code;
      [code, bit_no] = read8bitCode(input, len, bit_no);
      for (var code_pos = 0; code_pos < 5; code_pos++) {
        if (usx_hcode_lens[code_pos] > 0 && (code & len_masks[usx_hcode_lens[code_pos] - 1]) == usx_hcodes[code_pos]) {
          bit_no += usx_hcode_lens[code_pos];
          return [code_pos, bit_no];
        }
      }
    }
    return [99, bit_no];
  }
  function getStepCodeIdx(input, len, bit_no, limit) {
    var idx = 0;
    while (bit_no < len && readBit(input, bit_no) > 0) {
      idx++;
      bit_no++;
      if (idx == limit) return [idx, bit_no];
    }
    if (bit_no >= len) return [99, bit_no];
    bit_no++;
    return [idx, bit_no];
  }
  function getNumFromBits(input, len, bit_no, count) {
    var ret = 0;
    while (count-- > 0 && bit_no < len) {
      ret += readBit(input, bit_no) > 0 ? 1 << count : 0;
      bit_no++;
    }
    return count < 0 ? ret : -1;
  }
  function readCount(input, bit_no, len) {
    var idx = 0;
    [idx, bit_no] = getStepCodeIdx(input, len, bit_no, 4);
    if (idx == 99) return [-1, bit_no];
    if (bit_no + count_bit_lens[idx] - 1 >= len) return [-1, bit_no];
    var count = getNumFromBits(input, len, bit_no, count_bit_lens[idx]) + (idx > 0 ? count_adder[idx - 1] : 0);
    bit_no += count_bit_lens[idx];
    return [count, bit_no];
  }
  function readUnicode(input, bit_no, len) {
    var idx = 0;
    [idx, bit_no] = getStepCodeIdx(input, len, bit_no, 5);
    if (idx == 99) return [2147483392 + 99, bit_no];
    if (idx == 5) {
      [idx, bit_no] = getStepCodeIdx(input, len, bit_no, 4);
      return [2147483392 + idx, bit_no];
    }
    if (idx >= 0) {
      var sign = bit_no < len ? readBit(input, bit_no) : 0;
      bit_no++;
      if (bit_no + uni_bit_len[idx] - 1 >= len) return [2147483392 + 99, bit_no];
      var count = getNumFromBits(input, len, bit_no, uni_bit_len[idx]);
      count += uni_adder[idx];
      bit_no += uni_bit_len[idx];
      return [sign > 0 ? -count : count, bit_no];
    }
    return [0, bit_no];
  }
  function decodeRepeatArray(input, len, out_arr, out, bit_no, prev_lines_arr, prev_lines_idx, usx_hcodes, usx_hcode_lens, usx_freq_seq, usx_templates) {
    var dict_len = 0;
    [dict_len, bit_no] = readCount(input, bit_no, len);
    dict_len += NICE_LEN;
    if (dict_len < NICE_LEN) return [-1, out];
    var dist = 0;
    [dist, bit_no] = readCount(input, bit_no, len);
    if (dist < 0) return [-1, out];
    var ctx = 0;
    [ctx, bit_no] = readCount(input, bit_no, len);
    if (ctx < 0) return [-1, out];
    var line;
    if (ctx == 0) line = out_arr == null ? out : out_arr;
    else {
      if (prev_lines_idx < ctx) return [-1, out];
      if (out_arr == null) {
        line = unishox2_decompress(
          prev_lines_arr,
          prev_lines_idx - ctx,
          null,
          usx_hcodes,
          usx_hcode_lens,
          usx_freq_seq,
          usx_templates
        );
      } else {
        line = new Uint8Array((dist + dict_len) * 2);
        unishox2_decompress(
          prev_lines_arr,
          prev_lines_idx - ctx,
          line,
          usx_hcodes,
          usx_hcode_lens,
          usx_freq_seq,
          usx_templates
        );
      }
    }
    if (out_arr == null) {
      out += typeof line == "string" ? line.substr(dist, dict_len) : line.slice(dist, dict_len);
    } else {
      for (var i = 0; i < dict_len; i++) {
        if (out >= out_arr.length) break;
        out_arr[out] = line[dist + i];
        out++;
      }
    }
    return [bit_no, out];
  }
  function decodeRepeat(input, len, out_arr, out, bit_no) {
    var dict_len = 0;
    [dict_len, bit_no] = readCount(input, bit_no, len);
    dict_len += NICE_LEN;
    if (dict_len < NICE_LEN) return [-1, out];
    var dist = 0;
    [dist, bit_no] = readCount(input, bit_no, len);
    dist += NICE_LEN - 1;
    if (dist < NICE_LEN - 1) return [-1, out];
    if (out_arr == null) {
      if (out.length < dist) return [-1, out];
      out += out.substr(out.length - dist, dict_len);
    } else {
      for (var i = 0; i < dict_len; i++) {
        if (out >= out_arr.length) break;
        out_arr[out] = out_arr[out - dist];
        out++;
      }
    }
    return [bit_no, out];
  }
  function getHexChar(nibble, hex_type) {
    if (nibble >= 0 && nibble <= 9) return String.fromCharCode(48 + nibble);
    else if (hex_type < USX_NIB_HEX_UPPER)
      return String.fromCharCode(97 + nibble - 10);
    return String.fromCharCode(65 + nibble - 10);
  }
  function writeUTF8(out_arr, out, uni) {
    if (uni < 1 << 11) {
      out_arr[out++] = 192 + (uni >> 6);
      out_arr[out++] = 128 + (uni & 63);
    } else if (uni < 1 << 16) {
      out_arr[out++] = 224 + (uni >> 12);
      out_arr[out++] = 128 + (uni >> 6 & 63);
      out_arr[out++] = 128 + (uni & 63);
    } else {
      out_arr[out++] = 240 + (uni >> 18);
      out_arr[out++] = 128 + (uni >> 12 & 63);
      out_arr[out++] = 128 + (uni >> 6 & 63);
      out_arr[out++] = 128 + (uni & 63);
    }
    return out;
  }
  function appendChar(out_arr, out, ch) {
    if (out_arr == null) out += ch;
    else {
      if (out < out_arr.length) out_arr[out++] = ch.charCodeAt(0);
    }
    return out;
  }
  function appendString(out_arr, out, str) {
    if (out_arr == null) out += str;
    else {
      for (var i = 0; i < str.length; i++) {
        if (out >= out_arr.length) break;
        out_arr[out++] = str.charCodeAt(i);
      }
    }
    return out;
  }
  function unishox2_decompress(input, len, out_arr, usx_hcodes, usx_hcode_lens, usx_freq_seq, usx_templates) {
    var dstate;
    var bit_no;
    var h, v;
    var is_all_upper;
    var prev_lines_arr = null;
    var prev_lines_idx;
    init_coder();
    bit_no = 1;
    dstate = h = USX_ALPHA;
    is_all_upper = 0;
    var prev_uni = 0;
    if (input instanceof Array) {
      prev_lines_arr = input;
      prev_lines_idx = len;
      input = prev_lines_arr[prev_lines_idx];
      len = input.length;
    }
    len <<= 3;
    var out = out_arr == null ? "" : 0;
    while (bit_no < len) {
      var orig_bit_no = bit_no;
      if (dstate == USX_DELTA || h == USX_DELTA) {
        if (dstate != USX_DELTA) h = dstate;
        var delta;
        [delta, bit_no] = readUnicode(input, bit_no, len);
        if (delta >> 8 == 8388607) {
          var spl_code_idx = delta & 255;
          if (spl_code_idx == 99) break;
          switch (spl_code_idx) {
            case 0:
              out = appendChar(out_arr, out, " ");
              continue;
            case 1:
              [h, bit_no] = readHCodeIdx(
                input,
                len,
                bit_no,
                usx_hcodes,
                usx_hcode_lens
              );
              if (h == 99) {
                bit_no = len;
                continue;
              }
              if (h == USX_DELTA || h == USX_ALPHA) {
                dstate = h;
                continue;
              }
              if (h == USX_DICT) {
                if (prev_lines_arr == null)
                  [bit_no, out] = decodeRepeat(input, len, out_arr, out, bit_no);
                else {
                  [bit_no, out] = decodeRepeatArray(
                    input,
                    len,
                    out_arr,
                    out,
                    bit_no,
                    prev_lines_arr,
                    prev_lines_idx,
                    usx_hcodes,
                    usx_hcode_lens,
                    usx_freq_seq,
                    usx_templates
                  );
                }
                if (bit_no < 0) return out;
                h = dstate;
                continue;
              }
              break;
            case 2:
              out = appendChar(out_arr, out, ",");
              continue;
            case 3:
              out = appendChar(out_arr, out, ".");
              continue;
            case 4:
              out = appendChar(out_arr, out, String.fromCharCode(10));
              continue;
          }
        } else {
          prev_uni += delta;
          if (prev_uni > 0) {
            if (out_arr == null) out += String.fromCodePoint(prev_uni);
            else out = writeUTF8(out_arr, out, prev_uni);
          }
        }
        if (dstate == USX_DELTA && h == USX_DELTA) continue;
      } else h = dstate;
      var c = "";
      var is_upper = is_all_upper;
      [v, bit_no] = readVCodeIdx(input, len, bit_no);
      if (v == 99 || h == 99) {
        bit_no = orig_bit_no;
        break;
      }
      if (v == 0 && h != USX_SYM) {
        if (bit_no >= len) break;
        if (h != USX_NUM || dstate != USX_DELTA) {
          [h, bit_no] = readHCodeIdx(
            input,
            len,
            bit_no,
            usx_hcodes,
            usx_hcode_lens
          );
          if (h == 99 || bit_no >= len) {
            bit_no = orig_bit_no;
            break;
          }
        }
        if (h == USX_ALPHA) {
          if (dstate == USX_ALPHA) {
            if (usx_hcode_lens[USX_ALPHA] == 0 && TERM_BYTE_PRESET_1 == (read8bitCode(input, len, bit_no - SW_CODE_LEN) & 255 << 8 - (is_all_upper ? TERM_BYTE_PRESET_1_LEN_UPPER : TERM_BYTE_PRESET_1_LEN_LOWER)))
              break;
            if (is_all_upper) {
              is_upper = is_all_upper = 0;
              continue;
            }
            [v, bit_no] = readVCodeIdx(input, len, bit_no);
            if (v == 99) {
              bit_no = orig_bit_no;
              break;
            }
            if (v == 0) {
              [h, bit_no] = readHCodeIdx(
                input,
                len,
                bit_no,
                usx_hcodes,
                usx_hcode_lens
              );
              if (h == 99) {
                bit_no = orig_bit_no;
                break;
              }
              if (h == USX_ALPHA) {
                is_all_upper = 1;
                continue;
              }
            }
            is_upper = 1;
          } else {
            dstate = USX_ALPHA;
            continue;
          }
        } else if (h == USX_DICT) {
          if (prev_lines_arr == null)
            [bit_no, out] = decodeRepeat(input, len, out_arr, out, bit_no);
          else {
            [bit_no, out] = decodeRepeatArray(
              input,
              len,
              out_arr,
              out,
              bit_no,
              prev_lines_arr,
              prev_lines_idx,
              usx_hcodes,
              usx_hcode_lens,
              usx_freq_seq,
              usx_templates
            );
          }
          if (bit_no < 0) break;
          continue;
        } else if (h == USX_DELTA) {
          continue;
        } else {
          if (h != USX_NUM || dstate != USX_DELTA)
            [v, bit_no] = readVCodeIdx(input, len, bit_no);
          if (v == 99) {
            bit_no = orig_bit_no;
            break;
          }
          if (h == USX_NUM && v == 0) {
            var idx;
            [idx, bit_no] = getStepCodeIdx(input, len, bit_no, 5);
            if (idx == 99) break;
            if (idx == 0) {
              [idx, bit_no] = getStepCodeIdx(input, len, bit_no, 4);
              if (idx >= 5) break;
              var rem;
              [rem, bit_no] = readCount(input, bit_no, len);
              if (rem < 0) break;
              if (usx_templates[idx] == null) break;
              var tlen = usx_templates[idx].length;
              if (rem > tlen) break;
              rem = tlen - rem;
              var eof = false;
              for (var j = 0; j < rem; j++) {
                var c_t = usx_templates[idx][j];
                if (c_t === "f" || c_t === "r" || c_t === "t" || c_t === "o" || c_t === "F") {
                  var nibble_len = c_t === "f" || c_t === "F" ? 4 : c_t === "r" ? 3 : c_t === "t" ? 2 : 1;
                  var raw_char = getNumFromBits(input, len, bit_no, nibble_len);
                  if (raw_char < 0) {
                    eof = true;
                    break;
                  }
                  var nibble_char = getHexChar(
                    raw_char,
                    c_t === "f" ? USX_NIB_HEX_LOWER : USX_NIB_HEX_UPPER
                  );
                  out = appendChar(out_arr, out, nibble_char);
                  bit_no += nibble_len;
                } else out = appendChar(out_arr, out, c_t);
              }
              if (eof) break;
            } else if (idx == 5) {
              var bin_count;
              [bin_count, bit_no] = readCount(input, bit_no, len);
              if (bin_count < 0) break;
              if (bin_count == 0)
                break;
              do {
                var raw_char = getNumFromBits(input, len, bit_no, 8);
                if (raw_char < 0) break;
                var bin_byte = String.fromCharCode(raw_char);
                out = appendChar(out_arr, out, bin_byte);
                bit_no += 8;
              } while (--bin_count > 0);
            } else {
              var nibble_count = 0;
              if (idx == 2 || idx == 4) nibble_count = 32;
              else {
                [nibble_count, bit_no] = readCount(input, bit_no, len);
                if (nibble_count < 0) break;
                if (nibble_count == 0)
                  break;
              }
              do {
                var nibble = getNumFromBits(input, len, bit_no, 4);
                if (nibble < 0) break;
                var nibble_char = getHexChar(
                  nibble,
                  idx < 3 ? USX_NIB_HEX_LOWER : USX_NIB_HEX_UPPER
                );
                out = appendChar(out_arr, out, nibble_char);
                if ((idx == 2 || idx == 4) && (nibble_count == 25 || nibble_count == 21 || nibble_count == 17 || nibble_count == 13))
                  out = appendChar(out_arr, out, "-");
                bit_no += 4;
              } while (--nibble_count > 0);
              if (nibble_count > 0) break;
            }
            if (dstate == USX_DELTA) h = USX_DELTA;
            continue;
          }
        }
      }
      if (is_upper && v == 1) {
        h = dstate = USX_DELTA;
        continue;
      }
      if (h < 3 && v < 28) c = usx_sets[h].charAt(v);
      if (c >= "a" && c <= "z") {
        dstate = USX_ALPHA;
        if (is_upper) c = String.fromCharCode(c.charCodeAt(0) - 32);
      } else {
        if (c !== 0 && c.charCodeAt(0) >= 48 && c.charCodeAt(0) <= 57)
          dstate = USX_NUM;
        else if (c.charCodeAt(0) === 0 && c !== "0") {
          if (v == 8) {
            out = appendString(out_arr, out, "\r\n");
          } else if (h == USX_NUM && v == 26) {
            var count;
            [count, bit_no] = readCount(input, bit_no, len);
            if (count < 0) break;
            count += 4;
            var rpt_c = out_arr == null ? out.charAt(out.length - 1) : String.fromCharCode(out_arr[out - 1]);
            while (count--) out = appendChar(out_arr, out, rpt_c);
          } else if (h == USX_SYM && v > 24) {
            v -= 25;
            out = appendString(out_arr, out, usx_freq_seq[v]);
          } else if (h == USX_NUM && v > 22 && v < 26) {
            v -= 23 - 3;
            out = appendString(out_arr, out, usx_freq_seq[v]);
          } else break;
          if (dstate == USX_DELTA) h = USX_DELTA;
          continue;
        }
      }
      if (dstate == USX_DELTA) h = USX_DELTA;
      out = appendChar(out_arr, out, c);
    }
    return out;
  }
  var MersenneTwister = function(seed) {
    if (seed == void 0) {
      seed = (/* @__PURE__ */ new Date()).getTime();
    }
    this.N = 624;
    this.M = 397;
    this.MATRIX_A = 2567483615;
    this.UPPER_MASK = 2147483648;
    this.LOWER_MASK = 2147483647;
    this.mt = new Array(this.N);
    this.mti = this.N + 1;
    if (seed.constructor == Array) {
      this.init_by_array(seed, seed.length);
    } else {
      this.init_seed(seed);
    }
  };
  MersenneTwister.prototype.init_seed = function(s) {
    this.mt[0] = s >>> 0;
    for (this.mti = 1; this.mti < this.N; this.mti++) {
      var s = this.mt[this.mti - 1] ^ this.mt[this.mti - 1] >>> 30;
      this.mt[this.mti] = (((s & 4294901760) >>> 16) * 1812433253 << 16) + (s & 65535) * 1812433253 + this.mti;
      this.mt[this.mti] >>>= 0;
    }
  };
  MersenneTwister.prototype.init_by_array = function(init_key, key_length) {
    var i, j, k;
    this.init_seed(19650218);
    i = 1;
    j = 0;
    k = this.N > key_length ? this.N : key_length;
    for (; k; k--) {
      var s = this.mt[i - 1] ^ this.mt[i - 1] >>> 30;
      this.mt[i] = (this.mt[i] ^ (((s & 4294901760) >>> 16) * 1664525 << 16) + (s & 65535) * 1664525) + init_key[j] + j;
      this.mt[i] >>>= 0;
      i++;
      j++;
      if (i >= this.N) {
        this.mt[0] = this.mt[this.N - 1];
        i = 1;
      }
      if (j >= key_length) j = 0;
    }
    for (k = this.N - 1; k; k--) {
      var s = this.mt[i - 1] ^ this.mt[i - 1] >>> 30;
      this.mt[i] = (this.mt[i] ^ (((s & 4294901760) >>> 16) * 1566083941 << 16) + (s & 65535) * 1566083941) - i;
      this.mt[i] >>>= 0;
      i++;
      if (i >= this.N) {
        this.mt[0] = this.mt[this.N - 1];
        i = 1;
      }
    }
    this.mt[0] = 2147483648;
  };
  MersenneTwister.prototype.random_int = function() {
    var y;
    var mag01 = new Array(0, this.MATRIX_A);
    if (this.mti >= this.N) {
      var kk;
      if (this.mti == this.N + 1)
        this.init_seed(5489);
      for (kk = 0; kk < this.N - this.M; kk++) {
        y = this.mt[kk] & this.UPPER_MASK | this.mt[kk + 1] & this.LOWER_MASK;
        this.mt[kk] = this.mt[kk + this.M] ^ y >>> 1 ^ mag01[y & 1];
      }
      for (; kk < this.N - 1; kk++) {
        y = this.mt[kk] & this.UPPER_MASK | this.mt[kk + 1] & this.LOWER_MASK;
        this.mt[kk] = this.mt[kk + (this.M - this.N)] ^ y >>> 1 ^ mag01[y & 1];
      }
      y = this.mt[this.N - 1] & this.UPPER_MASK | this.mt[0] & this.LOWER_MASK;
      this.mt[this.N - 1] = this.mt[this.M - 1] ^ y >>> 1 ^ mag01[y & 1];
      this.mti = 0;
    }
    y = this.mt[this.mti++];
    y ^= y >>> 11;
    y ^= y << 7 & 2636928640;
    y ^= y << 15 & 4022730752;
    y ^= y >>> 18;
    return y >>> 0;
  };
  MersenneTwister.prototype.random_int31 = function() {
    return this.random_int() >>> 1;
  };
  MersenneTwister.prototype.random_incl = function() {
    return this.random_int() * (1 / 4294967295);
  };
  MersenneTwister.prototype.random = function() {
    return this.random_int() * (1 / 4294967296);
  };
  MersenneTwister.prototype.random_excl = function() {
    return (this.random_int() + 0.5) * (1 / 4294967296);
  };
  MersenneTwister.prototype.random_long = function() {
    var a = this.random_int() >>> 5, b = this.random_int() >>> 6;
    return (a * 67108864 + b) * (1 / 9007199254740992);
  };
  var mersenneTwister = MersenneTwister;
  const MersenneTwister$1 = /* @__PURE__ */ getDefaultExportFromCjs(mersenneTwister);
  const Map$1 = '{"basic":{"alphabet":{"a":["请","上","中","之","等","人","到","年","个","将"],"b":["得","可","并","发","过","协","曲","闭","斋","峦"],"c":["页","于","而","被","无","挽","裕","斜","绪","镜"],"d":["由","把","好","从","会","帕","莹","盈","敬","粒"],"e":["的","在","了","是","为","有","和","我","一","与"],"f":["站","最","号","及","能","迟","鸭","呈","玻","据"],"g":["着","很","此","但","看","浩","附","侃","汐","绸"],"h":["名","呢","又","图","啊","棉","畅","蒸","玫","添"],"i":["对","地","您","给","这","下","网","也","来","你"],"j":["更","天","去","用","只","矽","萌","镁","芯","夸"],"k":["第","者","所","两","里","氢","羟","纽","夏","春"],"l":["自","做","前","二","他","氦","汀","兰","竹","捷"],"m":["家","点","路","至","十","锂","羧","暑","夕","振"],"n":["区","想","向","主","四","铍","烃","惠","芳","岩"],"o":["就","新","吗","该","不","多","还","要","让","大"],"p":["小","如","成","位","其","硼","酞","褔","苑","笋"],"q":["吧","每","机","几","总","碳","铂","涓","绣","悦"],"r":["起","它","内","高","次","氮","铵","奏","鲤","淳"],"s":["非","元","类","五","使","氧","醇","迷","霁","琅"],"t":["首","进","即","没","市","氖","酯","琳","绫","濑"],"u":["后","三","本","都","时","月","或","说","已","以"],"v":["种","快","那","篇","万","钠","炔","柯","睿","琼"],"w":["长","按","报","比","信","硅","烷","静","欣","束"],"x":["再","带","才","全","呀","磷","烯","柔","雪","冰"],"y":["业","却","版","美","们","硫","桉","寒","冻","玖"],"z":["像","走","文","各","当","氯","缬","妃","琉","璃"],"A":["贴","则","老","生","达","商","行","周","证","经"],"B":["事","场","同","化","找","建","手","道","间","式"],"C":["特","城","型","定","接","局","问","重","叫","通"],"D":["件","少","面","金","近","买","听","学","见","称"],"E":["写","选","片","体","组","先","仅","别","表","现"],"F":["雨","泊","注","织","赴","茶","因","设","环","青"],"G":["数","心","子","处","作","项","谁","分","转","字"],"H":["砂","妥","鹦","课","栗","霞","鹉","翌","蕴","憩"],"I":["畔","珑","咫","瑞","玲","郊","蛟","昱","祉","菁"],"J":["铁","宙","耕","琴","铃","瑰","旬","茉","砺","莅"],"K":["钇","莉","筱","森","曳","苹","踵","晰","砥","舀"],"L":["锆","粟","魄","辉","谜","馅","醋","甄","韶","泪"],"M":["钌","倘","祥","善","泉","惦","铠","骏","韵","泣"],"N":["铑","筑","铿","智","禀","磊","桨","檀","荧","铭"],"O":["钯","骐","烛","蔬","凛","溯","困","炯","酿","瑕"],"P":["银","榻","驿","缎","澟","绒","莺","萤","桅","枕"],"Q":["镉","赞","瑾","程","怡","漱","穗","湍","栀","皆"],"R":["碘","礼","饴","舒","芷","麟","沥","描","锄","墩"],"S":["锡","彰","瞻","雅","贮","喵","翊","闪","翎","婉"],"T":["钨","咨","涌","益","嵩","御","饶","纺","栩","稔"],"U":["铋","骆","橘","未","泰","频","琥","囍","浣","裳"],"V":["钕","飒","浇","哦","途","瓢","珀","涨","仓","棠"],"W":["祁","蓬","灿","部","涧","舫","曙","航","礁","渡"],"X":["旺","嫦","漫","佑","钥","谧","葵","咩","诵","绮"],"Y":["阐","译","锻","茜","坞","砌","靛","猫","芮","绚"],"Z":["拌","皎","笙","沃","悟","拓","遨","揽","昼","蔗"]},"numbersymbol":{"0":["卡","风","水","放","花","钾","宏","谊","探","棋"],"1":["需","头","话","曾","楼","钙","吾","恋","菲","遥"],"2":["连","系","门","力","量","钛","苗","氛","鹤","雀"],"3":["书","亿","跟","深","方","钒","鸳","鸯","纸","鸢"],"4":["若","低","谈","明","百","铬","羯","尧","舜","兆"],"5":["关","客","读","双","回","锰","熙","瀚","渊","灯"],"6":["较","品","嘛","单","价","钴","阑","珊","雁","鹂"],"7":["山","西","动","厂","热","锌","鹃","鸠","昆","仑"],"8":["言","笑","度","易","身","镓","乾","坤","澈","饺"],"9":["份","星","千","仍","办","锗","彗","聪","慧","磋"],"+":["集","费","传","室","拉"],"/":["难","界","指","管","具"],"?":["相","儿","李","早","拿"],"-":["科","白","段","飞","住"],".":["利","红","板","光","约"],"(":["变","款","林","夹","院"],")":["服","句","声","务","游"],"[":["股","南","社","阿","远"],"]":["意","换","些","必","赛"],"<":["届","完","乐","彩","讲"],">":["展","帮","且","物","班"],",":["何","流","密","某","房"],"|":["语","亚","常","除","装"],"=":["极","载","题","刚","气"],"@":["米","影","德","世","坐"],"#":["北","招","短","活","斯"],"!":["值","店","树","哪","余"],"~":["盘","速","座","求","创"],"`":["梦","足","半","视","安"],"$":["空","歌","派","顶","登"],"%":["夜","云","感","啦","欲"],"^":["边","工","眼","街","奖"],"&":["获","占","理","任","实"],"*":["知","掉","色","讯","克"],"_":["直","评","往","层","园"],"{":["留","靠","亦","罗","营"],"}":["合","尚","产","诚","汨"],":":["曱","朩","杉","杸","歩"],";":["毋","氕","気","氘","氙"]}},"special":{"DECRYPT":{"JP":["桜","込","凪","雫","実","沢"],"CN":["玚","俟","玊","欤","瞐","珏"]}}}';
  var RoundFlip$1 = 0;
  var RoundControl$1 = new Uint8Array(32);
  const LETTERS$1 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var LETTERS_ROUND_1$1 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var LETTERS_ROUND_2$1 = "FbPoDRStyJKAUcdahfVXlqwnOGpHZejzvmrBCigQILxkYMuWTEsN";
  var LETTERS_ROUND_3$1 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const BIG_LETTERS$1 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const NUMBERS$1 = "1234567890";
  const SYMBOLS$1 = "+=_-/?.>,<|`~!@#$%^&*(){}[];:";
  const NUMBERSYMBOL$1 = "1234567890+=_-/?.>,<|`~!@#$%^&*(){}[];:";
  var NUMBERSYMBOL_ROUND_1$1 = "1234567890+=_-/?.>,<|`~!@#$%^&*(){}[];:";
  var NUMBERSYMBOL_ROUND_2$1 = "~3{8}_-$[6(2^&#5|1*%0,<9:`+@7/?.>4=];!)";
  var NUMBERSYMBOL_ROUND_3$1 = "1234567890+=_-/?.>,<|`~!@#$%^&*(){}[];:";
  const SIG_DECRYPT_JP = "桜込凪雫実沢";
  const SIG_DECRYPT_CN = "玚俟玊欤瞐珏";
  const NULL_STR$1 = "孎";
  var MT$1 = new MersenneTwister$1(Date.now());
  const CHINESE_WEBPAN_LIB$1 = [
    "https://",
    "lanzou",
    "pan.quark.cn",
    "pan.baidu.com",
    "aliyundrive.com",
    "123pan.com"
  ];
  const INTER_WEBPAN_LIB$1 = [
    "https://",
    "mypikpak.com",
    "mega.nz",
    "drive.google.com",
    "sharepoint.com",
    "1drv.ms"
  ];
  const CHINESE_WEBSITE_LIB$1 = [
    "https://",
    "baidu.com",
    "b23.tv",
    "bilibili.com",
    "weibo.com",
    "weixin.qq.com"
  ];
  const INTER_WEBSITE_LIB$1 = [
    "https://",
    "google.com",
    "youtube.com",
    "x.com",
    "twitter.com",
    "telegra.ph"
  ];
  const INTER_WEBSITE_LIB_2$1 = [
    "https://",
    "wikipedia.org",
    "github.com",
    "pages.dev",
    "github.io",
    "netlify.app"
  ];
  const JAPAN_WEBSITE_LIB$1 = [
    "https://",
    "pixiv.net",
    "nicovideo.jp",
    "dlsite.com",
    "line.me",
    "dmm.com"
  ];
  const PIRACY_WEBSITE_LIB$1 = [
    "https://",
    "nyaa.si",
    "bangumi.moe",
    "thepiratebay.org",
    "e-hentai.org",
    "exhentai.org"
  ];
  const GENERIC_TLINK_LIB$1 = [
    "https://",
    "magnet:?xt=urn:btih:",
    "magnet:?xt=urn:sha1:",
    "ed2k://",
    "thunder://",
    "torrent"
  ];
  const GENERIC_LINK_LIB_1$1 = ["https://", ".cn", ".com", ".net", ".org", ".xyz"];
  const GENERIC_LINK_LIB_2$1 = ["https://", ".info", ".moe", ".cc", ".co", ".dev"];
  const GENERIC_LINK_LIB_3$1 = ["https://", ".io", ".us", ".eu", ".jp", ".de"];
  const Map_Obj$1 = JSON.parse(Map$1);
  function AES_256_CTR_E$1(Uint8attr, key, RandomBytes) {
    let KeyHash = CryptoJS.SHA256(key);
    let HashArray = wordArrayToUint8Array$1(KeyHash);
    let TempArray = new Uint8Array(HashArray.byteLength + 2);
    TempArray.set(HashArray, 0);
    TempArray.set([RandomBytes[0], RandomBytes[1]], HashArray.byteLength);
    HashArray = TempArray;
    let HashWithRandom = CryptoJS.lib.WordArray.create(HashArray);
    let KeyHashHash = CryptoJS.SHA256(HashWithRandom);
    let HashHashArray = wordArrayToUint8Array$1(KeyHashHash);
    let ivArray = new Uint8Array(16);
    for (var i = 0; i < 16; i++) {
      ivArray[i] = HashHashArray[i];
    }
    let iv = CryptoJS.lib.WordArray.create(ivArray);
    let msg = CryptoJS.lib.WordArray.create(Uint8attr);
    let Enc = CryptoJS.AES.encrypt(msg, KeyHash, {
      mode: CryptoJS.mode.CTR,
      padding: CryptoJS.pad.NoPadding,
      iv
    });
    return wordArrayToUint8Array$1(Enc.ciphertext);
  }
  function GZIP_COMPRESS$1(Data) {
    let DataOutput = pako.gzip(Data);
    if (DataOutput.byteLength >= Data.byteLength) {
      return Data;
    }
    return DataOutput;
  }
  function GZIP_DECOMPRESS$1(Data) {
    const firstTwoBytes = new Uint8Array(Data.buffer, 0, 2);
    if (firstTwoBytes[0] === 31 && firstTwoBytes[1] === 139) {
      let DataOutput = pako.ungzip(Data);
      return DataOutput;
    } else {
      return Data;
    }
  }
  function UNISHOX_COMPRESS$1(Data) {
    let CompressedStrCharArray = new Uint8Array(2048);
    let Datastr = Uint8ArrayTostring$1(Data);
    let libmark = 255;
    for (let i = 1; i < 6; i++) {
      if (Datastr.indexOf(CHINESE_WEBPAN_LIB$1[i]) != -1) {
        libmark = 254;
        break;
      }
      if (Datastr.indexOf(INTER_WEBPAN_LIB$1[i]) != -1) {
        libmark = 245;
        break;
      }
    }
    if (libmark == 255) {
      for (let i = 1; i < 6; i++) {
        if (Datastr.indexOf(CHINESE_WEBSITE_LIB$1[i]) != -1) {
          libmark = 253;
          break;
        }
        if (Datastr.indexOf(INTER_WEBSITE_LIB$1[i]) != -1) {
          libmark = 252;
          break;
        }
        if (Datastr.indexOf(INTER_WEBSITE_LIB_2$1[i]) != -1) {
          libmark = 244;
          break;
        }
        if (Datastr.indexOf(JAPAN_WEBSITE_LIB$1[i]) != -1) {
          libmark = 251;
          break;
        }
        if (Datastr.indexOf(PIRACY_WEBSITE_LIB$1[i]) != -1) {
          libmark = 250;
          break;
        }
      }
    }
    if (libmark == 255) {
      for (let i = 1; i < 6; i++) {
        if (Datastr.indexOf(GENERIC_TLINK_LIB$1[i]) != -1) {
          libmark = 249;
          break;
        }
        if (Datastr.indexOf(GENERIC_LINK_LIB_1$1[i]) != -1) {
          libmark = 248;
          break;
        }
        if (Datastr.indexOf(GENERIC_LINK_LIB_2$1[i]) != -1) {
          libmark = 247;
          break;
        }
        if (Datastr.indexOf(GENERIC_LINK_LIB_3$1[i]) != -1) {
          libmark = 246;
          break;
        }
      }
    }
    let Outlen;
    switch (libmark) {
      case 255:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray
        );
        break;
      case 254:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          CHINESE_WEBPAN_LIB$1
        );
        break;
      case 245:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          INTER_WEBPAN_LIB$1
        );
        break;
      case 253:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          CHINESE_WEBSITE_LIB$1
        );
        break;
      case 252:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          INTER_WEBSITE_LIB$1
        );
        break;
      case 244:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          INTER_WEBSITE_LIB_2$1
        );
        break;
      case 251:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          JAPAN_WEBSITE_LIB$1
        );
        break;
      case 250:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          PIRACY_WEBSITE_LIB$1
        );
        break;
      case 249:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          GENERIC_TLINK_LIB$1
        );
        break;
      case 248:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          GENERIC_LINK_LIB_1$1
        );
        break;
      case 247:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          GENERIC_LINK_LIB_2$1
        );
        break;
      case 246:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          GENERIC_LINK_LIB_3$1
        );
        break;
    }
    let ResStrCharArray = CompressedStrCharArray.subarray(0, Outlen);
    if (ResStrCharArray.byteLength >= Data.byteLength) {
      return Data;
    }
    let TempArray = new Uint8Array(ResStrCharArray.byteLength + 2);
    TempArray.set(ResStrCharArray, 0);
    TempArray.set([libmark, 255], ResStrCharArray.byteLength);
    ResStrCharArray = TempArray;
    return ResStrCharArray;
  }
  function UNISHOX_DECOMPRESS$1(Data) {
    const lastElement = Data[Data.byteLength - 1];
    const secondLastElement = Data[Data.byteLength - 2];
    if (lastElement != 255 || secondLastElement < 244 || secondLastElement > 255) {
      return Data;
    }
    let libmark = secondLastElement;
    let NewData = Data.subarray(0, Data.byteLength - 2);
    let DecompressedStrCharArray = new Uint8Array(2048);
    let Outlen;
    switch (libmark) {
      case 255:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          USX_FREQ_SEQ_DFLT,
          USX_TEMPLATES
        );
        break;
      case 254:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          CHINESE_WEBPAN_LIB$1,
          USX_TEMPLATES
        );
        break;
      case 245:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          INTER_WEBPAN_LIB$1,
          USX_TEMPLATES
        );
        break;
      case 253:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          CHINESE_WEBSITE_LIB$1,
          USX_TEMPLATES
        );
        break;
      case 252:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          INTER_WEBSITE_LIB$1,
          USX_TEMPLATES
        );
        break;
      case 244:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          INTER_WEBSITE_LIB_2$1,
          USX_TEMPLATES
        );
        break;
      case 251:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          JAPAN_WEBSITE_LIB$1,
          USX_TEMPLATES
        );
        break;
      case 250:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          PIRACY_WEBSITE_LIB$1,
          USX_TEMPLATES
        );
        break;
      case 249:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          GENERIC_TLINK_LIB$1,
          USX_TEMPLATES
        );
        break;
      case 248:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          GENERIC_LINK_LIB_1$1,
          USX_TEMPLATES
        );
        break;
      case 247:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          GENERIC_LINK_LIB_2$1,
          USX_TEMPLATES
        );
        break;
      case 246:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          GENERIC_LINK_LIB_3$1,
          USX_TEMPLATES
        );
        break;
    }
    let ResStrCharArray = DecompressedStrCharArray.subarray(0, Outlen);
    return ResStrCharArray;
  }
  function GetLuhnBit$1(Data) {
    let Digit = new Array();
    let num, digit;
    for (let i = 0; i < Data.byteLength; i++) {
      num = Data[i];
      while (num > 0) {
        digit = num % 10;
        Digit.push(digit);
        num = Math.floor(num / 10);
      }
    }
    let sum = 0;
    let Check = 0;
    for (let i = 0; i < Digit.length; i++) {
      if (i % 2 != 0) {
        Digit[i] = Digit[i] * 2;
        if (Digit[i] >= 10) {
          Digit[i] = Digit[i] % 10 + Math.floor(Digit[i] / 10);
        }
      }
      sum = sum + Digit[i];
    }
    Check = 10 - sum % 10;
    return Check;
  }
  function CheckLuhnBit$1(Data) {
    let DCheck = Data[Data.byteLength - 1];
    let Check = GetLuhnBit$1(Data.subarray(0, Data.byteLength - 1));
    if (Check == DCheck) {
      return true;
    } else {
      return false;
    }
  }
  function RemovePadding$1(Base64String) {
    let PaddingCount = 0;
    for (let i = Base64String.length - 1; i >= Base64String.length - 4; i--) {
      if (Base64String[i] == "=") {
        PaddingCount++;
      }
    }
    return Base64String.slice(0, Base64String.length - PaddingCount);
  }
  function AddPadding$1(Base64String) {
    if (Base64String.length % 4 == 3) {
      return Base64String + "=";
    } else if (Base64String.length % 4 == 2) {
      return Base64String + "==";
    } else {
      return Base64String;
    }
  }
  function wordArrayToUint8Array$1(data) {
    const dataArray = new Uint8Array(data.sigBytes);
    for (let i = 0; i < data.sigBytes; i++) {
      dataArray[i] = data.words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
    }
    return dataArray;
  }
  function stringToUint8Array(str) {
    let tempBase64 = gBase64.encode(str);
    return gBase64.toUint8Array(tempBase64);
  }
  function Uint8ArrayTostring$1(fileData) {
    let tempBase64 = gBase64.fromUint8Array(fileData);
    return gBase64.decode(tempBase64);
  }
  function setCharOnIndex(string, index, char) {
    if (index > string.length - 1) return string;
    return string.substring(0, index) + char + string.substring(index + 1);
  }
  function GetRandomIndex$1(length) {
    let Rand = Math.floor(MT$1.random() * length);
    return Rand;
  }
  function insertStringAtIndex(str, value, index) {
    return str.slice(0, index) + value + str.slice(index);
  }
  function difference(arr1, arr2) {
    return arr1.filter((item) => !arr2.includes(item));
  }
  function rotateString$1(str, n) {
    return str.slice(n) + str.slice(0, n);
  }
  function LrotateString$1(str, n) {
    return str.slice(str.length - n) + str.slice(0, str.length - n);
  }
  function RoundKeyMatch$1(keyIn) {
    let idx1, idx2;
    let idx1_1, idx2_1;
    let idx1_2, idx2_2;
    idx1 = LETTERS$1.indexOf(keyIn);
    idx2 = NUMBERSYMBOL$1.indexOf(keyIn);
    idx1_1 = LETTERS$1.indexOf(LETTERS_ROUND_1$1[idx1]);
    idx2_1 = NUMBERSYMBOL$1.indexOf(NUMBERSYMBOL_ROUND_1$1[idx2]);
    idx1_2 = LETTERS$1.indexOf(LETTERS_ROUND_2$1[idx1_1]);
    idx2_2 = NUMBERSYMBOL$1.indexOf(NUMBERSYMBOL_ROUND_2$1[idx2_1]);
    if (idx1 != -1) {
      return LETTERS_ROUND_3$1[idx1_2];
    } else if (idx2 != -1) {
      return NUMBERSYMBOL_ROUND_3$1[idx2_2];
    }
    return NULL_STR$1;
  }
  function DRoundKeyMatch$1(keyIn) {
    let idx1, idx2;
    let idx1_1, idx2_1;
    let idx1_2, idx2_2;
    idx1 = LETTERS_ROUND_3$1.indexOf(keyIn);
    idx2 = NUMBERSYMBOL_ROUND_3$1.indexOf(keyIn);
    idx1_1 = LETTERS_ROUND_2$1.indexOf(LETTERS$1[idx1]);
    idx2_1 = NUMBERSYMBOL_ROUND_2$1.indexOf(NUMBERSYMBOL$1[idx2]);
    idx1_2 = LETTERS_ROUND_1$1.indexOf(LETTERS$1[idx1_1]);
    idx2_2 = NUMBERSYMBOL_ROUND_1$1.indexOf(NUMBERSYMBOL$1[idx2_1]);
    if (idx1 != -1) {
      return LETTERS$1[idx1_2];
    } else if (idx2 != -1) {
      return NUMBERSYMBOL$1[idx2_2];
    }
    return NULL_STR$1;
  }
  function RoundKey$1() {
    let ControlNum = 0;
    if (RoundFlip$1 == 32) {
      RoundFlip$1 = 0;
    }
    ControlNum = RoundControl$1[RoundFlip$1] % 10;
    if (ControlNum == 0) {
      ControlNum = 10;
    }
    if (ControlNum % 2 == 0) {
      LETTERS_ROUND_1$1 = rotateString$1(LETTERS_ROUND_1$1, 6);
      NUMBERSYMBOL_ROUND_1$1 = rotateString$1(NUMBERSYMBOL_ROUND_1$1, 6);
      LETTERS_ROUND_2$1 = LrotateString$1(LETTERS_ROUND_2$1, ControlNum * 2);
      NUMBERSYMBOL_ROUND_2$1 = LrotateString$1(NUMBERSYMBOL_ROUND_2$1, ControlNum * 2);
      LETTERS_ROUND_3$1 = rotateString$1(LETTERS_ROUND_3$1, ControlNum / 2 + 1);
      NUMBERSYMBOL_ROUND_3$1 = rotateString$1(
        NUMBERSYMBOL_ROUND_3$1,
        ControlNum / 2 + 1
      );
    } else {
      LETTERS_ROUND_1$1 = LrotateString$1(LETTERS_ROUND_1$1, 3);
      NUMBERSYMBOL_ROUND_1$1 = LrotateString$1(NUMBERSYMBOL_ROUND_1$1, 3);
      LETTERS_ROUND_2$1 = rotateString$1(LETTERS_ROUND_2$1, ControlNum);
      NUMBERSYMBOL_ROUND_2$1 = rotateString$1(NUMBERSYMBOL_ROUND_2$1, ControlNum);
      LETTERS_ROUND_3$1 = LrotateString$1(LETTERS_ROUND_3$1, (ControlNum + 7) / 2);
      NUMBERSYMBOL_ROUND_3$1 = LrotateString$1(
        NUMBERSYMBOL_ROUND_3$1,
        (ControlNum + 7) / 2
      );
    }
    RoundFlip$1++;
  }
  function RoundReset$1() {
    RoundFlip$1 = 0;
    RoundControl$1 = new Array(32);
    LETTERS_ROUND_1$1 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    LETTERS_ROUND_2$1 = "FbPoDRStyJKAUcdahfVXlqwnOGpHZejzvmrBCigQILxkYMuWTEsN";
    LETTERS_ROUND_3$1 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    NUMBERSYMBOL_ROUND_1$1 = "1234567890+=_-/?.>,<|`~!@#$%^&*(){}[];:";
    NUMBERSYMBOL_ROUND_2$1 = "~3{8}_-$[6(2^&#5|1*%0,<9:`+@7/?.>4=];!)";
    NUMBERSYMBOL_ROUND_3$1 = "1234567890+=_-/?.>,<|`~!@#$%^&*(){}[];:";
    MT$1 = new MersenneTwister$1(Date.now());
  }
  function RoundControlInit$1(key) {
    let KeyHash = CryptoJS.SHA256(key);
    let HashArray = wordArrayToUint8Array$1(KeyHash);
    RoundControl$1 = HashArray;
  }
  class PreCheckResult {
    constructor(output, isEncrypted = false) {
      this.output = output;
      this.isEncrypted = isEncrypted;
    }
  }
  function preCheck(inp) {
    let input = String(inp);
    let size = input.length;
    let temp;
    let isEncrypted = false;
    let isJPFound = false;
    let isCNFound = false;
    for (let i = 0; i < size; i++) {
      temp = input[i];
      if (i != size - 1) {
        input[i + 1];
      }
      if (SIG_DECRYPT_JP.indexOf(temp) != -1) {
        input = setCharOnIndex(input, i, NULL_STR$1);
        isJPFound = true;
        continue;
      }
      if (SIG_DECRYPT_CN.indexOf(temp) != -1) {
        input = setCharOnIndex(input, i, NULL_STR$1);
        isCNFound = true;
        continue;
      }
    }
    if (isJPFound && isCNFound) {
      isEncrypted = true;
    }
    let Result = new PreCheckResult(stringToUint8Array(input), isEncrypted);
    return Result;
  }
  function enMap$1(input, key, q) {
    RoundReset$1();
    RoundControlInit$1(key);
    let OriginalData = new Uint8Array();
    OriginalData = input.output;
    Uint8ArrayTostring$1(OriginalData);
    let TempArray = new Uint8Array(OriginalData.byteLength + 1);
    TempArray.set(OriginalData, 0);
    TempArray.set([GetLuhnBit$1(OriginalData)], OriginalData.byteLength);
    OriginalData = TempArray;
    if (OriginalData.byteLength <= 1024) {
      let SizeBefore = OriginalData.byteLength;
      OriginalData = UNISHOX_COMPRESS$1(OriginalData);
      if (OriginalData.byteLength == SizeBefore) {
        OriginalData = GZIP_COMPRESS$1(OriginalData);
      }
    } else {
      OriginalData = GZIP_COMPRESS$1(OriginalData);
    }
    let RandomBytes = new Array();
    RandomBytes.push(GetRandomIndex$1(256));
    RandomBytes.push(GetRandomIndex$1(256));
    OriginalData = AES_256_CTR_E$1(OriginalData, key, RandomBytes);
    TempArray = new Uint8Array(OriginalData.byteLength + 2);
    TempArray.set(OriginalData, 0);
    TempArray.set(RandomBytes, OriginalData.byteLength);
    OriginalData = TempArray;
    let OriginStr = RemovePadding$1(gBase64.fromUint8Array(OriginalData));
    let TempStr1 = "", temp = "";
    let size = OriginStr.length;
    RoundKey$1();
    for (let i = 0; i < size; i++) {
      temp = OriginStr[i];
      if (i != size - 1) {
        OriginStr[i + 1];
      }
      TempStr1 = TempStr1 + getCryptText$1(temp);
      RoundKey$1();
    }
    if (q) {
      RoundReset$1();
      return TempStr1;
    }
    let RandIndex, RandIndex2;
    let Avoid = new Array();
    for (let q2 = 0; q2 < 2; q2++) {
      let PosToInset = new Array();
      let size2 = TempStr1.length;
      for (let i = 0; i < size2; i++) {
        PosToInset.push(i);
      }
      if (q2 == 0) {
        RandIndex = PosToInset[GetRandomIndex$1(PosToInset.length)];
        RandIndex2 = GetRandomIndex$1(Map_Obj$1["special"]["DECRYPT"]["JP"].length);
        let stemp = Map_Obj$1["special"]["DECRYPT"]["JP"][RandIndex2];
        TempStr1 = insertStringAtIndex(TempStr1, stemp, RandIndex);
        for (let z = RandIndex + 1; z < RandIndex + stemp.length; z++) {
          Avoid.push(z);
        }
      } else if (q2 == 1) {
        let AvailPos = new Array();
        AvailPos = difference(PosToInset, Avoid);
        RandIndex = AvailPos[GetRandomIndex$1(AvailPos.length)];
        RandIndex2 = GetRandomIndex$1(Map_Obj$1["special"]["DECRYPT"]["CN"].length);
        TempStr1 = insertStringAtIndex(
          TempStr1,
          Map_Obj$1["special"]["DECRYPT"]["CN"][RandIndex2],
          RandIndex
        );
      }
    }
    RoundReset$1();
    return TempStr1;
  }
  function deMap$1(input, key) {
    RoundReset$1();
    RoundControlInit$1(key);
    let OriginStr = Uint8ArrayTostring$1(input.output);
    let TempStr1 = "", TempStrz = "";
    let temp = "", findtemp = "";
    let size = OriginStr.length;
    for (let i = 0; i < size; i++) {
      temp = OriginStr[i];
      if (temp == NULL_STR$1 || temp == " " || temp == "\n" || temp == "	") {
        continue;
      } else {
        TempStrz = TempStrz + temp;
        continue;
      }
    }
    size = TempStrz.length;
    OriginStr = TempStrz;
    RoundKey$1();
    for (let i = 0; i < size; ) {
      temp = OriginStr[i];
      if (i != size - 1) {
        OriginStr[i + 1];
      }
      findtemp = findOriginText$1(temp);
      if (findtemp == NULL_STR$1) {
        throw "Bad Input. Try force encrypt if intended.";
      }
      TempStr1 = TempStr1 + findtemp;
      RoundKey$1();
      i++;
    }
    TempStr1 = AddPadding$1(TempStr1);
    let TempStr2Int = new Uint8Array();
    let RandomBytes = new Array(2);
    if (!gBase64.isValid(TempStr1)) {
      throw "Error Decoding. Bad Input or Incorrect Key.";
    }
    try {
      TempStr2Int = gBase64.toUint8Array(TempStr1);
      RandomBytes[1] = TempStr2Int.at(TempStr2Int.byteLength - 1);
      RandomBytes[0] = TempStr2Int.at(TempStr2Int.byteLength - 2);
      TempStr2Int = TempStr2Int.subarray(0, TempStr2Int.byteLength - 2);
      TempStr2Int = AES_256_CTR_E$1(TempStr2Int, key, RandomBytes);
      TempStr2Int = GZIP_DECOMPRESS$1(TempStr2Int);
      TempStr2Int = UNISHOX_DECOMPRESS$1(TempStr2Int);
    } catch (err2) {
      throw "Error Decoding. Bad Input or Incorrect Key.";
    }
    if (!CheckLuhnBit$1(TempStr2Int)) {
      if (TempStr2Int.at(TempStr2Int.byteLength - 1) == 2 && TempStr2Int.at(TempStr2Int.byteLength - 2) == 2 && TempStr2Int.at(TempStr2Int.byteLength - 3) == 2) {
        TempStr2Int = TempStr2Int.subarray(0, TempStr2Int.byteLength - 3);
      } else {
        throw "Error Decrypting. Checksum Mismatch.";
      }
    } else {
      TempStr2Int = TempStr2Int.subarray(0, TempStr2Int.byteLength - 1);
    }
    let Res = new Object();
    Res.output = Uint8ArrayTostring$1(TempStr2Int);
    Res.output_B = TempStr2Int;
    RoundReset$1();
    return Res;
  }
  function getCryptText$1(text) {
    let letter = String(text);
    let idx, idx2, idx3, idx4;
    idx = LETTERS$1.indexOf(letter);
    idx2 = BIG_LETTERS$1.indexOf(letter);
    idx3 = NUMBERS$1.indexOf(letter);
    idx4 = SYMBOLS$1.indexOf(letter);
    let RandIndex;
    if (idx != -1 || idx2 != -1) {
      for (let key in Map_Obj$1["basic"]["alphabet"]) {
        if (Map_Obj$1["basic"]["alphabet"].hasOwnProperty(key)) {
          if (key == letter) {
            RandIndex = GetRandomIndex$1(
              Map_Obj$1["basic"]["alphabet"][RoundKeyMatch$1(key)].length
            );
            let s2 = Map_Obj$1["basic"]["alphabet"][RoundKeyMatch$1(key)][RandIndex];
            return s2;
          } else if (key.toUpperCase() == letter) {
            RandIndex = GetRandomIndex$1(
              Map_Obj$1["basic"]["alphabet"][RoundKeyMatch$1(key.toUpperCase())].length
            );
            let s2 = String(
              Map_Obj$1["basic"]["alphabet"][RoundKeyMatch$1(key.toUpperCase())][RandIndex]
            );
            return s2;
          }
        }
      }
    } else if (idx3 != -1 || idx4 != -1) {
      for (let key in Map_Obj$1["basic"]["numbersymbol"]) {
        if (Map_Obj$1["basic"]["numbersymbol"].hasOwnProperty(key)) {
          if (key == letter) {
            RandIndex = GetRandomIndex$1(
              Map_Obj$1["basic"]["numbersymbol"][RoundKeyMatch$1(key)].length
            );
            let s2 = Map_Obj$1["basic"]["numbersymbol"][RoundKeyMatch$1(key)][RandIndex];
            return s2;
          }
        }
      }
    }
    return NULL_STR$1;
  }
  function findOriginText$1(text) {
    let letter = String(text);
    let res;
    for (let key in Map_Obj$1["basic"]["alphabet"]) {
      Map_Obj$1["basic"]["alphabet"][key].forEach((item) => {
        if (letter == item) {
          res = DRoundKeyMatch$1(key);
        }
      });
    }
    if (res) {
      return res;
    }
    for (let key in Map_Obj$1["basic"]["numbersymbol"]) {
      Map_Obj$1["basic"]["numbersymbol"][key].forEach((item) => {
        if (letter == item) {
          res = DRoundKeyMatch$1(key);
        }
      });
    }
    if (res) {
      return res;
    } else {
      return NULL_STR$1;
    }
  }
  const Map = '{"Actual":{"N":{"alphabet":{"a":"人","b":"镜","c":"鹏","d":"曲","e":"霞","f":"绸","g":"裳","h":"路","i":"岩","j":"叶","k":"鲤","l":"月","m":"雪","n":"冰","o":"局","p":"恋","q":"福","r":"铃","s":"琴","t":"家","u":"天","v":"韵","w":"书","x":"莺","y":"璃","z":"雨","A":"文","B":"涧","C":"水","D":"花","E":"风","F":"棋","G":"楼","H":"鹤","I":"鸢","J":"灯","K":"雁","L":"星","M":"声","N":"树","O":"茶","P":"竹","Q":"兰","R":"苗","S":"心","T":"语","U":"礼","V":"梦","W":"庭","X":"木","Y":"驿","Z":"火"},"numbersymbol":{"0":"森","1":"夏","2":"光","3":"林","4":"物","5":"云","6":"夜","7":"城","8":"春","9":"空","+":"雀","/":"鹂","=":"鸳"}},"V":{"alphabet":{"a":"关","b":"赴","c":"呈","d":"添","e":"停","f":"成","g":"走","h":"达","i":"行","j":"称","k":"见","l":"学","m":"听","n":"买","o":"作","p":"弹","q":"写","r":"定","s":"谈","t":"动","u":"旅","v":"返","w":"度","x":"开","y":"筑","z":"选","A":"流","B":"指","C":"换","D":"探","E":"放","F":"看","G":"报","H":"事","I":"泊","J":"现","K":"迸","L":"彰","M":"需","N":"飞","O":"游","P":"求","Q":"御","R":"航","S":"歌","T":"读","U":"振","V":"登","W":"任","X":"留","Y":"奏","Z":"连"},"numbersymbol":{"0":"知","1":"至","2":"致","3":"去","4":"画","5":"说","6":"进","7":"信","8":"取","9":"问","+":"笑","/":"视","=":"言"}},"MV":["欲","应","可","能","将","请","想","必","当"],"A":{"alphabet":{"a":"莹","b":"畅","c":"新","d":"高","e":"静","f":"美","g":"绿","h":"佳","i":"善","j":"良","k":"瀚","l":"明","m":"早","n":"宏","o":"青","p":"遥","q":"速","r":"慧","s":"绚","t":"绮","u":"寒","v":"冷","w":"银","x":"灵","y":"绣","z":"北","A":"临","B":"南","C":"俊","D":"捷","E":"骏","F":"益","G":"雅","H":"舒","I":"智","J":"谜","K":"彩","L":"余","M":"短","N":"秋","O":"乐","P":"怡","Q":"瑞","R":"惠","S":"和","T":"纯","U":"悦","V":"迷","W":"长","X":"少","Y":"近","Z":"清"},"numbersymbol":{"0":"远","1":"极","2":"安","3":"聪","4":"秀","5":"旧","6":"浩","7":"盈","8":"快","9":"悠","+":"后","/":"轻","=":"坚"}},"AD":{"alphabet":{"a":"诚","b":"畅","c":"新","d":"高","e":"静","f":"恒","g":"愈","h":"谨","i":"善","j":"良","k":"频","l":"笃","m":"早","n":"湛","o":"昭","p":"遥","q":"速","r":"朗","s":"祗","t":"攸","u":"徐","v":"咸","w":"皆","x":"灵","y":"恭","z":"弥","A":"临","B":"允","C":"公","D":"捷","E":"淳","F":"益","G":"雅","H":"舒","I":"嘉","J":"勤","K":"协","L":"永","M":"短","N":"歆","O":"乐","P":"怡","Q":"已","R":"忻","S":"和","T":"谧","U":"悦","V":"稍","W":"长","X":"少","Y":"近","Z":"尚"},"numbersymbol":{"0":"远","1":"极","2":"安","3":"竟","4":"悉","5":"渐","6":"颇","7":"辄","8":"快","9":"悠","+":"后","/":"轻","=":"曾"}}},"Virtual":{"zhi":["之"],"hu":["乎"],"zhe":["者"],"ye":["也"],"for":["为"],"ba":["把"],"le":["了"],"er":["而"],"this":["此","斯"],"still":["仍"],"with":["与","同"],"also":["亦","也"],"is":["是","乃"],"not":["未","莫"],"or":["或"],"more":["更"],"make":["使","将","让"],"and":["与","同"],"anti":["非","不"],"why":["为何","奈何","何哉"],"but":["但","却","则","而","况","且"],"like":["似","如","若"],"if":["若","倘"],"int":["哉","呼","噫"],"self":["自"],"by":["以","于"]},"Sentences":{"Begin":["1D/非/N/ye","1B/N/曰","1B/若夫/N","1C/anti/MV/V/ye/P","2B/A/N/曰","2B/N/以/A","2C/N/anti/在/A","2C/N/make/N/zhi","2C/MV/N/zhe/A","2E/有/N/则/A","2C/V/zhe/V/zhi","2D/but/MV/A/zhe/A","3C/N/V/by/N","3B/初，/N/V/by/N","3B/夫/N/anti/V/by/N","3B/AD/V/zhi/谓/A","3B/V/而/V/zhi/zhi/谓/A","3B/N/，/N/zhi/N/ye/P","3D/A/之/V/者/必/有/N/P","4D/非/N/不/A/，/V/不/A","4C/A/N/AD/V","4C/V/N/以/V/N","4E/N/不在/A/，/有/N/则/A/P","4D/A/N/常有/，/而/A/N/不常有/P","4D/V/N/者/，/N/之/N/也/P","4E/N/有/MV/V/，/N/有/AD/然/P","4D/N/无/N/，/无以/V/N","4D/V/之/不/为/N/，/V/之/不/为/N/P","5D/V/N/而/V/A/，/V/zhi/道/ye/P","5E/N/zhi/V/V/，/实为/A/A/P","5C/本/MV/V/A/，/anti/V/N/N","5C/N/之/无/N/，/N/V/之/N","5D/V/N/而/V/之/者/，/非/其/N/AD/也/P","5B/今/V/N/以/V/A/N","5B/N/乃/V/V/N/zhi/N","5B/今/N/乃/A/N/A/N","5C/A/N/V/A/N","5B/夫/N/、/N/不/MV/AD/V/N","5D/不/有/A/N/，/何/V/A/N/Q","5D/以/A/N/为/N/者/，/N/MV/弗/而/V/之/P","6B/以/N/V/，/like/V/N/V/N","6B/A/N/zhi/N/，/V/zhi/以/V/其/N","6B/A/N/V/于/N/而/V/N","6B/A/N/未/V/N/、/N/之/N","6D/不/V/N/，/不/V/N/，/当/以/AD/V/论/P","6D/A/则为/V/N/，/A/则为/V/N/P","6D/若/居/A/N/之/N/，/则/当/A/N/之/V/P","6D/N/无/N/则/V/，/N/无/N/则/V/P","7D/夫/A/之/N/V/N/者/，/其/所以/AD/V/者/N/也/P","6D/A/者/V/而/V/之/，/A/者/V/而/V/之/P","6D/N/受/命/于/N/，/固/AD/然/V/于/A/N/P","7C/N/以/A/A/，/AD/V/A/N","7B/V/N/A/，/A/N/V/N","7B/N/V/以/N/V/，/V/不/V/N","7C/N/N/V/N/，/A/于/N/N","7D/MV/AD/V/A/N/，/but/V/V/不/A","7C/或/V/N/V/N/，/V/N/于/N","7E/则有/N/A/N/A/，/N/N/具/V","7D/V/A/N/zhe/，/常/V/其/所/A/，/而/V/其/所/A/P","7D/A/N/之/N/不在/N/，/在乎/A/N/之/N/也/P","8D/V/A/N/，/V/A/N/，/by/MV/A/zhi/N/P","8D/N/anti/AD/V/zhe/by/AD/V/zhe/V/，/anti/MV/AD/V/P","8D/N/anti/MV/V/N/，/still/继/N/V/，/why/，/and/N/而/anti/V/N/ye/P","8C/V/N/A/A/，/V/N/A/A","8C/N/V/A/N/，/N/V/A/N","8C/N/在/A/N/，/A/N/zhi/A/，/V/于/N/P","8C/A/N/AD/V/，/N/N/AD/V","8C/A/N/V/N/，/N/N/V/N/P","8B/尝/V/A/N/，/AD/V/A/N/zhi/N","8D/予/V/夫/A/N/A/N/，/在/A/N/之/N","8D/N/V/于/A/N/，/而/N/V/于/A/N","8D/虽/无/N/N/zhi/V/，/亦/V/以/AD/V/A/N/P","9D/A/N/V/zhi/而不/V/zhi/、亦/make/A/N/er/复/V/A/N/ye/P","9D/N/MV/V/N/V/V/，/but/N/N/AD/V/P","9B/以/N/，/当/V/A/N/，/非/N/V/N/所/MV/AD/V/P","9C/此/N/有/A/N/A/N/，/A/N/A/N/P","9D/是/N/ye/，/N/A/N/A/，/N/A/N/A/P"],"Main":["1B/非/N/ye","1C/anti/MV/V/ye","2C/N/make/N/zhi","2C/MV/N/zhe/A","2E/有/N/则/A","2C/V/zhe/V/zhi","2C/but/MV/A/zhe/A","3C/N/with/N/V","3B/N/曰，何/A/zhi/V/Q","4C/A/N/AD/V","4C/V/N/以/V/N","4D/N/无/N/，/无以/V/N/P","4D/V/N/者/，/N/之/N/也/P","4E/N/不在/A/，/有/N/则/A/P","4C/N/有/MV/V/，/N/有/AD/然/P","4D/N/非/V/而/V/之/者/，/孰/MV/无/N/P","4D/A/N/常有/，/而/A/N/不常有/P","4C/不/以/N/V/，/不/以/N/V/P","4D/V/之/不/为/N/，/V/之/不/为/N/P","5B/今/V/N/以/V/A/N","5B/N/乃/V/V/N/zhi/N","5C/本/MV/V/A/，/anti/V/N/N","5D/V/N/而/V/之/者/，/非/其/N/AD/也/P","5D/以/A/N/为/N/者/，/N/MV/弗/而/V/之/P","5B/今/N/乃/A/N/A/N","5E/每/有/V/N/，/便/AD/然/V/N/P","5D/N/V/而/A/N/V/也","5E/不/有/A/N/，/何/V/A/N/Q","5C/N/之/无/N/，/N/V/之/N","6D/N/A/N/A/，/则/所/V/得/其/A/P","6B/以/N/V/，/like/V/N/V/N","6C/N/V/，/V/N/V/N","6E/虽/V/V/A/A/，/A/A/不/同/P","6D/而/A/N/zhi/N/，/V/zhi/以/V/其/N/P","6B/A/N/V/于/N/而/V/N","6B/A/N/未/V/N/、/N/之/N","6C/V/A/N/，/V/A/N","6D/V/MV/with/其/N/，/而/V/MV/V/以/N/者/，/N/也/P","6D/A/N/必/有/A/N/V/之者/、/予/可/无/N/也/P","6D/将/有/V/，/则/V/A/N/以/V/N/P","6D/不/V/N/，/不/V/N/，/当/以/AD/V/论/P","6D/A/则为/V/N/，/A/则为/V/N/P","6D/N/无/N/则/V/，/N/无/N/则/V/P","6D/A/者/V/而/V/之/，/A/者/V/而/V/之/P","6D/若/居/A/N/之/N/，/则/当/A/N/之/V/P","6D/N/受/命/于/N/，/固/AD/然/V/于/A/N/P","7D/夫/A/之/N/V/N/者/，/其/所以/AD/V/者/N/也/P","7B/N/V/以/N/V/，/V/不/V/N","7C/N/N/V/N/，/A/于/N/N","7D/MV/AD/V/A/N/，/but/V/V/不/A","7C/或/V/N/V/N/，/V/N/于/N","7D/V/A/N/zhe/，/常/V/其/所/A/，/而/V/其/所/A/P","7D/A/N/之/不/V/也/AD/矣/，/欲/N/之/无/N/也/AD/矣/P","7D/A/N/之/N/不在/N/，/在乎/A/N/之/N/也/P","7D/A/N/之/N/，/V/之/N/而/V/之/N/也/P","7D/是故/A/N/不必不如/N/，/N/不必/A/于/A/N/P","7B/有/A/N/、/A/N/、/A/N/之/N/P","8D/N/anti/MV/V/N/，/still/继/N/V/，/why/，/and/N/而/anti/V/N/ye/P","8E/是/故/无/A/无/A/，/无/A/无/A/，/N/之/所/V/、/N/之/所/V/ye/P","8C/V/N/A/A/，/V/N/A/A","8B/N/在/A/N/，/A/N/zhi/A/，/V/于/N/P","8B/like/A/N/V/N/，/不/V/N/V/之/N/P","8C/A/N/AD/V/，/N/N/AD/V","8C/A/N/V/N/，/N/N/V/N/P","8D/虽/无/N/N/zhi/V/，/亦/V/以/AD/V/A/N/P","8D/予/V/夫/A/N/A/N/，/在/A/N/之/N","8D/故/V/A/N/者/，/当/V/A/N/之/A/N/P","8D/N/V/于/A/N/，/而/N/V/于/A/N","8B/A/N/MV/A/N/之/A/，/V/N/中/之/A","8D/N/V/于/A/N/之上/，/AD/V/于/A/N/之间/P","8B/使/其/A/N/AD/V/，/A/N/AD/V/P","9B/N/MV/V/N/V/V/，/but/N/N/AD/V","9D/A/N/V/zhi/而不/V/zhi/、亦/make/A/N/er/复/V/A/N/ye/P","9D/以/N/，/当/V/A/N/，/非/N/V/N/所/MV/AD/V/P","9C/此/N/有/A/N/A/N/，/A/N/A/N/P","9E/是/N/ye/，/N/A/N/A/，/N/A/N/A","9E/V/A/N/，/N/A/N/A/，/乃/AD/V"],"End":["1B/非/N/ye","1C/anti/MV/V/ye","2C/唯/N/V/zhi","2B/V/by/N","2D/其/also/A/hu/其/V/ye/P","2C/N/make/N/zhi","2C/MV/N/zhe/A","2E/有/N/则/A","2C/V/zhe/V/zhi","2C/but/MV/A/zhe/A","3C/V/在/A/N","3D/今/zhi/V/zhe/，/亦将有/V/于/this/N/P","3D/某也/A/，/某也/A/，/可/不/A/哉","4B/V/N/zhi/N/by/N","4C/A/N/AD/V","4C/V/N/以/V/N","4D/N/无/N/，/无以/V/N","4D/V/N/者/，/N/之/N/也/P","4D/噫/，/A/N/ye/，/N/谁/与/V/Q","4C/不/以/N/V/，/不/以/N/V/P","4D/V/之/不/为/N/，/V/之/不/为/N/P","5B/请/V/N/zhi/N/中/，/是/N/zhi/N/P","5D/今/V/N/以/V/A/N","5B/N/乃/V/V/N/zhi/N","5C/本/MV/V/A/，/anti/V/N/N","5D/V/N/而/V/之/者/，/非/其/N/AD/也/P","5D/以/A/N/为/N/者/，/N/MV/弗/而/V/之/P","5B/今/N/乃/A/N/A/N","5D/N/V/而/A/N/V/也","5E/不/有/A/N/，/何/V/A/N/Q","5C/N/之/无/N/，/N/V/之/N","6D/以/N/V/，/like/V/N/V/N","6D/A/zhi/V/N/，/亦/like/今/zhi/V/N/，/A/夫/P","6D/A/者/V/而/V/之/，/A/者/V/而/V/之/P","6D/若/居/A/N/之/N/，/则/当/A/N/之/V/P","6B/N/V/，/V/N/V/N","6E/V/N/之/N/，/为/N/V/者/，/可以/V/矣/P","6D/V/MV/with/其/N/，/而/V/MV/V/以/N/者/，/N/也/P","6D/A/N/必/有/A/N/V/之者/、/予/可/无/N/也/P","6E/虽/V/V/A/A/，/A/A/不/同/P","6D/将/有/V/，/则/V/A/N/以/V/N/P","6D/不/V/N/，/不/V/N/，/当/以/AD/V/论/P","6D/A/则为/V/N/，/A/则为/V/N/P","6D/N/受/命/于/N/，/固/AD/然/V/于/A/N/P","6D/N/无/N/则/V/，/N/无/N/则/V/P","6D/N/A/N/A/，/则/所/V/得/其/A/P","7D/夫/A/之/N/V/N/者/，/其/所以/AD/V/者/N/也/P","7D/N/V/以/N/V/，/V/不/V/N","7C/N/N/V/N/，/A/于/N/N","7D/MV/AD/V/A/N/，/but/V/V/不/A","7E/或/V/N/V/N/，/V/N/于/N","7D/A/N/之/N/不在/N/，/在乎/A/N/之/N/也/P","7D/A/N/之/N/，/V/之/N/而/V/之/N/也/P","7D/是故/A/N/不必不如/N/，/N/不必/A/于/A/N/P","7B/有/A/N/、/A/N/、/A/N/之/N/P","8E/虽/N/A/N/A/，/所/以/V/N/，其/N/A/ye/P","8B/like/A/N/V/N/，/不/V/N/V/之/N/P","8D/何必/V/N/V/N/，/V/N/zhi/N/N/哉/P","8D/N/anti/MV/V/N/，/still/继/N/V/，/why/，/and/N/而/anti/V/N/ye/P","8C/V/N/A/A/，/V/N/A/A","8B/N/在/A/N/，/A/N/zhi/A/，/V/于/N/P","8C/A/N/AD/V/，/N/N/AD/V","8D/虽/无/N/N/zhi/V/，/亦/V/以/AD/V/A/N/P","8D/故/V/A/N/者/，/当/V/A/N/之/A/N/P","8D/N/V/于/A/N/之上/，/AD/V/于/A/N/之间/P","8C/使/其/A/N/AD/V/，/A/N/AD/V/P","9D/A/N/V/zhi/而不/V/zhi/、亦/make/A/N/er/复/V/A/N/ye/P","9B/N/MV/V/N/V/V/，/but/N/N/AD/V","9D/以/N/，/当/V/A/N/，/非/N/V/N/所/MV/AD/V/P","9C/此/N/有/A/N/A/N/，/A/N/A/N/P","9B/是/N/ye/，/N/A/N/A/，/N/A/N/A/P"]}}';
  var RoundFlip = 0;
  var RoundControl = new Uint8Array(32);
  const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var LETTERS_ROUND_1 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var LETTERS_ROUND_2 = "FbPoDRStyJKAUcdahfVXlqwnOGpHZejzvmrBCigQILxkYMuWTEsN";
  var LETTERS_ROUND_3 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const BIG_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const NUMBERS = "1234567890";
  const SYMBOLS = "+/=";
  const NUMBERSYMBOL = "0123456789+/=";
  var NUMBERSYMBOL_ROUND_1 = "0123456789+/=";
  var NUMBERSYMBOL_ROUND_2 = "5=0764+389/12";
  var NUMBERSYMBOL_ROUND_3 = "0123456789+/=";
  const NULL_STR = "孎";
  var MT = new MersenneTwister$1(Date.now());
  const CHINESE_WEBPAN_LIB = [
    "https://",
    "lanzou",
    "pan.quark.cn",
    "pan.baidu.com",
    "aliyundrive.com",
    "123pan.com"
  ];
  const INTER_WEBPAN_LIB = [
    "https://",
    "mypikpak.com",
    "mega.nz",
    "drive.google.com",
    "sharepoint.com",
    "1drv.ms"
  ];
  const CHINESE_WEBSITE_LIB = [
    "https://",
    "baidu.com",
    "b23.tv",
    "bilibili.com",
    "weibo.com",
    "weixin.qq.com"
  ];
  const INTER_WEBSITE_LIB = [
    "https://",
    "google.com",
    "youtube.com",
    "x.com",
    "twitter.com",
    "telegra.ph"
  ];
  const INTER_WEBSITE_LIB_2 = [
    "https://",
    "wikipedia.org",
    "github.com",
    "pages.dev",
    "github.io",
    "netlify.app"
  ];
  const JAPAN_WEBSITE_LIB = [
    "https://",
    "pixiv.net",
    "nicovideo.jp",
    "dlsite.com",
    "line.me",
    "dmm.com"
  ];
  const PIRACY_WEBSITE_LIB = [
    "https://",
    "nyaa.si",
    "bangumi.moe",
    "thepiratebay.org",
    "e-hentai.org",
    "exhentai.org"
  ];
  const GENERIC_TLINK_LIB = [
    "https://",
    "magnet:?xt=urn:btih:",
    "magnet:?xt=urn:sha1:",
    "ed2k://",
    "thunder://",
    "torrent"
  ];
  const GENERIC_LINK_LIB_1 = ["https://", ".cn", ".com", ".net", ".org", ".xyz"];
  const GENERIC_LINK_LIB_2 = ["https://", ".info", ".moe", ".cc", ".co", ".dev"];
  const GENERIC_LINK_LIB_3 = ["https://", ".io", ".us", ".eu", ".jp", ".de"];
  const GENERIC_LINK_LIB_4 = [
    "https://",
    ".top",
    ".one",
    ".online",
    ".me",
    ".ca"
  ];
  const Map_Obj = JSON.parse(Map);
  let DecodeTable = {};
  let PayloadLetter = "";
  const CompatibilityDecodeTable = { q: ["褔"] };
  function InitDecodeTable() {
    DecodeTable = {};
    PayloadLetter = "";
    for (let i = 0; i < 52; i++) {
      DecodeTable[LETTERS[i]] = [];
      DecodeTable[LETTERS[i]].push(
        Map_Obj["Actual"]["N"]["alphabet"][LETTERS[i]]
      );
      DecodeTable[LETTERS[i]].push(
        Map_Obj["Actual"]["A"]["alphabet"][LETTERS[i]]
      );
      DecodeTable[LETTERS[i]].push(
        Map_Obj["Actual"]["V"]["alphabet"][LETTERS[i]]
      );
      if (CompatibilityDecodeTable.hasOwnProperty(LETTERS[i])) {
        CompatibilityDecodeTable[LETTERS[i]].forEach((item) => {
          DecodeTable[LETTERS[i]].push(item);
          PayloadLetter = PayloadLetter + item;
        });
      }
      PayloadLetter = PayloadLetter + Map_Obj["Actual"]["N"]["alphabet"][LETTERS[i]];
      PayloadLetter = PayloadLetter + Map_Obj["Actual"]["A"]["alphabet"][LETTERS[i]];
      PayloadLetter = PayloadLetter + Map_Obj["Actual"]["V"]["alphabet"][LETTERS[i]];
      if (Map_Obj["Actual"]["A"]["alphabet"][LETTERS[i]] != Map_Obj["Actual"]["AD"]["alphabet"][LETTERS[i]]) {
        DecodeTable[LETTERS[i]].push(
          Map_Obj["Actual"]["AD"]["alphabet"][LETTERS[i]]
        );
        PayloadLetter = PayloadLetter + Map_Obj["Actual"]["AD"]["alphabet"][LETTERS[i]];
      }
    }
    for (let i = 0; i < 13; i++) {
      DecodeTable[NUMBERSYMBOL[i]] = [];
      DecodeTable[NUMBERSYMBOL[i]].push(
        Map_Obj["Actual"]["N"]["numbersymbol"][NUMBERSYMBOL[i]]
      );
      DecodeTable[NUMBERSYMBOL[i]].push(
        Map_Obj["Actual"]["A"]["numbersymbol"][NUMBERSYMBOL[i]]
      );
      DecodeTable[NUMBERSYMBOL[i]].push(
        Map_Obj["Actual"]["V"]["numbersymbol"][NUMBERSYMBOL[i]]
      );
      PayloadLetter = PayloadLetter + Map_Obj["Actual"]["N"]["numbersymbol"][NUMBERSYMBOL[i]];
      PayloadLetter = PayloadLetter + Map_Obj["Actual"]["A"]["numbersymbol"][NUMBERSYMBOL[i]];
      PayloadLetter = PayloadLetter + Map_Obj["Actual"]["V"]["numbersymbol"][NUMBERSYMBOL[i]];
      if (Map_Obj["Actual"]["A"]["numbersymbol"][NUMBERSYMBOL[i]] != Map_Obj["Actual"]["AD"]["numbersymbol"][NUMBERSYMBOL[i]]) {
        DecodeTable[NUMBERSYMBOL[i]].push(
          Map_Obj["Actual"]["AD"]["numbersymbol"][NUMBERSYMBOL[i]]
        );
        PayloadLetter = PayloadLetter + Map_Obj["Actual"]["AD"]["numbersymbol"][NUMBERSYMBOL[i]];
      }
    }
  }
  function AES_256_CTR_E(Uint8attr, key, RandomBytes) {
    let KeyHash = CryptoJS.SHA256(key);
    let HashArray = wordArrayToUint8Array(KeyHash);
    let TempArray = new Uint8Array(HashArray.byteLength + 2);
    TempArray.set(HashArray, 0);
    TempArray.set([RandomBytes[0], RandomBytes[1]], HashArray.byteLength);
    HashArray = TempArray;
    let HashWithRandom = CryptoJS.lib.WordArray.create(HashArray);
    let KeyHashHash = CryptoJS.SHA256(HashWithRandom);
    let HashHashArray = wordArrayToUint8Array(KeyHashHash);
    let ivArray = new Uint8Array(16);
    for (var i = 0; i < 16; i++) {
      ivArray[i] = HashHashArray[i];
    }
    let iv = CryptoJS.lib.WordArray.create(ivArray);
    let msg = CryptoJS.lib.WordArray.create(Uint8attr);
    let Enc = CryptoJS.AES.encrypt(msg, KeyHash, {
      mode: CryptoJS.mode.CTR,
      padding: CryptoJS.pad.NoPadding,
      iv
    });
    return wordArrayToUint8Array(Enc.ciphertext);
  }
  function GZIP_COMPRESS(Data) {
    let DataOutput = pako.gzip(Data);
    if (DataOutput.byteLength >= Data.byteLength) {
      return Data;
    }
    return DataOutput;
  }
  function GZIP_DECOMPRESS(Data) {
    const firstTwoBytes = new Uint8Array(Data.buffer, 0, 2);
    if (firstTwoBytes[0] === 31 && firstTwoBytes[1] === 139) {
      let DataOutput = pako.ungzip(Data);
      return DataOutput;
    } else {
      return Data;
    }
  }
  function UNISHOX_COMPRESS(Data) {
    let CompressedStrCharArray = new Uint8Array(2048);
    let Datastr = Uint8ArrayTostring(Data);
    let libmark = 255;
    for (let i = 1; i < 6; i++) {
      if (Datastr.indexOf(CHINESE_WEBPAN_LIB[i]) != -1) {
        libmark = 254;
        break;
      }
      if (Datastr.indexOf(INTER_WEBPAN_LIB[i]) != -1) {
        libmark = 245;
        break;
      }
    }
    if (libmark == 255) {
      for (let i = 1; i < 6; i++) {
        if (Datastr.indexOf(CHINESE_WEBSITE_LIB[i]) != -1) {
          libmark = 253;
          break;
        }
        if (Datastr.indexOf(INTER_WEBSITE_LIB[i]) != -1) {
          libmark = 252;
          break;
        }
        if (Datastr.indexOf(INTER_WEBSITE_LIB_2[i]) != -1) {
          libmark = 244;
          break;
        }
        if (Datastr.indexOf(JAPAN_WEBSITE_LIB[i]) != -1) {
          libmark = 251;
          break;
        }
        if (Datastr.indexOf(PIRACY_WEBSITE_LIB[i]) != -1) {
          libmark = 250;
          break;
        }
      }
    }
    if (libmark == 255) {
      for (let i = 1; i < 6; i++) {
        if (Datastr.indexOf(GENERIC_TLINK_LIB[i]) != -1) {
          libmark = 249;
          break;
        }
        if (Datastr.indexOf(GENERIC_LINK_LIB_1[i]) != -1) {
          libmark = 248;
          break;
        }
        if (Datastr.indexOf(GENERIC_LINK_LIB_2[i]) != -1) {
          libmark = 247;
          break;
        }
        if (Datastr.indexOf(GENERIC_LINK_LIB_3[i]) != -1) {
          libmark = 246;
          break;
        }
        if (Datastr.indexOf(GENERIC_LINK_LIB_4[i]) != -1) {
          libmark = 243;
          break;
        }
      }
    }
    let Outlen;
    switch (libmark) {
      case 255:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray
        );
        break;
      case 254:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          CHINESE_WEBPAN_LIB
        );
        break;
      case 245:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          INTER_WEBPAN_LIB
        );
        break;
      case 253:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          CHINESE_WEBSITE_LIB
        );
        break;
      case 252:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          INTER_WEBSITE_LIB
        );
        break;
      case 244:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          INTER_WEBSITE_LIB_2
        );
        break;
      case 251:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          JAPAN_WEBSITE_LIB
        );
        break;
      case 250:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          PIRACY_WEBSITE_LIB
        );
        break;
      case 249:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          GENERIC_TLINK_LIB
        );
        break;
      case 248:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          GENERIC_LINK_LIB_1
        );
        break;
      case 247:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          GENERIC_LINK_LIB_2
        );
        break;
      case 246:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          GENERIC_LINK_LIB_3
        );
        break;
      case 243:
        Outlen = unishox2_compress_simple(
          Data,
          Data.byteLength,
          CompressedStrCharArray,
          GENERIC_LINK_LIB_4
        );
        break;
    }
    let ResStrCharArray = CompressedStrCharArray.subarray(0, Outlen);
    if (ResStrCharArray.byteLength >= Data.byteLength) {
      return Data;
    }
    let TempArray = new Uint8Array(ResStrCharArray.byteLength + 2);
    TempArray.set(ResStrCharArray, 0);
    TempArray.set([libmark, 255], ResStrCharArray.byteLength);
    ResStrCharArray = TempArray;
    return ResStrCharArray;
  }
  function UNISHOX_DECOMPRESS(Data) {
    const lastElement = Data[Data.byteLength - 1];
    const secondLastElement = Data[Data.byteLength - 2];
    if (lastElement != 255 || secondLastElement < 243 || secondLastElement > 255) {
      return Data;
    }
    let libmark = secondLastElement;
    let NewData = Data.subarray(0, Data.byteLength - 2);
    let DecompressedStrCharArray = new Uint8Array(2048);
    let Outlen;
    switch (libmark) {
      case 255:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          USX_FREQ_SEQ_DFLT,
          USX_TEMPLATES
        );
        break;
      case 254:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          CHINESE_WEBPAN_LIB,
          USX_TEMPLATES
        );
        break;
      case 245:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          INTER_WEBPAN_LIB,
          USX_TEMPLATES
        );
        break;
      case 253:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          CHINESE_WEBSITE_LIB,
          USX_TEMPLATES
        );
        break;
      case 252:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          INTER_WEBSITE_LIB,
          USX_TEMPLATES
        );
        break;
      case 244:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          INTER_WEBSITE_LIB_2,
          USX_TEMPLATES
        );
        break;
      case 251:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          JAPAN_WEBSITE_LIB,
          USX_TEMPLATES
        );
        break;
      case 250:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          PIRACY_WEBSITE_LIB,
          USX_TEMPLATES
        );
        break;
      case 249:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          GENERIC_TLINK_LIB,
          USX_TEMPLATES
        );
        break;
      case 248:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          GENERIC_LINK_LIB_1,
          USX_TEMPLATES
        );
        break;
      case 247:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          GENERIC_LINK_LIB_2,
          USX_TEMPLATES
        );
        break;
      case 246:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          GENERIC_LINK_LIB_3,
          USX_TEMPLATES
        );
        break;
      case 243:
        Outlen = unishox2_decompress(
          NewData,
          NewData.byteLength,
          DecompressedStrCharArray,
          USX_HCODES_DFLT,
          USX_HCODE_LENS_DFLT,
          GENERIC_LINK_LIB_4,
          USX_TEMPLATES
        );
        break;
    }
    let ResStrCharArray = DecompressedStrCharArray.subarray(0, Outlen);
    return ResStrCharArray;
  }
  function GetLuhnBit(Data) {
    let Digit = new Array();
    let num, digit;
    for (let i = 0; i < Data.byteLength; i++) {
      num = Data[i];
      while (num > 0) {
        digit = num % 10;
        Digit.push(digit);
        num = Math.floor(num / 10);
      }
    }
    let sum = 0;
    let Check = 0;
    for (let i = 0; i < Digit.length; i++) {
      if (i % 2 != 0) {
        Digit[i] = Digit[i] * 2;
        if (Digit[i] >= 10) {
          Digit[i] = Digit[i] % 10 + Math.floor(Digit[i] / 10);
        }
      }
      sum = sum + Digit[i];
    }
    Check = 10 - sum % 10;
    return Check;
  }
  function CheckLuhnBit(Data) {
    let DCheck = Data[Data.byteLength - 1];
    let Check = GetLuhnBit(Data.subarray(0, Data.byteLength - 1));
    if (Check == DCheck) {
      return true;
    } else {
      return false;
    }
  }
  function RemovePadding(Base64String) {
    let PaddingCount = 0;
    for (let i = Base64String.length - 1; i >= Base64String.length - 4; i--) {
      if (Base64String[i] == "=") {
        PaddingCount++;
      }
    }
    return Base64String.slice(0, Base64String.length - PaddingCount);
  }
  function AddPadding(Base64String) {
    if (Base64String.length % 4 == 3) {
      return Base64String + "=";
    } else if (Base64String.length % 4 == 2) {
      return Base64String + "==";
    } else {
      return Base64String;
    }
  }
  function wordArrayToUint8Array(data) {
    const dataArray = new Uint8Array(data.sigBytes);
    for (let i = 0; i < data.sigBytes; i++) {
      dataArray[i] = data.words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
    }
    return dataArray;
  }
  function Uint8ArrayTostring(fileData) {
    let tempBase64 = gBase64.fromUint8Array(fileData);
    return gBase64.decode(tempBase64);
  }
  function GetRandomIndex(length) {
    let Rand = Math.floor(MT.random() * length);
    return Rand;
  }
  function rotateString(str, n) {
    return str.slice(n) + str.slice(0, n);
  }
  function LrotateString(str, n) {
    return str.slice(str.length - n) + str.slice(0, str.length - n);
  }
  function RoundKeyMatch(keyIn) {
    let idx1, idx2;
    let idx1_1, idx2_1;
    let idx1_2, idx2_2;
    idx1 = LETTERS.indexOf(keyIn);
    idx2 = NUMBERSYMBOL.indexOf(keyIn);
    idx1_1 = LETTERS.indexOf(LETTERS_ROUND_1[idx1]);
    idx2_1 = NUMBERSYMBOL.indexOf(NUMBERSYMBOL_ROUND_1[idx2]);
    idx1_2 = LETTERS.indexOf(LETTERS_ROUND_2[idx1_1]);
    idx2_2 = NUMBERSYMBOL.indexOf(NUMBERSYMBOL_ROUND_2[idx2_1]);
    if (idx1 != -1) {
      return LETTERS_ROUND_3[idx1_2];
    } else if (idx2 != -1) {
      return NUMBERSYMBOL_ROUND_3[idx2_2];
    }
    return NULL_STR;
  }
  function DRoundKeyMatch(keyIn) {
    let idx1, idx2;
    let idx1_1, idx2_1;
    let idx1_2, idx2_2;
    idx1 = LETTERS_ROUND_3.indexOf(keyIn);
    idx2 = NUMBERSYMBOL_ROUND_3.indexOf(keyIn);
    idx1_1 = LETTERS_ROUND_2.indexOf(LETTERS[idx1]);
    idx2_1 = NUMBERSYMBOL_ROUND_2.indexOf(NUMBERSYMBOL[idx2]);
    idx1_2 = LETTERS_ROUND_1.indexOf(LETTERS[idx1_1]);
    idx2_2 = NUMBERSYMBOL_ROUND_1.indexOf(NUMBERSYMBOL[idx2_1]);
    if (idx1 != -1) {
      return LETTERS[idx1_2];
    } else if (idx2 != -1) {
      return NUMBERSYMBOL[idx2_2];
    }
    return NULL_STR;
  }
  function RoundKey() {
    let ControlNum = 0;
    if (RoundFlip == 32) {
      RoundFlip = 0;
    }
    ControlNum = RoundControl[RoundFlip] % 10;
    if (ControlNum == 0) {
      ControlNum = 10;
    }
    if (ControlNum % 2 == 0) {
      LETTERS_ROUND_1 = rotateString(LETTERS_ROUND_1, 6);
      NUMBERSYMBOL_ROUND_1 = rotateString(NUMBERSYMBOL_ROUND_1, 6);
      LETTERS_ROUND_2 = LrotateString(LETTERS_ROUND_2, ControlNum);
      NUMBERSYMBOL_ROUND_2 = LrotateString(NUMBERSYMBOL_ROUND_2, ControlNum);
      LETTERS_ROUND_3 = rotateString(LETTERS_ROUND_3, ControlNum / 2 + 1);
      NUMBERSYMBOL_ROUND_3 = rotateString(
        NUMBERSYMBOL_ROUND_3,
        ControlNum / 2 + 1
      );
    } else {
      LETTERS_ROUND_1 = LrotateString(LETTERS_ROUND_1, 3);
      NUMBERSYMBOL_ROUND_1 = LrotateString(NUMBERSYMBOL_ROUND_1, 3);
      LETTERS_ROUND_2 = rotateString(LETTERS_ROUND_2, ControlNum);
      NUMBERSYMBOL_ROUND_2 = rotateString(NUMBERSYMBOL_ROUND_2, ControlNum);
      LETTERS_ROUND_3 = LrotateString(LETTERS_ROUND_3, (ControlNum + 7) / 2);
      NUMBERSYMBOL_ROUND_3 = LrotateString(
        NUMBERSYMBOL_ROUND_3,
        (ControlNum + 7) / 2
      );
    }
    RoundFlip++;
  }
  function RoundReset() {
    RoundFlip = 0;
    RoundControl = new Array(32);
    LETTERS_ROUND_1 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    LETTERS_ROUND_2 = "FbPoDRStyJKAUcdahfVXlqwnOGpHZejzvmrBCigQILxkYMuWTEsN";
    LETTERS_ROUND_3 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    NUMBERSYMBOL_ROUND_1 = "1234567890+/=";
    NUMBERSYMBOL_ROUND_2 = "5=0764+389/12";
    NUMBERSYMBOL_ROUND_3 = "1234567890+/=";
    MT = new MersenneTwister$1(Date.now());
  }
  function RoundControlInit(key) {
    let KeyHash = CryptoJS.SHA256(key);
    let HashArray = wordArrayToUint8Array(KeyHash);
    RoundControl = HashArray;
  }
  function distributeInteger(num) {
    if (num <= 3) {
      return [];
    }
    let maxPart = Math.floor(num * 0.2);
    let remaining = num - 2 * maxPart;
    if (remaining <= 0) {
      maxPart = Math.floor((num - 2) / 3);
      remaining = num - 2 * maxPart;
      if (remaining <= 0) {
        return [];
      }
    }
    const result = [maxPart, remaining, maxPart];
    return result;
  }
  function distributePayload(n) {
    if (n === 0) return [0];
    const k = Math.ceil(n / 100);
    const base = Math.floor(n / k);
    const remainder = n % k;
    const parts = [];
    for (let i = 0; i < remainder; i++) {
      parts.push(base + 1);
    }
    for (let i = remainder; i < k; i++) {
      parts.push(base);
    }
    return parts;
  }
  function selectSentence(PayloadLength, RandomIndex = 0, p, l) {
    if (RandomIndex > 100 || RandomIndex < 0) {
      throw "Incorrect Random Index";
    }
    if (p && l) {
      throw "Contradictory Mode Setting";
    }
    if (PayloadLength > 100) {
      let distributedPayload = distributePayload(PayloadLength);
      let Result = [];
      distributedPayload.forEach((Payload) => {
        Result = Result.concat(selectSentence(Payload, RandomIndex, p, l));
        Result[Result.length - 1].push("Z");
      });
      return Result;
    }
    let selectRand;
    let DividedPayload = distributeInteger(PayloadLength);
    let ElementResult = [];
    for (let i = 0; i < 3; i++) {
      let Payload = DividedPayload[i];
      let Lib = "";
      switch (i) {
        case 0:
          Lib = "Begin";
          break;
        case 1:
          Lib = "Main";
          break;
        case 2:
          Lib = "End";
          break;
      }
      for (let a = 0; a < Payload; ) {
        selectRand = GetRandomIndex(101) + RandomIndex;
        let PossiblePayload = [];
        for (let b = 1; b <= Payload - a; b++) {
          if (b == 9) {
            PossiblePayload.push(b);
            break;
          }
          PossiblePayload.push(b);
        }
        let TargetPayload;
        if (selectRand <= 100) {
          if (PossiblePayload[PossiblePayload.length - 1] > 6) {
            let GreedyRand = GetRandomIndex(91);
            if (GreedyRand < 30) {
              TargetPayload = PossiblePayload[PossiblePayload.length - 3];
            } else if (GreedyRand >= 30 && GreedyRand < 60) {
              TargetPayload = PossiblePayload[PossiblePayload.length - 2];
            } else {
              TargetPayload = PossiblePayload[PossiblePayload.length - 1];
            }
          } else {
            TargetPayload = PossiblePayload.pop();
          }
        } else if (selectRand > 100 && selectRand <= 200) {
          TargetPayload = PossiblePayload[GetRandomIndex(PossiblePayload.length)];
          PossiblePayload = PossiblePayload.filter(
            (item) => item > TargetPayload
          );
        }
        let PossibleSentences = [];
        let PossiblePianSentences = [];
        let PossibleLogicSentences = [];
        for (let c = 0; c < Map_Obj["Sentences"][Lib].length; c++) {
          let Sentence = Map_Obj["Sentences"][Lib][c].split("/");
          if (parseInt(Sentence[0]) == TargetPayload) {
            PossibleSentences.push(Sentence.slice(1));
            if (Sentence[0][1] == "C" || Sentence[0][1] == "E") {
              PossiblePianSentences.push(Sentence.slice(1));
            }
            if (Sentence[0][1] == "D" || Sentence[0][1] == "E") {
              PossibleLogicSentences.push(Sentence.slice(1));
            }
          }
        }
        let TargetSentence;
        if (p) {
          if (PossiblePianSentences.length != 0) {
            TargetSentence = PossiblePianSentences[GetRandomIndex(PossiblePianSentences.length)];
          } else {
            TargetSentence = PossibleSentences[GetRandomIndex(PossibleSentences.length)];
          }
        } else if (l) {
          if (PossibleLogicSentences.length != 0) {
            TargetSentence = PossibleLogicSentences[GetRandomIndex(PossibleLogicSentences.length)];
          } else {
            TargetSentence = PossibleSentences[GetRandomIndex(PossibleSentences.length)];
          }
        } else {
          let LogiRand = GetRandomIndex(101);
          if (LogiRand > 25) {
            TargetSentence = PossibleSentences[GetRandomIndex(PossibleSentences.length)];
          } else {
            let PianOrLogi = GetRandomIndex(2);
            if (PianOrLogi == 0) {
              if (PossiblePianSentences.length != 0) {
                TargetSentence = PossiblePianSentences[GetRandomIndex(PossiblePianSentences.length)];
              } else {
                TargetSentence = PossibleSentences[GetRandomIndex(PossibleSentences.length)];
              }
            } else {
              if (PossibleLogicSentences.length != 0) {
                TargetSentence = PossibleLogicSentences[GetRandomIndex(PossibleLogicSentences.length)];
              } else {
                TargetSentence = PossibleSentences[GetRandomIndex(PossibleSentences.length)];
              }
            }
          }
        }
        ElementResult.push(TargetSentence);
        a = a + TargetPayload;
      }
    }
    return ElementResult;
  }
  function enMap(input, key, q, r, p, l) {
    RoundReset();
    RoundControlInit(key);
    let OriginalData = new Uint8Array();
    OriginalData = input.output;
    Uint8ArrayTostring(OriginalData);
    let TempArray = new Uint8Array(OriginalData.byteLength + 1);
    TempArray.set(OriginalData, 0);
    TempArray.set([GetLuhnBit(OriginalData)], OriginalData.byteLength);
    OriginalData = TempArray;
    if (OriginalData.byteLength <= 1024) {
      let SizeBefore = OriginalData.byteLength;
      OriginalData = UNISHOX_COMPRESS(OriginalData);
      if (OriginalData.byteLength == SizeBefore) {
        OriginalData = GZIP_COMPRESS(OriginalData);
      }
    } else {
      OriginalData = GZIP_COMPRESS(OriginalData);
    }
    let RandomBytes = new Array();
    RandomBytes.push(GetRandomIndex(256));
    RandomBytes.push(GetRandomIndex(256));
    OriginalData = AES_256_CTR_E(OriginalData, key, RandomBytes);
    TempArray = new Uint8Array(OriginalData.byteLength + 2);
    TempArray.set(OriginalData, 0);
    TempArray.set(RandomBytes, OriginalData.byteLength);
    OriginalData = TempArray;
    let OriginStr = RemovePadding(gBase64.fromUint8Array(OriginalData));
    let TempStr1 = "", temp = "";
    let size = OriginStr.length;
    let Sentence = selectSentence(OriginStr.length, r, p, l);
    let i = 0;
    let Finished = false;
    let hasSpecialEndSymbol = false;
    let CommaCounter = 0;
    let CommaNumInSentence = 0;
    RoundKey();
    for (let j = 0; j < Sentence.length; j++) {
      hasSpecialEndSymbol = false;
      CommaNumInSentence = 0;
      for (let k = 0; k < Sentence[j].length; k++) {
        if (Sentence[j][k] == "，" || Sentence[j][k] == "、") {
          CommaNumInSentence++;
        }
      }
      for (let k = 0; k < Sentence[j].length; k++) {
        if (Sentence[j][k] == "V" || Sentence[j][k] == "N" || Sentence[j][k] == "A" || Sentence[j][k] == "AD") {
          temp = OriginStr[i];
          TempStr1 = TempStr1 + getCryptText(temp, Sentence[j][k]);
          RoundKey();
          i++;
        } else if (Sentence[j][k] == "MV") {
          TempStr1 = TempStr1 + Map_Obj["Actual"]["MV"][GetRandomIndex(Map_Obj["Actual"]["MV"].length)];
        } else if (Map_Obj["Virtual"].hasOwnProperty(Sentence[j][k])) {
          TempStr1 = TempStr1 + Map_Obj["Virtual"][Sentence[j][k]][GetRandomIndex(Map_Obj["Virtual"][Sentence[j][k]].length)];
        } else if (Sentence[j][k] == "P") {
          if (j == Sentence.length - 2) {
            continue;
          }
          hasSpecialEndSymbol = true;
          TempStr1 = TempStr1 + "。";
        } else if (Sentence[j][k] == "Z") {
          if (!hasSpecialEndSymbol) {
            hasSpecialEndSymbol = true;
            TempStr1 = TempStr1 + "。";
            if (i != size) {
              TempStr1 = TempStr1 + "\n\n";
            }
          } else {
            if (i != size) {
              TempStr1 = TempStr1 + "\n\n";
            }
          }
        } else if (Sentence[j][k] == "Q") {
          if (j == Sentence.length - 2) {
            continue;
          }
          hasSpecialEndSymbol = true;
          TempStr1 = TempStr1 + "？";
        } else {
          TempStr1 = TempStr1 + Sentence[j][k];
        }
        if (i == size) {
          Finished = true;
        }
      }
      if (Finished) {
        if (q && !hasSpecialEndSymbol) {
          TempStr1 = TempStr1 + "。";
          break;
        }
      } else {
        if (q && !hasSpecialEndSymbol) {
          let TestCommaCount = CommaCounter + (CommaNumInSentence + 1);
          if (CommaCounter < 3 || j == Sentence.length - 2) {
            if (TestCommaCount >= 3 && j != Sentence.length - 2) {
              TempStr1 = TempStr1 + "。";
              CommaCounter = 0;
            } else {
              TempStr1 = TempStr1 + "，";
              CommaCounter += CommaNumInSentence + 1;
            }
          } else {
            TempStr1 = TempStr1 + "。";
            CommaCounter = 0;
          }
        }
        if (hasSpecialEndSymbol) {
          CommaCounter = 0;
        }
      }
    }
    if (!q) {
      let TempStrQ = "";
      for (let i2 = 0; i2 < TempStr1.length; i2++) {
        if (TempStr1[i2] != "，" && TempStr1[i2] != "。" && TempStr1[i2] != "、" && TempStr1[i2] != "？") {
          TempStrQ = TempStrQ + TempStr1[i2];
        }
      }
      TempStr1 = TempStrQ;
    }
    RoundReset();
    return TempStr1;
  }
  function deMap(input, key) {
    RoundReset();
    InitDecodeTable();
    RoundControlInit(key);
    let OriginStr = Uint8ArrayTostring(input.output);
    let TempStr1 = "", TempStrz = "";
    let temp = "", findtemp = "";
    let size = OriginStr.length;
    for (let i = 0; i < size; i++) {
      temp = OriginStr[i];
      if (temp == NULL_STR || temp == " " || temp == "\n" || temp == "	") {
        continue;
      } else if (PayloadLetter.indexOf(temp) == -1) {
        continue;
      } else {
        TempStrz = TempStrz + temp;
        continue;
      }
    }
    size = TempStrz.length;
    OriginStr = TempStrz;
    RoundKey();
    for (let i = 0; i < size; ) {
      temp = OriginStr[i];
      findtemp = findOriginText(temp);
      if (findtemp == NULL_STR) {
        throw "Bad Input. Try force encrypt if intended.";
      }
      TempStr1 = TempStr1 + findtemp;
      RoundKey();
      i++;
    }
    TempStr1 = AddPadding(TempStr1);
    let TempStr2Int = new Uint8Array();
    let RandomBytes = new Array(2);
    if (!gBase64.isValid(TempStr1)) {
      throw "Error Decoding. Bad Input or Incorrect Key.";
    }
    try {
      TempStr2Int = gBase64.toUint8Array(TempStr1);
      RandomBytes[1] = TempStr2Int.at(TempStr2Int.byteLength - 1);
      RandomBytes[0] = TempStr2Int.at(TempStr2Int.byteLength - 2);
      TempStr2Int = TempStr2Int.subarray(0, TempStr2Int.byteLength - 2);
      TempStr2Int = AES_256_CTR_E(TempStr2Int, key, RandomBytes);
      TempStr2Int = GZIP_DECOMPRESS(TempStr2Int);
      TempStr2Int = UNISHOX_DECOMPRESS(TempStr2Int);
    } catch (err2) {
      throw "Error Decoding. Bad Input or Incorrect Key.";
    }
    if (!CheckLuhnBit(TempStr2Int)) {
      if (TempStr2Int.at(TempStr2Int.byteLength - 1) == 2 && TempStr2Int.at(TempStr2Int.byteLength - 2) == 2 && TempStr2Int.at(TempStr2Int.byteLength - 3) == 2) {
        TempStr2Int = TempStr2Int.subarray(0, TempStr2Int.byteLength - 3);
      } else {
        throw "Error Decrypting. Checksum Mismatch.";
      }
    } else {
      TempStr2Int = TempStr2Int.subarray(0, TempStr2Int.byteLength - 1);
    }
    let Res = new Object();
    Res.output = Uint8ArrayTostring(TempStr2Int);
    Res.output_B = TempStr2Int;
    RoundReset();
    return Res;
  }
  function getCryptText(text, type) {
    let letter = String(text);
    let idx, idx2, idx3, idx4;
    idx = LETTERS.indexOf(letter);
    idx2 = BIG_LETTERS.indexOf(letter);
    idx3 = NUMBERS.indexOf(letter);
    idx4 = SYMBOLS.indexOf(letter);
    if (idx != -1 || idx2 != -1) {
      if (type == "N") {
        for (let key in Map_Obj["Actual"]["N"]["alphabet"]) {
          if (Map_Obj["Actual"]["N"]["alphabet"].hasOwnProperty(key)) {
            if (key == letter) {
              let s2 = Map_Obj["Actual"]["N"]["alphabet"][RoundKeyMatch(key)];
              return s2;
            } else if (key.toUpperCase() == letter) {
              let s2 = String(
                Map_Obj["Actual"]["N"]["alphabet"][RoundKeyMatch(key.toUpperCase())]
              );
              return s2;
            }
          }
        }
      } else if (type == "V") {
        for (let key in Map_Obj["Actual"]["V"]["alphabet"]) {
          if (Map_Obj["Actual"]["V"]["alphabet"].hasOwnProperty(key)) {
            if (key == letter) {
              let s2 = Map_Obj["Actual"]["V"]["alphabet"][RoundKeyMatch(key)];
              return s2;
            } else if (key.toUpperCase() == letter) {
              let s2 = String(
                Map_Obj["Actual"]["V"]["alphabet"][RoundKeyMatch(key.toUpperCase())]
              );
              return s2;
            }
          }
        }
      } else if (type == "A") {
        for (let key in Map_Obj["Actual"]["A"]["alphabet"]) {
          if (Map_Obj["Actual"]["A"]["alphabet"].hasOwnProperty(key)) {
            if (key == letter) {
              let s2 = Map_Obj["Actual"]["A"]["alphabet"][RoundKeyMatch(key)];
              return s2;
            } else if (key.toUpperCase() == letter) {
              let s2 = String(
                Map_Obj["Actual"]["A"]["alphabet"][RoundKeyMatch(key.toUpperCase())]
              );
              return s2;
            }
          }
        }
      } else if (type == "AD") {
        for (let key in Map_Obj["Actual"]["AD"]["alphabet"]) {
          if (Map_Obj["Actual"]["AD"]["alphabet"].hasOwnProperty(key)) {
            if (key == letter) {
              let s2 = Map_Obj["Actual"]["AD"]["alphabet"][RoundKeyMatch(key)];
              return s2;
            } else if (key.toUpperCase() == letter) {
              let s2 = String(
                Map_Obj["Actual"]["AD"]["alphabet"][RoundKeyMatch(key.toUpperCase())]
              );
              return s2;
            }
          }
        }
      }
    } else if (idx3 != -1 || idx4 != -1) {
      if (type == "N") {
        for (let key in Map_Obj["Actual"]["N"]["numbersymbol"]) {
          if (Map_Obj["Actual"]["N"]["numbersymbol"].hasOwnProperty(key)) {
            if (key == letter) {
              let s2 = Map_Obj["Actual"]["N"]["numbersymbol"][RoundKeyMatch(key)];
              return s2;
            }
          }
        }
      } else if (type == "V") {
        for (let key in Map_Obj["Actual"]["V"]["numbersymbol"]) {
          if (Map_Obj["Actual"]["V"]["numbersymbol"].hasOwnProperty(key)) {
            if (key == letter) {
              let s2 = Map_Obj["Actual"]["V"]["numbersymbol"][RoundKeyMatch(key)];
              return s2;
            }
          }
        }
      } else if (type == "A") {
        for (let key in Map_Obj["Actual"]["A"]["numbersymbol"]) {
          if (Map_Obj["Actual"]["A"]["numbersymbol"].hasOwnProperty(key)) {
            if (key == letter) {
              let s2 = Map_Obj["Actual"]["A"]["numbersymbol"][RoundKeyMatch(key)];
              return s2;
            }
          }
        }
      } else if (type == "AD") {
        for (let key in Map_Obj["Actual"]["AD"]["numbersymbol"]) {
          if (Map_Obj["Actual"]["AD"]["numbersymbol"].hasOwnProperty(key)) {
            if (key == letter) {
              let s2 = Map_Obj["Actual"]["AD"]["numbersymbol"][RoundKeyMatch(key)];
              return s2;
            }
          }
        }
      }
    }
    return NULL_STR;
  }
  function findOriginText(text) {
    let letter = String(text);
    let res;
    for (let key in DecodeTable) {
      DecodeTable[key].forEach((item) => {
        if (letter == item) {
          res = DRoundKeyMatch(key);
        }
      });
    }
    if (res) {
      return res;
    } else {
      return NULL_STR;
    }
  }
  const _Abracadabra = class _Abracadabra {
 // 输出的结果
 /**
 * 创建一个 Abracadabra 实例
 * @param{string}inputType 可以是 TEXT 或者 UINT8，默认TEXT
 * @param{string}outputType 可以是 TEXT 或者 UINT8，默认TEXT
 */
    constructor(inputType = _Abracadabra.TEXT, outputType = _Abracadabra.TEXT) {
      __privateAdd(this, _input, "");
 //输入类型，可以是 UINT8 或者 TEXT
      __privateAdd(this, _output, "");
 //输出类型，可以是 UINT8 或者 TEXT
      __privateAdd(this, _res, null);
      if (inputType != _Abracadabra.TEXT && inputType != _Abracadabra.UINT8) {
        throw "Unexpected Argument";
      }
      if (outputType != _Abracadabra.TEXT && outputType != _Abracadabra.UINT8) {
        throw "Unexpected Argument";
      }
      __privateSet(this, _input, inputType);
      __privateSet(this, _output, outputType);
    }
 /**
 * 魔曰 传统加密模式
 *
 * @param{string | Uint8Array}input 输入的数据，根据此前指定的输入类型，可能是字符串或字节数组
 * @param{string}mode 指定模式，可以是 ENCRYPT DECRYPT AUTO 中的一种;
 * @param{string}key 指定密钥，默认是 ABRACADABRA;
 * @param{bool}q 指定是否在加密后省略标志位，默认 false/不省略;
 */
    Input(input, mode, key = "ABRACADABRA", q = false) {
      if (__privateGet(this, _input) == _Abracadabra.UINT8) {
        if (Object.prototype.toString.call(input) != "[object Uint8Array]") {
          throw "Unexpected Input Type";
        }
        let Decoder = new TextDecoder("utf-8", { fatal: true });
        let NoNeedtoPreCheck = false;
        let inputString = String();
        try {
          inputString = Decoder.decode(input);
        } catch (err2) {
          NoNeedtoPreCheck = true;
        }
        let preCheckRes;
        if (!NoNeedtoPreCheck) {
          preCheckRes = preCheck(inputString);
          if (preCheckRes.isEncrypted && mode != _Abracadabra.ENCRYPT || mode == _Abracadabra.DECRYPT) {
            __privateSet(this, _res, deMap$1(preCheckRes, key));
          } else {
            __privateSet(this, _res, enMap$1(preCheckRes, key, q));
          }
        } else {
          preCheckRes = new PreCheckResult(input, true, false);
          __privateSet(this, _res, enMap$1(preCheckRes, key, q));
        }
      } else if (__privateGet(this, _input) == _Abracadabra.TEXT) {
        if (Object.prototype.toString.call(input) != "[object String]") {
          throw "Unexpected Input Type";
        }
        let preCheckRes = preCheck(input);
        if (preCheckRes.isEncrypted && mode != _Abracadabra.ENCRYPT || mode == _Abracadabra.DECRYPT) {
          __privateSet(this, _res, deMap$1(preCheckRes, key));
        } else {
          __privateSet(this, _res, enMap$1(preCheckRes, key, q));
        }
      }
      return 0;
    }
 /**
 * 魔曰 获取加密/解密后的结果
 */
    Output() {
      if (__privateGet(this, _res) == null) {
        throw "Null Output, please input some data at first.";
      }
      if (typeof __privateGet(this, _res) == "object") {
        if (__privateGet(this, _output) == _Abracadabra.TEXT) {
          return __privateGet(this, _res).output;
        } else {
          if (__privateGet(this, _res).output_B != null) {
            return __privateGet(this, _res).output_B;
          } else {
            const encoder = new TextEncoder();
            const encodedData = encoder.encode(__privateGet(this, _res).output);
            return encodedData;
          }
        }
      } else if (typeof __privateGet(this, _res) == "string") {
        if (__privateGet(this, _output) == _Abracadabra.TEXT) {
          return __privateGet(this, _res);
        } else {
          const encoder = new TextEncoder();
          const encodedData = encoder.encode(__privateGet(this, _res));
          return encodedData;
        }
      }
    }
 /**
 * 魔曰 文言文加密模式
 *
 * @param{string | Uint8Array}input 输入的数据，根据此前指定的输入类型，可能是字符串或字节数组
 * @param{string}mode 指定模式，可以是 ENCRYPT DECRYPT 中的一种;
 * @param{string}key 指定密钥，默认是 ABRACADABRA;
 * @param{bool}q 指定是否为密文添加标点符号，默认 true/添加;
 * @param{int}r 密文算法的随机程度，越大随机性越强，默认 50，最大100，超过100将会出错;
 * @param{bool}p 指定是否强制生成骈文密文，默认 false;
 * @param{bool}l 指定是否强制生成逻辑密文，默认 false;
 */
    Input_Next(input, mode, key = "ABRACADABRA", q = true, r = 50, p = false, l = false) {
      if (__privateGet(this, _input) == _Abracadabra.UINT8) {
        if (Object.prototype.toString.call(input) != "[object Uint8Array]") {
          throw "Unexpected Input Type";
        }
        if (mode == _Abracadabra.ENCRYPT) {
          let Nextinput = new Object();
          Nextinput.output = input;
          __privateSet(this, _res, enMap(Nextinput, key, q, r, p, l));
        } else if (mode == _Abracadabra.DECRYPT) {
          let Nextinput = new Object();
          Nextinput.output = input;
          __privateSet(this, _res, deMap(Nextinput, key));
        }
        return 0;
      } else if (__privateGet(this, _input) == _Abracadabra.TEXT) {
        if (Object.prototype.toString.call(input) != "[object String]") {
          throw "Unexpected Input Type";
        }
        let Nextinput = new Object();
        Nextinput.output = stringToUint8Array(input);
        if (mode == _Abracadabra.ENCRYPT) {
          __privateSet(this, _res, enMap(Nextinput, key, q, r, p, l));
        } else if (mode == _Abracadabra.DECRYPT) {
          __privateSet(this, _res, deMap(Nextinput, key));
        }
        return 0;
      }
      return 0;
    }
  };
  _input = new WeakMap();
  _output = new WeakMap();
  _res = new WeakMap();
 //主类
  __publicField(_Abracadabra, "TEXT", "TEXT");
 //常量方便调用
  __publicField(_Abracadabra, "UINT8", "UINT8");
  __publicField(_Abracadabra, "ENCRYPT", "ENCRYPT");
  __publicField(_Abracadabra, "DECRYPT", "DECRYPT");
  __publicField(_Abracadabra, "AUTO", "AUTO");
  let Abracadabra = _Abracadabra;
  exports2.Abracadabra = Abracadabra;
  Object.defineProperty(exports2, Symbol.toStringTag, { value: "Module" });
});

/* ===== ESM 导出（本地化补充，非上游原文） ===== */
const _AbraNS = (typeof globalThis !== "undefined" && globalThis["abracadabra-cn"]) || {};
export const Abracadabra = _AbraNS.Abracadabra;
export default _AbraNS;
