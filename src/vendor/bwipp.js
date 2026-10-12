// This file is part of the bwip-js project available at:
//
//   http://metafloor.github.io/bwip-js
//
// Copyright (c) 2011-2026 Mark Warren
//
// This file contains code automatically generated from:
// Barcode Writer in Pure PostScript - Version 2026-05-28
// Copyright (c) 2004-2024 Terry Burton
//
// The MIT License
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
"use strict";

// bwip-js // Barcode Writer in Pure JavaScript
// https://github.com/metafloor/bwip-js
//
// This code was automatically generated from:
// Barcode Writer in Pure PostScript - Version 2026-05-28
//
// Copyright (c) 2011-2026 Mark Warren
// Copyright (c) 2004-2024 Terry Burton
//
// Licensed MIT. See the LICENSE file in the bwip-js root directory.
// bwip-js/barcode-hdr.js
//
// This code is injected above the cross-compiled barcode.js.

var $$ = null; // The BWIPJS object (graphics interface)
var $j = 0; // stack pointer
var $k = []; // operand stack
var $_ = {}; // base of the dictionary stack

// If you add a global variable here, add it to bwippdefs in psc.js replacing the
// bwipp_ prefix with $-sign.
// All globals must be referenced with $-sign prefix in the ps code.  They are handled
// special in the cross-compiler.
var bwipp_enabledontdraw = false; // Used by the BWIPP pstests - always false in production
var bwipp_error = new Map; // The postscript system error dict

// Aliases from Math ops
const $abs = Math.abs;
const $ceil = Math.ceil;
const $flr = Math.floor;
const $log = Math.log;
const $pow = Math.pow
const $rnd = Math.round;
const $sqrt = Math.sqrt;

// Code instrumenting
const $metrics = {};

// Array ctor
// $a()    : Build a new array up to the Infinity-marker on the stack.
// $a(arr) : Convert native array to a "view" of the array.
// $a(len) : Create a new array of length `len`
function $a(a) {
    if (!arguments.length) {
        for (var i = $j - 1; i >= 0 && $k[i] !== Infinity; i--);
        if (i < 0) {
            throw new Error('array-marker-not-found');
        }
        a = $k.splice(i + 1, $j - 1 - i);
        $j = i;
    } else if (!(a instanceof Array)) {
        var len = arguments[0] | 0;
        if (len >= 1 << 24) {
            throw new Error('array-size-limit');
        }
        a = new Array(len);
        for (var i = 0; i < len; i++) {
            a[i] = null;
        }
    }
    a.b = a; // base array
    a.o = 0; // offset into base
    return a;
}

// dict ctor
// $d() : look for the Infinity marker on the stack
function $d() {
    // Build the dictionary in the order the keys/values were pushed so enumeration
    // occurs in the correct sequence.
    for (var mark = $j - 1; mark >= 0 && $k[mark] !== Infinity; mark -= 2) {
        if ($k[mark - 1] === Infinity) {
            throw new Error('dict-malformed-stack');
        }
    }
    if (mark < 0) {
        throw new Error('dict-marker-not-found');
    }
    var d = new Map;
    for (var i = mark + 1; i < $j; i += 2) {
        // Unlike javascript, postscript dict keys differentiate between
        // numbers and the string representation of a number.
        var k = $k[i]; // "key" into the dict entry
        var t = typeof k;
        if (t == 'number' || t == 'string') {
            d.set(k, $k[i + 1]);
        } else if (k instanceof Uint8Array) {
            d.set($z(k), $k[i + 1]);
        } else {
            throw new Error('dict-not-a-valid-key(' + k + ')');
        }
    }
    $j = mark;
    return d;
}

// string ctor
// s(number)   : create zero-filled string of number-length
// s(string)   : make a copy of the string
// s(uint8[])  : make a copy of the string
//
// Returns a Uint8Array-string.
function $s(v) {
    var t = typeof v;
    if (t === 'number') {
        return new Uint8Array(v);
    }
    if (t !== 'string') {
        v = '' + v;
    }
    var s = new Uint8Array(v.length);
    for (var i = 0, l = v.length; i < l; i++) {
        s[i] = v.charCodeAt(i);
    }
    return s;
}

// ... n c roll
function $r(n, c) {
    if ($j < n) {
        throw new Error('roll: --stack-underflow--');
    }
    if (!c) {
        return;
    }
    if (c < 0) {
        var t = $k.splice($j - n, -c);
    } else {
        var t = $k.splice($j - n, n - c);
    }
    $k.splice.apply($k, [$j - t.length, 0].concat(t));
}

// Primarily designed to convert uint8-string to string, but will call the
// the toString() method on any value.
function $z(s) {
    if (s instanceof Uint8Array) {
        return String.fromCharCode.apply(null, s);
    }
    return '' + s;
}

// Copies source to dest and returns a view of just the copied characters
function $strcpy(dst, src) {
    if (typeof dst === 'string') {
        dst = $s(dst);
    }
    if (src instanceof Uint8Array) {
        for (var i = 0, l = src.length; i < l; i++) {
            dst[i] = src[i];
        }
    } else {
        for (var i = 0, l = src.length; i < l; i++) {
            dst[i] = src.charCodeAt(i);
        }
    }
    return src.length < dst.length ? dst.subarray(0, src.length) : dst;
}

// Copies source to dest and should (but doesn't) return a view of just the copied elements
function $arrcpy(dst, src) {
    for (var i = 0, l = src.length; i < l; i++) {
        dst[i] = src[i];
    }
    dst.length = src.length;
    return dst;
}

// cvs operator - convert a value to its string representation
// s : string to store into
// v : any value
function $cvs(s, v) {
    var t = typeof v;
    if (t == 'number' || t == 'boolean' || v === null) {
        v = '' + v;
    } else if (t !== 'string') {
        v = '--nostringval--';
    }
    for (var i = 0, l = v.length; i < l; i++) {
        s[i] = v.charCodeAt(i);
    }
    return i < s.length ? s.subarray(0, i) : s;
}
// cvi operator - converts a numeric string value to integer/real.
function $cvi(s) {
    if (s instanceof Uint8Array) {
        // nul-chars on the end of a string are ignored by postscript but cause javascript
        // to return a zero result.
        return $flr(String.fromCharCode.apply(null, s).replace(/\0+$/, ''));
    }
    return $flr('' + s);
}

// cvrs operator - convert a number to a radix string
// s : string to store into
// n : number
// r : radix
function $cvrs(s, n, r) {
    return $strcpy(s, (~~n).toString(r).toUpperCase());
}

// cvx operator
// BWIPP uses this to bind a function to ...args
// The operand must be an array with a function as its last element.
// All other elements get pushed on the stack before invoking the
// function.
function $cvx(a) {
    if (!(a instanceof Array)) {
        throw new Error('cvx: not arraytype');
    }
    if (typeof a[a.length - 1] !== 'function') {
        throw new Error('cvx: last array element not function');
    }
    const last = a.length - 1;
    return function() {
        for (let i = 0; i < last; i++) {
            $k[$j++] = a[i];
        }
        a[last]();
    };
}


// get operator
// s : source
// k : key
function $get(s, k) {
    if (s instanceof Uint8Array) {
        return s[k];
    }
    if (typeof s === 'string') {
        return s.charCodeAt(k);
    }
    if (s instanceof Array) {
        return s.b[s.o + k];
    }
    // Map or Object - need a string key
    if (k instanceof Uint8Array) {
        k = $z(k);
    }
    if (s instanceof Map) {
        return s.get(k);
    }
    return s[k];
}

// known operator
function $has(v, k) {
    if (v instanceof Uint8Array) {
        return k < v.length;
    }
    if (typeof v === 'string') {
        return k < v.length;
    }
    if (v instanceof Array) {
        return k < v.length;
    }
    // Map or Object - need a string key
    if (k instanceof Uint8Array) {
        k = $z(k);
    }
    if (v instanceof Map) {
        return v.has(k);
    }
    return k in v;
}

// undef operator
// d : dict
// k : key
function $del(d, k) {
    if (d instanceof Map) {
        if (k instanceof Uint8Array) {
            d.delete($z(k));
        } else {
            d.delete(k);
        }
    } else if (typeof d == 'object') {
        if (k instanceof Uint8Array) {
            delete d[$z(k)];
        } else {
            delete d[k];
        }
    } else {
        throw new Error('undef-not-a-dict-' + (typeof d));
    }
}

// put operator
// d : dest
// k : key
// v : value
function $put(d, k, v) {
    if (d instanceof Uint8Array) {
        d[k] = v;
    } else if (d instanceof Array) {
        d.b[d.o + k] = v;
    } else if (d instanceof Map) {
        if (k instanceof Uint8Array) {
            d.set($z(k), v);
        } else {
            d.set(k, v);
        }
    } else if (typeof d == 'object') {
        if (k instanceof Uint8Array) {
            d[$z(k)] = v;
        } else {
            d[k] = v;
        }
    } else {
        throw new Error('put-not-writable-' + (typeof d));
    }
}

// getinterval operator
// s : src
// o : offset
// l : length
function $geti(s, o, l) {
    if (s instanceof Uint8Array) {
        return s.subarray(o, o + l);
    }
    if (s instanceof Array) {
        var a = new Array(l);
        a.b = s.b; // base array
        a.o = s.o + o; // offset into base
        return a;
    }
    // Must be a string
    return s.substr(o, l);
}

// putinterval operator
// d : dst
// o : offset
// s : src
function $puti(d, o, s) {
    if (d instanceof Uint8Array) {
        if (typeof s == 'string') {
            for (var i = 0, l = s.length; i < l; i++) {
                d[o + i] = s.charCodeAt(i);
            }
        } else {
            // When both d and s are the same, we want to copy
            // backwards, which works for the general case as well.
            for (var i = s.length - 1; i >= 0; i--) {
                d[o + i] = s[i];
            }
        }
    } else if (d instanceof Array) {
        // Operate on the base arrays
        var darr = d.b;
        var doff = o + d.o;
        var sarr = s.b;
        var soff = s.o;

        for (var i = 0, l = s.length; i < l; i++) {
            darr[doff + i] = sarr[soff + i];
        }
    } else {
        throw new Error('putinterval-not-writable-' + (typeof d));
    }
}

// see rendertext
function $splay() {
    var map = $k[--$j];
    for (var keys = map.keys(), i = 0, l = map.size; i < l; i++) {
        var id = keys.next().value;
        if (id && typeof id === 'string') {
            $_[id] = map.get(id);
        }
    }
}

// type operator
function $type(v) {
    // null can be mis-typed - get it out of the way
    if (v == null) {
        return 'nulltype';
    }
    var t = typeof v;
    if (t == 'number') {
        if (isFinite(v)) {
            return v % 1 ? 'realtype' : 'integertype';
        }
        return 'marktype';
    }
    if (t == 'boolean') {
        return 'booleantype';
    }
    if (t == 'string' || v instanceof Uint8Array) {
        return 'stringtype';
    }
    if (t == 'function') {
        return 'operatortype';
    }
    if (v instanceof Array) {
        return 'arraytype';
    }
    return 'dicttype';
    // filetype
    // fonttype
    // gstatetype
    // nametype
    // savetype
}

// anchorsearch operator
//     string seek anchorsearch suffix seek true %if-found
//                              string false     %if-not-found
function $anchorsearch(str, seek) {
    if (!(str instanceof Uint8Array)) {
        str = $s(str);
    }
    var i = 0,
        ls = str.length,
        lk = seek.length;

    // Optimize for single characters.
    if (lk == 1) {
        var cd = seek instanceof Uint8Array ? seek[0] : seek.charCodeAt(0);
        i = str[0] == cd ? 1 : ls;
    } else if (seek.length <= ls) {
        // Slow path,
        if (!(seek instanceof Uint8Array)) {
            seek = $s(seek);
        }
        for (; i < lk && str[i] == seek[i]; i++);
    }
    if (i == lk) {
        $k[$j++] = str.subarray(lk);
        $k[$j++] = str.subarray(0, lk);
        $k[$j++] = true;
    } else {
        $k[$j++] = str;
        $k[$j++] = false;
    }
}

// search operator
//     string seek search suffix match prefix true %if-found
//                        string false             %if-not-found
function $search(str, seek) {
    if (!(str instanceof Uint8Array)) {
        str = $s(str);
    }
    var ls = str.length;

    // Virtually all uses of search in BWIPP are for single-characters.
    // Optimize for that case.
    if (seek.length == 1) {
        var lk = 1;
        var cd = seek instanceof Uint8Array ? seek[0] : seek.charCodeAt(0);
        for (var i = 0; i < ls && str[i] != cd; i++);
    } else {
        // Slow path,
        if (!(seek instanceof Uint8Array)) {
            seek = $s(seek);
        }
        var lk = seek.length;
        var cd = seek[0];
        for (var i = 0; i < ls && str[i] != cd; i++);
        while (i < ls) {
            for (var j = 1; j < lk && str[i + j] === seek[j]; j++);
            if (j === lk) {
                break;
            }
            for (i++; i < ls && str[i] != cd; i++);
        }
    }
    if (i < ls) {
        $k[$j++] = str.subarray(i + lk);
        $k[$j++] = str.subarray(i, i + lk);
        $k[$j++] = str.subarray(0, i);
        $k[$j++] = true;
    } else {
        $k[$j++] = str;
        $k[$j++] = false;
    }
}

// The callback is omitted when forall is being used just to push onto the
// stack.  The callback normally returns undefined.  A return of true means break.
function $forall(o, cb) {
    if (o instanceof Uint8Array) {
        for (var i = 0, l = o.length; i < l; i++) {
            $k[$j++] = o[i];
            if (cb && cb()) break;
        }
    } else if (o instanceof Array) {
        // The array may be a view.
        for (var a = o.b, i = o.o, l = o.o + o.length; i < l; i++) {
            $k[$j++] = a[i];
            if (cb && cb()) break;
        }
    } else if (typeof o === 'string') {
        for (var i = 0, l = o.length; i < l; i++) {
            $k[$j++] = o.charCodeAt(i);
            if (cb && cb()) break;
        }
    } else if (o instanceof Map) {
        for (var keys = o.keys(), i = 0, l = o.size; i < l; i++) {
            var id = keys.next().value;
            $k[$j++] = id;
            $k[$j++] = o.get(id);
            if (cb && cb()) break;
        }
    } else {
        for (var id in o) {
            $k[$j++] = id;
            $k[$j++] = o[id];
            if (cb && cb()) break;
        }
    }
}

function $cleartomark() {
    while ($j > 0 && $k[--$j] !== Infinity);
}

function $counttomark() {
    for (var i = $j - 1; i >= 0 && $k[i] !== Infinity; i--);
    return $j - i - 1;
}

function $aload(a) {
    for (var i = 0, l = a.length, b = a.b, o = a.o; i < l; i++) {
        $k[$j++] = b[o + i];
    }
    // This push has been optimized out.  See $.aload() in psc.js.
    //$k[$j++] = a;
}

function $astore(a) {
    for (var i = 0, l = a.length, b = a.b, o = a.o + l - 1; i < l; i++) {
        b[o - i] = $k[--$j];
    }
    $k[$j++] = a;
}

function $eq(a, b) {
    if (typeof a === 'string' && typeof b === 'string') {
        return a == b;
    }
    if (a instanceof Uint8Array && b instanceof Uint8Array) {
        if (a.length != b.length) {
            return false;
        }
        for (var i = 0, l = a.length; i < l; i++) {
            if (a[i] != b[i]) {
                return false;
            }
        }
        return true;
    }
    if (a instanceof Uint8Array && typeof b === 'string' ||
        b instanceof Uint8Array && typeof a === 'string') {
        if (a instanceof Uint8Array) {
            a = $z(a);
        } else {
            b = $z(b);
        }
        return a == b;
    }
    return a == b;
}

function $ne(a, b) {
    return !$eq(a, b);
}

function $lt(a, b) {
    if (a instanceof Uint8Array) {
        a = $z(a);
    }
    if (b instanceof Uint8Array) {
        b = $z(b);
    }
    return a < b;
}

function $le(a, b) {
    if (a instanceof Uint8Array) {
        a = $z(a);
    }
    if (b instanceof Uint8Array) {
        b = $z(b);
    }
    return a <= b;
}

function $gt(a, b) {
    if (a instanceof Uint8Array) {
        a = $z(a);
    }
    if (b instanceof Uint8Array) {
        b = $z(b);
    }
    return a > b;
}

function $ge(a, b) {
    if (a instanceof Uint8Array) {
        a = $z(a);
    }
    if (b instanceof Uint8Array) {
        b = $z(b);
    }
    return a >= b;
}

function $an(a, b) { // and
    return (typeof a === 'boolean') ? a && b : a & b;
}

function $or(a, b) { // or
    return (typeof a === 'boolean') ? a || b : a | b;
}

function $xo(a, b) { // xor
    return (typeof a === 'boolean') ? a != b : a ^ b;
}

function $nt(a) {
    return typeof a == 'boolean' ? !a : ~a;
}

function $bs(v, n) {
    // 64-bit shifts
    return n < 0 ? $flr(v / $pow(2, -n)) : v * $pow(2, n);
}
// emulate single-precision floating-point.  This is not Math.fround().
// More like ffloor()...
var $f = (function(fa) {
    return (v) => {
        //return Number.isInteger(v) ? v : (fa[0] = v, fa[0]);
        return (v | 0) == v ? v : (fa[0] = v, fa[0]);
    };
})(new Float32Array(1));

// This is a replacement for the BWIPP raiseerror function.

function bwipp_raiseerror() {
    var info = $k[--$j];
    var name = $k[--$j];
    bwipp_error.set('errorname', name);
    bwipp_error.set('errorinfo', info);

    if (typeof info == 'string' || info instanceof Uint8Array) {
        throw new Error($z(name) + ": " + $z(info));
    } else {
        throw $z(name);
    }
}

// This list was taken from BWIPP 2026-03-31
const _textOptions = new Map([
    ['', ""],
    ['subspace', ""],
    ['split', ""],
    ['linegaps', 1.2],
    ['color', "unset"],
    ['xalign', "left"],
    ['yalign', "above"],
    ['direction', "forward"],
    ['font', "OCR-B"],
    ['size', 10.0],
    ['xoffset', 0.0],
    ['yoffset', 0.0],
    ['gaps', 0.0],
]);


// processoptions.generate
// The BWIPP code uses currentdict as a user dict, which we do not support.
// It also pulls in render.groupoptions which is not visible due to the
// code transforms.

function bwipp_inittextoptions() {
    for (var grp = 1; grp <= 9; grp++) {
        var map = _textOptions;
        for (var keys = map.keys(), i = 0, l = map.size; i < l; i++) {
            var id = keys.next().value;
            $_['text' + grp + id] = map.get(id);
        }
    }
}

// processoptions.collectgroup

function bwipp_grouptextoptions() {
    var a = $a(9);
    var map = _textOptions;
    for (var grp = 1; grp <= 9; grp++) {
        var dict = new Map;
        var pfx = 'text' + grp;
        for (var keys = map.keys(), i = 0, l = map.size; i < l; i++) {
            var id = keys.next().value;
            dict.set(id, $_[pfx + id]);
        }
        $put(a, grp - 1, dict);
    }
    $k[$j++] = a;
}

// This list was taken from BWIPP 2026-03-31
const _textAliases = {
    alttext: 'text1',
    alttextsubspace: 'text1subspace',
    alttextsplit: 'text1split',
    textsubspace: 'text1subspace',
    textsplit: 'text1split',
    textlinegaps: 'text1linegaps',
    textcolor: 'text1color',
    textxalign: 'text1xalign',
    textyalign: 'text1yalign',
    textdirection: 'text1direction',
    textfont: 'text1font',
    textsize: 'text1size',
    textxoffset: 'text1xoffset',
    textyoffset: 'text1yoffset',
    textgaps: 'text1gaps',

    extratext: 'text2',
    extratextsubspace: 'text2subspace',
    extratextsplit: 'text2split',
    extratextlinegaps: 'text2linegaps',
    extratextcolor: 'text2color',
    extratextxalign: 'text2xalign',
    extratextyalign: 'text2yalign',
    extratextdirection: 'text2direction',
    extratextfont: 'text2font',
    extratextsize: 'text2size',
    extratextxoffset: 'text2xoffset',
    extratextyoffset: 'text2yoffset',
    extratextgaps: 'text2gaps',
};

// This is a replacement for the BWIPP processoptions function.
// We cannot use the BWIPP version for several reasons:
// - legacy code allows strings to be numbers and numbers to be strings
// - in javascript, there is no way to tell the difference between a real
//  number that is an integer, and an actual integer.
// - (alt|extra)text must be uint8array due to the bwipp option 
//  (alt|extra)subspace, which requires the text to be writable.
//
// Invoked as:
//     options supaliases //processoptions exec -> options
//
// supaliases is often null

function bwipp_processoptions() {
    var sups = $k[--$j];
    var opts = $k[$j - 1];
    if (opts instanceof Uint8Array) {
        opts = $z(opts);
    }
    if (typeof opts === 'string') {
        let vals = opts.trim().split(/ +/g)
        $k[$j - 1] = opts = new Map();
        for (let i = 0; i < vals.length; i++) {
            let pair = vals[i].split('=');
            if (pair.length === 1) {
                opts.set(pair[0], true);
            } else {
                opts.set(pair[0], pair[1]);
            }
        }
    }
    // BWIPP does not raiseerror on these (text1* and text2* override alttext* and extratext*)
    if (opts.has('alttext') && opts.has('text1')) {
        throw new Error('bwipp.invalidTextOptions: alttext and text1 are mutually exclusive');
    }
    if (opts.has('extratext') && opts.has('text2')) {
        throw new Error('bwipp.invalidTextOptions: extratext and text2 are mutually exclusive');
    }
    // alttext* -> text1*, extratext* -> text2*
    for (var keys = opts.keys(), i = 0, l = opts.size; i < l; i++) {
        var id = keys.next().value;
        if (sups && sups[id]) {
            opts.set(sups[id], opts.get(id));
        } else if (_textAliases[id]) {
            opts.set(_textAliases[id], opts.get(id));
            if (/^(?:alt|extra)text/.test(id)) {
                opts.delete(id);
            }
        }
    }
    for (var id in $_) {
        if (!opts.has(id)) {
            continue;
        }
        var val = opts.get(id);
        var def = $_[id];
        var typ = typeof def;

        // null is a placeholder for realtype
        if (def === null || typ == 'number') {
            // Allow numeric strings to be numbers
            if (!isFinite(+val)) {
                throw new Error('bwipp.invalidOptionType: ' + id +
                    ': not a realtype: ' + val);
            }
            if (typeof val == 'string') {
                val = +val;
                opts.set(id, val);
            }
        } else if (typ == 'boolean') {
            if (val !== true && val !== false) {
                // In keeping with the ethos of javascript, allow a more relaxed
                // interpretation of boolean.
                if (val == null || (val | 0) === val) {
                    val = !!val;
                } else if (val === 'true') {
                    val = true;
                } else if (val === 'false') {
                    val = false;
                } else {
                    throw new Error('bwipp.invalidOptionType: ' + id +
                        ': not a booleantype: ' + val);
                }
                opts.set(id, val);
            }
        } else if (typ == 'string' || def instanceof Uint8Array) {
            // Allow numbers to be strings
            if (typeof val == 'number') {
                val = '' + val;
                opts.set(id, val);
            } else if (/^text\d$/.test(id) && typeof val === 'string') {
                // BWIPP 2025-06-13 introduced textsubspace which allows replacing
                // a marker character with space.  This requires the text to be a
                // uint8array otherwise we get
                //     Error: put-not-writable-string
                val = $s(val);
                opts.set(id, val);
            } else if (typeof val != 'string' && !(val instanceof Uint8Array)) {
                throw new Error('bwipp.invalidOptionType: ' + id +
                    ': not a stringtype: ' + val);
            }
        } else if (Object.prototype.toString.call(val) !== Object.prototype.toString.call(def)) {
            var m = /\[object (\w+)\]/.exec(Object.prototype.toString.call(def)) || [, 'unknown'];
            throw new Error('bwipp.invalidOptionType: ' + id + ': expected ' + m[1].toLowerCase() + 'type');
        }
        // Set the option into the dictionary
        $_[id] = val;
    }
}

// Replacement for fifocache constructor.  We can't use the postscript version
// because it creates a user defined dict << ... >>> and fetch installs it as
// the current dictionary...
//   /fifocache {
//       8 dict begin
//   
//       /limit exch def
//       /max exch def
//       /cache max dict def
//       /fifo max array def
//       /state << /head 0 /cnt 0 /total 0 >> def
//       /fetch currentdict [
//           exch { //fifocache.fetch exec } aload pop
//       ] cvx def
//   
//       currentdict  % Leave this on the stack
//       end
//   } bind def

function bwipp_fifocache() {
    var limit = $k[--$j];
    var max = $k[--$j];
    var dict = {
        limit: limit,
        max: max,
        cache: new Map(),
        fifo: [],
        state: {
            head: 0,
            cnt: 0,
            total: 0
        },
        fetch() {
            $k[$j++] = dict;
            bwipp_fifocache_fetch();
        },
    };
    $k[$j++] = dict;
}

function bwipp_fifocache_fetch() {
    var self = $k[--$j];
    var cardfn = $k[--$j];
    var genfn = $k[--$j];
    var key = $k[--$j];
    if (key instanceof Uint8Array) {
        key = String.fromCharCode.apply(null, key);
    }
    var cache = self.cache;
    if (cache.has(key)) {
        $k[$j++] = cache.get(key);
        return;
    }
    var fifo = self.fifo;
    var max = self.max;
    var limit = self.limit;
    genfn();
    var result = $k[$j - 1];
    cardfn();
    var card = $k[--$j];
    var state = self.state; // { head:0, cnt:0, total:0 }
    if (card < limit) {
        for (;;) {
            if (state.total + card <= limit && state.cnt < max) {
                break;
            }
            var oldkey = fifo[state.head];
            $k[$j++] = cache.get(oldkey);
            cardfn();
            state.total = state.total - $k[--$j];
            cache.delete(oldkey);
            state.head = (state.head + 1) % max;
            state.cnt--;
        }
        cache.set(key, result);
        fifo[(state.head + state.cnt) % max] = key;
        state.cnt++;
        state.total = state.total + card;
    }
    $k[$j++] = result;
}

function bwipp_parseinput() {
    if (!bwipp_parseinput.globals) {
        var $__ = $_;
        $_ = bwipp_parseinput.globals = {};
        //#413
        $k[$j++] = Infinity; //#425
        var _0 = $a(['NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL', 'BS', 'TAB', 'LF', 'VT', 'FF', 'CR', "", "", 'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB', 'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US']); //#430
        $k[$j++] = 0; //#434
        for (var _1 = 0, _2 = _0.length; _1 < _2; _1++) { //#434
            var _3 = $get(_0, _1); //#434
            var _4 = $k[--$j]; //#433
            $k[$j++] = _3; //#433
            $k[$j++] = _4; //#433
            $k[$j++] = _4 + 1; //#433
        } //#433
        $j--; //#434
        $_.ctrl = $d(); //#434
        $_ = $__;
    }
    //#451
    var $__ = $_; //#453
    $_ = Object.assign({}, $_, bwipp_parseinput.globals); //#453
    var _5 = $k[--$j]; //#456
    $_.fncvals = _5; //#456
    var _6 = $k[--$j]; //#457
    $_.barcode = _6; //#457
    $_.parse = $get($_.fncvals, 'parse'); //#459
    $del($_.fncvals, 'parse') //#459
    $_.parsefnc = $get($_.fncvals, 'parsefnc'); //#460
    $del($_.fncvals, 'parsefnc') //#460
    $_.parseonly = $has($_.fncvals, 'parseonly'); //#461
    $del($_.fncvals, 'parseonly') //#461
    $_.eci = $has($_.fncvals, 'eci'); //#462
    $del($_.fncvals, 'eci') //#462
    $_.msg = $a($_.barcode.length); //#466
    $_.j = 0; //#467
    $k[$j++] = $_.barcode; //#590
    for (;;) { //#590
        var _M = $k[--$j]; //#469
        $search(_M, "^"); //#469
        var _N = $k[--$j]; //#469
        var _O = $k[--$j]; //#469
        var _X = _O.length; //#472
        var _V = $_.msg; //#472
        var _U = $_.j; //#472
        $k[$j++] = Infinity; //#472
        $forall(_O); //#472
        var _T = $a(); //#472
        $puti(_V, _U, _T); //#472
        $_.j = $f(_X + $_.j) //#473
        if (_N) { //#588
            $j--; //#475
            for (var _Z = 0; _Z < 1; _Z++) { //#586
                if (!$_.parse && !$_.parsefnc) { //#482
                    $put($_.msg, $_.j, 94); //#479
                    $_.j = $_.j + 1; //#480
                    break; //#481
                } //#481
                $put($_.msg, $_.j, 94); //#485
                $_.j = $_.j + 1; //#486
                if ($_.parse) { //#529
                    var _j = $k[$j - 1]; //#490
                    if (_j.length >= 3) { //#501
                        var _k = $k[$j - 1]; //#491
                        var _l = $geti(_k, 0, 3); //#491
                        var _m = $_.ctrl; //#491
                        var _n = $has(_m, _l); //#492
                        $k[$j++] = _m; //#500
                        $k[$j++] = _l; //#500
                        if (_n) { //#499
                            $_.j = $_.j - 1; //#493
                            var _p = $k[--$j]; //#494
                            var _q = $k[--$j]; //#494
                            $put($_.msg, $_.j, $get(_q, _p)); //#494
                            $_.j = $_.j + 1; //#495
                            var _v = $k[--$j]; //#496
                            $k[$j++] = $geti(_v, 3, _v.length - 3); //#497
                            break; //#497
                        } else { //#499
                            $j -= 2; //#499
                        } //#499
                    } //#499
                    var _x = $k[$j - 1]; //#502
                    if (_x.length >= 2) { //#513
                        var _y = $k[$j - 1]; //#503
                        var _z = $geti(_y, 0, 2); //#503
                        var _10 = $_.ctrl; //#503
                        var _11 = $has(_10, _z); //#504
                        $k[$j++] = _10; //#512
                        $k[$j++] = _z; //#512
                        if (_11) { //#511
                            $_.j = $_.j - 1; //#505
                            var _13 = $k[--$j]; //#506
                            var _14 = $k[--$j]; //#506
                            $put($_.msg, $_.j, $get(_14, _13)); //#506
                            $_.j = $_.j + 1; //#507
                            var _19 = $k[--$j]; //#508
                            $k[$j++] = $geti(_19, 2, _19.length - 2); //#509
                            break; //#509
                        } else { //#511
                            $j -= 2; //#511
                        } //#511
                    } //#511
                    var _1B = $k[$j - 1]; //#514
                    if (_1B.length >= 3) { //#528
                        var _1C = $k[$j - 1]; //#515
                        var _1D = $geti(_1C, 0, 3); //#515
                        $k[$j++] = true; //#517
                        for (var _1E = 0, _1F = _1D.length; _1E < _1F; _1E++) { //#517
                            var _1G = $get(_1D, _1E); //#517
                            if ((_1G < 48) || (_1G > 57)) { //#516
                                $k[$j - 1] = false; //#516
                            } //#516
                        } //#516
                        var _1H = $k[--$j]; //#527
                        if (_1H) { //#527
                            var _1I = $k[$j - 1]; //#519
                            var _1K = $cvi($geti(_1I, 0, 3)); //#519
                            $k[$j++] = _1K; //#522
                            if (_1K > 255) { //#522
                                $j -= 2; //#520
                                $k[$j++] = "bwipp.invalidOrdinal#521"; //#521
                                $k[$j++] = "Ordinal must be 000 to 255"; //#521
                                bwipp_raiseerror(); //#521
                            } //#521
                            $_.j = $_.j - 1; //#523
                            var _1N = $k[--$j]; //#524
                            $put($_.msg, $_.j, _1N); //#524
                            $_.j = $_.j + 1; //#525
                            var _1Q = $k[--$j]; //#526
                            $k[$j++] = $geti(_1Q, 3, _1Q.length - 3); //#526
                        } //#526
                    } //#526
                } //#526
                if ($_.parseonly || !$_.parsefnc || $get($_.msg, $_.j - 1) != 94) { //#534
                    break; //#534
                } //#534
                $_.j = $_.j - 1; //#537
                var _1Y = $k[$j - 1]; //#538
                if (_1Y.length < 1) { //#541
                    $k[$j - 1] = "bwipp.truncatedCaret#540"; //#540
                    $k[$j++] = "Caret character truncated"; //#540
                    bwipp_raiseerror(); //#540
                } //#540
                var _1Z = $k[$j - 1]; //#542
                var _1a = $get(_1Z, 0); //#542
                if (_1a == 94) { //#547
                    $put($_.msg, $_.j, 94); //#543
                    $_.j = $_.j + 1; //#544
                    var _1e = $k[--$j]; //#545
                    $k[$j++] = $geti(_1e, 1, _1e.length - 1); //#546
                    break; //#546
                } //#546
                var _1g = $k[$j - 1]; //#548
                if (_1g.length < 3) { //#551
                    $k[$j - 1] = "bwipp.truncatedFNC#550"; //#550
                    $k[$j++] = "Function character truncated"; //#550
                    bwipp_raiseerror(); //#550
                } //#550
                var _1h = $k[$j - 1]; //#552
                var _1i = $geti(_1h, 0, 3); //#552
                if ($eq(_1i, "ECI") && $_.eci) { //#569
                    var _1k = $k[$j - 1]; //#553
                    if (_1k.length < 9) { //#556
                        $k[$j - 1] = "bwipp.truncatedECI#555"; //#555
                        $k[$j++] = "ECI truncated"; //#555
                        bwipp_raiseerror(); //#555
                    } //#555
                    var _1l = $k[$j - 1]; //#557
                    var _1m = $geti(_1l, 3, 6); //#557
                    $k[$j++] = _1m; //#563
                    for (var _1n = 0, _1o = _1m.length; _1n < _1o; _1n++) { //#563
                        var _1p = $get(_1m, _1n); //#563
                        if ((_1p < 48) || (_1p > 57)) { //#562
                            $j -= 2; //#560
                            $k[$j++] = "bwipp.invalidECI#561"; //#561
                            $k[$j++] = "ECI must be 000000 to 999999"; //#561
                            bwipp_raiseerror(); //#561
                        } //#561
                    } //#561
                    var _1q = $k[--$j]; //#564
                    var _1t = 0; //#564
                    $forall(_1q, function() { //#564
                        var _1r = $k[--$j]; //#564
                        _1t = $f(_1t - (_1r - 48)) * 10 //#564
                    }); //#564
                    $put($_.msg, $_.j, (~~(_1t / 10)) - 1000000); //#565
                    $_.j = $_.j + 1; //#566
                    var _1x = $k[--$j]; //#567
                    $k[$j++] = $geti(_1x, 9, _1x.length - 9); //#568
                    break; //#568
                } //#568
                var _1z = $k[$j - 1]; //#570
                if (_1z.length < 4) { //#573
                    $k[$j - 1] = "bwipp.truncatedFNC#572"; //#572
                    $k[$j++] = "Function character truncated"; //#572
                    bwipp_raiseerror(); //#572
                } //#572
                var _20 = $k[$j - 1]; //#574
                var _21 = $geti(_20, 0, 4); //#574
                var _23 = $has($_.fncvals, _21); //#574
                $k[$j++] = _21; //#579
                if (!_23) { //#579
                    var _24 = $k[--$j]; //#575
                    var _25 = $s(_24.length + 28); //#575
                    $puti(_25, 28, _24); //#575
                    $puti(_25, 0, "Unknown function character: "); //#576
                    $k[$j - 1] = "bwipp.unknownFNC#578"; //#578
                    $k[$j++] = _25; //#578
                    bwipp_raiseerror(); //#578
                } //#578
                var _29 = $k[--$j]; //#580
                $put($_.msg, $_.j, $get($_.fncvals, _29)); //#581
                $_.j = $_.j + 1; //#582
                var _2E = $k[--$j]; //#583
                $k[$j++] = $geti(_2E, 4, _2E.length - 4); //#584
                break; //#584
            } //#584
        } else { //#588
            break; //#588
        } //#588
    } //#588
    if (!$_.parseonly) { //#596
        $k[$j++] = $geti($_.msg, 0, $_.j); //#593
    } else { //#596
        $k[$j++] = $s($_.j); //#596
        for (var _2O = 0, _2N = $_.j - 1; _2O <= _2N; _2O += 1) { //#596
            var _2P = $k[$j - 1]; //#596
            $put(_2P, _2O, $get($_.msg, _2O)); //#596
        } //#596
    } //#596
    $_ = $__; //#600
} //bwipp_parseinput

function bwipp_rsecbinary() {
    if (!bwipp_rsecbinary.globals) {
        var $__ = $_;
        $_ = bwipp_rsecbinary.globals = {};
        //#4184
        $_ = $__;
    }
    //#4194
    var $__ = $_; //#4196
    $_ = Object.assign({}, $_, bwipp_rsecbinary.globals); //#4196
    var _0 = $k[--$j]; //#4198
    $_.rsprod = _0; //#4198
    var _1 = $k[--$j]; //#4199
    $_.lfsr = _1; //#4199
    var _2 = $k[--$j]; //#4200
    $_.nc = _2; //#4200
    var _3 = $k[--$j]; //#4201
    $_.coeffs = _3; //#4201
    var _4 = $k[--$j]; //#4202
    $_.nd = _4; //#4202
    var _5 = $k[--$j]; //#4203
    $_.getdata = _5; //#4203
    for (var _8 = 0, _7 = $_.nc - 1; _8 <= _7; _8 += 1) { //#4205
        $put($_.lfsr, _8, 0); //#4205
    } //#4205
    for (var _C = 0, _B = $_.nd - 1; _C <= _B; _C += 1) { //#4220
        $k[$j++] = _C; //#4208
        if ($_.getdata() === true) {
            break;
        } //#4208
        var _F = $get($_.lfsr, 0); //#4208
        var _G = $k[--$j]; //#4208
        $k[$j++] = $xo(_G, _F); //#4216
        for (var _J = 0, _I = $_.nc - 2; _J <= _I; _J += 1) { //#4216
            var _K = $_.lfsr; //#4210
            var _L = $get(_K, _J + 1); //#4211
            var _O = $get($_.coeffs, $f($_.nc - _J) - 1); //#4212
            var _P = $k[$j - 1]; //#4213
            $k[$j++] = _K; //#4214
            $k[$j++] = _J; //#4214
            $k[$j++] = _L; //#4214
            $k[$j++] = _O; //#4214
            $k[$j++] = _P; //#4214
            if ($_.rsprod() === true) {
                break;
            } //#4214
            var _R = $k[--$j]; //#4215
            var _S = $k[--$j]; //#4215
            var _T = $k[--$j]; //#4215
            var _U = $k[--$j]; //#4215
            $put(_U, _T, $xo(_S, _R)); //#4215
        } //#4215
        var _Y = $get($_.coeffs, 0); //#4217
        var _Z = $k[$j - 1]; //#4217
        $k[$j++] = $_.lfsr; //#4218
        $k[$j++] = $_.nc - 1; //#4218
        $k[$j++] = _Y; //#4218
        $k[$j++] = _Z; //#4218
        if ($_.rsprod() === true) {
            break;
        } //#4218
        var _b = $k[--$j]; //#4218
        var _c = $k[--$j]; //#4218
        var _d = $k[--$j]; //#4218
        $put(_d, _c, _b); //#4218
        $j--; //#4219
    } //#4219
    $_ = $__; //#4222
} //bwipp_rsecbinary

function bwipp_ean5() {
    if (!bwipp_ean5.globals) {
        var $__ = $_;
        $_ = bwipp_ean5.globals = {};
        //#6456
        $_.ean5_encs = $a(["3211", "2221", "2122", "1411", "1132", "1231", "1114", "1312", "1213", "3112", "112", "11"]); //#6462
        $_.ean5_barchars = "0123456789"; //#6464
        $_.ean5_mirrormaps = $a(["11000", "10100", "10010", "10001", "01100", "00110", "00011", "01010", "01001", "00101"]); //#6469
        $_ = $__;
    }
    //#6471
    var $__ = $_; //#6473
    $_ = Object.assign({}, $_, bwipp_ean5.globals); //#6473
    $_.dontdraw = false; //#6476
    $_.includetext = false; //#6477
    $_.text1font = "OCR-B"; //#6478
    $_.text1size = 12; //#6479
    $_.text1xoffset = 3.25; //#6480
    $_.text1yoffset = null; //#6481
    $_.height = -1; //#6482
    $_.addondescent = 5; //#6483
    $_.width = 0; //#6484
    $_.modunit = 1; //#6495
    $k[$j++] = null; //#6497
    bwipp_processoptions(); //#6497
    var _2 = $k[--$j]; //#6497
    $_.options = _2; //#6497
    var _3 = $k[--$j]; //#6500
    $_.barcode = _3; //#6500
    $_._render = !($_.dontdraw || ($_.bwipp_dontdraw || bwipp_enabledontdraw)); //#6502
    if ($_.barcode.length != 5) { //#6512
        $k[$j++] = "bwipp.ean5badLength#6511"; //#6511
        $k[$j++] = "EAN-5 add-on must be 5 digits"; //#6511
        bwipp_raiseerror(); //#6511
    } //#6511
    $forall($_.barcode, function() { //#6517
        var _8 = $k[--$j]; //#6514
        if ((_8 < 48) || (_8 > 57)) { //#6516
            $k[$j++] = "bwipp.ean5badCharacter#6515"; //#6515
            $k[$j++] = "EAN-5 add-on must contain only digits"; //#6515
            bwipp_raiseerror(); //#6515
        } //#6515
    }); //#6515
    if ($_.height == -1) { //#6525
        $_.height = 0.7; //#6525
    } //#6525
    $_.descent = ($_.addondescent * $_.modunit) / 72; //#6527
    if ($_.text1yoffset == null) { //#6531
        $_.text1yoffset = $f($_.height * 72 + 4.75) //#6530
    } //#6530
    $_.checksum = 0; //#6533
    for (var _E = 0; _E <= 4; _E += 1) { //#6542
        $_.i = _E; //#6535
        $_.barchar = $get($_.barcode, $_.i) - 48; //#6536
        if (($_.i % 2) == 0) { //#6540
            $_.checksum = $f($_.barchar * 3 + $_.checksum) //#6538
        } else { //#6540
            $_.checksum = $f($_.barchar * 9 + $_.checksum) //#6540
        } //#6540
    } //#6540
    $_.checksum = $_.checksum % 10; //#6543
    $_.mirrormap = $get($_.ean5_mirrormaps, $_.checksum); //#6544
    $_.sbs = $s(31); //#6546
    $_.txt = $a(5); //#6547
    for (var _S = 0; _S <= 4; _S += 1) { //#6581
        $_.i = _S; //#6550
        if ($_.i == 0) { //#6558
            $puti($_.sbs, 0, $get($_.ean5_encs, 10)); //#6556
        } else { //#6558
            $puti($_.sbs, (($_.i - 1) * 6) + 7, $get($_.ean5_encs, 11)); //#6558
        } //#6558
        $search($_.ean5_barchars, $geti($_.barcode, $_.i, 1)); //#6564
        $j--; //#6565
        var _c = $k[--$j]; //#6566
        $_.indx = _c.length; //#6566
        $j -= 2; //#6567
        $_.enc = $get($_.ean5_encs, $_.indx); //#6568
        if ($get($_.mirrormap, $_.i) == 49) { //#6578
            $_.enclen = $_.enc.length; //#6570
            $_.revenc = $s($_.enclen); //#6571
            for (var _n = 0, _m = $_.enclen - 1; _n <= _m; _n += 1) { //#6576
                $_.j = _n; //#6573
                $_.char = $get($_.enc, $_.j); //#6574
                $put($_.revenc, ($_.enclen - $_.j) - 1, $_.char); //#6575
            } //#6575
            $_.enc = $_.revenc; //#6577
        } //#6577
        $puti($_.sbs, ($_.i * 6) + 3, $_.enc); //#6579
        $put($_.txt, $_.i, $a([$geti($_.barcode, $_.i, 1), $f(($_.i - 1) * 9 + 10 + $_.text1xoffset), $_.text1yoffset, $_.text1font, $_.text1size])) //#6580
    } //#6580
    $k[$j++] = Infinity; //#6583
    var _1E = []; //#6585
    var _1A = $_.sbs; //#6585
    for (var _1B = 0, _1C = _1A.length; _1B < _1C; _1B++) { //#6585
        _1E[_1B] = $get(_1A, _1B) - 48; //#6585
    } //#6585
    _1E = $a(_1E); //#6585
    var _1I = []; //#6586
    for (var _1F = 0; _1F < 16; _1F++) { //#6586
        _1I[_1F] = $f($_.height + $_.descent) //#6586
    } //#6586
    _1I = $a(_1I); //#6586
    var _1L = []; //#6587
    for (var _1J = 0; _1J < 16; _1J++) { //#6587
        _1L[_1J] = -$_.descent; //#6587
    } //#6587
    _1L = $a(_1L); //#6587
    $k[$j++] = 'ren'; //#6590
    $k[$j++] = 'renlinear'; //#6590
    $k[$j++] = 'sbs'; //#6590
    $k[$j++] = _1E; //#6590
    $k[$j++] = 'bhs'; //#6590
    $k[$j++] = _1I; //#6590
    $k[$j++] = 'bbs'; //#6590
    $k[$j++] = _1L; //#6590
    if ($_.includetext) { //#6590
        $k[$j++] = 'txt'; //#6589
        $k[$j++] = $_.txt; //#6589
    } //#6589
    $k[$j++] = 'opt'; //#6602
    $k[$j++] = $_.options; //#6602
    $k[$j++] = 'guardrightpos'; //#6602
    $k[$j++] = 5; //#6602
    $k[$j++] = 'guardrightypos'; //#6602
    $k[$j++] = $_.text1yoffset; //#6602
    $k[$j++] = 'borderleft'; //#6602
    $k[$j++] = 12; //#6602
    $k[$j++] = 'borderright'; //#6602
    $k[$j++] = 5; //#6602
    $k[$j++] = 'bordertop'; //#6602
    $k[$j++] = 10; //#6602
    var _1Q = $d(); //#6602
    $k[$j++] = _1Q; //#6605
    if ($_._render) { //#6605
        bwipp_renlinear(); //#6605
    } //#6605
    $_ = $__; //#6608
} //bwipp_ean5

function bwipp_ean2() {
    if (!bwipp_ean2.globals) {
        var $__ = $_;
        $_ = bwipp_ean2.globals = {};
        //#6637
        $_.ean2_encs = $a(["3211", "2221", "2122", "1411", "1132", "1231", "1114", "1312", "1213", "3112", "112", "11"]); //#6643
        $_.ean2_barchars = "0123456789"; //#6645
        $_.ean2_mirrormaps = $a(["00", "01", "10", "11"]); //#6647
        $_ = $__;
    }
    //#6649
    var $__ = $_; //#6651
    $_ = Object.assign({}, $_, bwipp_ean2.globals); //#6651
    $_.dontdraw = false; //#6654
    $_.includetext = false; //#6655
    $_.text1font = "OCR-B"; //#6656
    $_.text1size = 12; //#6657
    $_.text1xoffset = 3.25; //#6658
    $_.text1yoffset = null; //#6659
    $_.height = -1; //#6660
    $_.addondescent = 5; //#6661
    $_.width = 0; //#6662
    $_.modunit = 1; //#6673
    $k[$j++] = null; //#6675
    bwipp_processoptions(); //#6675
    var _2 = $k[--$j]; //#6675
    $_.options = _2; //#6675
    var _3 = $k[--$j]; //#6678
    $_.barcode = _3; //#6678
    $_._render = !($_.dontdraw || ($_.bwipp_dontdraw || bwipp_enabledontdraw)); //#6680
    if ($_.barcode.length != 2) { //#6690
        $k[$j++] = "bwipp.ean2badLength#6689"; //#6689
        $k[$j++] = "EAN-2 add-on must be 2 digits"; //#6689
        bwipp_raiseerror(); //#6689
    } //#6689
    $forall($_.barcode, function() { //#6695
        var _8 = $k[--$j]; //#6692
        if ((_8 < 48) || (_8 > 57)) { //#6694
            $k[$j++] = "bwipp.ean2badCharacter#6693"; //#6693
            $k[$j++] = "EAN-2 add-on must contain only digits"; //#6693
            bwipp_raiseerror(); //#6693
        } //#6693
    }); //#6693
    if ($_.height == -1) { //#6703
        $_.height = 0.7; //#6703
    } //#6703
    $_.descent = ($_.addondescent * $_.modunit) / 72; //#6705
    if ($_.text1yoffset == null) { //#6709
        $_.text1yoffset = $f($_.height * 72 + 4.75) //#6708
    } //#6708
    $_.mirrormap = $get($_.ean2_mirrormaps, $cvi($geti($_.barcode, 0, 2)) % 4); //#6711
    $_.sbs = $s(13); //#6713
    $_.txt = $a(2); //#6714
    for (var _J = 0; _J <= 1; _J += 1) { //#6748
        $_.i = _J; //#6717
        if ($_.i == 0) { //#6725
            $puti($_.sbs, 0, $get($_.ean2_encs, 10)); //#6723
        } else { //#6725
            $puti($_.sbs, (($_.i - 1) * 6) + 7, $get($_.ean2_encs, 11)); //#6725
        } //#6725
        $search($_.ean2_barchars, $geti($_.barcode, $_.i, 1)); //#6731
        $j--; //#6732
        var _T = $k[--$j]; //#6733
        $_.indx = _T.length; //#6733
        $j -= 2; //#6734
        $_.enc = $get($_.ean2_encs, $_.indx); //#6735
        if ($get($_.mirrormap, $_.i) == 49) { //#6745
            $_.enclen = $_.enc.length; //#6737
            $_.revenc = $s($_.enclen); //#6738
            for (var _e = 0, _d = $_.enclen - 1; _e <= _d; _e += 1) { //#6743
                $_.j = _e; //#6740
                $_.char = $get($_.enc, $_.j); //#6741
                $put($_.revenc, ($_.enclen - $_.j) - 1, $_.char); //#6742
            } //#6742
            $_.enc = $_.revenc; //#6744
        } //#6744
        $puti($_.sbs, ($_.i * 6) + 3, $_.enc); //#6746
        $put($_.txt, $_.i, $a([$geti($_.barcode, $_.i, 1), $f(($_.i - 1) * 9 + 10 + $_.text1xoffset), $_.text1yoffset, $_.text1font, $_.text1size])) //#6747
    } //#6747
    $k[$j++] = Infinity; //#6750
    var _15 = []; //#6752
    var _11 = $_.sbs; //#6752
    for (var _12 = 0, _13 = _11.length; _12 < _13; _12++) { //#6752
        _15[_12] = $get(_11, _12) - 48; //#6752
    } //#6752
    _15 = $a(_15); //#6752
    var _19 = []; //#6753
    for (var _16 = 0; _16 < 12; _16++) { //#6753
        _19[_16] = $f($_.height + $_.descent) //#6753
    } //#6753
    _19 = $a(_19); //#6753
    var _1C = []; //#6754
    for (var _1A = 0; _1A < 12; _1A++) { //#6754
        _1C[_1A] = -$_.descent; //#6754
    } //#6754
    _1C = $a(_1C); //#6754
    $k[$j++] = 'ren'; //#6757
    $k[$j++] = 'renlinear'; //#6757
    $k[$j++] = 'sbs'; //#6757
    $k[$j++] = _15; //#6757
    $k[$j++] = 'bhs'; //#6757
    $k[$j++] = _19; //#6757
    $k[$j++] = 'bbs'; //#6757
    $k[$j++] = _1C; //#6757
    if ($_.includetext) { //#6757
        $k[$j++] = 'txt'; //#6756
        $k[$j++] = $_.txt; //#6756
    } //#6756
    $k[$j++] = 'opt'; //#6769
    $k[$j++] = $_.options; //#6769
    $k[$j++] = 'guardrightpos'; //#6769
    $k[$j++] = 5; //#6769
    $k[$j++] = 'guardrightypos'; //#6769
    $k[$j++] = $_.text1yoffset; //#6769
    $k[$j++] = 'borderleft'; //#6769
    $k[$j++] = 12; //#6769
    $k[$j++] = 'borderright'; //#6769
    $k[$j++] = 5; //#6769
    $k[$j++] = 'bordertop'; //#6769
    $k[$j++] = 10; //#6769
    var _1H = $d(); //#6769
    $k[$j++] = _1H; //#6772
    if ($_._render) { //#6772
        bwipp_renlinear(); //#6772
    } //#6772
    $_ = $__; //#6775
} //bwipp_ean2

function bwipp_ean13() {
    if (!bwipp_ean13.globals) {
        var $__ = $_;
        $_ = bwipp_ean13.globals = {};
        //#6807
        $_.ean13_encs = $a(["3211", "2221", "2122", "1411", "1132", "1231", "1114", "1312", "1213", "3112", "111", "11111", "111"]); //#6811
        $_.ean13_barchars = "0123456789"; //#6813
        $_.ean13_mirrormaps = $a(["000000", "001011", "001101", "001110", "010011", "011001", "011100", "010101", "010110", "011010"]); //#6817
        $_ = $__;
    }
    //#6819
    var $__ = $_; //#6821
    $_ = Object.assign({}, $_, bwipp_ean13.globals); //#6821
    $_.dontdraw = false; //#6824
    $_.includetext = false; //#6825
    $_.text1font = "OCR-B"; //#6827
    $_.text1size = 12; //#6828
    $_.text1xoffset = -7.75; //#6829
    $_.text1yoffset = -5.25; //#6830
    $_.height = -1; //#6831
    $_.guarddescent = 5; //#6832
    $_.addondescent = null; //#6833
    $_.width = 0; //#6834
    $_.addongap = 12; //#6835
    $_.addontextfont = "unset"; //#6836
    $_.addontextsize = null; //#6837
    $_.addontextxoffset = null; //#6838
    $_.addontextyoffset = null; //#6839
    $_.modunit = 1; //#6850
    $k[$j++] = null; //#6852
    bwipp_processoptions(); //#6852
    var _2 = $k[--$j]; //#6852
    $_.options = _2; //#6852
    var _3 = $k[--$j]; //#6855
    $_.barcode = _3; //#6855
    $_._render = !($_.dontdraw || ($_.bwipp_dontdraw || bwipp_enabledontdraw)); //#6857
    $search($_.barcode, " "); //#6865
    var _7 = $k[--$j]; //#6872
    if (_7) { //#6871
        var _8 = $k[--$j]; //#6866
        $_.barcode = _8; //#6866
        $j--; //#6867
        var _9 = $k[--$j]; //#6868
        $_.addon = _9; //#6868
    } else { //#6871
        $j--; //#6870
        $_.addon = ""; //#6871
    } //#6871
    if (($_.barcode.length != 12) && ($_.barcode.length != 13)) { //#6879
        $k[$j++] = "bwipp.ean13badLength#6878"; //#6878
        $k[$j++] = "EAN-13 must be 12 or 13 digits"; //#6878
        bwipp_raiseerror(); //#6878
    } //#6878
    $forall($_.barcode, function() { //#6884
        var _D = $k[--$j]; //#6881
        if ((_D < 48) || (_D > 57)) { //#6883
            $k[$j++] = "bwipp.ean13badCharacter#6882"; //#6882
            $k[$j++] = "EAN-13 must contain only digits"; //#6882
            bwipp_raiseerror(); //#6882
        } //#6882
    }); //#6882
    if ((($_.addon.length != 0) && ($_.addon.length != 2)) && ($_.addon.length != 5)) { //#6887
        $k[$j++] = "bwipp.ean13badAddOnLength#6886"; //#6886
        $k[$j++] = "Add-on for EAN-13 must be 2 or 5 digits"; //#6886
        bwipp_raiseerror(); //#6886
    } //#6886
    $_.descent = ($_.guarddescent * $_.modunit) / 72; //#6895
    if ($_.addondescent == null) { //#6896
        $_.addondescent = $_.guarddescent; //#6896
    } //#6896
    $_.pad = $s(13); //#6901
    $_.checksum = 0; //#6902
    for (var _M = 0; _M <= 11; _M += 1) { //#6911
        $_.i = _M; //#6904
        $_.barchar = $get($_.barcode, $_.i) - 48; //#6905
        if (($_.i % 2) == 0) { //#6909
            $_.checksum = $f($_.barchar + $_.checksum) //#6907
        } else { //#6909
            $_.checksum = $f($_.barchar * 3 + $_.checksum) //#6909
        } //#6909
    } //#6909
    $_.checksum = (10 - ($_.checksum % 10)) % 10; //#6912
    if ($_.barcode.length == 13) { //#6917
        if ($get($_.barcode, 12) != ($_.checksum + 48)) { //#6916
            $k[$j++] = "bwipp.ean13badCheckDigit#6915"; //#6915
            $k[$j++] = "Incorrect EAN-13 check digit provided"; //#6915
            bwipp_raiseerror(); //#6915
        } //#6915
    } //#6915
    $puti($_.pad, 0, $_.barcode); //#6918
    $put($_.pad, 12, $_.checksum + 48); //#6919
    $_.barcode = $_.pad; //#6920
    $_.sbs = $s(59); //#6922
    $_.txt = $a(13); //#6923
    $puti($_.sbs, 0, $get($_.ean13_encs, 10)); //#6928
    $_.mirrormap = $get($_.ean13_mirrormaps, $get($_.barcode, 0) - 48); //#6933
    $put($_.txt, 0, $a([$geti($_.barcode, 0, 1), $_.text1xoffset, $_.text1yoffset, $_.text1font, $_.text1size])); //#6934
    for (var _u = 1; _u <= 6; _u += 1) { //#6959
        $_.i = _u; //#6941
        $search($_.ean13_barchars, $geti($_.barcode, $_.i, 1)); //#6942
        $j--; //#6943
        var _y = $k[--$j]; //#6944
        $_.indx = _y.length; //#6944
        $j -= 2; //#6945
        $_.enc = $get($_.ean13_encs, $_.indx); //#6946
        if ($get($_.mirrormap, $_.i - 1) == 49) { //#6956
            $_.enclen = $_.enc.length; //#6948
            $_.revenc = $s($_.enclen); //#6949
            for (var _19 = 0, _18 = $_.enclen - 1; _19 <= _18; _19 += 1) { //#6954
                $_.j = _19; //#6951
                $_.char = $get($_.enc, $_.j); //#6952
                $put($_.revenc, ($_.enclen - $_.j) - 1, $_.char); //#6953
            } //#6953
            $_.enc = $_.revenc; //#6955
        } //#6955
        $puti($_.sbs, (($_.i - 1) * 4) + 3, $_.enc); //#6957
        $put($_.txt, $_.i, $a([$geti($_.barcode, $_.i, 1), $f(($_.i - 1) * 7 + 15 + $_.text1xoffset), $_.text1yoffset, $_.text1font, $_.text1size])) //#6958
    } //#6958
    $puti($_.sbs, ((7 - 1) * 4) + 3, $get($_.ean13_encs, 11)); //#6964
    for (var _1Y = 7; _1Y <= 12; _1Y += 1) { //#6979
        $_.i = _1Y; //#6971
        $search($_.ean13_barchars, $geti($_.barcode, $_.i, 1)); //#6972
        $j--; //#6973
        var _1c = $k[--$j]; //#6974
        $_.indx = _1c.length; //#6974
        $j -= 2; //#6975
        $_.enc = $get($_.ean13_encs, $_.indx); //#6976
        $puti($_.sbs, (($_.i - 1) * 4) + 8, $_.enc); //#6977
        $put($_.txt, $_.i, $a([$geti($_.barcode, $_.i, 1), $f(($_.i - 1) * 7 + 19 + $_.text1xoffset), $_.text1yoffset, $_.text1font, $_.text1size])) //#6978
    } //#6978
    $puti($_.sbs, 56, $get($_.ean13_encs, 12)); //#6984
    $k[$j++] = Infinity; //#6986
    var _1v = $_.sbs; //#6986
    for (var _1w = 0, _1x = _1v.length; _1w < _1x; _1w++) { //#6986
        $k[$j++] = $get(_1v, _1w) - 48; //#6986
    } //#6986
    $_.sbs = $a(); //#6986
    if ($_.height == -1) { //#6988
        $_.height = 1; //#6988
    } //#6988
    if ($_.includetext) { //#6997
        $_.guardheight = $f($_.height + $_.descent) //#6991
        $k[$j++] = Infinity; //#6992
        $k[$j++] = $_.guardheight; //#6992
        $k[$j++] = $_.guardheight; //#6992
        for (var _25 = 0; _25 < 12; _25++) { //#6992
            $k[$j++] = $_.height; //#6992
        } //#6992
        $k[$j++] = $_.guardheight; //#6992
        $k[$j++] = $_.guardheight; //#6992
        for (var _29 = 0; _29 < 12; _29++) { //#6992
            $k[$j++] = $_.height; //#6992
        } //#6992
        $k[$j++] = $_.guardheight; //#6992
        $k[$j++] = $_.guardheight; //#6992
        $_.bhs = $a(); //#6992
        $k[$j++] = Infinity; //#6993
        $k[$j++] = -$_.descent; //#6993
        $k[$j++] = -$_.descent; //#6993
        for (var _2F = 0; _2F < 12; _2F++) { //#6993
            $k[$j++] = 0; //#6993
        } //#6993
        $k[$j++] = -$_.descent; //#6993
        $k[$j++] = -$_.descent; //#6993
        for (var _2I = 0; _2I < 12; _2I++) { //#6993
            $k[$j++] = 0; //#6993
        } //#6993
        $k[$j++] = -$_.descent; //#6993
        $k[$j++] = -$_.descent; //#6993
        $_.bbs = $a(); //#6993
    } else { //#6997
        $k[$j++] = Infinity; //#6995
        for (var _2L = 0; _2L < 30; _2L++) { //#6995
            $k[$j++] = $_.height; //#6995
        } //#6995
        $_.bhs = $a(); //#6995
        $k[$j++] = Infinity; //#6996
        for (var _2N = 0; _2N < 30; _2N++) { //#6996
            $k[$j++] = 0; //#6996
        } //#6996
        $_.bbs = $a(); //#6996
        $_.txt = $a([]); //#6997
    } //#6997
    $_.guardrightypos = -5; //#6999
    if ($_.addon.length != 0) { //#7024
        $k[$j++] = Infinity; //#7005
        $k[$j++] = 'includetext'; //#7007
        $k[$j++] = true; //#7007
        $k[$j++] = 'height'; //#7007
        $k[$j++] = $_.height; //#7007
        if ($_.includetext) { //#7007
            var _2R = $k[--$j]; //#7007
            $k[$j++] = $f(_2R - 0.15) //#7007
        } //#7007
        $k[$j++] = 'addondescent'; //#7009
        $k[$j++] = $_.addondescent; //#7009
        $k[$j++] = 'text1xoffset'; //#7009
        if ($_.addontextxoffset != null) { //#7009
            $k[$j++] = $_.addontextxoffset; //#7009
        } else { //#7009
            $k[$j++] = $f(98.25 + $_.addongap) //#7009
        } //#7009
        if ($_.addontextyoffset != null) { //#7010
            $k[$j++] = 'text1yoffset'; //#7010
            $k[$j++] = $_.addontextyoffset; //#7010
        } //#7010
        $k[$j++] = 'text1size'; //#7011
        if ($_.addontextsize != null) { //#7011
            $k[$j++] = $_.addontextsize; //#7011
        } else { //#7011
            $k[$j++] = $_.text1size; //#7011
        } //#7011
        var _2c = $ne($_.addontextfont, "unset") ? $_.addontextfont : $_.text1font; //#7012
        $k[$j++] = 'text1font'; //#7012
        $k[$j++] = _2c; //#7012
        $_.addopts = $d(); //#7012
        $_.bwipp_dontdraw = true; //#7015
        if ($_.addon.length == 2) { //#7016
            $k[$j++] = $_.addon; //#7016
            $k[$j++] = $_.addopts; //#7016
            bwipp_ean2(); //#7016
        } //#7016
        if ($_.addon.length == 5) { //#7017
            $k[$j++] = $_.addon; //#7017
            $k[$j++] = $_.addopts; //#7017
            bwipp_ean5(); //#7017
        } //#7017
        var _2j = $k[--$j]; //#7018
        $_.addcode = _2j; //#7018
        $k[$j++] = Infinity; //#7019
        $aload($_.sbs); //#7019
        var _2n = $get($_.addcode, "sbs"); //#7019
        $k[$j++] = $_.addongap; //#7019
        $aload(_2n); //#7019
        $_.sbs = $a(); //#7019
        $k[$j++] = Infinity; //#7020
        $aload($_.bhs); //#7020
        $aload($get($_.addcode, "bhs")); //#7020
        $_.bhs = $a(); //#7020
        $k[$j++] = Infinity; //#7021
        $aload($_.bbs); //#7021
        $aload($get($_.addcode, "bbs")); //#7021
        $_.bbs = $a(); //#7021
        $k[$j++] = Infinity; //#7022
        $aload($_.txt); //#7022
        $aload($get($_.addcode, "txt")); //#7022
        $_.txt = $a(); //#7022
        $_.guardrightypos = $get($_.addcode, "guardrightypos"); //#7023
    } //#7023
    $k[$j++] = Infinity; //#7026
    $k[$j++] = 'ren'; //#7033
    $k[$j++] = 'renlinear'; //#7033
    $k[$j++] = 'sbs'; //#7033
    $k[$j++] = $_.sbs; //#7033
    $k[$j++] = 'bhs'; //#7033
    $k[$j++] = $_.bhs; //#7033
    $k[$j++] = 'bbs'; //#7033
    $k[$j++] = $_.bbs; //#7033
    $k[$j++] = 'txt'; //#7033
    $k[$j++] = $_.txt; //#7033
    $k[$j++] = 'opt'; //#7033
    $k[$j++] = $_.options; //#7033
    $k[$j++] = 'guardrightpos'; //#7033
    if ($_.addon.length == 0) { //#7033
        $k[$j++] = 7; //#7033
    } else { //#7033
        $k[$j++] = 5; //#7033
    } //#7033
    $k[$j++] = 'guardrightypos'; //#7036
    $k[$j++] = $_.guardrightypos; //#7036
    $k[$j++] = 'borderleft'; //#7036
    $k[$j++] = 11; //#7036
    $k[$j++] = 'borderright'; //#7036
    if ($_.addon.length == 0) { //#7036
        $k[$j++] = 7; //#7036
    } else { //#7036
        $k[$j++] = 5; //#7036
    } //#7036
    $k[$j++] = 'bordertop'; //#7038
    $k[$j++] = 0; //#7038
    $k[$j++] = 'borderbottom'; //#7038
    $k[$j++] = 5 + ($_.guarddescent * $_.modunit); //#7038
    var _39 = $d(); //#7038
    $k[$j++] = _39; //#7047
    if ($_._render) { //#7047
        bwipp_renlinear(); //#7047
    } //#7047
    $_ = $__; //#7050
} //bwipp_ean13

function bwipp_code128() {
    if (!bwipp_code128.globals) {
        var $__ = $_;
        $_ = bwipp_code128.globals = {};
        //#8982
        $_.code128_sta = -1; //#8987
        $_.code128_stb = -2; //#8987
        $_.code128_stc = -3; //#8987
        $_.code128_swa = -4; //#8988
        $_.code128_swb = -5; //#8988
        $_.code128_swc = -6; //#8988
        $_.code128_fn1 = -7; //#8989
        $_.code128_fn2 = -8; //#8989
        $_.code128_fn3 = -9; //#8989
        $_.code128_fn4 = -10; //#8990
        $_.code128_sft = -11; //#8990
        $_.code128_stp = -12; //#8990
        $_.code128_lka = -13; //#8991
        $_.code128_lkc = -14; //#8991
        $_.sta = $_.code128_sta; //#8993
        $_.stb = $_.code128_stb; //#8993
        $_.stc = $_.code128_stc; //#8993
        $_.swa = $_.code128_swa; //#8994
        $_.swb = $_.code128_swb; //#8994
        $_.swc = $_.code128_swc; //#8994
        $_.fn1 = $_.code128_fn1; //#8995
        $_.fn2 = $_.code128_fn2; //#8995
        $_.fn3 = $_.code128_fn3; //#8995
        $_.fn4 = $_.code128_fn4; //#8996
        $_.sft = $_.code128_sft; //#8996
        $_.stp = $_.code128_stp; //#8996
        $_.lka = $_.code128_lka; //#8997
        $_.lkc = $_.code128_lkc; //#8997
        $_.code128_charmaps = $a([$a([32, 32, "00"]), $a(["!", "!", "01"]), $a(["\"", "\"", "02"]), $a(["#", "#", "03"]), $a(["$", "$", "04"]), $a(["%", "%", "05"]), $a(["&", "&", "06"]), $a(["'", "'", "07"]), $a([40, 40, "08"]), $a([41, 41, "09"]), $a(["*", "*", "10"]), $a(["+", "+", "11"]), $a([",", ",", "12"]), $a(["-", "-", "13"]), $a([".", ".", "14"]), $a(["/", "/", "15"]), $a(["0", "0", "16"]), $a(["1", "1", "17"]), $a(["2", "2", "18"]), $a(["3", "3", "19"]), $a(["4", "4", "20"]), $a(["5", "5", "21"]), $a(["6", "6", "22"]), $a(["7", "7", "23"]), $a(["8", "8", "24"]), $a(["9", "9", "25"]), $a([":", ":", "26"]), $a([";", ";", "27"]), $a(["<", "<", "28"]), $a(["=", "=", "29"]), $a([">", ">", "30"]), $a(["?", "?", "31"]), $a(["@", "@", "32"]), $a(["A", "A", "33"]), $a(["B", "B", "34"]), $a(["C", "C", "35"]), $a(["D", "D", "36"]), $a(["E", "E", "37"]), $a(["F", "F", "38"]), $a(["G", "G", "39"]), $a(["H", "H", "40"]), $a(["I", "I", "41"]), $a(["J", "J", "42"]), $a(["K", "K", "43"]), $a(["L", "L", "44"]), $a(["M", "M", "45"]), $a(["N", "N", "46"]), $a(["O", "O", "47"]), $a(["P", "P", "48"]), $a(["Q", "Q", "49"]), $a(["R", "R", "50"]), $a(["S", "S", "51"]), $a(["T", "T", "52"]), $a(["U", "U", "53"]), $a(["V", "V", "54"]), $a(["W", "W", "55"]), $a(["X", "X", "56"]), $a(["Y", "Y", "57"]), $a(["Z", "Z", "58"]), $a(["[", "[", "59"]), $a([92, 92, "60"]), $a(["]", "]", "61"]), $a(["^", "^", "62"]), $a(["_", "_", "63"]), $a([0, "`", "64"]), $a([1, "a", "65"]), $a([2, "b", "66"]), $a([3, "c", "67"]), $a([4, "d", "68"]), $a([5, "e", "69"]), $a([6, "f", "70"]), $a([7, "g", "71"]), $a([8, "h", "72"]), $a([9, "i", "73"]), $a([10, "j", "74"]), $a([11, "k", "75"]), $a([12, "l", "76"]), $a([13, "m", "77"]), $a([14, "n", "78"]), $a([15, "o", "79"]), $a([16, "p", "80"]), $a([17, "q", "81"]), $a([18, "r", "82"]), $a([19, "s", "83"]), $a([20, "t", "84"]), $a([21, "u", "85"]), $a([22, "v", "86"]), $a([23, "w", "87"]), $a([24, "x", "88"]), $a([25, "y", "89"]), $a([26, "z", "90"]), $a([27, "{", "91"]), $a([28, "|", "92"]), $a([29, "}", "93"]), $a([30, "~", "94"]), $a([31, 127, "95"]), $a([$_.fn3, $_.fn3, "96"]), $a([$_.fn2, $_.fn2, "97"]), $a([$_.sft, $_.sft, "98"]), $a([$_.swc, $_.swc, "99"]), $a([$_.swb, $_.fn4, $_.swb]), $a([$_.fn4, $_.swa, $_.swa]), $a([$_.fn1, $_.fn1, $_.fn1]), $a([$_.sta, $_.sta, $_.sta]), $a([$_.stb, $_.stb, $_.stb]), $a([$_.stc, $_.stc, $_.stc]), $a([$_.stp, $_.stp, $_.stp])]); //#9040
        $_.code128_latch_a0 = $a(["", "e", "e", "ee", "eee", "eee"]); //#9060
        $_.code128_latch_b0 = $a(["d", "", "d", "ddd", "dd", "ddd"]); //#9061
        $_.code128_latch_c0 = $a(["c", "c", "", "eec", "ddc", "dddc"]); //#9062
        $_.code128_latch_a1 = $a(["ee", "eee", "eee", "", "e", "e"]); //#9063
        $_.code128_latch_b1 = $a(["ddd", "dd", "ddd", "d", "", "d"]); //#9064
        $_.code128_latch_c1 = $a(["eec", "ddc", "dddc", "c", "c", ""]); //#9065
        var _2N = []; //#9067
        var _2J = $_.code128_latch_a0; //#9067
        for (var _2K = 0, _2L = _2J.length; _2K < _2L; _2K++) { //#9067
            _2N[_2K] = $get(_2J, _2K).length; //#9067
        } //#9067
        _2N = $a(_2N); //#9067
        $_.code128_latch_length_a0 = _2N; //#9067
        var _2S = []; //#9068
        var _2O = $_.code128_latch_b0; //#9068
        for (var _2P = 0, _2Q = _2O.length; _2P < _2Q; _2P++) { //#9068
            _2S[_2P] = $get(_2O, _2P).length; //#9068
        } //#9068
        _2S = $a(_2S); //#9068
        $_.code128_latch_length_b0 = _2S; //#9068
        var _2X = []; //#9069
        var _2T = $_.code128_latch_c0; //#9069
        for (var _2U = 0, _2V = _2T.length; _2U < _2V; _2U++) { //#9069
            _2X[_2U] = $get(_2T, _2U).length; //#9069
        } //#9069
        _2X = $a(_2X); //#9069
        $_.code128_latch_length_c0 = _2X; //#9069
        var _2c = []; //#9070
        var _2Y = $_.code128_latch_a1; //#9070
        for (var _2Z = 0, _2a = _2Y.length; _2Z < _2a; _2Z++) { //#9070
            _2c[_2Z] = $get(_2Y, _2Z).length; //#9070
        } //#9070
        _2c = $a(_2c); //#9070
        $_.code128_latch_length_a1 = _2c; //#9070
        var _2h = []; //#9071
        var _2d = $_.code128_latch_b1; //#9071
        for (var _2e = 0, _2f = _2d.length; _2e < _2f; _2e++) { //#9071
            _2h[_2e] = $get(_2d, _2e).length; //#9071
        } //#9071
        _2h = $a(_2h); //#9071
        $_.code128_latch_length_b1 = _2h; //#9071
        var _2m = []; //#9072
        var _2i = $_.code128_latch_c1; //#9072
        for (var _2j = 0, _2k = _2i.length; _2j < _2k; _2j++) { //#9072
            _2m[_2j] = $get(_2i, _2j).length; //#9072
        } //#9072
        _2m = $a(_2m); //#9072
        $_.code128_latch_length_c1 = _2m; //#9072
        $_.code128_latch_sequence = $a([$_.code128_latch_a0, $_.code128_latch_b0, $_.code128_latch_c0, $_.code128_latch_a1, $_.code128_latch_b1, $_.code128_latch_c1]); //#9075
        $_.code128_start_code = $a([103, 104, 105]); //#9076
        $_.code128_state_priority = $a([1, 0, 2, 4, 3, 5]); //#9079
        $_.code128_start_state = $a([0, 1, 2, 0, 1, 2]); //#9080
        $_.code128_start_length = $a([1, 1, 1, 1, 1, 1]); //#9081
        var _34 = []; //#9084
        var _2y = $a([5, 4, 3, 2, 1, 0]); //#9084
        for (var _2z = 0, _30 = _2y.length; _2z < _30; _2z++) { //#9084
            _34[_2z] = $get($_.code128_state_priority, $get(_2y, _2z)); //#9084
        } //#9084
        _34 = $a(_34); //#9084
        $_.code128_reverse_priority = _34; //#9084
        $k[$j++] = Infinity; //#9087
        var _35 = $_.code128_reverse_priority; //#9087
        for (var _36 = 0, _37 = _35.length; _36 < _37; _36++) { //#9087
            var _38 = $get(_35, _36); //#9087
            var _3A = $get($_.code128_latch_length_a0, _38); //#9087
            $k[$j++] = _38; //#9087
            $k[$j++] = _3A; //#9087
            $k[$j++] = _38; //#9087
        } //#9087
        var _3B = $a(); //#9087
        $_.code128_prioritized_latch_length_a0 = _3B; //#9087
        $k[$j++] = Infinity; //#9088
        var _3C = $_.code128_reverse_priority; //#9088
        for (var _3D = 0, _3E = _3C.length; _3D < _3E; _3D++) { //#9088
            var _3F = $get(_3C, _3D); //#9088
            var _3H = $get($_.code128_latch_length_a1, _3F); //#9088
            $k[$j++] = _3F; //#9088
            $k[$j++] = _3H; //#9088
            $k[$j++] = _3F; //#9088
        } //#9088
        var _3I = $a(); //#9088
        $_.code128_prioritized_latch_length_a1 = _3I; //#9088
        $k[$j++] = Infinity; //#9089
        var _3J = $_.code128_reverse_priority; //#9089
        for (var _3K = 0, _3L = _3J.length; _3K < _3L; _3K++) { //#9089
            var _3M = $get(_3J, _3K); //#9089
            var _3O = $get($_.code128_latch_length_b0, _3M); //#9089
            $k[$j++] = _3M; //#9089
            $k[$j++] = _3O; //#9089
            $k[$j++] = _3M; //#9089
        } //#9089
        var _3P = $a(); //#9089
        $_.code128_prioritized_latch_length_b0 = _3P; //#9089
        $k[$j++] = Infinity; //#9090
        var _3Q = $_.code128_reverse_priority; //#9090
        for (var _3R = 0, _3S = _3Q.length; _3R < _3S; _3R++) { //#9090
            var _3T = $get(_3Q, _3R); //#9090
            var _3V = $get($_.code128_latch_length_b1, _3T); //#9090
            $k[$j++] = _3T; //#9090
            $k[$j++] = _3V; //#9090
            $k[$j++] = _3T; //#9090
        } //#9090
        var _3W = $a(); //#9090
        $_.code128_prioritized_latch_length_b1 = _3W; //#9090
        $k[$j++] = Infinity; //#9091
        var _3X = $_.code128_reverse_priority; //#9091
        for (var _3Y = 0, _3Z = _3X.length; _3Y < _3Z; _3Y++) { //#9091
            var _3a = $get(_3X, _3Y); //#9091
            var _3c = $get($_.code128_latch_length_c0, _3a); //#9091
            $k[$j++] = _3a; //#9091
            $k[$j++] = _3c; //#9091
            $k[$j++] = _3a; //#9091
        } //#9091
        var _3d = $a(); //#9091
        $_.code128_prioritized_latch_length_c0 = _3d; //#9091
        $k[$j++] = Infinity; //#9092
        var _3e = $_.code128_reverse_priority; //#9092
        for (var _3f = 0, _3g = _3e.length; _3f < _3g; _3f++) { //#9092
            var _3h = $get(_3e, _3f); //#9092
            var _3j = $get($_.code128_latch_length_c1, _3h); //#9092
            $k[$j++] = _3h; //#9092
            $k[$j++] = _3j; //#9092
            $k[$j++] = _3h; //#9092
        } //#9092
        var _3k = $a(); //#9092
        $_.code128_prioritized_latch_length_c1 = _3k; //#9092
        $k[$j++] = Infinity; //#9097
        $k[$j++] = $_.fn3; //#9097
        $k[$j++] = 96; //#9097
        $k[$j++] = $_.fn2; //#9097
        $k[$j++] = 97; //#9097
        $k[$j++] = $_.fn1; //#9097
        $k[$j++] = 102; //#9097
        $k[$j++] = $_.stp; //#9097
        $k[$j++] = 106; //#9097
        $k[$j++] = $_.lka; //#9097
        $k[$j++] = 100; //#9097
        $k[$j++] = $_.lkc; //#9097
        $k[$j++] = 99; //#9097
        var _3r = $d(); //#9097
        $_.code128_seta_new = _3r; //#9097
        $k[$j++] = Infinity; //#9098
        $k[$j++] = $_.fn3; //#9098
        $k[$j++] = 96; //#9098
        $k[$j++] = $_.fn2; //#9098
        $k[$j++] = 97; //#9098
        $k[$j++] = $_.fn1; //#9098
        $k[$j++] = 102; //#9098
        $k[$j++] = $_.stp; //#9098
        $k[$j++] = 106; //#9098
        $k[$j++] = $_.lka; //#9098
        $k[$j++] = 99; //#9098
        $k[$j++] = $_.lkc; //#9098
        $k[$j++] = 101; //#9098
        var _3y = $d(); //#9098
        $_.code128_setb_new = _3y; //#9098
        $k[$j++] = Infinity; //#9099
        $k[$j++] = $_.fn1; //#9099
        $k[$j++] = 102; //#9099
        $k[$j++] = $_.stp; //#9099
        $k[$j++] = 106; //#9099
        $k[$j++] = $_.lka; //#9099
        $k[$j++] = 101; //#9099
        $k[$j++] = $_.lkc; //#9099
        $k[$j++] = 100; //#9099
        var _43 = $d(); //#9099
        $_.code128_setc_new = _43; //#9099
        $_.code128_encs = $a(["212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112"]); //#9121
        $_.code128_max_int = 2147483647; //#9123
        $_.charvals_legacy = $a([new Map, new Map, new Map]); //#9135
        for (var _46 = 0, _45 = $_.code128_charmaps.length - 1; _46 <= _45; _46 += 1) { //#9144
            $_.i = _46; //#9137
            $_.encs = $get($_.code128_charmaps, $_.i); //#9138
            for (var _49 = 0; _49 <= 2; _49 += 1) { //#9143
                $_.j = _49; //#9140
                var _4C = $get($_.encs, $_.j); //#9141
                var _4D = $type(_4C); //#9141
                $k[$j++] = _4C; //#9141
                if ($eq(_4D, 'stringtype')) { //#9141
                    var _4E = $k[--$j]; //#9141
                    $k[$j++] = $get(_4E, 0); //#9141
                } //#9141
                var _4I = $get($_.charvals_legacy, $_.j); //#9142
                var _4J = $k[--$j]; //#9142
                $put(_4I, _4J, $_.i); //#9142
            } //#9142
        } //#9142
        $_.charvals_legacy = $_.charvals_legacy; //#9145
        var _4N = $get($_.charvals_legacy, 0); //#9150
        $put(_4N, $_.code128_lka, $get(_4N, $_.code128_swb)); //#9150
        $put(_4N, $_.code128_lkc, $get(_4N, $_.code128_swc)); //#9150
        $_.seta_legacy = _4N; //#9150
        var _4R = $get($_.charvals_legacy, 1); //#9151
        $put(_4R, $_.code128_lka, $get(_4R, $_.code128_swc)); //#9151
        $put(_4R, $_.code128_lkc, $get(_4R, $_.code128_swa)); //#9151
        $_.setb_legacy = _4R; //#9151
        var _4V = $get($_.charvals_legacy, 2); //#9152
        $put(_4V, $_.code128_lka, $get(_4V, $_.code128_swa)); //#9152
        $put(_4V, $_.code128_lkc, $get(_4V, $_.code128_swb)); //#9152
        $_.setc_legacy = _4V; //#9152
        $_ = $__;
    }
    //#9168
    var $__ = $_; //#9170
    $_ = Object.assign({}, $_, bwipp_code128.globals); //#9170
    $_.dontdraw = false; //#9173
    $_.includetext = false; //#9174
    $_.text1font = "OCR-B"; //#9175
    $_.text1size = 10; //#9176
    $_.text1xoffset = 0; //#9177
    $_.textyoffset = -8; //#9178
    $_.height = -1; //#9179
    $_.width = 0; //#9180
    $_.raw = false; //#9181
    $_.newencoder = false; //#9182
    $_.parse = false; //#9183
    $_.parsefnc = false; //#9184
    $_.suppressc = false; //#9185
    $_.unlatchextbeforec = false; //#9186
    $_.modunit = 1; //#9197
    $k[$j++] = null; //#9199
    bwipp_processoptions(); //#9199
    var _4Y = $k[--$j]; //#9199
    $_.options = _4Y; //#9199
    var _4Z = $k[--$j]; //#9202
    $_.barcode = _4Z; //#9202
    if ($_.barcode.length > 500) { //#9206
        $k[$j++] = "bwipp.code128inputTooLong#9205"; //#9205
        $k[$j++] = "The input data is too long"; //#9205
        bwipp_raiseerror(); //#9205
    } //#9205
    $_._render = !($_.dontdraw || ($_.bwipp_dontdraw || bwipp_enabledontdraw)); //#9214
    $_.fncvals = new Map([
        ["parse", $_.parse],
        ["parsefnc", $_.parsefnc],
        ["FNC1", $_.code128_fn1],
        ["FNC2", $_.code128_fn2],
        ["FNC3", $_.code128_fn3],
        ["LNKA", $_.code128_lka],
        ["LNKC", $_.code128_lkc]
    ]); //#9232
    $k[$j++] = $_.barcode; //#9234
    $k[$j++] = $_.fncvals; //#9234
    bwipp_parseinput(); //#9234
    var _4h = $k[--$j]; //#9234
    $_.msg = _4h; //#9234
    $_.msglen = $_.msg.length; //#9235
    $_.encoding = "legacy"; //#9237
    if ($_.newencoder) { //#9238
        $_.encoding = "new"; //#9238
    } //#9238
    if ($_.raw) { //#9239
        $_.encoding = "raw"; //#9239
    } //#9239
    if ($eq($_.encoding, "raw")) { //#9267
        $_.cws = $a($_.barcode.length); //#9242
        $_.i = 0; //#9243
        $_.j = 0; //#9243
        for (;;) { //#9257
            if ($_.i >= ($_.barcode.length - 3)) { //#9245
                break; //#9245
            } //#9245
            if ($get($_.barcode, $_.i) != 94) { //#9246
                break; //#9246
            } //#9246
            var _4v = $geti($_.barcode, $_.i + 1, 3); //#9247
            $k[$j++] = _4v; //#9249
            $k[$j++] = false; //#9249
            for (var _4w = 0, _4x = _4v.length; _4w < _4x; _4w++) { //#9249
                var _4y = $get(_4v, _4w); //#9249
                if ((_4y < 48) || (_4y > 57)) { //#9248
                    $k[$j - 1] = true; //#9248
                } //#9248
            } //#9248
            var _4z = $k[--$j]; //#9249
            if (_4z) { //#9249
                $j--; //#9249
                break; //#9249
            } //#9249
            var _50 = $k[--$j]; //#9250
            $_.cw = $cvi(_50); //#9250
            if ($_.cw > 106) { //#9253
                $k[$j++] = "bwipp.code128BadRawCodeword#9252"; //#9252
                $k[$j++] = "Raw codewords must be 0 to 106"; //#9252
                bwipp_raiseerror(); //#9252
            } //#9252
            $put($_.cws, $_.j, $_.cw); //#9254
            $_.i = $_.i + 4; //#9255
            $_.j = $_.j + 1; //#9256
        } //#9256
        if ($_.i != $_.barcode.length) { //#9260
            $k[$j++] = "bwipp.code128BadRawFormat#9259"; //#9259
            $k[$j++] = "Raw codewords must be formatted as ^NNN"; //#9259
            bwipp_raiseerror(); //#9259
        } //#9259
        $_.cws = $geti($_.cws, 0, $_.j); //#9261
        $_.text = ""; //#9262
    } else { //#9267
        $_.text = $s($_.msglen); //#9264
        for (var _5G = 0, _5F = $_.msglen - 1; _5G <= _5F; _5G += 1) { //#9268
            $_.i = _5G; //#9266
            var _5L = $get($_.msg, $_.i); //#9267
            var _5O = $_.text; //#9267
            var _5N = $_.i; //#9267
            if (_5L < 0) { //#9267
                _5L = 32; //#9267
            } //#9267
            $put(_5O, _5N, _5L); //#9267
        } //#9267
    } //#9267
    if ($eq($_.encoding, "legacy")) { //#9519
        $_.seta = $_.seta_legacy; //#9274
        $_.setb = $_.setb_legacy; //#9275
        $_.setc = $_.setc_legacy; //#9276
        $k[$j++] = Infinity; //#9281
        for (var _5U = 0, _5V = $_.msglen; _5U < _5V; _5U++) { //#9281
            $k[$j++] = 0; //#9281
        } //#9281
        $k[$j++] = 0; //#9281
        $_.numSA = $a(); //#9281
        $k[$j++] = Infinity; //#9282
        for (var _5X = 0, _5Y = $_.msglen; _5X < _5Y; _5X++) { //#9282
            $k[$j++] = 0; //#9282
        } //#9282
        $k[$j++] = 0; //#9282
        $_.numEA = $a(); //#9282
        for (var _5a = $_.msglen - 1; _5a >= 0; _5a -= 1) { //#9292
            $_.i = _5a; //#9284
            if ($get($_.msg, $_.i) >= 0) { //#9291
                if ($get($_.msg, $_.i) >= 128) { //#9289
                    $put($_.numEA, $_.i, $get($_.numEA, $_.i + 1) + 1); //#9287
                } else { //#9289
                    $put($_.numSA, $_.i, $get($_.numSA, $_.i + 1) + 1); //#9289
                } //#9289
            } //#9289
        } //#9289
        $_.ea = false; //#9297
        $k[$j++] = Infinity; //#9298
        for (var _5t = 0, _5s = $_.msglen - 1; _5t <= _5s; _5t += 1) { //#9313
            $_.i = _5t; //#9300
            $_.c = $get($_.msg, $_.i); //#9301
            if ((!($_.ea != ($_.c < 128))) && ($_.c >= 0)) { //#9311
                var _64 = $_.ea ? $_.numSA : $_.numEA; //#9303
                var _65 = $get(_64, $_.i); //#9303
                var _68 = $f(_65 + $_.i) == $_.msglen ? 3 : 5; //#9304
                if (_65 < _68) { //#9309
                    $k[$j++] = $_.code128_fn4; //#9306
                } else { //#9309
                    $_.ea = !$_.ea; //#9309
                    $k[$j++] = $_.code128_fn4; //#9309
                    $k[$j++] = $_.code128_fn4; //#9309
                } //#9309
            } //#9309
            if ($_.c >= 0) { //#9312
                $k[$j++] = $_.c & 127; //#9312
            } else { //#9312
                $k[$j++] = $_.c; //#9312
            } //#9312
        } //#9312
        $astore($a($counttomark())); //#9314
        var _6F = $k[--$j]; //#9314
        $_.msg = _6F; //#9314
        $j--; //#9314
        $_.msglen = $_.msg.length; //#9315
        $k[$j++] = Infinity; //#9321
        for (var _6I = 0, _6J = $_.msglen + 1; _6I < _6J; _6I++) { //#9321
            $k[$j++] = 0; //#9321
        } //#9321
        $_.numsAtEven = $a(); //#9321
        $k[$j++] = Infinity; //#9322
        for (var _6L = 0, _6M = $_.msglen + 1; _6L < _6M; _6L++) { //#9322
            $k[$j++] = 0; //#9322
        } //#9322
        $_.numsAtOdd = $a(); //#9322
        for (var _6O = $_.msglen - 1; _6O >= 0; _6O -= 1) { //#9338
            $_.i = _6O; //#9324
            $_.c = $get($_.msg, $_.i); //#9325
            if ($_.c == $_.code128_fn1) { //#9335
                $put($_.numsAtEven, $_.i, 2 + $get($_.numsAtEven, $_.i + 1)); //#9327
                $put($_.numsAtOdd, $_.i, 0); //#9328
            } else { //#9335
                if (($_.c >= 48) && ($_.c <= 57)) { //#9335
                    $put($_.numsAtEven, $_.i, 1 + $get($_.numsAtOdd, $_.i + 1)); //#9331
                    $put($_.numsAtOdd, $_.i, 1 + $get($_.numsAtEven, $_.i + 1)); //#9332
                } else { //#9335
                    $put($_.numsAtEven, $_.i, 0); //#9334
                    $put($_.numsAtOdd, $_.i, 0); //#9335
                } //#9335
            } //#9335
        } //#9335
        $_.numsscr = function() {
            var _6r = $k[--$j]; //#9339
            $k[$j++] = $get($_.numsAtEven, _6r); //#9339
        }; //#9339
        $_.enca = function() {
            var _6u = $k[--$j]; //#9345
            $put($_.cws, $_.j, $get($_.seta, _6u)); //#9345
            $_.j = $_.j + 1; //#9346
        }; //#9346
        $_.encb = function() {
            var _70 = $k[--$j]; //#9349
            $put($_.cws, $_.j, $get($_.setb, _70)); //#9349
            $_.j = $_.j + 1; //#9350
        }; //#9350
        $_.encc = function() {
            var _75 = $k[$j - 1]; //#9353
            var _76 = $type(_75); //#9353
            if ($ne(_76, 'arraytype')) { //#9356
                var _78 = $k[--$j]; //#9354
                $k[$j++] = $get($_.setc, _78); //#9354
            } else { //#9356
                var _7A = $k[--$j]; //#9356
                $aload(_7A); //#9356
                var _7B = $k[--$j]; //#9356
                var _7C = $k[--$j]; //#9356
                $k[$j++] = $f(_7B - 48 + (_7C - 48) * 10) //#9356
            } //#9356
            var _7E = $k[--$j]; //#9358
            $put($_.cws, $_.j, _7E); //#9358
            $_.j = $_.j + 1; //#9359
        }; //#9359
        $_.anotb = function() {
            var _7H = $k[--$j]; //#9365
            $k[$j++] = $has($_.seta, _7H) && (!$has($_.setb, _7H)); //#9365
        }; //#9365
        $_.bnota = function() {
            var _7M = $k[--$j]; //#9366
            $k[$j++] = $has($_.setb, _7M) && (!$has($_.seta, _7M)); //#9366
        }; //#9366
        $k[$j++] = Infinity; //#9371
        for (var _7S = 0, _7T = $_.msg.length; _7S < _7T; _7S++) { //#9371
            $k[$j++] = 0; //#9371
        } //#9371
        $k[$j++] = 9999; //#9371
        $_.nextanotb = $a(); //#9371
        $k[$j++] = Infinity; //#9372
        for (var _7V = 0, _7W = $_.msg.length; _7V < _7W; _7V++) { //#9372
            $k[$j++] = 0; //#9372
        } //#9372
        $k[$j++] = 9999; //#9372
        $_.nextbnota = $a(); //#9372
        for (var _7Y = $_.msg.length - 1; _7Y >= 0; _7Y -= 1) { //#9385
            $_.i = _7Y; //#9374
            $k[$j++] = $get($_.msg, $_.i); //#9375
            $_.anotb(); //#9375
            var _7c = $k[--$j]; //#9379
            if (_7c) { //#9378
                $put($_.nextanotb, $_.i, 0); //#9376
            } else { //#9378
                $put($_.nextanotb, $_.i, $get($_.nextanotb, $_.i + 1) + 1); //#9378
            } //#9378
            $k[$j++] = $get($_.msg, $_.i); //#9380
            $_.bnota(); //#9380
            var _7n = $k[--$j]; //#9384
            if (_7n) { //#9383
                $put($_.nextbnota, $_.i, 0); //#9381
            } else { //#9383
                $put($_.nextbnota, $_.i, $get($_.nextbnota, $_.i + 1) + 1); //#9383
            } //#9383
        } //#9383
        $_.abeforeb = function() {
            var _7v = $k[--$j]; //#9390
            $k[$j++] = $lt($get($_.nextanotb, _7v), $get($_.nextbnota, _7v)); //#9390
        }; //#9390
        $_.bbeforea = function() {
            var _80 = $k[--$j]; //#9391
            $k[$j++] = $lt($get($_.nextbnota, _80), $get($_.nextanotb, _80)); //#9391
        }; //#9391
        $_.cws = $a(($_.barcode.length * 2) + 3); //#9393
        $_.j = 0; //#9398
        if ($_.msglen > 0) { //#9399
            $k[$j++] = 0; //#9399
            $_.numsscr(); //#9399
        } else { //#9399
            $k[$j++] = -1; //#9399
        } //#9399
        var _88 = $k[--$j]; //#9399
        $_.nums = _88; //#9399
        for (;;) { //#9424
            if ($_.msglen == 0) { //#9405
                $k[$j++] = $_.code128_stb; //#9402
                $_.enca(); //#9402
                $_.cset = "setb"; //#9403
                break; //#9404
            } //#9404
            if (($_.msglen == 2) && ($_.nums == 2)) { //#9410
                $k[$j++] = $_.code128_stc; //#9407
                $_.enca(); //#9407
                $_.cset = "setc"; //#9408
                break; //#9409
            } //#9409
            if ($_.nums >= 4) { //#9415
                $k[$j++] = $_.code128_stc; //#9412
                $_.enca(); //#9412
                $_.cset = "setc"; //#9413
                break; //#9414
            } //#9414
            $k[$j++] = 0; //#9416
            $_.abeforeb(); //#9416
            var _8D = $k[--$j]; //#9420
            if (_8D) { //#9420
                $k[$j++] = $_.code128_sta; //#9417
                $_.enca(); //#9417
                $_.cset = "seta"; //#9418
                break; //#9419
            } //#9419
            $k[$j++] = $_.code128_stb; //#9421
            $_.enca(); //#9421
            $_.cset = "setb"; //#9422
            break; //#9423
        } //#9423
        $_.i = 0; //#9429
        for (;;) { //#9516
            if ($_.i == $_.msglen) { //#9430
                break; //#9430
            } //#9430
            $k[$j++] = $_.i; //#9432
            $_.numsscr(); //#9432
            var _8H = $k[--$j]; //#9432
            $_.nums = _8H; //#9432
            for (;;) { //#9514
                if ((($eq($_.cset, "seta") || $eq($_.cset, "setb")) && ($_.nums >= 4)) && ($get($_.msg, $_.i) != $_.code128_fn1)) { //#9453
                    if (($_.nums % 2) == 0) { //#9450
                        $k[$j++] = $_.code128_swc; //#9441
                        if ($eq($_.cset, "seta")) { //#9441
                            $_.enca(); //#9441
                        } else { //#9441
                            $_.encb(); //#9441
                        } //#9441
                        $_.cset = "setc"; //#9442
                        break; //#9443
                    } else { //#9450
                        $k[$j++] = $get($_.msg, $_.i); //#9445
                        if ($eq($_.cset, "seta")) { //#9445
                            $_.enca(); //#9445
                        } else { //#9445
                            $_.encb(); //#9445
                        } //#9445
                        $_.i = $_.i + 1; //#9446
                        $k[$j++] = $_.i; //#9447
                        $_.numsscr(); //#9447
                        var _8W = $k[--$j]; //#9447
                        if (_8W >= 4) { //#9451
                            $k[$j++] = $_.code128_swc; //#9448
                            if ($eq($_.cset, "seta")) { //#9448
                                $_.enca(); //#9448
                            } else { //#9448
                                $_.encb(); //#9448
                            } //#9448
                            $_.cset = "setc"; //#9449
                            break; //#9450
                        } //#9450
                    } //#9450
                } //#9450
                var _8b = $get($_.msg, $_.i); //#9454
                $k[$j++] = $eq($_.cset, "setb"); //#9454
                $k[$j++] = _8b; //#9454
                $_.anotb(); //#9454
                var _8c = $k[--$j]; //#9454
                var _8d = $k[--$j]; //#9454
                if (_8d && _8c) { //#9466
                    if ($_.i < ($_.msglen - 1)) { //#9462
                        $k[$j++] = $_.i + 1; //#9456
                        $_.bbeforea(); //#9456
                        var _8h = $k[--$j]; //#9461
                        if (_8h) { //#9461
                            $k[$j++] = $_.code128_sft; //#9457
                            $_.encb(); //#9457
                            $k[$j++] = $get($_.msg, $_.i); //#9458
                            $_.enca(); //#9458
                            $_.i = $_.i + 1; //#9459
                            break; //#9460
                        } //#9460
                    } //#9460
                    $k[$j++] = $_.code128_swa; //#9463
                    $_.encb(); //#9463
                    $_.cset = "seta"; //#9464
                    break; //#9465
                } //#9465
                var _8p = $get($_.msg, $_.i); //#9467
                $k[$j++] = $eq($_.cset, "seta"); //#9467
                $k[$j++] = _8p; //#9467
                $_.bnota(); //#9467
                var _8q = $k[--$j]; //#9467
                var _8r = $k[--$j]; //#9467
                if (_8r && _8q) { //#9479
                    if ($_.i < ($_.msglen - 1)) { //#9475
                        $k[$j++] = $_.i + 1; //#9469
                        $_.abeforeb(); //#9469
                        var _8v = $k[--$j]; //#9474
                        if (_8v) { //#9474
                            $k[$j++] = $_.code128_sft; //#9470
                            $_.enca(); //#9470
                            $k[$j++] = $get($_.msg, $_.i); //#9471
                            $_.encb(); //#9471
                            $_.i = $_.i + 1; //#9472
                            break; //#9473
                        } //#9473
                    } //#9473
                    $k[$j++] = $_.code128_swb; //#9476
                    $_.enca(); //#9476
                    $_.cset = "setb"; //#9477
                    break; //#9478
                } //#9478
                if (($eq($_.cset, "setc") && ($_.nums < 2)) && (($get($_.msg, $_.i) > -1) || ($get($_.msg, $_.i) == $_.code128_fn4))) { //#9489
                    $k[$j++] = $_.i; //#9481
                    $_.abeforeb(); //#9481
                    var _99 = $k[--$j]; //#9485
                    if (_99) { //#9485
                        $k[$j++] = $_.code128_swa; //#9482
                        $_.encc(); //#9482
                        $_.cset = "seta"; //#9483
                        break; //#9484
                    } //#9484
                    $k[$j++] = $_.code128_swb; //#9486
                    $_.encc(); //#9486
                    $_.cset = "setb"; //#9487
                    break; //#9488
                } //#9488
                if ($eq($_.cset, "seta")) { //#9496
                    $k[$j++] = $get($_.msg, $_.i); //#9493
                    $_.enca(); //#9493
                    $_.i = $_.i + 1; //#9494
                    break; //#9495
                } //#9495
                if ($eq($_.cset, "setb")) { //#9501
                    $k[$j++] = $get($_.msg, $_.i); //#9498
                    $_.encb(); //#9498
                    $_.i = $_.i + 1; //#9499
                    break; //#9500
                } //#9500
                if ($eq($_.cset, "setc")) { //#9511
                    if ($get($_.msg, $_.i) <= -1) { //#9508
                        $k[$j++] = $get($_.msg, $_.i); //#9504
                        $_.encc(); //#9504
                        $_.i = $_.i + 1; //#9505
                    } else { //#9508
                        $k[$j++] = $geti($_.msg, $_.i, 2); //#9507
                        $_.encc(); //#9507
                        $_.i = $_.i + 2; //#9508
                    } //#9508
                    break; //#9510
                } //#9510
                break; //#9513
            } //#9513
        } //#9513
        $_.cws = $geti($_.cws, 0, $_.j); //#9517
    } //#9517
    if ($eq($_.encoding, "new")) { //#9668
        $_.seta = $_.code128_seta_new; //#9526
        $_.setb = $_.code128_setb_new; //#9527
        $_.setc = $_.code128_setc_new; //#9528
        $_.encode = $a([function() {
            $_.enc_a0(); //#9533
        }, function() {
            $_.enc_b0(); //#9533
        }, function() {
            $_.enc_c(); //#9533
        }, function() {
            $_.enc_a1(); //#9533
        }, function() {
            $_.enc_b1(); //#9533
        }, function() {
            $_.enc_c(); //#9533
        }]); //#9533
        $_.can_a = function() {
            if ($_.c >= 0) { //#9538
                $k[$j++] = true; //#9538
            } else { //#9538
                $k[$j++] = $has($_.seta, $_.c); //#9538
            } //#9538
        }; //#9538
        $_.can_b = function() {
            if ($_.c >= 0) { //#9539
                $k[$j++] = true; //#9539
            } else { //#9539
                $k[$j++] = $has($_.setb, $_.c); //#9539
            } //#9539
        }; //#9539
        $_.can_c0 = function() {
            if ($_.num_digits >= 2) { //#9540
                $k[$j++] = true; //#9540
            } else { //#9540
                $k[$j++] = $has($_.setc, $_.c); //#9540
            } //#9540
        }; //#9540
        $_.can_c1 = function() {
            if ($_.num_digits >= 2) { //#9541
                $k[$j++] = true; //#9541
            } else { //#9541
                $k[$j++] = $has($_.setc, $_.c); //#9541
            } //#9541
        }; //#9541
        if ($_.suppressc) { //#9546
            $_.can_c0 = function() {
                $k[$j++] = false; //#9546
            }; //#9546
        } //#9546
        if ($_.suppressc || $_.unlatchextbeforec) { //#9547
            $_.can_c1 = function() {
                $k[$j++] = false; //#9547
            }; //#9547
        } //#9547
        $_.out_a0 = function() {
            $k[$j++] = 1; //#9552
            if ($_.c >= 0) { //#9552
                if ($_.c >= 128) { //#9552
                    $k[$j - 1] += 1; //#9552
                } //#9552
                if (($_.c & 127) >= 96) { //#9552
                    $k[$j - 1] += 1; //#9552
                } //#9552
            } //#9552
        }; //#9552
        $_.out_a1 = function() {
            $k[$j++] = 1; //#9553
            if ($_.c >= 0) { //#9553
                if ($_.c < 128) { //#9553
                    $k[$j - 1] += 1; //#9553
                } //#9553
                if (($_.c & 127) >= 96) { //#9553
                    $k[$j - 1] += 1; //#9553
                } //#9553
            } //#9553
        }; //#9553
        $_.out_b0 = function() {
            $k[$j++] = 1; //#9554
            if ($_.c >= 0) { //#9554
                if ($_.c >= 128) { //#9554
                    $k[$j - 1] += 1; //#9554
                } //#9554
                if (($_.c & 127) < 32) { //#9554
                    $k[$j - 1] += 1; //#9554
                } //#9554
            } //#9554
        }; //#9554
        $_.out_b1 = function() {
            $k[$j++] = 1; //#9555
            if ($_.c >= 0) { //#9555
                if ($_.c < 128) { //#9555
                    $k[$j - 1] += 1; //#9555
                } //#9555
                if (($_.c & 127) < 32) { //#9555
                    $k[$j - 1] += 1; //#9555
                } //#9555
            } //#9555
        }; //#9555
        $_.map_ab = function() {
            var _AD = $k[$j - 1]; //#9560
            if (_AD < 32) { //#9560
                $k[$j - 1] += 64; //#9560
            } else { //#9560
                $k[$j - 1] -= 32; //#9560
            } //#9560
        }; //#9560
        $_.enc_a0 = function() {
            $k[$j++] = Infinity; //#9561
            if ($_.c < 0) { //#9561
                $k[$j++] = $get($_.seta, $_.c); //#9561
            } else { //#9561
                if ($_.c >= 128) { //#9561
                    $k[$j++] = 101; //#9561
                } //#9561
                var _AM = $_.c & 127; //#9561
                $k[$j++] = _AM; //#9561
                if (_AM >= 96) { //#9561
                    var _AN = $k[--$j]; //#9561
                    $k[$j++] = 98; //#9561
                    $k[$j++] = _AN; //#9561
                } //#9561
                $_.map_ab(); //#9561
            } //#9561
            var _AO = $a(); //#9561
            $k[$j++] = _AO; //#9561
        }; //#9561
        $_.enc_a1 = function() {
            $k[$j++] = Infinity; //#9562
            if ($_.c < 0) { //#9562
                $k[$j++] = $get($_.seta, $_.c); //#9562
            } else { //#9562
                if ($_.c < 128) { //#9562
                    $k[$j++] = 101; //#9562
                } //#9562
                var _AV = $_.c & 127; //#9562
                $k[$j++] = _AV; //#9562
                if (_AV >= 96) { //#9562
                    var _AW = $k[--$j]; //#9562
                    $k[$j++] = 98; //#9562
                    $k[$j++] = _AW; //#9562
                } //#9562
                $_.map_ab(); //#9562
            } //#9562
            var _AX = $a(); //#9562
            $k[$j++] = _AX; //#9562
        }; //#9562
        $_.enc_b0 = function() {
            $k[$j++] = Infinity; //#9563
            if ($_.c < 0) { //#9563
                $k[$j++] = $get($_.setb, $_.c); //#9563
            } else { //#9563
                if ($_.c >= 128) { //#9563
                    $k[$j++] = 100; //#9563
                } //#9563
                var _Ae = $_.c & 127; //#9563
                $k[$j++] = _Ae; //#9563
                if (_Ae < 32) { //#9563
                    var _Af = $k[--$j]; //#9563
                    $k[$j++] = 98; //#9563
                    $k[$j++] = _Af; //#9563
                } //#9563
                $_.map_ab(); //#9563
            } //#9563
            var _Ag = $a(); //#9563
            $k[$j++] = _Ag; //#9563
        }; //#9563
        $_.enc_b1 = function() {
            $k[$j++] = Infinity; //#9564
            if ($_.c < 0) { //#9564
                $k[$j++] = $get($_.setb, $_.c); //#9564
            } else { //#9564
                if ($_.c < 128) { //#9564
                    $k[$j++] = 100; //#9564
                } //#9564
                var _An = $_.c & 127; //#9564
                $k[$j++] = _An; //#9564
                if (_An < 32) { //#9564
                    var _Ao = $k[--$j]; //#9564
                    $k[$j++] = 98; //#9564
                    $k[$j++] = _Ao; //#9564
                } //#9564
                $_.map_ab(); //#9564
            } //#9564
            var _Ap = $a(); //#9564
            $k[$j++] = _Ap; //#9564
        }; //#9564
        $_.enc_c = function() {
            $k[$j++] = Infinity; //#9565
            if ($_.c < 0) { //#9565
                $k[$j++] = $get($_.setc, $_.c); //#9565
            } else { //#9565
                $k[$j++] = $f(($get($_.msg, $_.n) - 48) * 10 + ($get($_.msg, $_.n + 1) - 48)) //#9565
            } //#9565
            var _B0 = $a(); //#9565
            $k[$j++] = _B0; //#9565
        }; //#9565
        $_.get_best_prior_state = function() {
            var _B2 = $k[--$j]; //#9572
            var _B3 = $get($_.bln_0, _B2); //#9572
            var _B4 = $k[--$j]; //#9572
            $_.len = $f(_B4 + _B3) //#9572
            var _B5 = $k[--$j]; //#9572
            $_.o = _B5; //#9572
            var _B7 = $k[--$j]; //#9573
            var _B8 = $get($_.bln_0, _B7); //#9573
            var _B9 = $k[--$j]; //#9573
            var _BA = $f(_B9 + _B8); //#9573
            $k[$j++] = _BA; //#9573
            if (_BA < $_.len) { //#9573
                var _BC = $k[--$j]; //#9573
                $_.len = _BC; //#9573
                var _BD = $k[--$j]; //#9573
                $_.o = _BD; //#9573
            } else { //#9573
                $j -= 2; //#9573
            } //#9573
            var _BF = $k[--$j]; //#9574
            var _BG = $get($_.bln_0, _BF); //#9574
            var _BH = $k[--$j]; //#9574
            var _BI = $f(_BH + _BG); //#9574
            $k[$j++] = _BI; //#9574
            if (_BI < $_.len) { //#9574
                var _BK = $k[--$j]; //#9574
                $_.len = _BK; //#9574
                var _BL = $k[--$j]; //#9574
                $_.o = _BL; //#9574
            } else { //#9574
                $j -= 2; //#9574
            } //#9574
            var _BN = $k[--$j]; //#9575
            var _BO = $get($_.bln_0, _BN); //#9575
            var _BP = $k[--$j]; //#9575
            var _BQ = $f(_BP + _BO); //#9575
            $k[$j++] = _BQ; //#9575
            if (_BQ < $_.len) { //#9575
                var _BS = $k[--$j]; //#9575
                $_.len = _BS; //#9575
                var _BT = $k[--$j]; //#9575
                $_.o = _BT; //#9575
            } else { //#9575
                $j -= 2; //#9575
            } //#9575
            var _BV = $k[--$j]; //#9576
            var _BW = $get($_.bln_0, _BV); //#9576
            var _BX = $k[--$j]; //#9576
            var _BY = $f(_BX + _BW); //#9576
            $k[$j++] = _BY; //#9576
            if (_BY < $_.len) { //#9576
                var _Ba = $k[--$j]; //#9576
                $_.len = _Ba; //#9576
                var _Bb = $k[--$j]; //#9576
                $_.o = _Bb; //#9576
            } else { //#9576
                $j -= 2; //#9576
            } //#9576
            var _Bd = $k[--$j]; //#9577
            var _Be = $get($_.bln_0, _Bd); //#9577
            var _Bf = $k[--$j]; //#9577
            if ($f(_Bf + _Be) < $_.len) { //#9577
                var _Bh = $k[--$j]; //#9577
                $_.o = _Bh; //#9577
            } else { //#9577
                $j--; //#9577
            } //#9577
            $k[$j++] = $_.o; //#9578
        }; //#9578
        $_.bln_0 = $_.code128_start_length; //#9586
        $_.bln_1 = $_.code128_start_length; //#9586
        $k[$j++] = Infinity; //#9586
        for (var _Bj = 0; _Bj < 4; _Bj++) { //#9586
            $k[$j++] = $a([0, 0, 0, 0, 0, 0]); //#9586
        } //#9586
        $_.bln = $a(); //#9586
        $_.bps_0 = $_.code128_start_state; //#9587
        $_.bps_1 = $_.code128_start_state; //#9587
        $k[$j++] = Infinity; //#9587
        for (var _Bl = 0; _Bl < 4; _Bl++) { //#9587
            $k[$j++] = $a([0, 0, 0, 0, 0, 0]); //#9587
        } //#9587
        $_.bps = $a(); //#9587
        $k[$j++] = Infinity; //#9592
        for (var _Bo = 0, _Bp = $_.msg.length; _Bo < _Bp; _Bo++) { //#9592
            $k[$j++] = $a([0, 0, 0, 0, 0, 0]); //#9592
        } //#9592
        $_.path = $a(); //#9592
        $_.make_tables = function() {
            $_.num_digits = 0; //#9595
            for (var _Bt = 0, _Bs = $_.msg.length - 1; _Bt <= _Bs; _Bt += 1) { //#9636
                $_.n = _Bt; //#9597
                $_.c = $get($_.msg, $_.n); //#9598
                var _C0 = ($_.c >= 48) && ($_.c < 58) ? $_.num_digits + 1 : 0; //#9603
                $_.num_digits = _C0; //#9603
                $_.bln_2 = $_.bln_1; //#9608
                $_.bln_1 = $_.bln_0; //#9608
                $_.bln_0 = $get($_.bln, $_.n & 3); //#9608
                $_.bps_2 = $_.bps_1; //#9609
                $_.bps_1 = $_.bps_0; //#9609
                $_.bps_0 = $get($_.bps, $_.n & 3); //#9609
                var _CF = $_.num_digits >= 2 ? $_.bps_2 : $_.bps_1; //#9614
                $_.bps_c = _CF; //#9614
                var _CK = $_.num_digits >= 2 ? $_.bln_2 : $_.bln_1; //#9615
                $_.bln_c = _CK; //#9615
                $k[$j++] = $_.bln_0; //#9620
                $k[$j++] = 0; //#9620
                $_.can_a(); //#9620
                var _CN = $k[--$j]; //#9620
                if (_CN) { //#9620
                    $_.p = $get($_.bps_1, 0); //#9620
                    $put($get($_.path, $_.n), 0, $_.p); //#9620
                    $k[$j++] = $f($get($_.bln_1, $_.p) + $get($_.code128_latch_length_a0, $_.p)) //#9620
                    $_.out_a0(); //#9620
                    var _CZ = $k[--$j]; //#9620
                    var _Ca = $k[--$j]; //#9620
                    $k[$j++] = $f(_Ca + _CZ) //#9620
                } else { //#9620
                    $k[$j++] = $_.code128_max_int; //#9620
                } //#9620
                var _Cb = $k[--$j]; //#9620
                var _Cc = $k[--$j]; //#9620
                var _Cd = $k[--$j]; //#9620
                $put(_Cd, _Cc, _Cb); //#9620
                $k[$j++] = $_.bln_0; //#9621
                $k[$j++] = 3; //#9621
                $_.can_a(); //#9621
                var _Cf = $k[--$j]; //#9621
                if (_Cf) { //#9621
                    $_.p = $get($_.bps_1, 3); //#9621
                    $put($get($_.path, $_.n), 3, $_.p); //#9621
                    $k[$j++] = $f($get($_.bln_1, $_.p) + $get($_.code128_latch_length_a1, $_.p)) //#9621
                    $_.out_a1(); //#9621
                    var _Cr = $k[--$j]; //#9621
                    var _Cs = $k[--$j]; //#9621
                    $k[$j++] = $f(_Cs + _Cr) //#9621
                } else { //#9621
                    $k[$j++] = $_.code128_max_int; //#9621
                } //#9621
                var _Ct = $k[--$j]; //#9621
                var _Cu = $k[--$j]; //#9621
                var _Cv = $k[--$j]; //#9621
                $put(_Cv, _Cu, _Ct); //#9621
                $k[$j++] = $_.bln_0; //#9622
                $k[$j++] = 1; //#9622
                $_.can_b(); //#9622
                var _Cx = $k[--$j]; //#9622
                if (_Cx) { //#9622
                    $_.p = $get($_.bps_1, 1); //#9622
                    $put($get($_.path, $_.n), 1, $_.p); //#9622
                    $k[$j++] = $f($get($_.bln_1, $_.p) + $get($_.code128_latch_length_b0, $_.p)) //#9622
                    $_.out_b0(); //#9622
                    var _D9 = $k[--$j]; //#9622
                    var _DA = $k[--$j]; //#9622
                    $k[$j++] = $f(_DA + _D9) //#9622
                } else { //#9622
                    $k[$j++] = $_.code128_max_int; //#9622
                } //#9622
                var _DB = $k[--$j]; //#9622
                var _DC = $k[--$j]; //#9622
                var _DD = $k[--$j]; //#9622
                $put(_DD, _DC, _DB); //#9622
                $k[$j++] = $_.bln_0; //#9623
                $k[$j++] = 4; //#9623
                $_.can_b(); //#9623
                var _DF = $k[--$j]; //#9623
                if (_DF) { //#9623
                    $_.p = $get($_.bps_1, 4); //#9623
                    $put($get($_.path, $_.n), 4, $_.p); //#9623
                    $k[$j++] = $f($get($_.bln_1, $_.p) + $get($_.code128_latch_length_b1, $_.p)) //#9623
                    $_.out_b1(); //#9623
                    var _DR = $k[--$j]; //#9623
                    var _DS = $k[--$j]; //#9623
                    $k[$j++] = $f(_DS + _DR) //#9623
                } else { //#9623
                    $k[$j++] = $_.code128_max_int; //#9623
                } //#9623
                var _DT = $k[--$j]; //#9623
                var _DU = $k[--$j]; //#9623
                var _DV = $k[--$j]; //#9623
                $put(_DV, _DU, _DT); //#9623
                $k[$j++] = $_.bln_0; //#9624
                $k[$j++] = 2; //#9624
                $_.can_c0(); //#9624
                var _DX = $k[--$j]; //#9624
                if (_DX) { //#9624
                    $_.p = $get($_.bps_c, 2); //#9624
                    $put($get($_.path, $_.n), 2, $_.p); //#9624
                    $k[$j++] = $f($get($_.bln_c, $_.p) + $get($_.code128_latch_length_c0, $_.p)) + 1 //#9624
                } else { //#9624
                    $k[$j++] = $_.code128_max_int; //#9624
                } //#9624
                var _Dj = $k[--$j]; //#9624
                var _Dk = $k[--$j]; //#9624
                var _Dl = $k[--$j]; //#9624
                $put(_Dl, _Dk, _Dj); //#9624
                $k[$j++] = $_.bln_0; //#9625
                $k[$j++] = 5; //#9625
                $_.can_c1(); //#9625
                var _Dn = $k[--$j]; //#9625
                if (_Dn) { //#9625
                    $_.p = $get($_.bps_c, 5); //#9625
                    $put($get($_.path, $_.n), 5, $_.p); //#9625
                    $k[$j++] = $f($get($_.bln_c, $_.p) + $get($_.code128_latch_length_c1, $_.p)) + 1 //#9625
                } else { //#9625
                    $k[$j++] = $_.code128_max_int; //#9625
                } //#9625
                var _Dz = $k[--$j]; //#9625
                var _E0 = $k[--$j]; //#9625
                var _E1 = $k[--$j]; //#9625
                $put(_E1, _E0, _Dz); //#9625
                $k[$j++] = $_.bps_0; //#9630
                $k[$j++] = 0; //#9630
                $aload($_.code128_prioritized_latch_length_a0); //#9630
                $_.get_best_prior_state(); //#9630
                var _E3 = $k[--$j]; //#9630
                var _E4 = $k[--$j]; //#9630
                var _E5 = $k[--$j]; //#9630
                $put(_E5, _E4, _E3); //#9630
                $k[$j++] = $_.bps_0; //#9631
                $k[$j++] = 3; //#9631
                $aload($_.code128_prioritized_latch_length_a1); //#9631
                $_.get_best_prior_state(); //#9631
                var _E7 = $k[--$j]; //#9631
                var _E8 = $k[--$j]; //#9631
                var _E9 = $k[--$j]; //#9631
                $put(_E9, _E8, _E7); //#9631
                $k[$j++] = $_.bps_0; //#9632
                $k[$j++] = 1; //#9632
                $aload($_.code128_prioritized_latch_length_b0); //#9632
                $_.get_best_prior_state(); //#9632
                var _EB = $k[--$j]; //#9632
                var _EC = $k[--$j]; //#9632
                var _ED = $k[--$j]; //#9632
                $put(_ED, _EC, _EB); //#9632
                $k[$j++] = $_.bps_0; //#9633
                $k[$j++] = 4; //#9633
                $aload($_.code128_prioritized_latch_length_b1); //#9633
                $_.get_best_prior_state(); //#9633
                var _EF = $k[--$j]; //#9633
                var _EG = $k[--$j]; //#9633
                var _EH = $k[--$j]; //#9633
                $put(_EH, _EG, _EF); //#9633
                $k[$j++] = $_.bps_0; //#9634
                $k[$j++] = 2; //#9634
                $aload($_.code128_prioritized_latch_length_c0); //#9634
                $_.get_best_prior_state(); //#9634
                var _EJ = $k[--$j]; //#9634
                var _EK = $k[--$j]; //#9634
                var _EL = $k[--$j]; //#9634
                $put(_EL, _EK, _EJ); //#9634
                $k[$j++] = $_.bps_0; //#9635
                $k[$j++] = 5; //#9635
                $aload($_.code128_prioritized_latch_length_c1); //#9635
                $_.get_best_prior_state(); //#9635
                var _EN = $k[--$j]; //#9635
                var _EO = $k[--$j]; //#9635
                var _EP = $k[--$j]; //#9635
                $put(_EP, _EO, _EN); //#9635
            } //#9635
        }; //#9635
        $_.backtrack = function() {
            $_.n = $_.msg.length; //#9640
            for (var _ER = 0, _ES = $_.code128_reverse_priority.length; _ER < _ES; _ER++) { //#9645
                var _ET = $get($_.code128_reverse_priority, _ER); //#9645
                var _EV = $get($_.bln_0, _ET); //#9645
                $k[$j++] = _ET; //#9645
                $k[$j++] = _EV; //#9645
                $k[$j++] = _EV; //#9645
            } //#9645
            $j--; //#9646
            var _EW = $k[--$j]; //#9646
            $_.len = _EW; //#9646
            var _EX = $k[--$j]; //#9646
            $_.state = _EX; //#9646
            for (var _EY = 0; _EY < 5; _EY++) { //#9647
                var _Ea = $k[--$j]; //#9647
                if ($lt(_Ea, $_.len)) { //#9647
                    var _Eb = $k[--$j]; //#9647
                    $_.len = _Eb; //#9647
                    var _Ec = $k[--$j]; //#9647
                    $_.state = _Ec; //#9647
                } else { //#9647
                    $j -= 2; //#9647
                } //#9647
            } //#9647
            $k[$j++] = $a($_.len); //#9660
            for (;;) { //#9660
                if ($_.n <= 0) { //#9651
                    break; //#9651
                } //#9651
                $_.prior_state = $get($get($_.path, $_.n - 1), $_.state); //#9652
                $k[$j++] = Infinity; //#9653
                $forall($get($get($_.code128_latch_sequence, $_.state), $_.prior_state)); //#9653
                $_.latch = $a(); //#9653
                var _Ev = ((($_.state == 2) || ($_.state == 5)) && ($get($_.msg, $_.n - 1) >= 48)) ? 2 : 1; //#9654
                $_.n = $_.n - _Ev; //#9654
                $_.c = $get($_.msg, $_.n); //#9655
                var _F1 = $get($_.encode, $_.state); //#9656
                $k[$j++] = 'enc'; //#9656
                if (_F1() === true) {
                    break;
                } //#9656
                var _F2 = $k[--$j]; //#9656
                var _F3 = $k[--$j]; //#9656
                $_[_F3] = _F2; //#9656
                $_.len = $f($_.len - $_.latch.length - $_.enc.length) //#9657
                var _F7 = $k[--$j]; //#9658
                var _F8 = $_.len; //#9658
                var _F9 = $_.latch; //#9658
                $puti(_F7, _F8, _F9); //#9658
                $puti(_F7, $f(_F8 + _F9.length), $_.enc) //#9658
                $_.state = $_.prior_state; //#9659
                $k[$j++] = _F7; //#9659
            } //#9659
            var _FC = $k[$j - 1]; //#9661
            $put(_FC, 0, $get($_.code128_start_code, $_.state)); //#9661
        }; //#9661
        $_.make_tables(); //#9664
        $_.backtrack(); //#9664
        var _FF = $k[--$j]; //#9666
        $_.cws = _FF; //#9666
    } //#9666
    $_.j = $_.cws.length; //#9673
    var _FI = $a($_.j + 2); //#9674
    $puti(_FI, 0, $_.cws); //#9674
    $_.cws = _FI; //#9674
    $_.csum = $get($_.cws, 0); //#9675
    for (var _FO = 1, _FN = $_.j - 1; _FO <= _FN; _FO += 1) { //#9679
        $_.i = _FO; //#9677
        $_.csum = $f($_.csum + $get($_.cws, $_.i) * $_.i) //#9678
    } //#9678
    $_.csum = $_.csum % 103; //#9680
    $put($_.cws, $_.j, $_.csum); //#9681
    $put($_.cws, $_.j + 1, 106); //#9682
    if ($has($_.options, 'debugcws')) { //#9686
        $k[$j++] = "bwipp.debugcws#9686"; //#9686
        $k[$j++] = $_.cws; //#9686
        bwipp_raiseerror(); //#9686
    } //#9686
    $_.sbs = $s(($_.cws.length * 6) + 1); //#9692
    for (var _Fh = 0, _Fg = $_.cws.length - 1; _Fh <= _Fg; _Fh += 1) { //#9696
        $_.i = _Fh; //#9694
        $puti($_.sbs, $_.i * 6, $get($_.code128_encs, $get($_.cws, $_.i))); //#9695
    } //#9695
    $k[$j++] = Infinity; //#9698
    var _Fo = $_.sbs; //#9698
    for (var _Fp = 0, _Fq = _Fo.length; _Fp < _Fq; _Fp++) { //#9698
        $k[$j++] = $get(_Fo, _Fp) - 48; //#9698
    } //#9698
    $_.sbs = $a(); //#9698
    if ($_.height == -1) { //#9700
        $_.height = 1; //#9700
    } //#9700
    $k[$j++] = Infinity; //#9702
    var _Ft = $_.sbs; //#9704
    var _Fy = []; //#9705
    for (var _Fv = 0, _Fw = ~~(($_.sbs.length + 1) / 2); _Fv < _Fw; _Fv++) { //#9705
        _Fy[_Fv] = $_.height; //#9705
    } //#9705
    _Fy = $a(_Fy); //#9705
    var _G2 = []; //#9706
    for (var _G0 = 0, _G1 = ~~(($_.sbs.length + 1) / 2); _G0 < _G1; _G0++) { //#9706
        _G2[_G0] = 0; //#9706
    } //#9706
    _G2 = $a(_G2); //#9706
    var _G9 = $a([$a([$_.text, $_.text1xoffset, $_.text1yoffset, $_.text1font, $_.text1size])]); //#9707
    $k[$j++] = 'ren'; //#9715
    $k[$j++] = 'renlinear'; //#9715
    $k[$j++] = 'sbs'; //#9715
    $k[$j++] = _Ft; //#9715
    $k[$j++] = 'bhs'; //#9715
    $k[$j++] = _Fy; //#9715
    $k[$j++] = 'bbs'; //#9715
    $k[$j++] = _G2; //#9715
    $k[$j++] = 'txt'; //#9715
    $k[$j++] = _G9; //#9715
    $k[$j++] = 'text1xalign'; //#9715
    $k[$j++] = "center"; //#9715
    $k[$j++] = 'opt'; //#9715
    $k[$j++] = $_.options; //#9715
    var _GB = $d(); //#9715
    $k[$j++] = _GB; //#9718
    if ($_._render) { //#9718
        bwipp_renlinear(); //#9718
    } //#9718
    $_ = $__; //#9721
} //bwipp_code128

function bwipp_datamatrix() {
    if (!bwipp_datamatrix.globals) {
        var $__ = $_;
        $_ = bwipp_datamatrix.globals = {};
        //#24915
        $_.datamatrix_metrics = $a([$a([10, 10, 1, 1, 5, 1, 0]), $a([12, 12, 1, 1, 7, 1, 0]), $a([14, 14, 1, 1, 10, 1, 0]), $a([16, 16, 1, 1, 12, 1, 0]), $a([18, 18, 1, 1, 14, 1, 0]), $a([20, 20, 1, 1, 18, 1, 0]), $a([22, 22, 1, 1, 20, 1, 0]), $a([24, 24, 1, 1, 24, 1, 0]), $a([26, 26, 1, 1, 28, 1, 0]), $a([32, 32, 2, 2, 36, 1, 0]), $a([36, 36, 2, 2, 42, 1, 0]), $a([40, 40, 2, 2, 48, 1, 0]), $a([44, 44, 2, 2, 56, 1, 0]), $a([48, 48, 2, 2, 68, 1, 0]), $a([52, 52, 2, 2, 84, 2, 0]), $a([64, 64, 4, 4, 112, 2, 0]), $a([72, 72, 4, 4, 144, 4, 0]), $a([80, 80, 4, 4, 192, 4, 0]), $a([88, 88, 4, 4, 224, 4, 0]), $a([96, 96, 4, 4, 272, 4, 0]), $a([104, 104, 4, 4, 336, 6, 0]), $a([120, 120, 6, 6, 408, 6, 0]), $a([132, 132, 6, 6, 496, 8, 0]), $a([144, 144, 6, 6, 620, 10, 0]), $a([8, 18, 1, 1, 7, 1, 0]), $a([8, 32, 1, 2, 11, 1, 0]), $a([8, 48, 1, 2, 15, 1, 1]), $a([8, 64, 1, 4, 18, 1, 1]), $a([8, 80, 1, 4, 22, 1, 1]), $a([8, 96, 1, 4, 28, 1, 1]), $a([8, 120, 1, 6, 32, 1, 1]), $a([8, 144, 1, 6, 36, 1, 1]), $a([12, 26, 1, 1, 14, 1, 0]), $a([12, 36, 1, 2, 18, 1, 0]), $a([12, 64, 1, 4, 27, 1, 1]), $a([12, 88, 1, 4, 36, 1, 1]), $a([16, 36, 1, 2, 24, 1, 0]), $a([16, 48, 1, 2, 28, 1, 0]), $a([16, 64, 1, 4, 36, 1, 1]), $a([20, 36, 1, 2, 28, 1, 1]), $a([20, 44, 1, 2, 34, 1, 1]), $a([20, 64, 1, 4, 42, 1, 1]), $a([22, 48, 1, 2, 38, 1, 1]), $a([24, 48, 1, 2, 41, 1, 1]), $a([24, 64, 1, 4, 46, 1, 1]), $a([26, 40, 1, 2, 38, 1, 1]), $a([26, 48, 1, 2, 42, 1, 1]), $a([26, 64, 1, 4, 50, 1, 1])]); //#24975
        $_.datamatrix_fnc1 = -1; //#24980
        $_.datamatrix_prog = -2; //#24980
        $_.datamatrix_m05 = -3; //#24980
        $_.datamatrix_m06 = -4; //#24980
        $_.datamatrix_lC = -5; //#24981
        $_.datamatrix_lB = -6; //#24981
        $_.datamatrix_lX = -7; //#24981
        $_.datamatrix_lT = -8; //#24981
        $_.datamatrix_lE = -9; //#24981
        $_.datamatrix_unl = -10; //#24981
        $_.datamatrix_sapp = -11; //#24982
        $_.datamatrix_usft = -12; //#24982
        $_.datamatrix_sft1 = -13; //#24982
        $_.datamatrix_sft2 = -14; //#24982
        $_.datamatrix_sft3 = -15; //#24982
        $_.datamatrix_eci = -16; //#24982
        $_.datamatrix_pad = -17; //#24982
        $_.datamatrix_unlcw = 254; //#24983
        $_.datamatrix_A = 0; //#24985
        $_.datamatrix_C = 1; //#24985
        $_.datamatrix_T = 2; //#24985
        $_.datamatrix_X = 3; //#24985
        $_.datamatrix_E = 4; //#24985
        $_.datamatrix_B = 5; //#24985
        $_.datamatrix_encfuncs = $a(['encA', 'encCTX', 'encCTX', 'encCTX', 'encE', 'encB']); //#24986
        var _14 = $a([function() {
            var _o = $k[$j - 1]; //#24992
            var _p = $k[$j - 2]; //#24992
            $k[$j++] = _p - 2; //#24992
            $k[$j++] = _o - 2; //#24992
        }, function() {
            var _q = $k[$j - 1]; //#24992
            var _r = $k[$j - 2]; //#24992
            $k[$j++] = _r - 2; //#24992
            $k[$j++] = _q - 1; //#24992
        }, function() {
            var _s = $k[$j - 1]; //#24993
            var _t = $k[$j - 2]; //#24993
            $k[$j++] = _t - 1; //#24993
            $k[$j++] = _s - 2; //#24993
        }, function() {
            var _u = $k[$j - 1]; //#24993
            var _v = $k[$j - 2]; //#24993
            $k[$j++] = _v - 1; //#24993
            $k[$j++] = _u - 1; //#24993
        }, function() {
            var _w = $k[$j - 1]; //#24994
            var _x = $k[$j - 2]; //#24994
            $k[$j++] = _x - 1; //#24994
            $k[$j++] = _w; //#24994
        }, function() {
            var _y = $k[$j - 1]; //#24994
            var _z = $k[$j - 2]; //#24994
            $k[$j++] = _z; //#24994
            $k[$j++] = _y - 2; //#24994
        }, function() {
            var _10 = $k[$j - 1]; //#24995
            var _11 = $k[$j - 2]; //#24995
            $k[$j++] = _11; //#24995
            $k[$j++] = _10 - 1; //#24995
        }, function() {
            var _12 = $k[$j - 1]; //#24995
            var _13 = $k[$j - 2]; //#24995
            $k[$j++] = _13; //#24995
            $k[$j++] = _12; //#24995
        }]); //#24995
        $_.datamatrix_dmn = _14; //#24996
        var _1D = $a([function() {
            $k[$j++] = $_.mrows - 1; //#24999
            $k[$j++] = 0; //#24999
        }, function() {
            $k[$j++] = $_.mrows - 1; //#24999
            $k[$j++] = 1; //#24999
        }, function() {
            $k[$j++] = $_.mrows - 1; //#25000
            $k[$j++] = 2; //#25000
        }, function() {
            $k[$j++] = 0; //#25000
            $k[$j++] = $_.mcols - 2; //#25000
        }, function() {
            $k[$j++] = 0; //#25001
            $k[$j++] = $_.mcols - 1; //#25001
        }, function() {
            $k[$j++] = 1; //#25001
            $k[$j++] = $_.mcols - 1; //#25001
        }, function() {
            $k[$j++] = 2; //#25002
            $k[$j++] = $_.mcols - 1; //#25002
        }, function() {
            $k[$j++] = 3; //#25002
            $k[$j++] = $_.mcols - 1; //#25002
        }]); //#25002
        $_.datamatrix_dmc1 = _1D; //#25003
        var _1M = $a([function() {
            $k[$j++] = $_.mrows - 3; //#25006
            $k[$j++] = 0; //#25006
        }, function() {
            $k[$j++] = $_.mrows - 2; //#25006
            $k[$j++] = 0; //#25006
        }, function() {
            $k[$j++] = $_.mrows - 1; //#25007
            $k[$j++] = 0; //#25007
        }, function() {
            $k[$j++] = 0; //#25007
            $k[$j++] = $_.mcols - 4; //#25007
        }, function() {
            $k[$j++] = 0; //#25008
            $k[$j++] = $_.mcols - 3; //#25008
        }, function() {
            $k[$j++] = 0; //#25008
            $k[$j++] = $_.mcols - 2; //#25008
        }, function() {
            $k[$j++] = 0; //#25009
            $k[$j++] = $_.mcols - 1; //#25009
        }, function() {
            $k[$j++] = 1; //#25009
            $k[$j++] = $_.mcols - 1; //#25009
        }]); //#25009
        $_.datamatrix_dmc2 = _1M; //#25010
        var _1V = $a([function() {
            $k[$j++] = $_.mrows - 3; //#25013
            $k[$j++] = 0; //#25013
        }, function() {
            $k[$j++] = $_.mrows - 2; //#25013
            $k[$j++] = 0; //#25013
        }, function() {
            $k[$j++] = $_.mrows - 1; //#25014
            $k[$j++] = 0; //#25014
        }, function() {
            $k[$j++] = 0; //#25014
            $k[$j++] = $_.mcols - 2; //#25014
        }, function() {
            $k[$j++] = 0; //#25015
            $k[$j++] = $_.mcols - 1; //#25015
        }, function() {
            $k[$j++] = 1; //#25015
            $k[$j++] = $_.mcols - 1; //#25015
        }, function() {
            $k[$j++] = 2; //#25016
            $k[$j++] = $_.mcols - 1; //#25016
        }, function() {
            $k[$j++] = 3; //#25016
            $k[$j++] = $_.mcols - 1; //#25016
        }]); //#25016
        $_.datamatrix_dmc3 = _1V; //#25017
        var _1f = $a([function() {
            $k[$j++] = $_.mrows - 1; //#25020
            $k[$j++] = 0; //#25020
        }, function() {
            $k[$j++] = $_.mrows - 1; //#25020
            $k[$j++] = $_.mcols - 1; //#25020
        }, function() {
            $k[$j++] = 0; //#25021
            $k[$j++] = $_.mcols - 3; //#25021
        }, function() {
            $k[$j++] = 0; //#25021
            $k[$j++] = $_.mcols - 2; //#25021
        }, function() {
            $k[$j++] = 0; //#25022
            $k[$j++] = $_.mcols - 1; //#25022
        }, function() {
            $k[$j++] = 1; //#25022
            $k[$j++] = $_.mcols - 3; //#25022
        }, function() {
            $k[$j++] = 1; //#25023
            $k[$j++] = $_.mcols - 2; //#25023
        }, function() {
            $k[$j++] = 1; //#25023
            $k[$j++] = $_.mcols - 1; //#25023
        }]); //#25023
        $_.datamatrix_dmc4 = _1f; //#25024
        $k[$j++] = Infinity; //#25038
        for (var _1g = 0; _1g <= 128; _1g += 1) { //#25039
            $k[$j++] = _1g; //#25039
            $k[$j++] = _1g + 1; //#25039
        } //#25039
        $k[$j++] = $_.datamatrix_pad; //#25044
        $k[$j++] = 129; //#25044
        for (var _1h = 0; _1h <= 99; _1h += 1) { //#25044
            var _1j = $cvrs($s(2), _1h, 10); //#25042
            var _1l = $strcpy($s(2), "00"); //#25042
            $puti(_1l, 2 - _1j.length, _1j); //#25042
            $k[$j++] = _1l; //#25043
            $k[$j++] = _1h + 130; //#25043
        } //#25043
        var _1m = $a([$_.datamatrix_lC, $_.datamatrix_lB, $_.datamatrix_fnc1, $_.datamatrix_sapp, $_.datamatrix_prog, $_.datamatrix_usft, $_.datamatrix_m05, $_.datamatrix_m06, $_.datamatrix_lX, $_.datamatrix_lT, $_.datamatrix_lE, $_.datamatrix_eci]); //#25045
        $k[$j++] = 229; //#25045
        for (var _1n = 0, _1o = _1m.length; _1n < _1o; _1n++) { //#25045
            var _1p = $get(_1m, _1n); //#25045
            var _1q = $k[--$j]; //#25045
            var _1r = _1q + 1; //#25045
            $k[$j++] = _1p; //#25045
            $k[$j++] = _1r; //#25045
            $k[$j++] = _1r; //#25045
        } //#25045
        $j--; //#25045
        $_.Avals = $d(); //#25045
        $k[$j++] = Infinity; //#25047
        var _1s = $_.Avals; //#25048
        for (var _1x = _1s.size, _1w = _1s.keys(), _1v = 0; _1v < _1x; _1v++) { //#25048
            var _1t = _1w.next().value; //#25048
            var _1u = _1s.get(_1t); //#25048
            $k[$j++] = _1t; //#25048
            $k[$j++] = Infinity; //#25048
            $k[$j++] = _1u; //#25048
            var _20 = $a(); //#25048
            $k[$j++] = _20; //#25048
        } //#25048
        $_.Avals = $d(); //#25048
        $k[$j++] = Infinity; //#25051
        $k[$j++] = $_.datamatrix_sft1; //#25056
        $k[$j++] = 0; //#25056
        $k[$j++] = $_.datamatrix_sft2; //#25056
        $k[$j++] = 1; //#25056
        $k[$j++] = $_.datamatrix_sft3; //#25056
        $k[$j++] = 2; //#25056
        $k[$j++] = 32; //#25056
        $k[$j++] = 3; //#25056
        for (var _21 = 48; _21 <= 57; _21 += 1) { //#25056
            $k[$j++] = _21; //#25056
            $k[$j++] = _21 - 44; //#25056
        } //#25056
        for (var _22 = 65; _22 <= 90; _22 += 1) { //#25057
            $k[$j++] = _22; //#25057
            $k[$j++] = _22 - 51; //#25057
        } //#25057
        var _23 = $d(); //#25057
        $_.CNvals = _23; //#25058
        $k[$j++] = Infinity; //#25059
        for (var _24 = 0; _24 <= 31; _24 += 1) { //#25059
            $k[$j++] = _24; //#25059
            $k[$j++] = _24; //#25059
        } //#25059
        var _25 = $d(); //#25059
        $_.C1vals = _25; //#25059
        $k[$j++] = Infinity; //#25060
        for (var _26 = 33; _26 <= 47; _26 += 1) { //#25061
            $k[$j++] = _26; //#25061
            $k[$j++] = _26 - 33; //#25061
        } //#25061
        for (var _27 = 58; _27 <= 64; _27 += 1) { //#25062
            $k[$j++] = _27; //#25062
            $k[$j++] = _27 - 43; //#25062
        } //#25062
        for (var _28 = 91; _28 <= 95; _28 += 1) { //#25063
            $k[$j++] = _28; //#25063
            $k[$j++] = _28 - 69; //#25063
        } //#25063
        $k[$j++] = $_.datamatrix_fnc1; //#25065
        $k[$j++] = 27; //#25065
        $k[$j++] = $_.datamatrix_usft; //#25065
        $k[$j++] = 30; //#25065
        var _29 = $d(); //#25065
        $_.C2vals = _29; //#25066
        $k[$j++] = Infinity; //#25067
        for (var _2A = 96; _2A <= 127; _2A += 1) { //#25067
            $k[$j++] = _2A; //#25067
            $k[$j++] = _2A - 96; //#25067
        } //#25067
        var _2B = $d(); //#25067
        $_.C3vals = _2B; //#25067
        $k[$j++] = Infinity; //#25068
        var _2C = $_.CNvals; //#25069
        for (var _2H = _2C.size, _2G = _2C.keys(), _2F = 0; _2F < _2H; _2F++) { //#25069
            var _2D = _2G.next().value; //#25069
            var _2E = _2C.get(_2D); //#25069
            $k[$j++] = _2D; //#25069
            $k[$j++] = Infinity; //#25069
            $k[$j++] = _2E; //#25069
            var _2K = $a(); //#25069
            $k[$j++] = _2K; //#25069
        } //#25069
        var _2L = $_.C1vals; //#25070
        for (var _2Q = _2L.size, _2P = _2L.keys(), _2O = 0; _2O < _2Q; _2O++) { //#25070
            var _2M = _2P.next().value; //#25070
            var _2N = _2L.get(_2M); //#25070
            $k[$j++] = _2M; //#25070
            var _2U = $get($_.CNvals, $_.datamatrix_sft1); //#25070
            $k[$j++] = Infinity; //#25070
            $k[$j++] = _2U; //#25070
            $k[$j++] = _2N; //#25070
            var _2V = $a(); //#25070
            $k[$j++] = _2V; //#25070
        } //#25070
        var _2W = $_.C2vals; //#25071
        for (var _2b = _2W.size, _2a = _2W.keys(), _2Z = 0; _2Z < _2b; _2Z++) { //#25071
            var _2X = _2a.next().value; //#25071
            var _2Y = _2W.get(_2X); //#25071
            $k[$j++] = _2X; //#25071
            var _2f = $get($_.CNvals, $_.datamatrix_sft2); //#25071
            $k[$j++] = Infinity; //#25071
            $k[$j++] = _2f; //#25071
            $k[$j++] = _2Y; //#25071
            var _2g = $a(); //#25071
            $k[$j++] = _2g; //#25071
        } //#25071
        var _2h = $_.C3vals; //#25072
        for (var _2m = _2h.size, _2l = _2h.keys(), _2k = 0; _2k < _2m; _2k++) { //#25072
            var _2i = _2l.next().value; //#25072
            var _2j = _2h.get(_2i); //#25072
            $k[$j++] = _2i; //#25072
            var _2q = $get($_.CNvals, $_.datamatrix_sft3); //#25072
            $k[$j++] = Infinity; //#25072
            $k[$j++] = _2q; //#25072
            $k[$j++] = _2j; //#25072
            var _2r = $a(); //#25072
            $k[$j++] = _2r; //#25072
        } //#25072
        $_.Cvals = $d(); //#25072
        $k[$j++] = Infinity; //#25075
        $k[$j++] = $_.datamatrix_sft1; //#25080
        $k[$j++] = 0; //#25080
        $k[$j++] = $_.datamatrix_sft2; //#25080
        $k[$j++] = 1; //#25080
        $k[$j++] = $_.datamatrix_sft3; //#25080
        $k[$j++] = 2; //#25080
        $k[$j++] = 32; //#25080
        $k[$j++] = 3; //#25080
        for (var _2s = 48; _2s <= 57; _2s += 1) { //#25080
            $k[$j++] = _2s; //#25080
            $k[$j++] = _2s - 44; //#25080
        } //#25080
        for (var _2t = 97; _2t <= 122; _2t += 1) { //#25081
            $k[$j++] = _2t; //#25081
            $k[$j++] = _2t - 83; //#25081
        } //#25081
        var _2u = $d(); //#25081
        $_.TNvals = _2u; //#25082
        $k[$j++] = Infinity; //#25083
        for (var _2v = 0; _2v <= 31; _2v += 1) { //#25083
            $k[$j++] = _2v; //#25083
            $k[$j++] = _2v; //#25083
        } //#25083
        var _2w = $d(); //#25083
        $_.T1vals = _2w; //#25083
        $k[$j++] = Infinity; //#25084
        for (var _2x = 33; _2x <= 47; _2x += 1) { //#25085
            $k[$j++] = _2x; //#25085
            $k[$j++] = _2x - 33; //#25085
        } //#25085
        for (var _2y = 58; _2y <= 64; _2y += 1) { //#25086
            $k[$j++] = _2y; //#25086
            $k[$j++] = _2y - 43; //#25086
        } //#25086
        for (var _2z = 91; _2z <= 95; _2z += 1) { //#25087
            $k[$j++] = _2z; //#25087
            $k[$j++] = _2z - 69; //#25087
        } //#25087
        $k[$j++] = $_.datamatrix_fnc1; //#25089
        $k[$j++] = 27; //#25089
        $k[$j++] = $_.datamatrix_usft; //#25089
        $k[$j++] = 30; //#25089
        var _30 = $d(); //#25089
        $_.T2vals = _30; //#25090
        $k[$j++] = Infinity; //#25091
        $k[$j++] = 96; //#25093
        $k[$j++] = 0; //#25093
        for (var _31 = 65; _31 <= 90; _31 += 1) { //#25093
            $k[$j++] = _31; //#25093
            $k[$j++] = _31 - 64; //#25093
        } //#25093
        for (var _32 = 123; _32 <= 127; _32 += 1) { //#25094
            $k[$j++] = _32; //#25094
            $k[$j++] = _32 - 96; //#25094
        } //#25094
        var _33 = $d(); //#25094
        $_.T3vals = _33; //#25095
        $k[$j++] = Infinity; //#25096
        var _34 = $_.TNvals; //#25097
        for (var _39 = _34.size, _38 = _34.keys(), _37 = 0; _37 < _39; _37++) { //#25097
            var _35 = _38.next().value; //#25097
            var _36 = _34.get(_35); //#25097
            $k[$j++] = _35; //#25097
            $k[$j++] = Infinity; //#25097
            $k[$j++] = _36; //#25097
            var _3C = $a(); //#25097
            $k[$j++] = _3C; //#25097
        } //#25097
        var _3D = $_.T1vals; //#25098
        for (var _3I = _3D.size, _3H = _3D.keys(), _3G = 0; _3G < _3I; _3G++) { //#25098
            var _3E = _3H.next().value; //#25098
            var _3F = _3D.get(_3E); //#25098
            $k[$j++] = _3E; //#25098
            var _3M = $get($_.TNvals, $_.datamatrix_sft1); //#25098
            $k[$j++] = Infinity; //#25098
            $k[$j++] = _3M; //#25098
            $k[$j++] = _3F; //#25098
            var _3N = $a(); //#25098
            $k[$j++] = _3N; //#25098
        } //#25098
        var _3O = $_.T2vals; //#25099
        for (var _3T = _3O.size, _3S = _3O.keys(), _3R = 0; _3R < _3T; _3R++) { //#25099
            var _3P = _3S.next().value; //#25099
            var _3Q = _3O.get(_3P); //#25099
            $k[$j++] = _3P; //#25099
            var _3X = $get($_.TNvals, $_.datamatrix_sft2); //#25099
            $k[$j++] = Infinity; //#25099
            $k[$j++] = _3X; //#25099
            $k[$j++] = _3Q; //#25099
            var _3Y = $a(); //#25099
            $k[$j++] = _3Y; //#25099
        } //#25099
        var _3Z = $_.T3vals; //#25100
        for (var _3e = _3Z.size, _3d = _3Z.keys(), _3c = 0; _3c < _3e; _3c++) { //#25100
            var _3a = _3d.next().value; //#25100
            var _3b = _3Z.get(_3a); //#25100
            $k[$j++] = _3a; //#25100
            var _3i = $get($_.TNvals, $_.datamatrix_sft3); //#25100
            $k[$j++] = Infinity; //#25100
            $k[$j++] = _3i; //#25100
            $k[$j++] = _3b; //#25100
            var _3j = $a(); //#25100
            $k[$j++] = _3j; //#25100
        } //#25100
        $_.Tvals = $d(); //#25100
        for (var _3k = 128; _3k <= 255; _3k += 1) { //#25111
            $_.i = _3k; //#25107
            var _3u = $_.Avals; //#25108
            var _3t = $_.i; //#25108
            $k[$j++] = Infinity; //#25108
            $aload($get($_.Avals, $_.datamatrix_usft)); //#25108
            $aload($get($_.Avals, $_.i - 128)); //#25108
            var _3s = $a(); //#25108
            $put(_3u, _3t, _3s); //#25108
            var _44 = $_.Cvals; //#25109
            var _43 = $_.i; //#25109
            $k[$j++] = Infinity; //#25109
            $aload($get($_.Cvals, $_.datamatrix_usft)); //#25109
            $aload($get($_.Cvals, $_.i - 128)); //#25109
            var _42 = $a(); //#25109
            $put(_44, _43, _42); //#25109
            var _4E = $_.Tvals; //#25110
            var _4D = $_.i; //#25110
            $k[$j++] = Infinity; //#25110
            $aload($get($_.Tvals, $_.datamatrix_usft)); //#25110
            $aload($get($_.Tvals, $_.i - 128)); //#25110
            var _4C = $a(); //#25110
            $put(_4E, _4D, _4C); //#25110
        } //#25110
        $_.Avals = $_.Avals; //#25113
        $_.Cvals = $_.Cvals; //#25114
        $_.Tvals = $_.Tvals; //#25115
        $k[$j++] = Infinity; //#25117
        $k[$j++] = 13; //#25122
        $k[$j++] = 0; //#25122
        $k[$j++] = 42; //#25122
        $k[$j++] = 1; //#25122
        $k[$j++] = 62; //#25122
        $k[$j++] = 2; //#25122
        $k[$j++] = 32; //#25122
        $k[$j++] = 3; //#25122
        for (var _4I = 48; _4I <= 57; _4I += 1) { //#25122
            $k[$j++] = _4I; //#25122
            $k[$j++] = _4I - 44; //#25122
        } //#25122
        for (var _4J = 65; _4J <= 90; _4J += 1) { //#25123
            $k[$j++] = _4J; //#25123
            $k[$j++] = _4J - 51; //#25123
        } //#25123
        var _4K = $d(); //#25123
        $_.Xvals = _4K; //#25124
        $k[$j++] = Infinity; //#25125
        var _4L = $_.Xvals; //#25126
        for (var _4Q = _4L.size, _4P = _4L.keys(), _4O = 0; _4O < _4Q; _4O++) { //#25126
            var _4M = _4P.next().value; //#25126
            var _4N = _4L.get(_4M); //#25126
            $k[$j++] = _4M; //#25126
            $k[$j++] = Infinity; //#25126
            $k[$j++] = _4N; //#25126
            var _4T = $a(); //#25126
            $k[$j++] = _4T; //#25126
        } //#25126
        var _4U = $d(); //#25126
        $_.Xvals = _4U; //#25127
        $k[$j++] = Infinity; //#25129
        for (var _4V = 64; _4V <= 94; _4V += 1) { //#25130
            $k[$j++] = _4V; //#25130
            $k[$j++] = _4V - 64; //#25130
        } //#25130
        $k[$j++] = $_.datamatrix_unl; //#25132
        $k[$j++] = 31; //#25132
        for (var _4W = 32; _4W <= 63; _4W += 1) { //#25132
            $k[$j++] = _4W; //#25132
            $k[$j++] = _4W; //#25132
        } //#25132
        var _4X = $d(); //#25132
        $_.Evals = _4X; //#25133
        $k[$j++] = Infinity; //#25134
        var _4Y = $_.Evals; //#25135
        for (var _4d = _4Y.size, _4c = _4Y.keys(), _4b = 0; _4b < _4d; _4b++) { //#25135
            var _4Z = _4c.next().value; //#25135
            var _4a = _4Y.get(_4Z); //#25135
            $k[$j++] = _4Z; //#25135
            $k[$j++] = Infinity; //#25135
            $k[$j++] = _4a; //#25135
            var _4g = $a(); //#25135
            $k[$j++] = _4g; //#25135
        } //#25135
        var _4h = $d(); //#25135
        $_.Evals = _4h; //#25136
        $k[$j++] = Infinity; //#25138
        for (var _4i = 0; _4i <= 255; _4i += 1) { //#25139
            $k[$j++] = _4i; //#25139
            $k[$j++] = _4i; //#25139
        } //#25139
        var _4j = $d(); //#25139
        $_.Bvals = _4j; //#25140
        $k[$j++] = Infinity; //#25141
        var _4k = $_.Bvals; //#25142
        for (var _4p = _4k.size, _4o = _4k.keys(), _4n = 0; _4n < _4p; _4n++) { //#25142
            var _4l = _4o.next().value; //#25142
            var _4m = _4k.get(_4l); //#25142
            $k[$j++] = _4l; //#25142
            $k[$j++] = Infinity; //#25142
            $k[$j++] = _4m; //#25142
            var _4s = $a(); //#25142
            $k[$j++] = _4s; //#25142
        } //#25142
        var _4t = $d(); //#25142
        $_.Bvals = _4t; //#25143
        $_.encvals = $a([$_.Avals, $_.Cvals, $_.Tvals, $_.Xvals, $_.Evals, $_.Bvals]); //#25145
        $k[$j++] = Infinity; //#25150
        $k[$j++] = 1; //#25150
        for (var _51 = 0; _51 < 255; _51++) { //#25150
            var _52 = $k[$j - 1]; //#25150
            var _53 = _52 * 2; //#25150
            $k[$j++] = _53; //#25150
            if (_53 >= 256) { //#25150
                var _54 = $k[--$j]; //#25150
                $k[$j++] = _54 ^ 301; //#25150
            } //#25150
        } //#25150
        var _55 = $a(); //#25150
        $_.rsalog = _55; //#25150
        $_.rslog = $a(256); //#25151
        for (var _57 = 1; _57 <= 255; _57 += 1) { //#25152
            $put($_.rslog, $get($_.rsalog, _57), _57); //#25152
        } //#25152
        $_.rslog = $_.rslog; //#25153
        $_.datamatrix_rsprod = function() {
            var _5C = $k[$j - 1]; //#25175
            if (_5C != 0) { //#25177
                var _5E = $k[$j - 2]; //#25175
                if (_5E != 0) { //#25177
                    var _5G = $k[--$j]; //#25176
                    var _5H = $get($_.rslog, _5G); //#25176
                    var _5I = $k[--$j]; //#25176
                    $k[$j++] = $get($_.rsalog, $f(_5H + $get($_.rslog, _5I)) % 255) //#25176
                } else { //#25177
                    $j -= 2; //#25177
                    $k[$j++] = 0; //#25177
                } //#25177
            } else { //#25177
                $j -= 2; //#25177
                $k[$j++] = 0; //#25177
            } //#25177
        }; //#25178
        $_.datamatrix_gencoeffs = function() {
            $k[$j++] = Infinity; //#25184
            $k[$j++] = 1; //#25184
            for (var _5O = 0, _5P = $_.k; _5O < _5P; _5O++) { //#25184
                $k[$j++] = 0; //#25184
            } //#25184
            $_.coeffs = $a(); //#25184
            for (var _5S = 1, _5R = $_.k; _5S <= _5R; _5S += 1) { //#25199
                var _5T = $_.coeffs; //#25186
                $put(_5T, _5S, $get(_5T, _5S - 1)); //#25186
                $k[$j++] = $get($_.rsalog, _5S); //#25194
                for (var _5X = _5S - 1; _5X >= 1; _5X -= 1) { //#25194
                    var _5Y = $_.coeffs; //#25189
                    var _5Z = $get(_5Y, _5X); //#25189
                    var _5a = $k[$j - 1]; //#25190
                    $k[$j++] = _5Y; //#25191
                    $k[$j++] = _5X; //#25191
                    $k[$j++] = _5Z; //#25191
                    $k[$j++] = _5a; //#25191
                    $_.datamatrix_rsprod(); //#25191
                    var _5c = $k[--$j]; //#25192
                    var _5d = $k[--$j]; //#25192
                    var _5e = $get($_.coeffs, _5d - 1); //#25192
                    var _5f = $k[--$j]; //#25193
                    $put(_5f, _5d, $xo(_5c, _5e)); //#25193
                } //#25193
                var _5g = $_.coeffs; //#25195
                var _5h = $get(_5g, 0); //#25195
                var _5i = $k[$j - 1]; //#25196
                $k[$j++] = _5g; //#25197
                $k[$j++] = 0; //#25197
                $k[$j++] = _5h; //#25197
                $k[$j++] = _5i; //#25197
                $_.datamatrix_rsprod(); //#25197
                var _5j = $k[--$j]; //#25197
                var _5k = $k[--$j]; //#25197
                var _5l = $k[--$j]; //#25197
                $put(_5l, _5k, _5j); //#25197
                $j--; //#25198
            } //#25198
            $k[$j++] = $geti($_.coeffs, 0, $_.coeffs.length - 1); //#25200
        }; //#25201
        $_.datamatrix_coeffscachemax = 25; //#25208
        $_.datamatrix_coeffscachelimit = 766; //#25209
        $k[$j++] = $_.datamatrix_coeffscachemax; //#25216
        $k[$j++] = $_.datamatrix_coeffscachelimit; //#25216
        bwipp_fifocache(); //#25216
        var _5r = $k[--$j]; //#25216
        $_.datamatrix_coeffscache = _5r; //#25216
        $_.datamatrix_coeffscachefetch = function() {
            var _5s = $k[--$j]; //#25219
            $_.k = _5s; //#25219
            var _5u = $get($_.datamatrix_coeffscache, 'fetch'); //#25223
            $k[$j++] = $_.k; //#25223
            $k[$j++] = function() {
                $_.datamatrix_gencoeffs(); //#25221
            }; //#25221
            $k[$j++] = function() {
                var _5v = $k[--$j]; //#25222
                $k[$j++] = _5v.length; //#25222
            }; //#25222
            if (_5u() === true) {
                return true;
            } //#25222
        }; //#25224
        $_ = $__;
    }
    //#25226
    var $__ = $_; //#25228
    $_ = Object.assign({}, $_, bwipp_datamatrix.globals); //#25228
    $_.dontdraw = false; //#25233
    $_.columns = 0; //#25234
    $_.rows = 0; //#25235
    $_.format = "unset"; //#25236
    $_.version = "unset"; //#25237
    $_.parse = false; //#25238
    $_.parsefnc = false; //#25239
    $_.c40headerlength = -1; //#25240
    $_.raw = false; //#25241
    $_.dmre = false; //#25242
    $k[$j++] = null; //#25253
    bwipp_processoptions(); //#25253
    var _5w = $k[--$j]; //#25253
    $_.options = _5w; //#25253
    var _5x = $k[--$j]; //#25256
    $_.barcode = _5x; //#25256
    $_._render = !($_.dontdraw || ($_.bwipp_dontdraw || bwipp_enabledontdraw)); //#25258
    $_.modunit = 2; //#25263
    if ($_.barcode.length == 0) { //#25285
        $k[$j++] = "bwipp.datamatrixEmptyData#25284"; //#25284
        $k[$j++] = "The data must not be empty"; //#25284
        bwipp_raiseerror(); //#25284
    } //#25284
    if ($_.barcode.length > 15000) { //#25289
        $k[$j++] = "bwipp.datamatrixInputTooLong#25288"; //#25288
        $k[$j++] = "The input data is too long"; //#25288
        bwipp_raiseerror(); //#25288
    } //#25288
    if ($ne($_.version, "unset") && (($_.rows != 0) || ($_.columns != 0))) { //#25293
        $k[$j++] = "bwipp.datamatrixVersionRowsCols#25292"; //#25292
        $k[$j++] = "rows and columns must not be given if version is specified"; //#25292
        bwipp_raiseerror(); //#25292
    } //#25292
    if ($ne($_.version, "unset")) { //#25319
        $search($_.version, "x"); //#25299
        var _67 = $k[--$j]; //#25316
        if (_67) { //#25315
            var _68 = $k[--$j]; //#25300
            $k[$j - 1] = _68; //#25300
            var _6A = $k[$j - 1]; //#25301
            var _6B = $k[$j - 2]; //#25301
            var _6C = $a(2); //#25301
            $k[$j++] = _6B; //#25301
            $k[$j++] = _6A; //#25301
            $astore(_6C); //#25301
            var _6D = $k[--$j]; //#25310
            $forall(_6D, function() { //#25310
                var _6E = $k[$j - 1]; //#25303
                var _6F = true; //#25303
                if (_6E.length == 0) { //#25303
                    _6F = false; //#25303
                } //#25303
                var _6G = $k[--$j]; //#25304
                $k[$j++] = _6F; //#25306
                $forall(_6G, function() { //#25306
                    var _6H = $k[--$j]; //#25305
                    if ((_6H < 48) || (_6H > 57)) { //#25305
                        $k[$j - 1] = false; //#25305
                    } //#25305
                }); //#25305
                var _6I = $k[--$j]; //#25307
                if (!_6I) { //#25309
                    $j -= 2; //#25308
                    $k[$j++] = "bwipp.datamatrixVersionBadRowOrColumn#25308"; //#25308
                    $k[$j++] = "version must be formatted as RxC"; //#25308
                    bwipp_raiseerror(); //#25308
                } //#25308
            }); //#25308
            var _6J = $k[--$j]; //#25311
            $_.rows = $cvi(_6J); //#25311
            var _6K = $k[--$j]; //#25312
            $_.columns = $cvi(_6K); //#25312
            var _6N = $_.rows == $_.columns ? "square" : "rectangle"; //#25313
            $_.format = _6N; //#25313
        } else { //#25315
            $k[$j - 1] = "bwipp.datamatrixVersionFormat#25315"; //#25315
            $k[$j++] = "version must be formatted as RxC"; //#25315
            bwipp_raiseerror(); //#25315
        } //#25315
    } else { //#25319
        if ($eq($_.format, "unset")) { //#25320
            var _6R = $_.dmre ? "rectangle" : "square"; //#25319
            $_.format = _6R; //#25319
        } //#25319
    } //#25319
    if ($ne($_.format, "square") && $ne($_.format, "rectangle")) { //#25325
        $k[$j++] = "bwipp.datamatrixInvalidFormat#25324"; //#25324
        $k[$j++] = "The format must be either square or rectangle"; //#25324
        bwipp_raiseerror(); //#25324
    } //#25324
    $_.urows = $_.rows; //#25332
    $_.ucols = $_.columns; //#25333
    $k[$j++] = Infinity; //#25334
    for (var _6X = 0, _6Y = $_.datamatrix_metrics.length; _6X < _6Y; _6X++) { //#25354
        $_.m = $get($_.datamatrix_metrics, _6X); //#25336
        $_.rows = $get($_.m, 0); //#25337
        $_.cols = $get($_.m, 1); //#25338
        $_.regh = $get($_.m, 2); //#25339
        $_.regv = $get($_.m, 3); //#25340
        $_.rscw = $get($_.m, 4); //#25341
        $_.rsbl = $get($_.m, 5); //#25342
        $_.doly = $get($_.m, 6); //#25343
        $_.mrows = $f($_.rows - 2 * $_.regh) //#25344
        $_.mcols = $f($_.cols - 2 * $_.regv) //#25345
        $_.ncws = $f(~~($_.mrows * $_.mcols / 8) - $_.rscw) //#25346
        $_.okay = true; //#25347
        if (($_.urows != 0) && ($_.urows != $_.rows)) { //#25348
            $_.okay = false; //#25348
        } //#25348
        if (($_.ucols != 0) && ($_.ucols != $_.cols)) { //#25349
            $_.okay = false; //#25349
        } //#25349
        if ($eq($_.format, "square") && $ne($_.rows, $_.cols)) { //#25350
            $_.okay = false; //#25350
        } //#25350
        if ($eq($_.format, "rectangle") && $eq($_.rows, $_.cols)) { //#25351
            $_.okay = false; //#25351
        } //#25351
        if ((!$_.dmre) && ($_.doly == 1)) { //#25352
            $_.okay = false; //#25352
        } //#25352
        if ($_.okay) { //#25353
            $k[$j++] = $_.ncws; //#25353
        } //#25353
    } //#25353
    $astore($a($counttomark())); //#25355
    var _7D = $k[--$j]; //#25355
    $_.fullcws = _7D; //#25355
    $k[$j - 1] = Infinity; //#25356
    for (var _7E = 0; _7E < 1558; _7E++) { //#25356
        $k[$j++] = 10000; //#25356
    } //#25356
    $_.numremcws = $a(); //#25356
    $forall($_.fullcws, function() { //#25357
        var _7H = $k[--$j]; //#25357
        $put($_.numremcws, _7H - 1, 1); //#25357
    }); //#25357
    for (var _7I = 1556; _7I >= 0; _7I -= 1) { //#25363
        $_.i = _7I; //#25359
        if ($get($_.numremcws, $_.i) != 1) { //#25362
            $put($_.numremcws, $_.i, $get($_.numremcws, $_.i + 1) + 1); //#25361
        } //#25361
    } //#25361
    $_.getnumremcws = function() {
        var _7R = $k[$j - 1]; //#25366
        if (_7R >= $_.numremcws.length) { //#25368
            $k[$j - 1] = "bwipp.datamatrixTooMuchData#25367"; //#25367
            $k[$j++] = "The input data exceeds the symbol capacity"; //#25367
            bwipp_raiseerror(); //#25367
        } //#25367
        var _7U = $k[--$j]; //#25369
        $k[$j++] = $get($_.numremcws, _7U); //#25369
    }; //#25369
    if ($_.raw) { //#25837
        $_.cws = $a($_.barcode.length); //#25374
        $_.i = 0; //#25375
        $_.j = 0; //#25375
        for (;;) { //#25389
            if ($_.i >= ($_.barcode.length - 3)) { //#25377
                break; //#25377
            } //#25377
            if ($get($_.barcode, $_.i) != 94) { //#25378
                break; //#25378
            } //#25378
            var _7g = $geti($_.barcode, $_.i + 1, 3); //#25379
            $k[$j++] = _7g; //#25381
            $k[$j++] = false; //#25381
            for (var _7h = 0, _7i = _7g.length; _7h < _7i; _7h++) { //#25381
                var _7j = $get(_7g, _7h); //#25381
                if ((_7j < 48) || (_7j > 57)) { //#25380
                    $k[$j - 1] = true; //#25380
                } //#25380
            } //#25380
            var _7k = $k[--$j]; //#25381
            if (_7k) { //#25381
                $j--; //#25381
                break; //#25381
            } //#25381
            var _7l = $k[--$j]; //#25382
            $_.cw = $cvi(_7l); //#25382
            if ($_.cw > 255) { //#25385
                $k[$j++] = "bwipp.datamatrixBadRawCodeword#25384"; //#25384
                $k[$j++] = "Raw codewords must be 0 to 255"; //#25384
                bwipp_raiseerror(); //#25384
            } //#25384
            $put($_.cws, $_.j, $_.cw); //#25386
            $_.i = $_.i + 4; //#25387
            $_.j = $_.j + 1; //#25388
        } //#25388
        if ($_.i != $_.barcode.length) { //#25392
            $k[$j++] = "bwipp.datamatrixBadRawFormat#25391"; //#25391
            $k[$j++] = "Raw codewords must be formatted as ^NNN"; //#25391
            bwipp_raiseerror(); //#25391
        } //#25391
        $_.cws = $geti($_.cws, 0, $_.j); //#25393
    } else { //#25837
        $_.fncvals = new Map([
            ["parse", $_.parse],
            ["parsefnc", $_.parsefnc],
            ["eci", true],
            ["FNC1", $_.datamatrix_fnc1],
            ["PROG", $_.datamatrix_prog]
        ]); //#25407
        $k[$j++] = $_.barcode; //#25411
        $k[$j++] = $_.fncvals; //#25411
        bwipp_parseinput(); //#25411
        var _81 = $k[--$j]; //#25411
        $_.msg = _81; //#25411
        $_.msglen = $_.msg.length; //#25412
        if ($_.msglen >= 9) { //#25432
            $aload($geti($_.msg, 0, 7)); //#25418
            var _86 = $k[--$j]; //#25419
            $j--; //#25419
            var _88 = _86 == 29; //#25419
            var _89 = $k[--$j]; //#25419
            var _8A = $k[--$j]; //#25419
            var _8B = $k[--$j]; //#25420
            var _8C = $k[--$j]; //#25420
            var _8D = $k[--$j]; //#25420
            if (((((_88 && (_89 == 48)) && (_8A == 30)) && (_8B == 62)) && (_8C == 41)) && (_8D == 91)) { //#25431
                $aload($geti($_.msg, $_.msglen - 2, 2)); //#25421
                var _8H = $k[--$j]; //#25422
                var _8I = $k[--$j]; //#25422
                if ((_8H == 4) && (_8I == 30)) { //#25430
                    if ($get($_.msg, 5) == 53) { //#25427
                        $k[$j++] = Infinity; //#25424
                        var _8N = $geti($_.msg, 7, $_.msg.length - 9); //#25424
                        $k[$j++] = $_.datamatrix_m05; //#25424
                        $aload(_8N); //#25424
                        $_.msg = $a(); //#25424
                    } else { //#25427
                        if ($get($_.msg, 5) == 54) { //#25428
                            $k[$j++] = Infinity; //#25427
                            var _8S = $geti($_.msg, 7, $_.msg.length - 9); //#25427
                            $k[$j++] = $_.datamatrix_m06; //#25427
                            $aload(_8S); //#25427
                            $_.msg = $a(); //#25427
                        } //#25427
                    } //#25427
                } //#25427
            } //#25427
        } //#25427
        $_.msglen = $_.msg.length; //#25433
        if ($_.msglen > 3116) { //#25438
            $k[$j++] = "bwipp.datamatrixInputTooLong#25437"; //#25437
            $k[$j++] = "The input data is too long"; //#25437
            bwipp_raiseerror(); //#25437
        } //#25437
        if ($_.c40headerlength > $_.msglen) { //#25447
            $_.c40headerlength = $_.msglen; //#25447
        } //#25447
        $k[$j++] = Infinity; //#25449
        for (var _8Z = 0, _8a = $_.msglen; _8Z < _8a; _8Z++) { //#25449
            $k[$j++] = 0; //#25449
        } //#25449
        $k[$j++] = 0; //#25449
        $_.numD = $a(); //#25449
        $k[$j++] = Infinity; //#25450
        for (var _8c = 0, _8d = $_.msglen; _8c < _8d; _8c++) { //#25450
            $k[$j++] = 0; //#25450
        } //#25450
        $k[$j++] = 9999; //#25450
        $_.nextXterm = $a(); //#25450
        $k[$j++] = Infinity; //#25451
        for (var _8f = 0, _8g = $_.msglen; _8f < _8g; _8f++) { //#25451
            $k[$j++] = 0; //#25451
        } //#25451
        $k[$j++] = 9999; //#25451
        $_.nextNonX = $a(); //#25451
        $k[$j++] = Infinity; //#25452
        for (var _8i = 0, _8j = $_.msglen; _8i < _8j; _8i++) { //#25452
            $k[$j++] = false; //#25452
        } //#25452
        $k[$j++] = false; //#25452
        $_.isECI = $a(); //#25452
        for (var _8l = $_.msglen - 1; _8l >= 0; _8l -= 1) { //#25470
            $_.i = _8l; //#25454
            $_.barchar = $get($_.msg, $_.i); //#25455
            if (($_.barchar >= 48) && ($_.barchar <= 57)) { //#25458
                $put($_.numD, $_.i, $get($_.numD, $_.i + 1) + 1); //#25457
            } //#25457
            if ((($_.barchar == 13) || ($_.barchar == 42)) || ($_.barchar == 62)) { //#25462
                $put($_.nextXterm, $_.i, 0); //#25460
            } else { //#25462
                $put($_.nextXterm, $_.i, $get($_.nextXterm, $_.i + 1) + 1); //#25462
            } //#25462
            if (!$has($_.Xvals, $_.barchar)) { //#25467
                $put($_.nextNonX, $_.i, 0); //#25465
            } else { //#25467
                $put($_.nextNonX, $_.i, $get($_.nextNonX, $_.i + 1) + 1); //#25467
            } //#25467
            $put($_.isECI, $_.i, $_.barchar <= -1000000); //#25469
        } //#25469
        $k[$j++] = Infinity; //#25471
        var _9J = $_.nextXterm; //#25471
        for (var _9K = 0, _9L = _9J.length; _9K < _9L; _9K++) { //#25471
            var _9M = $get(_9J, _9K); //#25471
            $k[$j++] = _9M; //#25471
            if (_9M > 10000) { //#25471
                $k[$j - 1] = 10000; //#25471
            } //#25471
        } //#25471
        $_.nextXterm = $a(); //#25471
        $k[$j++] = Infinity; //#25472
        var _9N = $_.nextNonX; //#25472
        for (var _9O = 0, _9P = _9N.length; _9O < _9P; _9O++) { //#25472
            var _9Q = $get(_9N, _9O); //#25472
            $k[$j++] = _9Q; //#25472
            if (_9Q > 10000) { //#25472
                $k[$j - 1] = 10000; //#25472
            } //#25472
        } //#25472
        $_.nextNonX = $a(); //#25472
        $_.isD = function() {
            $k[$j++] = ($_.char >= 48) && ($_.char <= 57); //#25474
        }; //#25474
        $_.isC = function() {
            $k[$j++] = $has($_.CNvals, $_.char); //#25475
        }; //#25475
        $_.isT = function() {
            $k[$j++] = $has($_.TNvals, $_.char); //#25476
        }; //#25476
        $_.isX = function() {
            $k[$j++] = $has($_.Xvals, $_.char); //#25477
        }; //#25477
        $_.isE = function() {
            $k[$j++] = $has($_.Evals, $_.char); //#25478
        }; //#25478
        $_.isEA = function() {
            $k[$j++] = $_.char > 127; //#25479
        }; //#25479
        $_.isFN = function() {
            $k[$j++] = $_.char < 0; //#25480
        }; //#25480
        $_.XtermFirst = function() {
            var _9h = $k[--$j]; //#25481
            $k[$j++] = $lt($get($_.nextXterm, _9h), $get($_.nextNonX, _9h)); //#25481
        }; //#25481
        $_.lookup = function() {
            $_.ac = 1; //#25487
            $_.cc = 2; //#25487
            $_.tc = 2; //#25487
            $_.xc = 2; //#25487
            $_.ec = 2; //#25487
            $_.bc = 2.25; //#25487
            if ($_.mode == $_.datamatrix_A) { //#25488
                $_.ac = 0; //#25488
                $_.cc = 1; //#25488
                $_.tc = 1; //#25488
                $_.xc = 1; //#25488
                $_.ec = 1; //#25488
                $_.bc = 1.25; //#25488
            } //#25488
            if ($_.mode == $_.datamatrix_C) { //#25489
                $_.cc = 0; //#25489
            } //#25489
            if ($_.mode == $_.datamatrix_T) { //#25490
                $_.tc = 0; //#25490
            } //#25490
            if ($_.mode == $_.datamatrix_X) { //#25491
                $_.xc = 0; //#25491
            } //#25491
            if ($_.mode == $_.datamatrix_E) { //#25492
                $_.ec = 0; //#25492
            } //#25492
            if ($_.mode == $_.datamatrix_B) { //#25493
                $_.bc = 0; //#25493
            } //#25493
            for (var _9s = 0; _9s < 1; _9s++) { //#25529
                if ($get($_.isECI, $_.i)) { //#25495
                    $k[$j++] = $_.datamatrix_A; //#25495
                    break; //#25495
                } //#25495
                if ($_.i < $_.c40headerlength) { //#25496
                    $k[$j++] = $_.datamatrix_C; //#25496
                    break; //#25496
                } //#25496
                $_.isfnc1 = $get($_.msg, $_.i) == $_.datamatrix_fnc1; //#25497
                $_.k = 0; //#25498
                for (;;) { //#25528
                    if (($_.i + $_.k) == $_.msglen) { //#25507
                        var _A4 = $a(['ac', 'cc', 'tc', 'xc', 'ec', 'bc']); //#25500
                        for (var _A5 = 0, _A6 = _A4.length; _A5 < _A6; _A5++) { //#25500
                            var _A7 = $get(_A4, _A5); //#25500
                            var _A8 = $_[_A7]; //#25500
                            $_[_A7] = $ceil(_A8); //#25500
                        } //#25500
                        var _AE = $a([$_.cc, $_.tc, $_.xc, $_.ec, $_.bc]); //#25501
                        var _AK = true; //#25501
                        for (var _AF = 0, _AG = _AE.length; _AF < _AG; _AF++) { //#25501
                            var _AH = $get(_AE, _AF); //#25501
                            _AK = _AK && ($_.ac <= _AH); //#25501
                        } //#25501
                        if (_AK) { //#25501
                            $k[$j++] = $_.datamatrix_A; //#25501
                            break; //#25501
                        } //#25501
                        var _AQ = $a([$_.ac, $_.cc, $_.tc, $_.xc, $_.ec]); //#25502
                        var _AW = true; //#25502
                        for (var _AR = 0, _AS = _AQ.length; _AR < _AS; _AR++) { //#25502
                            var _AT = $get(_AQ, _AR); //#25502
                            _AW = _AW && ($_.bc < _AT); //#25502
                        } //#25502
                        if (_AW) { //#25502
                            if ($_.isfnc1) { //#25502
                                $k[$j++] = $_.datamatrix_A; //#25502
                            } else { //#25502
                                $k[$j++] = $_.datamatrix_B; //#25502
                            } //#25502
                            break; //#25502
                        } //#25502
                        var _Ad = $a([$_.ac, $_.cc, $_.tc, $_.xc, $_.bc]); //#25503
                        var _Aj = true; //#25503
                        for (var _Ae = 0, _Af = _Ad.length; _Ae < _Af; _Ae++) { //#25503
                            var _Ag = $get(_Ad, _Ae); //#25503
                            _Aj = _Aj && ($_.ec < _Ag); //#25503
                        } //#25503
                        if (_Aj) { //#25503
                            $k[$j++] = $_.datamatrix_E; //#25503
                            break; //#25503
                        } //#25503
                        var _Ap = $a([$_.ac, $_.cc, $_.xc, $_.ec, $_.bc]); //#25504
                        var _Av = true; //#25504
                        for (var _Aq = 0, _Ar = _Ap.length; _Aq < _Ar; _Aq++) { //#25504
                            var _As = $get(_Ap, _Aq); //#25504
                            _Av = _Av && ($_.tc < _As); //#25504
                        } //#25504
                        if (_Av) { //#25504
                            $k[$j++] = $_.datamatrix_T; //#25504
                            break; //#25504
                        } //#25504
                        var _B1 = $a([$_.ac, $_.cc, $_.tc, $_.ec, $_.bc]); //#25505
                        var _B7 = true; //#25505
                        for (var _B2 = 0, _B3 = _B1.length; _B2 < _B3; _B2++) { //#25505
                            var _B4 = $get(_B1, _B2); //#25505
                            _B7 = _B7 && ($_.xc < _B4); //#25505
                        } //#25505
                        if (_B7) { //#25505
                            $k[$j++] = $_.datamatrix_X; //#25505
                            break; //#25505
                        } //#25505
                        $k[$j++] = $_.datamatrix_C; //#25506
                        break; //#25506
                    } //#25506
                    $_.char = $get($_.msg, $_.i + $_.k); //#25508
                    $k[$j++] = 'ac'; //#25509
                    $k[$j++] = $_.ac; //#25509
                    $_.isD(); //#25509
                    var _BD = $k[--$j]; //#25509
                    if (_BD) { //#25509
                        var _BE = $k[--$j]; //#25509
                        $k[$j++] = $f(_BE + 1 / 2) //#25509
                    } else { //#25509
                        $_.isEA(); //#25509
                        var _BF = $k[--$j]; //#25509
                        if (_BF) { //#25509
                            var _BG = $k[--$j]; //#25509
                            $k[$j++] = $ceil(_BG) + 2; //#25509
                        } else { //#25509
                            var _BH = $k[--$j]; //#25509
                            $k[$j++] = $ceil(_BH) + 1; //#25509
                        } //#25509
                    } //#25509
                    var _BI = $k[--$j]; //#25509
                    var _BJ = $k[--$j]; //#25509
                    $_[_BJ] = _BI; //#25509
                    $k[$j++] = 'cc'; //#25510
                    $k[$j++] = $_.cc; //#25510
                    $_.isC(); //#25510
                    var _BL = $k[--$j]; //#25510
                    if (_BL) { //#25510
                        var _BM = $k[--$j]; //#25510
                        $k[$j++] = $f(_BM + 0.6666667) //#25510
                    } else { //#25510
                        $_.isEA(); //#25510
                        var _BN = $k[--$j]; //#25510
                        if (_BN) { //#25510
                            var _BO = $k[--$j]; //#25510
                            $k[$j++] = $f(_BO + 2.6666667) //#25510
                        } else { //#25510
                            var _BP = $k[--$j]; //#25510
                            $k[$j++] = $f(_BP + 1.3333334) //#25510
                        } //#25510
                    } //#25510
                    var _BQ = $k[--$j]; //#25510
                    var _BR = $k[--$j]; //#25510
                    $_[_BR] = _BQ; //#25510
                    $k[$j++] = 'tc'; //#25511
                    $k[$j++] = $_.tc; //#25511
                    $_.isT(); //#25511
                    var _BT = $k[--$j]; //#25511
                    if (_BT) { //#25511
                        var _BU = $k[--$j]; //#25511
                        $k[$j++] = $f(_BU + 0.6666667) //#25511
                    } else { //#25511
                        $_.isEA(); //#25511
                        var _BV = $k[--$j]; //#25511
                        if (_BV) { //#25511
                            var _BW = $k[--$j]; //#25511
                            $k[$j++] = $f(_BW + 2.6666667) //#25511
                        } else { //#25511
                            var _BX = $k[--$j]; //#25511
                            $k[$j++] = $f(_BX + 1.3333334) //#25511
                        } //#25511
                    } //#25511
                    var _BY = $k[--$j]; //#25511
                    var _BZ = $k[--$j]; //#25511
                    $_[_BZ] = _BY; //#25511
                    $k[$j++] = 'xc'; //#25512
                    $k[$j++] = $_.xc; //#25512
                    $_.isX(); //#25512
                    var _Bb = $k[--$j]; //#25512
                    if (_Bb) { //#25512
                        var _Bc = $k[--$j]; //#25512
                        $k[$j++] = $f(_Bc + 0.6666667) //#25512
                    } else { //#25512
                        $_.isEA(); //#25512
                        var _Bd = $k[--$j]; //#25512
                        if (_Bd) { //#25512
                            var _Be = $k[--$j]; //#25512
                            $k[$j++] = $f(_Be + 4.3333334) //#25512
                        } else { //#25512
                            var _Bf = $k[--$j]; //#25512
                            $k[$j++] = $f(_Bf + 3.3333334) //#25512
                        } //#25512
                    } //#25512
                    var _Bg = $k[--$j]; //#25512
                    var _Bh = $k[--$j]; //#25512
                    $_[_Bh] = _Bg; //#25512
                    $k[$j++] = 'ec'; //#25513
                    $k[$j++] = $_.ec; //#25513
                    $_.isE(); //#25513
                    var _Bj = $k[--$j]; //#25513
                    if (_Bj) { //#25513
                        var _Bk = $k[--$j]; //#25513
                        $k[$j++] = $f(_Bk + 3 / 4) //#25513
                    } else { //#25513
                        $_.isEA(); //#25513
                        var _Bl = $k[--$j]; //#25513
                        if (_Bl) { //#25513
                            var _Bm = $k[--$j]; //#25513
                            $k[$j++] = $f(_Bm + 17 / 4) //#25513
                        } else { //#25513
                            var _Bn = $k[--$j]; //#25513
                            $k[$j++] = $f(_Bn + 13 / 4) //#25513
                        } //#25513
                    } //#25513
                    var _Bo = $k[--$j]; //#25513
                    var _Bp = $k[--$j]; //#25513
                    $_[_Bp] = _Bo; //#25513
                    $k[$j++] = 'bc'; //#25514
                    $k[$j++] = $_.bc; //#25514
                    $_.isFN(); //#25514
                    var _Br = $k[--$j]; //#25514
                    if (_Br) { //#25514
                        $k[$j - 1] += 4; //#25514
                    } else { //#25514
                        $k[$j - 1] += 1; //#25514
                    } //#25514
                    var _Bu = $k[--$j]; //#25514
                    var _Bv = $k[--$j]; //#25514
                    $_[_Bv] = _Bu; //#25514
                    if ($_.k >= 4) { //#25526
                        var _C2 = $a([$_.cc, $_.tc, $_.xc, $_.ec, $_.bc]); //#25516
                        var _C8 = true; //#25516
                        for (var _C3 = 0, _C4 = _C2.length; _C3 < _C4; _C3++) { //#25516
                            var _C5 = $get(_C2, _C3); //#25516
                            _C8 = _C8 && (($_.ac + 1) <= _C5); //#25516
                        } //#25516
                        if (_C8) { //#25516
                            $k[$j++] = $_.datamatrix_A; //#25516
                            break; //#25516
                        } //#25516
                        if (($_.bc + 1) <= $_.ac) { //#25517
                            if ($_.isfnc1) { //#25517
                                $k[$j++] = $_.datamatrix_A; //#25517
                            } else { //#25517
                                $k[$j++] = $_.datamatrix_B; //#25517
                            } //#25517
                            break; //#25517
                        } //#25517
                        var _CG = $a([$_.cc, $_.tc, $_.xc, $_.ec]); //#25518
                        var _CM = true; //#25518
                        for (var _CH = 0, _CI = _CG.length; _CH < _CI; _CH++) { //#25518
                            var _CJ = $get(_CG, _CH); //#25518
                            _CM = _CM && (($_.bc + 1) < _CJ); //#25518
                        } //#25518
                        if (_CM) { //#25518
                            if ($_.isfnc1) { //#25518
                                $k[$j++] = $_.datamatrix_A; //#25518
                            } else { //#25518
                                $k[$j++] = $_.datamatrix_B; //#25518
                            } //#25518
                            break; //#25518
                        } //#25518
                        var _CT = $a([$_.ac, $_.cc, $_.tc, $_.xc, $_.bc]); //#25519
                        var _CZ = true; //#25519
                        for (var _CU = 0, _CV = _CT.length; _CU < _CV; _CU++) { //#25519
                            var _CW = $get(_CT, _CU); //#25519
                            _CZ = _CZ && (($_.ec + 1) < _CW); //#25519
                        } //#25519
                        if (_CZ) { //#25519
                            $k[$j++] = $_.datamatrix_E; //#25519
                            break; //#25519
                        } //#25519
                        var _Cf = $a([$_.ac, $_.cc, $_.xc, $_.ec, $_.bc]); //#25520
                        var _Cl = true; //#25520
                        for (var _Cg = 0, _Ch = _Cf.length; _Cg < _Ch; _Cg++) { //#25520
                            var _Ci = $get(_Cf, _Cg); //#25520
                            _Cl = _Cl && (($_.tc + 1) < _Ci); //#25520
                        } //#25520
                        if (_Cl) { //#25520
                            $k[$j++] = $_.datamatrix_T; //#25520
                            break; //#25520
                        } //#25520
                        var _Cr = $a([$_.ac, $_.cc, $_.tc, $_.ec, $_.bc]); //#25521
                        var _Cx = true; //#25521
                        for (var _Cs = 0, _Ct = _Cr.length; _Cs < _Ct; _Cs++) { //#25521
                            var _Cu = $get(_Cr, _Cs); //#25521
                            _Cx = _Cx && (($_.xc + 1) < _Cu); //#25521
                        } //#25521
                        if (_Cx) { //#25521
                            $k[$j++] = $_.datamatrix_X; //#25521
                            break; //#25521
                        } //#25521
                        var _D2 = $a([$_.ac, $_.tc, $_.ec, $_.bc]); //#25522
                        var _D8 = true; //#25522
                        for (var _D3 = 0, _D4 = _D2.length; _D3 < _D4; _D3++) { //#25522
                            var _D5 = $get(_D2, _D3); //#25522
                            _D8 = _D8 && (($_.cc + 1) < _D5); //#25522
                        } //#25522
                        if (_D8) { //#25525
                            if ($_.cc < $_.xc) { //#25523
                                $k[$j++] = $_.datamatrix_C; //#25523
                                break; //#25523
                            } //#25523
                            if ($_.cc == $_.xc) { //#25524
                                $k[$j++] = ($_.i + $_.k) + 1; //#25524
                                $_.XtermFirst(); //#25524
                                var _DF = $k[--$j]; //#25524
                                if (_DF) { //#25524
                                    $k[$j++] = $_.datamatrix_X; //#25524
                                    break; //#25524
                                } else { //#25524
                                    $k[$j++] = $_.datamatrix_C; //#25524
                                    break; //#25524
                                } //#25524
                            } //#25524
                        } //#25524
                    } //#25524
                    $_.k = $_.k + 1; //#25527
                } //#25527
            } //#25527
        }; //#25527
        $_.addtocws = function() {
            var _DH = $k[$j - 1]; //#25533
            if ((_DH.length + $_.j) > $_.cws.length) { //#25535
                $k[$j - 1] = "bwipp.datamatrixTooMuchData#25534"; //#25534
                $k[$j++] = "The input data exceeds the symbol capacity"; //#25534
                bwipp_raiseerror(); //#25534
            } //#25534
            var _DK = $k[--$j]; //#25536
            $puti($_.cws, $_.j, _DK); //#25536
            $_.j = _DK.length + $_.j; //#25537
        }; //#25537
        $_.ECItocws = function() {
            var _DO = $k[--$j]; //#25541
            var _DP = (-_DO) - 1000000; //#25542
            $k[$j++] = _DP; //#25556
            if (_DP <= 126) { //#25555
                var _DQ = $k[--$j]; //#25543
                var _DR = $a(1); //#25544
                $k[$j++] = _DQ + 1; //#25544
                $astore(_DR); //#25544
            } else { //#25555
                var _DS = $k[$j - 1]; //#25545
                if (_DS <= 16382) { //#25555
                    var _DT = $k[--$j]; //#25546
                    var _DU = _DT - 127; //#25547
                    var _DV = $a(2); //#25549
                    $k[$j++] = (~~(_DU / 254)) + 128; //#25549
                    $k[$j++] = (_DU % 254) + 1; //#25549
                    $astore(_DV); //#25549
                } else { //#25555
                    var _DW = $k[--$j]; //#25551
                    var _DX = _DW - 16383; //#25552
                    var _DY = $a(3); //#25555
                    $k[$j++] = (~~(_DX / 64516)) + 192; //#25555
                    $k[$j++] = ((~~(_DX / 254)) % 254) + 1; //#25555
                    $k[$j++] = (_DX % 254) + 1; //#25555
                    $astore(_DY); //#25555
                } //#25555
            } //#25555
        }; //#25555
        $_.encA = function() {
            for (var _DZ = 0; _DZ < 1; _DZ++) { //#25581
                if ($get($_.isECI, $_.i)) { //#25566
                    $k[$j++] = $get($_.Avals, $_.datamatrix_eci); //#25562
                    $_.addtocws(); //#25562
                    $k[$j++] = $get($_.msg, $_.i); //#25563
                    $_.ECItocws(); //#25563
                    $_.addtocws(); //#25563
                    $_.i = $_.i + 1; //#25564
                    break; //#25565
                } //#25565
                if (($_.i >= $_.c40headerlength) && ($get($_.numD, $_.i) >= 2)) { //#25571
                    var _Do = $s(2); //#25568
                    $put(_Do, 0, $get($_.msg, $_.i)); //#25568
                    $put(_Do, 1, $get($_.msg, $_.i + 1)); //#25568
                    $k[$j++] = $get($_.Avals, _Do); //#25568
                    $_.addtocws(); //#25568
                    $_.i = $_.i + 2; //#25569
                    break; //#25570
                } //#25570
                $k[$j++] = 'newmode'; //#25572
                $_.lookup(); //#25572
                var _Dy = $k[--$j]; //#25572
                var _Dz = $k[--$j]; //#25572
                $_[_Dz] = _Dy; //#25572
                if ($_.newmode != $_.mode) { //#25577
                    $k[$j++] = $get($_.Avals, $get($a([-1, $_.datamatrix_lC, $_.datamatrix_lT, $_.datamatrix_lX, $_.datamatrix_lE, $_.datamatrix_lB]), $_.newmode)); //#25574
                    $_.addtocws(); //#25574
                    $_.mode = $_.newmode; //#25575
                    break; //#25576
                } //#25576
                $k[$j++] = $get($_.Avals, $get($_.msg, $_.i)); //#25578
                $_.addtocws(); //#25578
                $_.i = $_.i + 1; //#25579
                break; //#25580
            } //#25580
        }; //#25580
        $_.CTXvalstocws = function() {
            var _EE = $k[--$j]; //#25585
            $_.in = _EE; //#25585
            $k[$j++] = Infinity; //#25586
            for (var _EH = 0, _EG = $_.in.length - 1; _EH <= _EG; _EH += 3) { //#25590
                var _EJ = $geti($_.in, _EH, 3); //#25588
                var _EO = 0; //#25588
                for (var _EK = 0, _EL = _EJ.length; _EK < _EL; _EK++) { //#25588
                    var _EM = $get(_EJ, _EK); //#25588
                    _EO = $f(_EO + _EM) * 40 //#25588
                } //#25588
                var _EP = (~~(_EO / 40)) + 1; //#25589
                $k[$j++] = ~~(_EP / 256); //#25589
                $k[$j++] = _EP % 256; //#25589
            } //#25589
            $astore($a($counttomark())); //#25591
            var _ES = $k[--$j]; //#25591
            $k[$j - 1] = _ES; //#25591
        }; //#25591
        $_.encCTX = function() {
            $_.p = 0; //#25595
            $_.ctxvals = $a(2500); //#25596
            $_.done = false; //#25597
            for (;;) { //#25679
                if ($_.i == $_.msglen) { //#25601
                    break; //#25601
                } //#25601
                if (!$has($get($_.encvals, $_.mode), $get($_.msg, $_.i))) { //#25602
                    break; //#25602
                } //#25602
                if (($_.p % 3) == 0) { //#25671
                    if ($_.p > 0) { //#25616
                        $k[$j++] = 'newmode'; //#25605
                        $_.lookup(); //#25605
                        var _Eg = $k[--$j]; //#25605
                        var _Eh = $k[--$j]; //#25605
                        $_[_Eh] = _Eg; //#25605
                        if ($ne($_.newmode, $_.mode)) { //#25615
                            $k[$j++] = $geti($_.ctxvals, 0, $_.p); //#25607
                            $_.CTXvalstocws(); //#25607
                            $_.addtocws(); //#25607
                            $k[$j++] = $a([$_.datamatrix_unlcw]); //#25608
                            $_.addtocws(); //#25608
                            if ($_.newmode != $_.datamatrix_A) { //#25611
                                $k[$j++] = $get($_.Avals, $get($a([-1, $_.datamatrix_lC, $_.datamatrix_lT, $_.datamatrix_lX, $_.datamatrix_lE, $_.datamatrix_lB]), $_.newmode)); //#25610
                                $_.addtocws(); //#25610
                            } //#25610
                            $_.mode = $_.newmode; //#25612
                            $_.done = true; //#25613
                            break; //#25614
                        } //#25614
                    } //#25614
                    if (($_.msglen - $_.i) <= 3) { //#25670
                        $k[$j++] = $_.j + ((~~($_.p / 3)) * 2); //#25618
                        $_.getnumremcws(); //#25618
                        var _Ez = $k[--$j]; //#25618
                        $_.remcws = _Ez; //#25618
                        $k[$j++] = Infinity; //#25619
                        var _F4 = $geti($_.msg, $_.i, $_.msglen - $_.i); //#25620
                        for (var _F5 = 0, _F6 = _F4.length; _F5 < _F6; _F5++) { //#25626
                            var _F7 = $get(_F4, _F5); //#25626
                            var _FB = $has($get($_.encvals, $_.mode), _F7); //#25621
                            $k[$j++] = _F7; //#25625
                            if (_FB) { //#25624
                                var _FE = $get($_.encvals, $_.mode); //#25622
                                var _FF = $k[--$j]; //#25622
                                $aload($get(_FE, _FF)); //#25622
                            } else { //#25624
                                $k[$j - 1] = -1; //#25624
                                $k[$j++] = -1; //#25624
                                $k[$j++] = -1; //#25624
                                $k[$j++] = -1; //#25624
                            } //#25624
                        } //#25624
                        $_.remvals = $a(); //#25624
                        if (($_.remcws == 2) && ($_.remvals.length == 3)) { //#25638
                            $k[$j++] = Infinity; //#25630
                            $aload($geti($_.ctxvals, 0, $_.p)); //#25631
                            $aload($_.remvals); //#25632
                            var _FN = $a(); //#25632
                            $k[$j++] = _FN; //#25633
                            $_.CTXvalstocws(); //#25633
                            $_.addtocws(); //#25633
                            $_.mode = $_.datamatrix_A; //#25634
                            $_.i = $_.msglen; //#25635
                            $_.done = true; //#25636
                            break; //#25637
                        } //#25637
                        if ((($_.remcws == 2) && ($_.remvals.length == 2)) && ($_.mode != $_.datamatrix_X)) { //#25650
                            $k[$j++] = Infinity; //#25641
                            $aload($geti($_.ctxvals, 0, $_.p)); //#25642
                            $aload($_.remvals); //#25643
                            $aload($get($get($_.encvals, $_.mode), $_.datamatrix_sft1)); //#25644
                            var _Fa = $a(); //#25644
                            $k[$j++] = _Fa; //#25645
                            $_.CTXvalstocws(); //#25645
                            $_.addtocws(); //#25645
                            $_.mode = $_.datamatrix_A; //#25646
                            $_.i = $_.msglen; //#25647
                            $_.done = true; //#25648
                            break; //#25649
                        } //#25649
                        if (($_.remcws == 2) && ($_.remvals.length == 1)) { //#25660
                            $k[$j++] = $geti($_.ctxvals, 0, $_.p); //#25653
                            $_.CTXvalstocws(); //#25653
                            $_.addtocws(); //#25653
                            $k[$j++] = $a([$_.datamatrix_unlcw]); //#25654
                            $_.addtocws(); //#25654
                            $k[$j++] = $get($_.Avals, $get($_.msg, $_.i)); //#25655
                            $_.addtocws(); //#25655
                            $_.mode = $_.datamatrix_A; //#25656
                            $_.i = $_.msglen; //#25657
                            $_.done = true; //#25658
                            break; //#25659
                        } //#25659
                        if (($_.remcws == 1) && ($_.remvals.length == 1)) { //#25669
                            $k[$j++] = $geti($_.ctxvals, 0, $_.p); //#25663
                            $_.CTXvalstocws(); //#25663
                            $_.addtocws(); //#25663
                            $k[$j++] = $get($_.Avals, $get($_.msg, $_.i)); //#25664
                            $_.addtocws(); //#25664
                            $_.mode = $_.datamatrix_A; //#25665
                            $_.i = $_.msglen; //#25666
                            $_.done = true; //#25667
                            break; //#25668
                        } //#25668
                    } //#25668
                } //#25668
                var _G5 = $get($get($_.encvals, $_.mode), $get($_.msg, $_.i)); //#25672
                $k[$j++] = _G5; //#25675
                if ((_G5.length + $_.p) > $_.ctxvals.length) { //#25675
                    $k[$j - 1] = "bwipp.datamatrixTooMuchData#25674"; //#25674
                    $k[$j++] = "The input data exceeds the symbol capacity"; //#25674
                    bwipp_raiseerror(); //#25674
                } //#25674
                var _G8 = $k[--$j]; //#25676
                $puti($_.ctxvals, $_.p, _G8); //#25676
                $_.p = _G8.length + $_.p; //#25677
                $_.i = $_.i + 1; //#25678
            } //#25678
            if (!$_.done) { //#25706
                for (;;) { //#25689
                    if (($_.p % 3) == 0) { //#25686
                        break; //#25686
                    } //#25686
                    $_.i = $_.i - 1; //#25687
                    $_.p = $_.p - $get($get($_.encvals, $_.mode), $get($_.msg, $_.i)).length; //#25688
                } //#25688
                $k[$j++] = Infinity; //#25690
                $aload($geti($_.ctxvals, 0, $_.p)); //#25691
                var _GR = $a(); //#25691
                $k[$j++] = _GR; //#25692
                $_.CTXvalstocws(); //#25692
                $_.addtocws(); //#25692
                $k[$j++] = $a([$_.datamatrix_unlcw]); //#25693
                $_.addtocws(); //#25693
                $_.mode = $_.datamatrix_A; //#25694
                $_.c40headerlength = -1; //#25695
                if ($_.i != $_.msglen && !$get($_.isECI, $_.i)) { //#25705
                    if ($get($_.numD, $_.i) >= 2) { //#25703
                        var _Gb = $s(2); //#25699
                        $put(_Gb, 0, $get($_.msg, $_.i)); //#25699
                        $put(_Gb, 1, $get($_.msg, $_.i + 1)); //#25699
                        $k[$j++] = $get($_.Avals, _Gb); //#25699
                        $_.addtocws(); //#25699
                        $_.i = $_.i + 2; //#25700
                    } else { //#25703
                        $k[$j++] = $get($_.Avals, $get($_.msg, $_.i)); //#25702
                        $_.addtocws(); //#25702
                        $_.i = $_.i + 1; //#25703
                    } //#25703
                } //#25703
            } //#25703
        }; //#25703
        $_.Evalstocws = function() {
            var _Gr = $k[--$j]; //#25711
            $_.in = _Gr; //#25711
            $_.inlen = $_.in.length; //#25712
            $_.outlen = $ceil(($_.in.length / 4) * 3); //#25713
            $k[$j++] = Infinity; //#25714
            $aload($_.in); //#25714
            $k[$j++] = 0; //#25714
            $k[$j++] = 0; //#25714
            $k[$j++] = 0; //#25714
            $_.in = $a(); //#25714
            $k[$j++] = Infinity; //#25715
            for (var _Gx = 0, _Gw = $_.inlen - 1; _Gx <= _Gw; _Gx += 4) { //#25721
                var _Gz = $geti($_.in, _Gx, 4); //#25717
                var _H4 = 0; //#25717
                for (var _H0 = 0, _H1 = _Gz.length; _H0 < _H1; _H0++) { //#25717
                    var _H2 = $get(_Gz, _H0); //#25717
                    _H4 = $or(_H4, _H2) * 64; //#25717
                } //#25717
                var _H5 = $flr(_H4 / 64); //#25718
                $k[$j++] = $flr(_H5 / 65536) & 255; //#25720
                $k[$j++] = $flr(_H5 / 256) & 255; //#25720
                $k[$j++] = _H5 & 255; //#25720
            } //#25720
            $astore($a($counttomark())); //#25722
            var _H8 = $k[--$j]; //#25722
            $k[$j - 1] = $geti(_H8, 0, $_.outlen); //#25723
        }; //#25723
        $_.encE = function() {
            $_.p = 0; //#25727
            $_.edifactvals = $a(2100); //#25728
            for (;;) { //#25762
                if ($_.i == $_.msglen) { //#25734
                    break; //#25734
                } //#25734
                if (!$has($_.Evals, $get($_.msg, $_.i))) { //#25735
                    break; //#25735
                } //#25735
                if ($_.p >= $_.edifactvals.length) { //#25738
                    $k[$j++] = "bwipp.datamatrixTooMuchData#25737"; //#25737
                    $k[$j++] = "The input data exceeds the symbol capacity"; //#25737
                    bwipp_raiseerror(); //#25737
                } //#25737
                if (($_.p % 4) == 0) { //#25757
                    if (($_.msglen - $_.i) <= 2) { //#25755
                        $k[$j++] = $_.j + ((~~($_.p / 4)) * 3); //#25741
                        $_.getnumremcws(); //#25741
                        var _HS = $k[--$j]; //#25741
                        $_.remcws = _HS; //#25741
                        $k[$j++] = Infinity; //#25742
                        var _HX = $geti($_.msg, $_.i, $_.msglen - $_.i); //#25743
                        for (var _HY = 0, _HZ = _HX.length; _HY < _HZ; _HY++) { //#25745
                            $aload($get($_.Avals, $get(_HX, _HY))); //#25744
                        } //#25744
                        $_.remvals = $a(); //#25744
                        if ((($_.remcws == 1) || ($_.remcws == 2)) && ($_.remvals.length <= $_.remcws)) { //#25754
                            $k[$j++] = $geti($_.edifactvals, 0, $_.p); //#25749
                            $_.Evalstocws(); //#25749
                            $_.addtocws(); //#25749
                            $k[$j++] = $_.remvals; //#25750
                            $_.addtocws(); //#25750
                            $_.mode = $_.datamatrix_A; //#25751
                            $_.i = $_.msglen; //#25752
                            break; //#25753
                        } //#25753
                    } //#25753
                    $_.lookup(); //#25756
                    var _Hn = $k[--$j]; //#25756
                    if (_Hn != $_.mode) { //#25756
                        break; //#25756
                    } //#25756
                } //#25756
                var _Hs = $get($_.Evals, $get($_.msg, $_.i)); //#25758
                $puti($_.edifactvals, $_.p, _Hs); //#25759
                $_.p = _Hs.length + $_.p; //#25760
                $_.i = $_.i + 1; //#25761
            } //#25761
            if ($_.mode != $_.datamatrix_A) { //#25787
                $k[$j++] = ($_.j + ((~~($_.p / 4)) * 3)) - 1; //#25768
                $_.getnumremcws(); //#25768
                var _I0 = $k[--$j]; //#25768
                $_.remcws = _I0 - 1; //#25768
                if (((($_.p % 4) != 0) || ($_.i != $_.msglen)) || ($_.remcws >= 3)) { //#25773
                    var _I6 = $get($_.Evals, $_.datamatrix_unl); //#25770
                    $puti($_.edifactvals, $_.p, _I6); //#25771
                    $_.p = _I6.length + $_.p; //#25772
                } //#25772
                $k[$j++] = $geti($_.edifactvals, 0, $_.p); //#25774
                $_.Evalstocws(); //#25774
                $_.addtocws(); //#25774
                $_.mode = $_.datamatrix_A; //#25775
                $_.c40headerlength = -1; //#25776
                if ($_.i != $_.msglen && !$get($_.isECI, $_.i)) { //#25786
                    if ($get($_.numD, $_.i) >= 2) { //#25784
                        var _IL = $s(2); //#25780
                        $put(_IL, 0, $get($_.msg, $_.i)); //#25780
                        $put(_IL, 1, $get($_.msg, $_.i + 1)); //#25780
                        $k[$j++] = $get($_.Avals, _IL); //#25780
                        $_.addtocws(); //#25780
                        $_.i = $_.i + 2; //#25781
                    } else { //#25784
                        $k[$j++] = $get($_.Avals, $get($_.msg, $_.i)); //#25783
                        $_.addtocws(); //#25783
                        $_.i = $_.i + 1; //#25784
                    } //#25784
                } //#25784
            } //#25784
        }; //#25784
        $_.encB = function() {
            $_.p = 0; //#25792
            $_.bvals = $a(1558); //#25792
            for (;;) { //#25801
                if ($_.i == $_.msglen) { //#25793
                    break; //#25793
                } //#25793
                $_.lookup(); //#25794
                var _If = $k[--$j]; //#25794
                if (_If != $_.mode) { //#25794
                    break; //#25794
                } //#25794
                if ($_.p >= $_.bvals.length) { //#25797
                    $k[$j++] = "bwipp.datamatrixTooMuchData#25796"; //#25796
                    $k[$j++] = "The input data exceeds the symbol capacity"; //#25796
                    bwipp_raiseerror(); //#25796
                } //#25796
                $put($_.bvals, $_.p, $get($_.msg, $_.i)); //#25798
                $_.p = $_.p + 1; //#25799
                $_.i = $_.i + 1; //#25800
            } //#25800
            $k[$j++] = $_.j + $_.p; //#25802
            $_.getnumremcws(); //#25802
            var _Ir = $k[--$j]; //#25802
            $_.remcws = _Ir - 1; //#25802
            $k[$j++] = Infinity; //#25803
            if (($_.remcws == 0) && ($_.i == $_.msglen)) { //#25807
                $k[$j++] = 0; //#25805
            } else { //#25807
                if ($_.p < 250) { //#25807
                    $k[$j++] = $_.p; //#25807
                } else { //#25807
                    $k[$j++] = (~~($_.p / 250)) + 249; //#25807
                    $k[$j++] = $_.p % 250; //#25807
                } //#25807
            } //#25807
            $aload($geti($_.bvals, 0, $_.p)); //#25809
            $_.bvals = $a(); //#25809
            for (var _J4 = 0, _J3 = $_.bvals.length - 1; _J4 <= _J3; _J4 += 1) { //#25816
                $_.p = _J4; //#25812
                var _JA = $f(($_.j + $_.p + 1) * 149 % 255 + 1 + $get($_.bvals, $_.p)); //#25814
                if (_JA >= 256) { //#25814
                    _JA = _JA - 256; //#25814
                } //#25814
                $put($_.bvals, $_.p, _JA); //#25815
            } //#25815
            $k[$j++] = $_.bvals; //#25817
            $_.addtocws(); //#25817
            $_.mode = $_.datamatrix_A; //#25818
        }; //#25818
        $_.cws = $a(1558); //#25824
        $_.mode = $_.datamatrix_A; //#25825
        $_.i = 0; //#25825
        $_.j = 0; //#25825
        if ($get($_.msg, 0) == $_.datamatrix_fnc1) { //#25832
            $k[$j++] = $get($_.Avals, $_.datamatrix_fnc1); //#25828
            $_.addtocws(); //#25828
            $_.i = 1; //#25829
            if ($_.c40headerlength > 0) { //#25831
                $_.c40headerlength = $_.c40headerlength + 1; //#25831
            } //#25831
        } //#25831
        for (;;) { //#25836
            if ($_.i >= $_.msglen) { //#25834
                break; //#25834
            } //#25834
            var _JR = $_[$get($_.datamatrix_encfuncs, $_.mode)]; //#25835
            if (_JR() === true) {
                break;
            } //#25835
        } //#25835
        $_.cws = $geti($_.cws, 0, $_.j); //#25837
    } //#25837
    $_.datlen = $_.cws.length; //#25844
    $k[$j++] = $_.j - 1; //#25845
    $_.getnumremcws(); //#25845
    var _JX = $k[--$j]; //#25845
    $_.remcws = _JX - 1; //#25845
    if ($_.remcws > 0) { //#25854
        $k[$j++] = Infinity; //#25847
        $aload($_.cws); //#25847
        for (var _Jb = 0, _Jc = $_.remcws; _Jb < _Jc; _Jb++) { //#25847
            $k[$j++] = 129; //#25847
        } //#25847
        $_.cws = $a(); //#25847
        for (var _Jh = $_.datlen + 1, _Jg = $f($_.datlen + $_.remcws) - 1; _Jh <= _Jg; _Jh += 1) { //#25853
            $_.i = _Jh; //#25849
            var _Jj = (((($_.i + 1) * 149) % 253) + 1) + 129; //#25851
            if (_Jj > 254) { //#25851
                _Jj = _Jj - 254; //#25851
            } //#25851
            $put($_.cws, $_.i, _Jj); //#25852
        } //#25852
    } //#25852
    if ($has($_.options, 'debugcws')) { //#25858
        $k[$j++] = "bwipp.debugcws#25858"; //#25858
        $k[$j++] = $_.cws; //#25858
        bwipp_raiseerror(); //#25858
    } //#25858
    for (var _Jr = 0, _Js = $_.datamatrix_metrics.length; _Jr < _Js; _Jr++) { //#25887
        $_.m = $get($_.datamatrix_metrics, _Jr); //#25866
        $_.rows = $get($_.m, 0); //#25867
        $_.cols = $get($_.m, 1); //#25868
        $_.regh = $get($_.m, 2); //#25869
        $_.regv = $get($_.m, 3); //#25870
        $_.rscw = $get($_.m, 4); //#25871
        $_.rsbl = $get($_.m, 5); //#25872
        $_.doly = $get($_.m, 6); //#25873
        $_.mrows = $f($_.rows - 2 * $_.regh) //#25874
        $_.mcols = $f($_.cols - 2 * $_.regv) //#25875
        $_.rrows = ~~($_.mrows / $_.regh); //#25876
        $_.rcols = ~~($_.mcols / $_.regv); //#25877
        $_.ncws = $f(~~($_.mrows * $_.mcols / 8) - $_.rscw) //#25878
        $_.okay = true; //#25879
        if ($_.cws.length != $_.ncws) { //#25880
            $_.okay = false; //#25880
        } //#25880
        if (($_.urows != 0) && ($_.urows != $_.rows)) { //#25881
            $_.okay = false; //#25881
        } //#25881
        if (($_.ucols != 0) && ($_.ucols != $_.cols)) { //#25882
            $_.okay = false; //#25882
        } //#25882
        if ($eq($_.format, "square") && $ne($_.rows, $_.cols)) { //#25883
            $_.okay = false; //#25883
        } //#25883
        if ($eq($_.format, "rectangle") && $eq($_.rows, $_.cols)) { //#25884
            $_.okay = false; //#25884
        } //#25884
        if ((!$_.dmre) && ($_.doly == 1)) { //#25885
            $_.okay = false; //#25885
        } //#25885
        if ($_.okay) { //#25886
            break; //#25886
        } //#25886
    } //#25886
    if (!$_.okay) { //#25891
        $k[$j++] = "bwipp.datamatrixNoValidSymbol#25890"; //#25890
        $k[$j++] = "Maximum length exceeded or invalid size"; //#25890
        bwipp_raiseerror(); //#25890
    } //#25890
    $k[$j++] = 'coeffs'; //#25897
    $k[$j++] = ~~($_.rscw / $_.rsbl); //#25897
    $_.datamatrix_coeffscachefetch(); //#25897
    var _Kd = $k[--$j]; //#25897
    var _Ke = $k[--$j]; //#25897
    $_[_Ke] = _Kd; //#25897
    $_.ecbs = $a($_.rsbl); //#25906
    $_.ecpb = ~~($_.rscw / $_.rsbl); //#25907
    for (var _Kl = 0, _Kk = $_.rsbl - 1; _Kl <= _Kk; _Kl += 1) { //#25920
        $_.blk = _Kl; //#25909
        if ($_.cws.length != 1558) { //#25913
            $_.cwbsize = ~~($_.cws.length / $_.rsbl); //#25911
        } else { //#25913
            if ($_.blk <= 7) { //#25913
                $_.cwbsize = 156; //#25913
            } else { //#25913
                $_.cwbsize = 155; //#25913
            } //#25913
        } //#25913
        $_.lfsr = $a($_.ecpb); //#25916
        var _Ku = $_.cwbsize; //#25917
        var _Kv = $_.coeffs; //#25917
        var _Kw = $_.ecpb; //#25917
        var _Kx = $_.lfsr; //#25917
        $k[$j++] = $_.ecbs; //#25917
        $k[$j++] = $_.blk; //#25917
        $k[$j++] = function() {
            var _Kz = $k[--$j]; //#25917
            $k[$j++] = $get($_.cws, $f(_Kz * $_.rsbl + $_.blk)) //#25917
        }; //#25917
        $k[$j++] = _Ku; //#25917
        $k[$j++] = _Kv; //#25917
        $k[$j++] = _Kw; //#25917
        $k[$j++] = _Kx; //#25917
        $k[$j++] = $_.datamatrix_rsprod; //#25917
        bwipp_rsecbinary(); //#25917
        var _L4 = $k[--$j]; //#25919
        var _L5 = $k[--$j]; //#25919
        $put(_L5, _L4, $_.lfsr); //#25919
    } //#25919
    if ($_.ncws == 1558) { //#25930
        $k[$j++] = Infinity; //#25926
        $aload($geti($_.ecbs, 8, 2)); //#25927
        $aload($geti($_.ecbs, 0, 8)); //#25928
        $_.ecbs = $a(); //#25928
    } //#25929
    if ($has($_.options, 'debugecc')) { //#25934
        $k[$j++] = "bwipp.debugecc#25934"; //#25934
        $k[$j++] = Infinity; //#25934
        var _LD = $_.ecbs; //#25934
        for (var _LE = 0, _LF = _LD.length; _LE < _LF; _LE++) { //#25934
            $aload($get(_LD, _LE)); //#25934
        } //#25934
        var _LH = $a(); //#25934
        $k[$j++] = _LH; //#25934
        bwipp_raiseerror(); //#25934
    } //#25934
    var _LK = $a($f($_.cws.length + $_.rscw)); //#25939
    $puti(_LK, 0, $_.cws); //#25939
    $_.cws = _LK; //#25939
    for (var _LO = 0, _LN = $_.rscw - 1; _LO <= _LN; _LO += 1) { //#25943
        $_.i = _LO; //#25941
        $put($_.cws, $f($_.ncws + $_.i), $get($get($_.ecbs, $_.i % $_.rsbl), ~~($_.i / $_.rsbl))) //#25942
    } //#25942
    $_.module = function() {
        $r(4, -1); //#25954
        var _La = $strcpy($s(8), "00000000"); //#25955
        $k[$j++] = _La; //#25955
        $k[$j++] = _La; //#25955
        var _Lb = $s(8); //#25955
        var _Lc = $k[$j - 3]; //#25955
        var _Ld = $cvrs(_Lb, _Lc, 2); //#25955
        var _Le = $k[$j - 1]; //#25956
        $k[$j - 3] = $k[$j - 2]; //#25955
        $j -= 2; //#25955
        $puti(_Le, 8 - _Ld.length, _Ld); //#25956
        for (var _Lf = 7; _Lf >= 0; _Lf -= 1) { //#25957
            var _Lg = $k[--$j]; //#25957
            $k[$j++] = $get(_Lg, _Lf) - 48; //#25957
            $k[$j++] = _Lg; //#25957
        } //#25957
        $j--; //#25957
        $r(11, -3); //#25958
        var _Li = $k[--$j]; //#25975
        $forall(_Li, function() { //#25975
            var _Lj = $k[--$j]; //#25961
            if (_Lj() === true) {
                return true;
            } //#25961
            var _Ll = $k[$j - 2]; //#25962
            if (_Ll < 0) { //#25965
                var _Lm = $k[--$j]; //#25963
                var _Ln = $k[--$j]; //#25963
                $k[$j++] = $f(_Ln + $_.mrows) //#25964
                $k[$j++] = $f(_Lm + (4 - ($_.mrows + 4) % 8)) //#25964
            } //#25964
            var _Lq = $k[$j - 1]; //#25966
            if (_Lq < 0) { //#25969
                var _Ls = $k[--$j]; //#25967
                var _Lt = $k[--$j]; //#25967
                $k[$j++] = $f(_Lt + (4 - ($_.mcols + 4) % 8)) //#25968
                $k[$j++] = $f(_Ls + $_.mcols) //#25968
            } //#25968
            var _Lw = $k[$j - 2]; //#25970
            if (_Lw >= $_.mrows) { //#25972
                var _Ly = $k[--$j]; //#25971
                var _Lz = $k[--$j]; //#25971
                $k[$j++] = $f(_Lz - $_.mrows) //#25971
                $k[$j++] = _Ly; //#25971
            } //#25971
            var _M1 = $k[--$j]; //#25973
            var _M2 = $k[--$j]; //#25973
            $k[$j++] = $_.mmat; //#25974
            $k[$j++] = $f(_M1 + _M2 * $_.mcols) //#25974
            $r(5, -1); //#25974
            var _M5 = $k[--$j]; //#25974
            var _M6 = $k[--$j]; //#25974
            var _M7 = $k[--$j]; //#25974
            $put(_M7, _M6, _M5); //#25974
        }); //#25974
    }; //#25974
    $k[$j++] = Infinity; //#25978
    for (var _MA = 0, _MB = $_.mrows * $_.mcols; _MA < _MB; _MA++) { //#25978
        $k[$j++] = -1; //#25978
    } //#25978
    $_.mmat = $a(); //#25978
    for (var _MD = $_.cws.length - 1; _MD >= 0; _MD -= 1) { //#25979
        $k[$j++] = $get($_.cws, _MD); //#25979
    } //#25979
    $k[$j++] = 4; //#26019
    $k[$j++] = 0; //#26019
    for (;;) { //#26019
        var _MG = $k[$j - 1]; //#25982
        var _MH = $k[$j - 2]; //#25982
        if ((_MG == 0) && (_MH == $_.mrows)) { //#25984
            $k[$j++] = $_.datamatrix_dmc1; //#25983
            $_.module(); //#25983
        } //#25983
        var _MJ = $k[$j - 1]; //#25985
        var _MK = $k[$j - 2]; //#25985
        if (((_MJ == 0) && (_MK == ($_.mrows - 2))) && (($_.mcols % 4) != 0)) { //#25987
            $k[$j++] = $_.datamatrix_dmc2; //#25986
            $_.module(); //#25986
        } //#25986
        var _MN = $k[$j - 1]; //#25988
        var _MO = $k[$j - 2]; //#25988
        if (((_MN == 0) && (_MO == ($_.mrows - 2))) && (($_.mcols % 8) == 4)) { //#25990
            $k[$j++] = $_.datamatrix_dmc3; //#25989
            $_.module(); //#25989
        } //#25989
        var _MR = $k[$j - 1]; //#25991
        var _MS = $k[$j - 2]; //#25991
        if (((_MR == 2) && (_MS == ($_.mrows + 4))) && (($_.mcols % 8) == 0)) { //#25993
            $k[$j++] = $_.datamatrix_dmc4; //#25992
            $_.module(); //#25992
        } //#25992
        for (;;) { //#26003
            var _MV = $k[$j - 1]; //#25996
            var _MW = $k[$j - 2]; //#25996
            if ((_MV >= 0) && (_MW < $_.mrows)) { //#26000
                var _MY = $k[$j - 1]; //#25997
                var _MZ = $k[$j - 2]; //#25997
                var _Mc = $get($_.mmat, $f(_MY + _MZ * $_.mcols)); //#25997
                if (_Mc == -1) { //#25999
                    $k[$j++] = $_.datamatrix_dmn; //#25998
                    $_.module(); //#25998
                } //#25998
            } //#25998
            var _Md = $k[--$j]; //#26001
            var _Me = $k[--$j]; //#26001
            $k[$j++] = _Me - 2; //#26002
            $k[$j++] = _Md + 2; //#26002
            if (!(((_Md + 2) < $_.mcols) && ((_Me - 2) >= 0))) { //#26002
                break; //#26002
            } //#26002
        } //#26002
        var _Mg = $k[--$j]; //#26004
        $k[$j - 1] += 1; //#26014
        $k[$j++] = _Mg + 3; //#26014
        for (;;) { //#26014
            var _Mi = $k[$j - 1]; //#26007
            var _Mj = $k[$j - 2]; //#26007
            if ((_Mi < $_.mcols) && (_Mj >= 0)) { //#26011
                var _Ml = $k[$j - 1]; //#26008
                var _Mm = $k[$j - 2]; //#26008
                var _Mp = $get($_.mmat, $f(_Ml + _Mm * $_.mcols)); //#26008
                if (_Mp == -1) { //#26010
                    $k[$j++] = $_.datamatrix_dmn; //#26009
                    $_.module(); //#26009
                } //#26009
            } //#26009
            var _Mq = $k[--$j]; //#26012
            var _Mr = $k[--$j]; //#26012
            $k[$j++] = _Mr + 2; //#26013
            $k[$j++] = _Mq - 2; //#26013
            if (!(((_Mq - 2) >= 0) && ((_Mr + 2) < $_.mrows))) { //#26013
                break; //#26013
            } //#26013
        } //#26013
        var _Mt = $k[--$j]; //#26015
        var _Mu = $k[--$j]; //#26015
        $k[$j++] = _Mu + 3; //#26017
        $k[$j++] = _Mt + 1; //#26017
        if (!(((_Mt + 1) < $_.mcols) || ((_Mu + 3) < $_.mrows))) { //#26017
            $j -= 2; //#26017
            break; //#26017
        } //#26017
    } //#26017
    if ($get($_.mmat, ($_.mrows * $_.mcols) - 1) == -1) { //#26027
        $puti($_.mmat, ($_.mrows * ($_.mcols - 1)) - 2, $a([1, 0])); //#26025
        $puti($_.mmat, ($_.mrows * $_.mcols) - 2, $a([0, 1])); //#26026
    } //#26026
    $_.pixs = $a($_.rows * $_.cols); //#26032
    $_.cwpos = 0; //#26033
    for (var _NE = 0, _ND = $_.rows - 1; _NE <= _ND; _NE += 1) { //#26049
        $_.i = _NE; //#26035
        if (($_.i % ($_.rrows + 2)) == 0) { //#26036
            var _NP = $_.pixs; //#26036
            var _NO = $_.i * $_.cols; //#26036
            $k[$j++] = Infinity; //#26036
            for (var _NL = 0, _NM = ~~($_.cols / 2); _NL < _NM; _NL++) { //#26036
                $k[$j++] = 1; //#26036
                $k[$j++] = 0; //#26036
            } //#26036
            var _NN = $a(); //#26036
            $puti(_NP, _NO, _NN); //#26036
        } //#26036
        if (($_.i % ($_.rrows + 2)) == ($_.rrows + 1)) { //#26037
            var _Nb = $_.pixs; //#26037
            var _Na = $_.i * $_.cols; //#26037
            var _NZ = []; //#26037
            for (var _NX = 0, _NY = $_.cols; _NX < _NY; _NX++) { //#26037
                _NZ[_NX] = 1; //#26037
            } //#26037
            _NZ = $a(_NZ); //#26037
            $puti(_Nb, _Na, _NZ); //#26037
        } //#26037
        if ((($_.i % ($_.rrows + 2)) != 0) && (($_.i % ($_.rrows + 2)) != ($_.rrows + 1))) { //#26048
            for (var _Nj = 0, _Ni = $_.cols - 1; _Nj <= _Ni; _Nj += 1) { //#26047
                $_.j = _Nj; //#26040
                if (($_.j % ($_.rcols + 2)) == 0) { //#26041
                    $put($_.pixs, $f($_.i * $_.cols + $_.j), 1) //#26041
                } //#26041
                if (($_.j % ($_.rcols + 2)) == ($_.rcols + 1)) { //#26042
                    $put($_.pixs, $f($_.i * $_.cols + $_.j), $_.i % 2) //#26042
                } //#26042
                if ((($_.j % ($_.rcols + 2)) != 0) && (($_.j % ($_.rcols + 2)) != ($_.rcols + 1))) { //#26046
                    $put($_.pixs, $f($_.i * $_.cols + $_.j), $get($_.mmat, $_.cwpos)) //#26044
                    $_.cwpos = $_.cwpos + 1; //#26045
                } //#26045
            } //#26045
        } //#26045
    } //#26045
    $k[$j++] = new Map([
        ["ren", 'renmatrix'],
        ["pixs", $_.pixs],
        ["pixx", $_.cols],
        ["pixy", $_.rows],
        ["height", ($_.rows * $_.modunit) / 72],
        ["width", ($_.cols * $_.modunit) / 72],
        ["borderleft", 1],
        ["borderright", 1],
        ["bordertop", 1],
        ["borderbottom", 1],
        ["opt", $_.options]
    ]); //#26070
    if ($_._render) { //#26073
        bwipp_renmatrix(); //#26073
    } //#26073
    $_ = $__; //#26076
} //bwipp_datamatrix

function bwipp_renderguards() {
    var _0 = $k[--$j]; //#41289
    $_.pixx = _0; //#41289
    if (($_.guardwidth < 0) || ($_.guardwidth > 20)) { //#41293
        $k[$j++] = "bwipp.renderBadGuardwidth#41292"; //#41292
        $k[$j++] = "guardwidth must be from 0 to 20"; //#41292
        bwipp_raiseerror(); //#41292
    } //#41292
    if (($_.guardheight < 0) || ($_.guardheight > 20)) { //#41297
        $k[$j++] = "bwipp.renderBadGuardheight#41296"; //#41296
        $k[$j++] = "guardheight must be from 0 to 20"; //#41296
        bwipp_raiseerror(); //#41296
    } //#41296
    if (($_.guardleftpos < -50) || ($_.guardleftpos > 150)) { //#41301
        $k[$j++] = "bwipp.renderBadGuardleftpos#41300"; //#41300
        $k[$j++] = "guardleftpos must be from -50 to 150"; //#41300
        bwipp_raiseerror(); //#41300
    } //#41300
    if (($_.guardleftypos < -50) || ($_.guardleftypos > 150)) { //#41305
        $k[$j++] = "bwipp.renderBadGuardleftypos#41304"; //#41304
        $k[$j++] = "guardleftypos must be from -50 to 150"; //#41304
        bwipp_raiseerror(); //#41304
    } //#41304
    if (($_.guardrightpos < -50) || ($_.guardrightpos > 150)) { //#41309
        $k[$j++] = "bwipp.renderBadGuardrightpos#41308"; //#41308
        $k[$j++] = "guardrightpos must be from -50 to 150"; //#41308
        bwipp_raiseerror(); //#41308
    } //#41308
    if (($_.guardrightypos < -50) || ($_.guardrightypos > 150)) { //#41313
        $k[$j++] = "bwipp.renderBadGuardrightypos#41312"; //#41312
        $k[$j++] = "guardrightypos must be from -50 to 150"; //#41312
        bwipp_raiseerror(); //#41312
    } //#41312
    if ($_.guardwhitespace) { //#41325
        $$.selectfont("OCR-B", $_.guardheight * 2); //#41316
        if ($_.guardleftpos != 0) { //#41320
            $$.moveto(-$_.guardleftpos - 2, $f($_.guardleftypos - $_.guardheight / 2 - 1.25)) //#41318
            $$.show("<", 0, 0); //#41319
        } //#41319
        if ($_.guardrightpos != 0) { //#41324
            $$.moveto($f($_.guardrightpos + $_.pixx - $_.guardwidth) - 1, $f($_.guardrightypos - $_.guardheight / 2 - 1.25)) //#41322
            $$.show(">", 0, 0); //#41323
        } //#41323
    } //#41323
} //bwipp_renderguards

function bwipp_rendertext() {
    if (!bwipp_rendertext.globals) {
        var $__ = $_;
        $_ = bwipp_rendertext.globals = {};
        //#41338
        var _G = new Map([
            ["offleft", function() {
                $k[$j++] = $f(-$_.tw - $_.nudge) //#41345
            }],
            ["below", function() {
                $k[$j++] = $f(-$_.th - $_.nudge) //#41345
            }],
            ["left", function() {
                $k[$j++] = 0; //#41346
            }],
            ["bottom", function() {
                $k[$j++] = 0; //#41346
            }],
            ["xcenter", function() {
                $k[$j++] = $f($_.pixx - $_.tw) / 2 //#41347
            }],
            ["ycenter", function() {
                $k[$j++] = $f($_.pixy - $_.th) / 2 //#41347
            }],
            ["right", function() {
                $k[$j++] = $f($_.pixx - $_.tw) //#41348
            }],
            ["top", function() {
                $k[$j++] = $f($_.pixy - $_.th) //#41348
            }],
            ["offright", function() {
                $k[$j++] = $f($_.pixx + $_.nudge) //#41349
            }],
            ["above", function() {
                $k[$j++] = $f($_.pixy + $_.nudge) //#41349
            }]
        ]); //#41349
        var _X = new Map([
            ["offleft", function() {
                $k[$j++] = 0 - $_.nudge; //#41352
            }],
            ["below", function() {
                $k[$j++] = 0 - $_.nudge; //#41352
            }],
            ["left", function() {
                $k[$j++] = $_.tw; //#41353
            }],
            ["bottom", function() {
                $k[$j++] = $_.th; //#41353
            }],
            ["xcenter", function() {
                $k[$j++] = $f($_.pixx + $_.tw) / 2 //#41354
            }],
            ["ycenter", function() {
                $k[$j++] = $f($_.pixy + $_.th) / 2 //#41354
            }],
            ["right", function() {
                $k[$j++] = $_.pixx; //#41355
            }],
            ["top", function() {
                $k[$j++] = $_.pixy; //#41355
            }],
            ["offright", function() {
                $k[$j++] = $f($_.pixx + $_.tw + $_.nudge) //#41356
            }],
            ["above", function() {
                $k[$j++] = $f($_.pixy + $_.th + $_.nudge) //#41356
            }]
        ]); //#41356
        var _o = new Map([
            ["offleft", function() {
                $k[$j++] = 0 - $_.nudge; //#41359
            }],
            ["below", function() {
                $k[$j++] = $f(-$_.tw - $_.nudge) //#41359
            }],
            ["left", function() {
                $k[$j++] = $_.th; //#41360
            }],
            ["bottom", function() {
                $k[$j++] = 0; //#41360
            }],
            ["xcenter", function() {
                $k[$j++] = $f($_.pixx + $_.th) / 2 //#41361
            }],
            ["ycenter", function() {
                $k[$j++] = $f($_.pixy - $_.tw) / 2 //#41361
            }],
            ["right", function() {
                $k[$j++] = $_.pixx; //#41362
            }],
            ["top", function() {
                $k[$j++] = $f($_.pixy - $_.tw) //#41362
            }],
            ["offright", function() {
                $k[$j++] = $f($_.pixx + $_.th + $_.nudge) //#41363
            }],
            ["above", function() {
                $k[$j++] = $f($_.pixy + $_.nudge) //#41363
            }]
        ]); //#41363
        var _15 = new Map([
            ["offleft", function() {
                $k[$j++] = $f(-$_.th - $_.nudge) //#41366
            }],
            ["below", function() {
                $k[$j++] = 0 - $_.nudge; //#41366
            }],
            ["left", function() {
                $k[$j++] = 0; //#41367
            }],
            ["bottom", function() {
                $k[$j++] = $_.tw; //#41367
            }],
            ["xcenter", function() {
                $k[$j++] = $f($_.pixx - $_.th) / 2 //#41368
            }],
            ["ycenter", function() {
                $k[$j++] = $f($_.pixy + $_.tw) / 2 //#41368
            }],
            ["right", function() {
                $k[$j++] = $f($_.pixx - $_.th) //#41369
            }],
            ["top", function() {
                $k[$j++] = $_.pixy; //#41369
            }],
            ["offright", function() {
                $k[$j++] = $f($_.pixx + $_.nudge) //#41370
            }],
            ["above", function() {
                $k[$j++] = $f($_.pixy + $_.tw + $_.nudge) //#41370
            }]
        ]); //#41370
        var _16 = new Map([
            ["forward", _G],
            ["backward", _X],
            ["upward", _o],
            ["downward", _15]
        ]); //#41370
        $_.rendertext_positions = _16; //#41372
        $_ = $__;
    }
    //#41379
    var $__ = $_; //#41382
    $_ = Object.assign({}, $_, bwipp_rendertext.globals); //#41382
    $splay(); //#41382
    var _17 = $k[--$j]; //#41384
    $_.grp = _17; //#41384
    var _18 = $k[--$j]; //#41385
    $_.pixy = _18; //#41385
    var _19 = $k[--$j]; //#41386
    $_.pixx = _19; //#41386
    $_.makeerr = function() {
        var _1A = $k[--$j]; //#41390
        $_.makeerr_msg = _1A; //#41390
        var _1B = $k[--$j]; //#41391
        $_.makeerr_name = $cvs($s(128), _1B); //#41391
        if ($_.grp == 1) { //#41399
            $k[$j++] = "text"; //#41394
        } else { //#41399
            if ($_.grp == 2) { //#41399
                $k[$j++] = "extratext"; //#41397
            } else { //#41399
                var _1F = $s(5); //#41399
                $puti(_1F, 0, "text"); //#41399
                $put(_1F, 4, $_.grp + 48); //#41399
                $k[$j++] = _1F; //#41399
            } //#41399
        } //#41399
        var _1H = $k[--$j]; //#41401
        $_.makeerr_pfx = _1H; //#41401
        var _1K = $s(($_.makeerr_pfx.length + 6) + $_.makeerr_name.length); //#41403
        $puti(_1K, 0, "bwipp."); //#41404
        $puti(_1K, 6, $_.makeerr_pfx); //#41405
        $puti(_1K, $_.makeerr_pfx.length + 6, $_.makeerr_name); //#41406
        var _1Q = $s($_.makeerr_pfx.length + $_.makeerr_msg.length); //#41409
        $puti(_1Q, 0, $_.makeerr_pfx); //#41410
        $puti(_1Q, $_.makeerr_pfx.length, $_.makeerr_msg); //#41411
        $k[$j++] = _1K; //#41411
        $k[$j++] = _1Q; //#41411
    }; //#41411
    $_.positiontext = function() {
        var _1U = $k[--$j]; //#41416
        $_.th = _1U; //#41416
        var _1V = $k[--$j]; //#41417
        $_.tw = _1V; //#41417
        $_.nudge = 1; //#41418
        var _1W = $k[--$j]; //#41419
        var _1X = $get($_.rendertext_positions, _1W); //#41419
        $k[$j++] = _1X; //#41420
        $k[$j++] = _1X; //#41420
        $r(4, -1); //#41420
        var _1Y = $k[$j - 1]; //#41420
        if ($eq(_1Y, "center")) { //#41420
            $k[$j - 1] = "xcenter"; //#41420
        } //#41420
        var _1Z = $k[--$j]; //#41420
        var _1a = $k[--$j]; //#41420
        if ($get(_1a, _1Z)() === true) {
            return true;
        } //#41420
        var _1c = $k[--$j]; //#41420
        var _1d = $k[--$j]; //#41420
        $k[$j++] = _1c; //#41421
        $k[$j++] = _1d; //#41421
        $r(3, -1); //#41421
        var _1e = $k[$j - 1]; //#41421
        if ($eq(_1e, "center")) { //#41421
            $k[$j - 1] = "ycenter"; //#41421
        } //#41421
        var _1f = $k[--$j]; //#41421
        var _1g = $k[--$j]; //#41421
        if ($get(_1g, _1f)() === true) {
            return true;
        } //#41421
    }; //#41421
    for (var _1i = 0; _1i < 1; _1i++) { //#41573
        if (((($_.txt.length > 0) && $eq($_.xalign, "unset")) && $eq($_.yalign, "unset")) && ($_.content.length == 0)) { //#41458
            if ($ne($_.color, "unset")) { //#41431
                $$.setcolor($_.color); //#41431
            } //#41431
            $_.s = 0; //#41433
            $_.fn = ""; //#41433
            $_.xoff = 0; //#41433
            $_.yoff = 0; //#41433
            try { //#41452
                $forall($_.txt, function() { //#41451
                    var _1q = $k[--$j]; //#41436
                    $aload(_1q); //#41436
                    var _1r = $k[$j - 1]; //#41437
                    var _1s = $k[$j - 2]; //#41437
                    if ((_1r != $_.s) || $ne(_1s, $_.fn)) { //#41448
                        var _1v = $k[$j - 1]; //#41438
                        if (_1v <= 0) { //#41440
                            $j -= 5; //#41439
                            throw Infinity; //#41439
                        } //#41439
                        var _1w = $k[--$j]; //#41441
                        var _1x = $k[--$j]; //#41441
                        $_.s = _1w; //#41441
                        $_.fn = _1x; //#41441
                        $$.selectfont(_1x, _1w); //#41442
                        var _1y = $$.stringwidth("0"); //#41444
                        $_.xoff = -(_1y.w / 2); //#41444
                        $$.save(); //#41445
                        $$.newpath(); //#41445
                        $$.moveto(0, 0); //#41445
                        $$.charpath("0", false); //#41445
                        var _1z = $$.pathbbox(); //#41445
                        $$.restore(); //#41445
                        $k[$j++] = _1z.llx; //#41446
                        $k[$j++] = _1z.lly; //#41446
                        $k[$j++] = _1z.ury; //#41446
                        $k[$j++] = _1z.urx; //#41446
                        $j--; //#41446
                        var _20 = $k[--$j]; //#41446
                        var _21 = $k[--$j]; //#41446
                        $_.yoff = -($f(_21 + _20) / 2) //#41446
                        $j--; //#41446
                    } else { //#41448
                        $j -= 2; //#41448
                    } //#41448
                    var _22 = $k[--$j]; //#41450
                    var _23 = $k[--$j]; //#41450
                    $$.moveto(_23, _22); //#41450
                    var _24 = $k[$j - 1]; //#41450
                    if (_24.length == 1) { //#41450
                        $$.rmoveto($_.xoff, $_.yoff); //#41450
                    } //#41450
                    var _27 = $k[--$j]; //#41450
                    $$.show(_27, 0, 0); //#41450
                }); //#41450
                $k[$j++] = false; //#41450
            } catch (e) { //#41450
                $k[$j++] = true; //#41450
            } //#41450
            var _28 = $k[--$j]; //#41454
            if (_28) { //#41454
                $k[$j++] = "bwipp.fontTooSmall#41453"; //#41453
                $k[$j++] = "The font size is too small"; //#41453
                $k[$j++] = false; //#41453
                break; //#41453
            } //#41453
            $k[$j++] = true; //#41456
            break; //#41456
        } //#41456
        if (($_.content.length == 0) && ($_.txt.length > 0)) { //#41472
            $k[$j++] = Infinity; //#41466
            $forall($_.txt, function() { //#41466
                var _2C = $k[--$j]; //#41466
                $forall($get(_2C, 0)); //#41466
            }); //#41466
            $_.txtchars = $a(); //#41466
            $_.tstr = $s($_.txtchars.length); //#41467
            for (var _2I = 0, _2H = $_.txtchars.length - 1; _2I <= _2H; _2I += 1) { //#41470
                $put($_.tstr, _2I, $get($_.txtchars, _2I)); //#41469
            } //#41469
            $_.content = $_.tstr; //#41471
        } //#41471
        if ($_.content.length == 0) { //#41475
            $k[$j++] = true; //#41475
            break; //#41475
        } //#41475
        if (($_.subspace.length != 0) && ($_.subspace.length != 1)) { //#41480
            $k[$j++] = 'subspaceBad'; //#41479
            $k[$j++] = "subspace option must be a single character"; //#41479
            $_.makeerr(); //#41479
            $k[$j++] = false; //#41479
            break; //#41479
        } //#41479
        if ($_.subspace.length != 0) { //#41489
            for (var _2T = 0, _2S = $_.content.length - 1; _2T <= _2S; _2T += 1) { //#41488
                var _2V = $geti($_.content, _2T, 1); //#41484
                $k[$j++] = _2T; //#41484
                $search($_.subspace, _2V); //#41484
                var _2X = $k[--$j]; //#41486
                if (_2X) { //#41486
                    $j--; //#41485
                    $j--; //#41485
                    var _2c = $k[$j - 2]; //#41485
                    $put($_.content, _2c, 32); //#41485
                } //#41485
                $j -= 2; //#41487
            } //#41487
        } //#41487
        if (($_.split.length != 0) && ($_.content.length != 0)) { //#41502
            if ($_.split.length != 1) { //#41495
                $k[$j++] = 'splitBad'; //#41494
                $k[$j++] = "split option must be a single character"; //#41494
                $_.makeerr(); //#41494
                $k[$j++] = false; //#41494
                break; //#41494
            } //#41494
            $k[$j++] = Infinity; //#41496
            $k[$j++] = $_.content; //#41499
            for (;;) { //#41499
                var _2i = $k[--$j]; //#41498
                $search(_2i, $_.split); //#41498
                var _2j = $k[--$j]; //#41498
                if (_2j) { //#41498
                    var _2k = $k[--$j]; //#41498
                    $j--; //#41498
                    var _2n = $k[--$j]; //#41498
                    $k[$j++] = _2k; //#41498
                    $k[$j++] = _2n; //#41498
                } else { //#41498
                    break; //#41498
                } //#41498
            } //#41498
            $_.textlines = $a(); //#41498
        } else { //#41502
            $_.textlines = $a([$_.content]); //#41502
        } //#41502
        if ($ne($_.color, "unset")) { //#41505
            $$.setcolor($_.color); //#41505
        } //#41505
        $$.selectfont($_.font, $_.size); //#41507
        if ($_.content.length == 0) { //#41516
            $k[$j++] = 0; //#41511
        } else { //#41516
            $$.save(); //#41513
            $$.newpath(); //#41514
            $$.moveto(0, 0); //#41514
            $$.charpath("0", false); //#41514
            var _2u = $$.pathbbox(); //#41514
            $$.restore(); //#41516
            $k[$j++] = _2u.ury; //#41516
        } //#41516
        var _2v = $k[--$j]; //#41525
        $_.textascent = _2v; //#41525
        var _2w = $_.textlines; //#41527
        $k[$j++] = 'textwidth'; //#41527
        $k[$j++] = 0; //#41527
        for (var _2x = 0, _2y = _2w.length; _2x < _2y; _2x++) { //#41527
            var _30 = $$.stringwidth($get(_2w, _2x)); //#41527
            var _31 = $k[--$j]; //#41527
            var _32 = _30.w; //#41527
            if (_31 < _30.w) { //#41527
                var _ = _32; //#41527
                _32 = _31; //#41527
                _31 = _; //#41527
            } //#41527
            $k[$j++] = _31; //#41527
        } //#41527
        var _35 = $k[--$j]; //#41527
        var _36 = $k[--$j]; //#41527
        $_[_36] = $f(_35 + ($_.content.length - 1) * $_.gaps) //#41527
        var _38 = $_.textlines.length; //#41528
        $_.textheight = $f(_38 * $_.textascent + (_38 - 1) * $_.linegaps) //#41528
        if ($eq($_.xalign, "unset")) { //#41530
            $_.xalign = "center"; //#41530
        } //#41530
        if ($eq($_.yalign, "unset")) { //#41531
            $_.yalign = "below"; //#41531
        } //#41531
        if ($eq($_.xalign, "justify")) { //#41544
            if ($ne($_.direction, "forward") && $ne($_.direction, "backward")) { //#41536
                $k[$j++] = 'xjustify'; //#41535
                $k[$j++] = "xalign=justify requires forward or backward text"; //#41535
                $_.makeerr(); //#41535
                $k[$j++] = false; //#41535
                break; //#41535
            } //#41535
            if ($lt($_.textwidth, $_.pixx) && ($_.content.length > 1)) { //#41542
                $_.gaps = $f($_.pixx - $_.textwidth) / ($_.content.length - 1) //#41538
                var _3N = $eq($_.direction, "forward") ? "left" : "right"; //#41539
                $_.xalign = _3N; //#41539
            } else { //#41542
                $_.gaps = 0; //#41541
                $_.xalign = "center"; //#41542
            } //#41542
        } //#41542
        if ($eq($_.yalign, "justify")) { //#41557
            if ($ne($_.direction, "upward") && $ne($_.direction, "downward")) { //#41549
                $k[$j++] = 'yjustify'; //#41548
                $k[$j++] = "yalign=justify requires upward or downward text"; //#41548
                $_.makeerr(); //#41548
                $k[$j++] = false; //#41548
                break; //#41548
            } //#41548
            if ($lt($_.textwidth, $_.pixy) && ($_.content.length > 1)) { //#41555
                $_.gaps = $f($_.pixy - $_.textwidth) / ($_.content.length - 1) //#41551
                var _3Z = $eq($_.direction, "upward") ? "bottom" : "top"; //#41552
                $_.yalign = _3Z; //#41552
            } else { //#41555
                $_.gaps = 0; //#41554
                $_.yalign = "center"; //#41555
            } //#41555
        } //#41555
        $k[$j++] = $_.xalign; //#41559
        $k[$j++] = $_.yalign; //#41559
        $k[$j++] = $_.direction; //#41559
        $k[$j++] = $_.textwidth; //#41559
        $k[$j++] = $_.textheight; //#41559
        $_.positiontext(); //#41559
        var _3g = $k[--$j]; //#41559
        var _3h = $k[--$j]; //#41559
        $$.moveto(_3h, _3g); //#41559
        $$.rmoveto($_.xoffset, $_.yoffset); //#41560
        $$.save(); //#41561
        var _3k = new Map([
            ["forward", 0],
            ["upward", 90],
            ["backward", 180],
            ["downward", 270]
        ]); //#41562
        $$.rotate($get(_3k, $_.direction)); //#41562
        var _3n = $$.currpos(); //#41563
        $$.translate(_3n.x, _3n.y); //#41563
        for (var _3q = 0, _3p = $_.textlines.length - 1; _3q <= _3p; _3q += 1) { //#41568
            $_.i = _3q; //#41565
            $$.moveto(0, 0 + $f($_.textascent + $_.linegaps) * $_.i) //#41566
            var _3v = $_.textlines; //#41567
            $$.show($get(_3v, (_3v.length - $_.i) - 1), $_.gaps, 0); //#41567
        } //#41567
        $$.restore(); //#41569
        $k[$j++] = true; //#41571
        break; //#41571
    } //#41571
    $_ = $__; //#41575
} //bwipp_rendertext

function bwipp_renlinear() {
    if ($_.bwipjs_rawstack) {
        $_.bwipjs_rawstack.push($k[--$j]);
        return;
    }
    if (!bwipp_renlinear.globals) {
        var $__ = $_;
        $_ = bwipp_renlinear.globals = {};
        //#41597
        var _0 = new Map([
            ["offleft", 'offleft'],
            ["left", 'left'],
            ["center", 'center'],
            ["right", 'right'],
            ["offright", 'offright'],
            ["justify", 'justify']
        ]); //#41600
        $_.renlinear_xalignopts = _0; //#41601
        var _1 = new Map([
            ["above", 'above'],
            ["top", 'top'],
            ["center", 'center'],
            ["bottom", 'bottom'],
            ["below", 'below'],
            ["justify", 'justify']
        ]); //#41604
        $_.renlinear_yalignopts = _1; //#41605
        var _2 = new Map([
            ["forward", 'forward'],
            ["backward", 'backward'],
            ["upward", 'upward'],
            ["downward", 'downward']
        ]); //#41608
        $_.renlinear_directionoptions = _2; //#41609
        $_ = $__;
    }
    //#41611
    var $__ = $_; //#41612
    $_ = Object.assign({}, $_, bwipp_renlinear.globals); //#41612
    $_.sbs = $a([]); //#41617
    $_.bhs = $a([]); //#41618
    $_.bbs = $a([]); //#41619
    $_.txt = $a([]); //#41620
    bwipp_inittextoptions(); //#41623
    $_.text1xalign = "unset"; //#41626
    $_.text1yalign = "unset"; //#41627
    $_.includetext = false; //#41629
    $_.barcolor = "unset"; //#41630
    $_.bordercolor = "unset"; //#41632
    $_.inkspread = null; //#41633
    $_.width = 0; //#41634
    $_.barratio = 1; //#41635
    $_.spaceratio = 1; //#41636
    $_.showborder = false; //#41637
    $_.showbearer = false; //#41638
    $_.borderleft = 10; //#41639
    $_.borderright = 10; //#41640
    $_.bordertop = 1; //#41641
    $_.borderbottom = 1; //#41642
    $_.borderwidth = 0.5; //#41643
    $_.guardwhitespace = false; //#41644
    $_.guardleftpos = 0; //#41645
    $_.guardleftypos = 0; //#41646
    $_.guardrightpos = 0; //#41647
    $_.guardrightypos = 0; //#41648
    $_.guardwidth = 5; //#41649
    $_.guardheight = 7; //#41650
    var _3 = $k[--$j]; //#41652
    $forall(_3, function() { //#41652
        var _4 = $k[--$j]; //#41652
        var _5 = $k[--$j]; //#41652
        $_[_5] = _4; //#41652
    }); //#41652
    $k[$j++] = $_.opt; //#41653
    $del($_, 'opt') //#41653
    $k[$j++] = null; //#41653
    bwipp_processoptions(); //#41653
    $k[$j - 1] = 'textopts'; //#41654
    bwipp_grouptextoptions(); //#41654
    var _7 = $k[--$j]; //#41654
    var _8 = $k[--$j]; //#41654
    $_[_8] = _7; //#41654
    for (var _9 = 1; _9 <= 9; _9 += 1) { //#41665
        $_.textgrp = _9; //#41662
        var _D = $get($_.textopts, $_.textgrp - 1); //#41663
        $k[$j++] = $_.textgrp; //#41664
        $k[$j++] = _D; //#41664
        bwipp_validatetext(); //#41664
        var _E = $k[--$j]; //#41664
        if (!_E) { //#41664
            bwipp_raiseerror(); //#41664
        } //#41664
    } //#41664
    if (($_.inkspread < -1) || ($_.inkspread > 1)) { //#41669
        $k[$j++] = "bwipp.renlinearBadInkspread#41668"; //#41668
        $k[$j++] = "inkspread must be from -1 to 1"; //#41668
        bwipp_raiseerror(); //#41668
    } //#41668
    if (($_.borderleft < -1) || ($_.borderleft > 50)) { //#41673
        $k[$j++] = "bwipp.renlinearBadBorderleft#41672"; //#41672
        $k[$j++] = "borderleft must be from -1 to 50"; //#41672
        bwipp_raiseerror(); //#41672
    } //#41672
    if (($_.borderright < -1) || ($_.borderright > 50)) { //#41677
        $k[$j++] = "bwipp.renlinearBadBorderright#41676"; //#41676
        $k[$j++] = "borderright must be from -1 to 50"; //#41676
        bwipp_raiseerror(); //#41676
    } //#41676
    if (($_.bordertop < -1) || ($_.bordertop > 50)) { //#41681
        $k[$j++] = "bwipp.renlinearBadBordertop#41680"; //#41680
        $k[$j++] = "bordertop must be from -1 to 50"; //#41680
        bwipp_raiseerror(); //#41680
    } //#41680
    if (($_.borderbottom < -1) || ($_.borderbottom > 50)) { //#41685
        $k[$j++] = "bwipp.renlinearBadBorderbottom#41684"; //#41684
        $k[$j++] = "borderbottom must be from -1 to 50"; //#41684
        bwipp_raiseerror(); //#41684
    } //#41684
    if (($_.borderwidth < 0) || ($_.borderwidth > 10)) { //#41689
        $k[$j++] = "bwipp.renlinearBadBorderwidth#41688"; //#41688
        $k[$j++] = "borderwidth must be from 0 to 10"; //#41688
        bwipp_raiseerror(); //#41688
    } //#41688
    if (($_.barratio < 0.1) || ($_.barratio > 5)) { //#41693
        $k[$j++] = "bwipp.renlinearBadBarratio#41692"; //#41692
        $k[$j++] = "barratio must be from 0.1 to 5"; //#41692
        bwipp_raiseerror(); //#41692
    } //#41692
    if (($_.spaceratio < 0.1) || ($_.spaceratio > 5)) { //#41697
        $k[$j++] = "bwipp.renlinearBadSpaceratio#41696"; //#41696
        $k[$j++] = "spaceratio must be from 0.1 to 5"; //#41696
        bwipp_raiseerror(); //#41696
    } //#41696
    if ($_.width != 0) { //#41701
        if (($_.width < 0.01) || ($_.width > 20)) { //#41701
            $k[$j++] = "bwipp.renlinearBadWidth#41700"; //#41700
            $k[$j++] = "width must be 0 or from 0.01 to 20"; //#41700
            bwipp_raiseerror(); //#41700
        } //#41700
    } //#41700
    if (($_.guardwidth < 0) || ($_.guardwidth > 20)) { //#41705
        $k[$j++] = "bwipp.renlinearBadGuardwidth#41704"; //#41704
        $k[$j++] = "guardwidth must be from 0 to 20"; //#41704
        bwipp_raiseerror(); //#41704
    } //#41704
    if (($_.guardheight < 0) || ($_.guardheight > 20)) { //#41709
        $k[$j++] = "bwipp.renlinearBadGuardheight#41708"; //#41708
        $k[$j++] = "guardheight must be from 0 to 20"; //#41708
        bwipp_raiseerror(); //#41708
    } //#41708
    if (($_.guardleftpos < -50) || ($_.guardleftpos > 150)) { //#41713
        $k[$j++] = "bwipp.renlinearBadGuardleftpos#41712"; //#41712
        $k[$j++] = "guardleftpos must be from -50 to 150"; //#41712
        bwipp_raiseerror(); //#41712
    } //#41712
    if (($_.guardleftypos < -50) || ($_.guardleftypos > 150)) { //#41717
        $k[$j++] = "bwipp.renlinearBadGuardleftypos#41716"; //#41716
        $k[$j++] = "guardleftypos must be from -50 to 150"; //#41716
        bwipp_raiseerror(); //#41716
    } //#41716
    if (($_.guardrightpos < -50) || ($_.guardrightpos > 150)) { //#41721
        $k[$j++] = "bwipp.renlinearBadGuardrightpos#41720"; //#41720
        $k[$j++] = "guardrightpos must be from -50 to 150"; //#41720
        bwipp_raiseerror(); //#41720
    } //#41720
    if (($_.guardrightypos < -50) || ($_.guardrightypos > 150)) { //#41725
        $k[$j++] = "bwipp.renlinearBadGuardrightypos#41724"; //#41724
        $k[$j++] = "guardrightypos must be from -50 to 150"; //#41724
        bwipp_raiseerror(); //#41724
    } //#41724
    if ($_.sbs.length != 0) { //#41732
        var _l = $_.sbs; //#41728
        $k[$j++] = ~~((_l.length + 1) / 2); //#41730
        if (($_.bhs.length < (~~((_l.length + 1) / 2))) || ($_.bbs.length < (~~((_l.length + 1) / 2)))) { //#41730
            $k[$j - 1] = "bwipp.renlinearBadBarHeightArrays#41730"; //#41730
            $k[$j++] = "The bar height and baseline arrays must be at least as long as the number of bars"; //#41730
            bwipp_raiseerror(); //#41730
        } //#41730
        $j--; //#41731
    } //#41731
    $_.bars = $a(~~(($_.sbs.length + 1) / 2)); //#41737
    $_.pixx = 0; //#41738
    $_.pixy = 0; //#41738
    for (var _s = 0, _r = ((~~(($_.sbs.length + 1) / 2)) * 2) - 2; _s <= _r; _s += 1) { //#41757
        $_.i = _s; //#41740
        if (($_.i % 2) == 0) { //#41754
            $_.d = $f($get($_.sbs, $_.i) * $_.barratio - $_.barratio) + 1 //#41742
            if ($get($_.sbs, $_.i) != 0) { //#41751
                $_.h = $get($_.bhs, ~~($_.i / 2)) * 72; //#41744
                $_.c = $f($_.d / 2 + $_.pixx) //#41745
                $_.y = $get($_.bbs, ~~($_.i / 2)) * 72; //#41746
                $_.w = $f($_.d - $_.inkspread) //#41747
                $put($_.bars, ~~($_.i / 2), $a([$_.h, $_.c, $_.y, $_.w])); //#41748
                if ($f($_.h + $_.y) > $_.pixy) { //#41749
                    $_.pixy = $f($_.h + $_.y) //#41749
                } //#41749
            } else { //#41751
                $put($_.bars, ~~($_.i / 2), -1); //#41751
            } //#41751
        } else { //#41754
            $_.d = $f($get($_.sbs, $_.i) * $_.spaceratio - $_.spaceratio) + 1 //#41754
        } //#41754
        $_.pixx = $f($_.pixx + $_.d) //#41756
    } //#41756
    $$.save(); //#41759
    var _1X = $$.currpos(); //#41761
    $$.translate(_1X.x, _1X.y); //#41761
    if ($_.width != 0) { //#41766
        $$.scale(($_.width * 72) / $_.pixx, 1); //#41765
    } //#41765
    $_.tl = $a([-$f($_.borderleft + $_.borderwidth / 2), $f($_.pixy + $_.bordertop + $_.borderwidth / 2)]) //#41778
    $_.tr = $a([$f($_.pixx + $_.borderright + $_.borderwidth / 2), $f($_.pixy + $_.bordertop + $_.borderwidth / 2)]) //#41779
    $_.bl = $a([-$f($_.borderleft + $_.borderwidth / 2), -$f($_.borderbottom + $_.borderwidth / 2)]) //#41780
    $_.br = $a([$f($_.pixx + $_.borderright + $_.borderwidth / 2), -$f($_.borderbottom + $_.borderwidth / 2)]) //#41781
    if ($_.showbearer) { //#41796
        $$.save(); //#41783
        $$.newpath(); //#41784
        $aload($_.bl); //#41785
        var _1x = $k[--$j]; //#41785
        var _1y = $k[--$j]; //#41785
        $$.moveto(_1y, _1x); //#41785
        $aload($_.br); //#41785
        var _20 = $k[--$j]; //#41785
        var _21 = $k[--$j]; //#41785
        $$.lineto(_21, _20); //#41785
        $aload($_.tl); //#41786
        var _23 = $k[--$j]; //#41786
        var _24 = $k[--$j]; //#41786
        $$.moveto(_24, _23); //#41786
        $aload($_.tr); //#41786
        var _26 = $k[--$j]; //#41786
        var _27 = $k[--$j]; //#41786
        $$.lineto(_27, _26); //#41786
        if ($ne($_.bordercolor, "unset")) { //#41787
            $$.setcolor($_.bordercolor); //#41787
        } //#41787
        $$.setlinewidth($f($_.borderwidth - $_.inkspread * 2)) //#41788
        $$.stroke(); //#41788
        $$.restore(); //#41789
    } else { //#41796
        if ($_.showborder) { //#41797
            $$.save(); //#41792
            $$.newpath(); //#41793
            $aload($_.bl); //#41793
            var _2E = $k[--$j]; //#41793
            var _2F = $k[--$j]; //#41793
            $$.moveto(_2F, _2E); //#41793
            var _2J = $a([$_.br, $_.tr, $_.tl]); //#41793
            for (var _2K = 0, _2L = _2J.length; _2K < _2L; _2K++) { //#41793
                $aload($get(_2J, _2K)); //#41793
                var _2N = $k[--$j]; //#41793
                var _2O = $k[--$j]; //#41793
                $$.lineto(_2O, _2N); //#41793
            } //#41793
            $$.closepath(); //#41793
            if ($ne($_.bordercolor, "unset")) { //#41794
                $$.setcolor($_.bordercolor); //#41794
            } //#41794
            $$.setlinewidth($_.borderwidth); //#41795
            $$.stroke(); //#41795
            $$.restore(); //#41796
        } //#41796
    } //#41796
    $$.save(); //#41802
    if ($ne($_.barcolor, "unset")) { //#41804
        $$.setcolor($_.barcolor); //#41804
    } //#41804
    var _2U = $_.bars; //#41805
    for (var _2V = 0, _2W = _2U.length; _2V < _2W; _2V++) { //#41811
        var _2X = $get(_2U, _2V); //#41811
        $k[$j++] = _2X; //#41810
        if (_2X != -1) { //#41809
            var _2Y = $k[--$j]; //#41807
            $aload(_2Y); //#41807
            $$.newpath(); //#41807
            var _2Z = $k[--$j]; //#41807
            $$.setlinewidth(_2Z); //#41807
            var _2a = $k[--$j]; //#41807
            var _2b = $k[--$j]; //#41807
            $$.moveto(_2b, _2a); //#41807
            var _2c = $k[--$j]; //#41807
            $$.rlineto(0, _2c); //#41807
            $$.stroke(); //#41807
        } else { //#41809
            $j--; //#41809
        } //#41809
    } //#41809
    $$.restore(); //#41812
    for (var _2d = 1; _2d <= 9; _2d += 1) { //#41828
        $_.textgrp = _2d; //#41818
        if (($get($get($_.textopts, $_.textgrp - 1), "").length != 0) || ((($_.textgrp == 1) && ($_.txt.length > 0)) && $_.includetext)) { //#41827
            var _2n = $get($_.textopts, $_.textgrp - 1); //#41822
            $put(_2n, "content", $get(_2n, "")); //#41823
            $k[$j++] = _2n; //#41824
            var _2t = "txt"; //#41824
            var _2s = $_.textgrp == 1 ? $_.txt : $a([]); //#41824
            $put(_2n, _2t, _2s); //#41824
            $k[$j++] = $_.pixx; //#41825
            $k[$j++] = $_.pixy; //#41825
            $k[$j++] = $_.textgrp; //#41825
            $r(4, -1); //#41825
            bwipp_rendertext(); //#41825
            var _2y = $k[--$j]; //#41826
            if (!_2y) { //#41826
                $$.restore(); //#41826
                bwipp_raiseerror(); //#41826
            } //#41826
        } //#41826
    } //#41826
    $k[$j++] = $_.pixx; //#41833
    bwipp_renderguards(); //#41833
    $$.restore(); //#41835
    $_ = $__; //#41837
} //bwipp_renlinear

function bwipp_renmatrix() {
    if ($_.bwipjs_rawstack) {
        $_.bwipjs_rawstack.push($k[--$j]);
        return;
    }
    if (!bwipp_renmatrix.globals) {
        var $__ = $_;
        $_ = bwipp_renmatrix.globals = {};
        //#41857
        var _0 = new Map([
            ["offleft", 'offleft'],
            ["left", 'left'],
            ["center", 'center'],
            ["right", 'right'],
            ["offright", 'offright'],
            ["justify", 'justify']
        ]); //#41860
        $_.renmatrix_xalignopts = _0; //#41861
        var _1 = new Map([
            ["above", 'above'],
            ["top", 'top'],
            ["center", 'center'],
            ["bottom", 'bottom'],
            ["below", 'below'],
            ["justify", 'justify']
        ]); //#41864
        $_.renmatrix_yalignopts = _1; //#41865
        var _2 = new Map([
            ["forward", 'forward'],
            ["backward", 'backward'],
            ["upward", 'upward'],
            ["downward", 'downward']
        ]); //#41868
        $_.renmatrix_directionoptions = _2; //#41869
        $_ = $__;
    }
    //#41871
    var $__ = $_; //#41873
    $_ = Object.assign({}, $_, bwipp_renmatrix.globals); //#41873
    $_.width = 1; //#41876
    $_.height = 1; //#41877
    $_.barcolor = "unset"; //#41878
    $_.bordercolor = "unset"; //#41880
    $_.colormap = "unset"; //#41881
    $_.dotty = false; //#41882
    $_.inkspread = null; //#41883
    $_.inkspreadh = null; //#41884
    $_.inkspreadv = null; //#41885
    $_.txt = $a([]); //#41886
    bwipp_inittextoptions(); //#41889
    $_.text1xalign = "unset"; //#41892
    $_.text1yalign = "unset"; //#41893
    $_.includetext = false; //#41895
    $_.showborder = false; //#41896
    $_.borderleft = 0; //#41897
    $_.borderright = 0; //#41898
    $_.bordertop = 0; //#41899
    $_.borderbottom = 0; //#41900
    $_.borderwidth = 0.5; //#41901
    $_.guardwhitespace = false; //#41902
    $_.guardleftpos = 0; //#41903
    $_.guardleftypos = 0; //#41904
    $_.guardrightpos = 0; //#41905
    $_.guardrightypos = 0; //#41906
    $_.guardwidth = 5; //#41907
    $_.guardheight = 7; //#41908
    var _3 = $k[--$j]; //#41910
    $forall(_3, function() { //#41910
        var _4 = $k[--$j]; //#41910
        var _5 = $k[--$j]; //#41910
        $_[_5] = _4; //#41910
    }); //#41910
    $k[$j++] = $_.opt; //#41911
    $del($_, 'opt') //#41911
    $k[$j++] = null; //#41911
    bwipp_processoptions(); //#41911
    $k[$j - 1] = 'textopts'; //#41912
    bwipp_grouptextoptions(); //#41912
    var _7 = $k[--$j]; //#41912
    var _8 = $k[--$j]; //#41912
    $_[_8] = _7; //#41912
    if ($_.inkspread == null) { //#41914
        $_.inkspread = 0; //#41914
    } //#41914
    if ($_.inkspreadh == null) { //#41915
        $_.inkspreadh = $_.inkspread; //#41915
    } //#41915
    if ($_.inkspreadv == null) { //#41916
        $_.inkspreadv = $_.inkspread; //#41916
    } //#41916
    if (!$has($_, 'rowheights')) { //#41921
        $k[$j++] = Infinity; //#41920
        for (var _G = 0, _H = $_.pixy; _G < _H; _G++) { //#41920
            $k[$j++] = 1; //#41920
        } //#41920
        $_.rowheights = $a(); //#41920
    } //#41920
    $_.bufnew = $a($_.pixx * $_.pixy); //#41924
    $_.bufoff = 0; //#41925
    $_.pixoff = 0; //#41926
    var _L = $_.rowheights; //#41927
    for (var _M = 0, _N = _L.length; _M < _N; _M++) { //#41932
        for (var _P = 0, _Q = $get(_L, _M); _P < _Q; _P++) { //#41930
            $puti($_.bufnew, $_.bufoff, $geti($_.pixs, $_.pixoff, $_.pixx)); //#41928
            $_.bufoff = $_.bufoff + $_.pixx; //#41929
        } //#41929
        $_.pixoff = $_.pixoff + $_.pixx; //#41931
    } //#41931
    $_.pixs = $_.bufnew; //#41933
    for (var _c = 1; _c <= 9; _c += 1) { //#41945
        $_.textgrp = _c; //#41942
        var _g = $get($_.textopts, $_.textgrp - 1); //#41943
        $k[$j++] = $_.textgrp; //#41944
        $k[$j++] = _g; //#41944
        bwipp_validatetext(); //#41944
        var _h = $k[--$j]; //#41944
        if (!_h) { //#41944
            bwipp_raiseerror(); //#41944
        } //#41944
    } //#41944
    if (($_.inkspread < -1) || ($_.inkspread > 1)) { //#41949
        $k[$j++] = "bwipp.renmatrixBadInkspread#41948"; //#41948
        $k[$j++] = "inkspread must be from -1 to 1"; //#41948
        bwipp_raiseerror(); //#41948
    } //#41948
    if (($_.inkspreadh < -1) || ($_.inkspreadh > 1)) { //#41953
        $k[$j++] = "bwipp.renmatrixBadInkspreadh#41952"; //#41952
        $k[$j++] = "inkspreadh must be from -1 to 1"; //#41952
        bwipp_raiseerror(); //#41952
    } //#41952
    if (($_.inkspreadv < -1) || ($_.inkspreadv > 1)) { //#41957
        $k[$j++] = "bwipp.renmatrixBadInkspreadv#41956"; //#41956
        $k[$j++] = "inkspreadv must be from -1 to 1"; //#41956
        bwipp_raiseerror(); //#41956
    } //#41956
    if (($_.borderleft < -1) || ($_.borderleft > 50)) { //#41961
        $k[$j++] = "bwipp.renmatrixBadBorderleft#41960"; //#41960
        $k[$j++] = "borderleft must be from -1 to 50"; //#41960
        bwipp_raiseerror(); //#41960
    } //#41960
    if (($_.borderright < -1) || ($_.borderright > 50)) { //#41965
        $k[$j++] = "bwipp.renmatrixBadBorderright#41964"; //#41964
        $k[$j++] = "borderright must be from -1 to 50"; //#41964
        bwipp_raiseerror(); //#41964
    } //#41964
    if (($_.bordertop < -1) || ($_.bordertop > 50)) { //#41969
        $k[$j++] = "bwipp.renmatrixBadBordertop#41968"; //#41968
        $k[$j++] = "bordertop must be from -1 to 50"; //#41968
        bwipp_raiseerror(); //#41968
    } //#41968
    if (($_.borderbottom < -1) || ($_.borderbottom > 50)) { //#41973
        $k[$j++] = "bwipp.renmatrixBadBorderbottom#41972"; //#41972
        $k[$j++] = "borderbottom must be from -1 to 50"; //#41972
        bwipp_raiseerror(); //#41972
    } //#41972
    if (($_.borderwidth < 0) || ($_.borderwidth > 10)) { //#41977
        $k[$j++] = "bwipp.renmatrixBadBorderwidth#41976"; //#41976
        $k[$j++] = "borderwidth must be from 0 to 10"; //#41976
        bwipp_raiseerror(); //#41976
    } //#41976
    if (($_.width < 0.01) || ($_.width > 50)) { //#41981
        $k[$j++] = "bwipp.renmatrixBadWidth#41980"; //#41980
        $k[$j++] = "width must be from 0.01 to 50"; //#41980
        bwipp_raiseerror(); //#41980
    } //#41980
    if (($_.height < 0.01) || ($_.height > 50)) { //#41985
        $k[$j++] = "bwipp.renmatrixBadHeight#41984"; //#41984
        $k[$j++] = "height must be from 0.01 to 50"; //#41984
        bwipp_raiseerror(); //#41984
    } //#41984
    if (($_.pixx <= 0) || ($_.pixy <= 0)) { //#41989
        $k[$j++] = "bwipp.renmatrixBadDimensions#41988"; //#41988
        $k[$j++] = "The symbol dimensions must be positive"; //#41988
        bwipp_raiseerror(); //#41988
    } //#41988
    if ($_.pixs.length < ($_.pixx * $_.pixy)) { //#41993
        $k[$j++] = "bwipp.renmatrixBadPixelData#41992"; //#41992
        $k[$j++] = "The pixel data is shorter than the symbol dimensions require"; //#41992
        bwipp_raiseerror(); //#41992
    } //#41992
    $_.xyget = function() {
        var _18 = $k[--$j]; //#41995
        var _19 = $k[--$j]; //#41995
        $k[$j++] = $get($_.pixs, $f(_19 + _18 * $_.pixx)) //#41995
    }; //#41995
    $_.drawlayerdots = function() {
        $_.pixsorig = $_.pixs; //#41998
        var _1D = $k[--$j]; //#41999
        $_.pixs = _1D; //#41999
        $$.newpath(); //#42001
        for (var _1G = 0, _1F = $_.pixs.length - 1; _1G <= _1F; _1G += 1) { //#42009
            $_.x = _1G % $_.pixx; //#42003
            $_.y = ~~(_1G / $_.pixx); //#42004
            $k[$j++] = $_.x; //#42005
            $k[$j++] = $_.y; //#42005
            $_.xyget(); //#42005
            var _1L = $k[--$j]; //#42005
            if (_1L == 1) { //#42008
                $$.moveto($f($_.x + 0.5), $f($_.pixy - $_.y - 0.5)) //#42006
                $$.arc($f($_.x + 0.5), $f($_.pixy - $_.y - 0.5), $f(0.5 - $_.inkspread), 0, 360, 1) //#42007
            } //#42007
        } //#42007
        $$.fill(); //#42010
        $_.pixs = $_.pixsorig; //#42012
    }; //#42012
    $$.save(); //#42016
    var _1U = $$.currpos(); //#42018
    $$.translate(_1U.x, _1U.y); //#42018
    $_.inkspread = $_.inkspread / 2; //#42020
    $_.inkspreadh = $_.inkspreadh / 2; //#42021
    $_.inkspreadv = $_.inkspreadv / 2; //#42022
    $$.save(); //#42024
    $$.scale(($_.width / $_.pixx) * 72, ($_.height / $_.pixy) * 72); //#42029
    if ($_.showborder) { //#42043
        $_.tl = $a([-$f($_.borderleft + $_.borderwidth / 2), $f($_.pixy + $_.bordertop + $_.borderwidth / 2)]) //#42035
        $_.tr = $a([$f($_.pixx + $_.borderright + $_.borderwidth / 2), $f($_.pixy + $_.bordertop + $_.borderwidth / 2)]) //#42036
        $_.bl = $a([-$f($_.borderleft + $_.borderwidth / 2), -$f($_.borderbottom + $_.borderwidth / 2)]) //#42037
        $_.br = $a([$f($_.pixx + $_.borderright + $_.borderwidth / 2), -$f($_.borderbottom + $_.borderwidth / 2)]) //#42038
    } else { //#42043
        $_.tl = $a([$f(-$_.borderleft + $_.inkspread), $f($_.pixy + $_.bordertop - $_.inkspread)]) //#42040
        $_.tr = $a([$f($_.pixx + $_.borderright - $_.inkspread), $f($_.pixy + $_.bordertop - $_.inkspread)]) //#42041
        $_.bl = $a([$f(-$_.borderleft + $_.inkspread), $f(-$_.borderbottom + $_.inkspread)]) //#42042
        $_.br = $a([$f($_.pixx + $_.borderright - $_.inkspread), $f(-$_.borderbottom + $_.inkspread)]) //#42043
    } //#42043
    if ($_.showborder) { //#42057
        $$.save(); //#42052
        $$.newpath(); //#42053
        $aload($_.bl); //#42053
        var _2J = $k[--$j]; //#42053
        var _2K = $k[--$j]; //#42053
        $$.moveto(_2K, _2J); //#42053
        var _2O = $a([$_.br, $_.tr, $_.tl]); //#42053
        for (var _2P = 0, _2Q = _2O.length; _2P < _2Q; _2P++) { //#42053
            $aload($get(_2O, _2P)); //#42053
            var _2S = $k[--$j]; //#42053
            var _2T = $k[--$j]; //#42053
            $$.lineto(_2T, _2S); //#42053
        } //#42053
        $$.closepath(); //#42053
        if ($ne($_.bordercolor, "unset")) { //#42054
            $$.setcolor($_.bordercolor); //#42054
        } //#42054
        $$.setlinewidth($f($_.borderwidth - $_.inkspread * 2)) //#42055
        $$.stroke(); //#42055
        $$.restore(); //#42056
    } //#42056
    if ($eq($_.colormap, "unset")) { //#42062
        $_.colormap = new Map([
            [1, $_.barcolor]
        ]); //#42061
    } //#42061
    var _2a = $_.colormap; //#42067
    for (var _2f = _2a.size, _2e = _2a.keys(), _2d = 0; _2d < _2f; _2d++) { //#42073
        var _2b = _2e.next().value; //#42073
        var _2c = _2a.get(_2b); //#42073
        $k[$j++] = _2b; //#42068
        $k[$j++] = _2c; //#42068
        if ($ne(_2c, "unset")) { //#42068
            var _2g = $k[--$j]; //#42068
            $$.setcolor(_2g); //#42068
        } else { //#42068
            $j--; //#42068
        } //#42068
        var _2h = $k[--$j]; //#42069
        $_.key = _2h; //#42069
        var _2o = []; //#42070
        var _2i = $_.pixs; //#42071
        for (var _2j = 0, _2k = _2i.length; _2j < _2k; _2j++) { //#42071
            _2o[_2j] = $eq($get(_2i, _2j), $_.key) ? 1 : 0; //#42071
        } //#42071
        _2o = $a(_2o); //#42071
        $k[$j++] = _2o; //#42072
        if ($_.dotty) { //#42072
            $_.drawlayerdots(); //#42072
        } else { //#42072
            var _2q = $k[--$j]; //#42072
            $$.drawlayer(_2q, $_.pixx, $_.pixy, $_.inkspreadh, $_.inkspreadv); //#42072
        } //#42072
    } //#42072
    $$.restore(); //#42075
    for (var _2r = 1; _2r <= 9; _2r += 1) { //#42091
        $_.textgrp = _2r; //#42081
        if (($get($get($_.textopts, $_.textgrp - 1), "").length != 0) || ((($_.textgrp == 1) && ($_.txt.length > 0)) && $_.includetext)) { //#42090
            var _31 = $get($_.textopts, $_.textgrp - 1); //#42085
            $put(_31, "txt", $_.txt); //#42086
            $put(_31, "content", $get(_31, "")); //#42087
            $k[$j++] = $_.width * 72; //#42088
            $k[$j++] = $_.height * 72; //#42088
            $k[$j++] = $_.textgrp; //#42088
            $k[$j++] = _31; //#42088
            bwipp_rendertext(); //#42088
            var _37 = $k[--$j]; //#42089
            if (!_37) { //#42089
                $$.restore(); //#42089
                bwipp_raiseerror(); //#42089
            } //#42089
        } //#42089
    } //#42089
    $k[$j++] = $_.width * 72; //#42096
    bwipp_renderguards(); //#42096
    $$.restore(); //#42098
    $_ = $__; //#42100
} //bwipp_renmatrix

function bwipp_validatetext() {
    if (!bwipp_validatetext.globals) {
        var $__ = $_;
        $_ = bwipp_validatetext.globals = {};
        //#42222
        var _0 = new Map([
            ["offleft", 'offleft'],
            ["left", 'left'],
            ["center", 'center'],
            ["right", 'right'],
            ["offright", 'offright'],
            ["justify", 'justify']
        ]); //#42226
        $_.validatetext_xalignopts = _0; //#42227
        var _1 = new Map([
            ["above", 'above'],
            ["top", 'top'],
            ["center", 'center'],
            ["bottom", 'bottom'],
            ["below", 'below'],
            ["justify", 'justify']
        ]); //#42230
        $_.validatetext_yalignopts = _1; //#42231
        var _2 = new Map([
            ["forward", 'forward'],
            ["backward", 'backward'],
            ["upward", 'upward'],
            ["downward", 'downward']
        ]); //#42234
        $_.validatetext_directionoptions = _2; //#42235
        $_ = $__;
    }
    //#42242
    var $__ = $_; //#42244
    $_ = Object.assign({}, $_, bwipp_validatetext.globals); //#42244
    var _3 = $k[--$j]; //#42246
    $_.td = _3; //#42246
    var _4 = $k[--$j]; //#42247
    $_.grp = _4; //#42247
    $k[$j++] = 'pfx'; //#42254
    if ($_.grp == 1) { //#42252
        $k[$j++] = "text"; //#42250
    } else { //#42252
        if ($_.grp == 2) { //#42252
            $k[$j++] = "extratext"; //#42251
        } else { //#42252
            var _7 = $s(5); //#42252
            $puti(_7, 0, "text"); //#42252
            $put(_7, 4, $_.grp + 48); //#42252
            $k[$j++] = _7; //#42252
        } //#42252
    } //#42252
    var _9 = $k[--$j]; //#42254
    var _A = $k[--$j]; //#42254
    $_[_A] = _9; //#42254
    $_.mkerr = function() {
        var _B = $k[--$j]; //#42257
        $_.msgtail = _B; //#42257
        var _C = $k[--$j]; //#42258
        $_.prop = $cvs($s(128), _C); //#42258
        var _G = $s(($_.pfx.length + 9) + $_.prop.length); //#42259
        $puti(_G, 0, "bwipp."); //#42260
        $puti(_G, 6, $_.pfx); //#42261
        $puti(_G, $_.pfx.length + 6, "Bad"); //#42262
        $puti(_G, $_.pfx.length + 9, $_.prop); //#42263
        var _O = $s(($_.pfx.length + $_.prop.length) + $_.msgtail.length); //#42264
        $puti(_O, 0, $_.pfx); //#42265
        $puti(_O, $_.pfx.length, $_.prop); //#42266
        $puti(_O, $_.pfx.length + $_.prop.length, $_.msgtail); //#42267
        $k[$j++] = _G; //#42267
        $k[$j++] = _O; //#42267
    }; //#42267
    for (var _V = 0; _V < 1; _V++) { //#42310
        var _X = $get($_.td, "xalign"); //#42272
        $k[$j++] = _X; //#42276
        if ($ne(_X, "unset")) { //#42276
            var _Y = $k[--$j]; //#42273
            if (!$has($_.validatetext_xalignopts, _Y)) { //#42275
                $k[$j++] = 'xalign'; //#42274
                $k[$j++] = " must be offleft, left, center, right, offright or justify"; //#42274
                $_.mkerr(); //#42274
                $k[$j++] = false; //#42274
                break; //#42274
            } //#42274
        } else { //#42276
            $j--; //#42276
        } //#42276
        var _b = $get($_.td, "yalign"); //#42278
        $k[$j++] = _b; //#42282
        if ($ne(_b, "unset")) { //#42282
            var _c = $k[--$j]; //#42279
            if (!$has($_.validatetext_yalignopts, _c)) { //#42281
                $k[$j++] = 'yalign'; //#42280
                $k[$j++] = " must be above, top, center, bottom, below or justify"; //#42280
                $_.mkerr(); //#42280
                $k[$j++] = false; //#42280
                break; //#42280
            } //#42280
        } else { //#42282
            $j--; //#42282
        } //#42282
        if (!$has($_.validatetext_directionoptions, $get($_.td, "direction"))) { //#42286
            $k[$j++] = 'direction'; //#42285
            $k[$j++] = " must be forward, backward, upward or downward"; //#42285
            $_.mkerr(); //#42285
            $k[$j++] = false; //#42285
            break; //#42285
        } //#42285
        var _i = $get($_.td, "size"); //#42288
        if ((_i <= 0) || (_i >= 25)) { //#42290
            $k[$j++] = 'size'; //#42289
            $k[$j++] = " must be greater than zero and less than 25"; //#42289
            $_.mkerr(); //#42289
            $k[$j++] = false; //#42289
            break; //#42289
        } //#42289
        var _k = $get($_.td, "xoffset"); //#42292
        if ((_k < -150) || (_k > 150)) { //#42294
            $k[$j++] = 'xoffset'; //#42293
            $k[$j++] = " must be from -150 to 150"; //#42293
            $_.mkerr(); //#42293
            $k[$j++] = false; //#42293
            break; //#42293
        } //#42293
        var _m = $get($_.td, "yoffset"); //#42296
        if ((_m < -150) || (_m > 150)) { //#42298
            $k[$j++] = 'yoffset'; //#42297
            $k[$j++] = " must be from -150 to 150"; //#42297
            $_.mkerr(); //#42297
            $k[$j++] = false; //#42297
            break; //#42297
        } //#42297
        var _o = $get($_.td, "gaps"); //#42300
        if ((_o < -20) || (_o > 20)) { //#42302
            $k[$j++] = 'gaps'; //#42301
            $k[$j++] = " must be from -20 to 20"; //#42301
            $_.mkerr(); //#42301
            $k[$j++] = false; //#42301
            break; //#42301
        } //#42301
        var _q = $get($_.td, "linegaps"); //#42304
        if ((_q < 0) || (_q > 20)) { //#42306
            $k[$j++] = 'linegaps'; //#42305
            $k[$j++] = " must be from 0 to 20"; //#42305
            $_.mkerr(); //#42305
            $k[$j++] = false; //#42305
            break; //#42305
        } //#42305
        $k[$j++] = true; //#42308
        break; //#42308
    } //#42308
    $_ = $__; //#42312
} //bwipp_validatetext
// bwip-js/barcode-ftr.js
//
// This code is injected below the cross-compiled barcode.js.

// `encoder` is one of the bwipp_ functions

function bwipp_encode(bwipjs, encoder, text, opts, dontdraw) {
    if (typeof text !== 'string') {
        throw new Error('bwipp.typeError: barcode text not a string (' +
            text + ')');
    }
    opts = opts || {};
    if (typeof opts === 'string') {
        var tmp = opts.split(' ');
        opts = {};
        for (var i = 0; i < tmp.length; i++) {
            if (!tmp[i]) {
                continue;
            }
            var eq = tmp[i].indexOf('=');
            if (eq == -1) {
                if (tmp[i][0] == '!') {
                    // boolean !name
                    opts[tmp[i].substr(1)] = false;
                } else {
                    // boolean name
                    opts[tmp[i]] = true;
                }
            } else {
                opts[tmp[i].substr(0, eq)] = tmp[i].substr(eq + 1);
            }
        }
    } else if (typeof opts !== 'object' || opts.constructor !== Object) {
        throw new Error('bwipp.typeError: options not an object');
    }

    // Convert utf-16 to utf-8 unless caller has pre-encoded the text.
    if (opts.binarytext) {
        // No 16-bit chars allowed.
        if (/[\u0100-\uffff]/.test(text)) {
            throw new Error('bwip-js: 16-bit chars not allowed with binarytext');
        }
    } else if (/[\u0080-\uffff]/.test(text)) {
        text = unescape(encodeURIComponent(text));
    }

    if (opts.dontdraw) {
        dontdraw = true;
    }

    // Convert opts to a Map
    var map = new Map;
    for (var id in opts) {
        if (opts.hasOwnProperty(id)) {
            map.set(id, opts[id]);
        }
    }

    // Set up the initial postscript state and invoke the encoder
    $$ = bwipjs;
    $k = [text, map];
    $j = 2;
    $_ = {
        bwipjs_rawstack: dontdraw ? [] : false
    };

    encoder();

    if ($_.bwipjs_rawstack) {
        return $_.bwipjs_rawstack;
    }

    return true;
}

function bwipp_lookup(symbol) {
    if (!symbol) {
        throw new Error("bwipp.undefinedEncoder: bcid is not defined");
    }
    switch (symbol.replace(/-/g, "_")) {
        case "code128":
                    return bwipp_code128;
        case "datamatrix":
                    return bwipp_datamatrix;
        case "ean13":
                    return bwipp_ean13;
        case "ean2":
                    return bwipp_ean2;
        case "ean5":
                    return bwipp_ean5;
        default:
            throw new Error("bwipp.unknownEncoder: no encoder for " + symbol);
    }
}

var bwipp_symlist = [
    {
        bcid: "code128",
        desc: "Code 128",
        text: "Count01234567!",
        opts: "includetext"
    },
    {
        bcid: "ean13",
        desc: "EAN-13",
        text: "9520123456788",
        opts: "includetext guardwhitespace"
    },
    {
        bcid: "datamatrix",
        desc: "Data Matrix",
        text: "This is Data Matrix!",
        opts: ""
    }
];

var bwipp_auspost; // trimmed: not bundled
var bwipp_azteccode; // trimmed: not bundled
var bwipp_azteccodecompact; // trimmed: not bundled
var bwipp_aztecrune; // trimmed: not bundled
var bwipp_bc412; // trimmed: not bundled
var bwipp_channelcode; // trimmed: not bundled
var bwipp_codablockf; // trimmed: not bundled
var bwipp_code11; // trimmed: not bundled
var bwipp_code16k; // trimmed: not bundled
var bwipp_code2of5; // trimmed: not bundled
var bwipp_code32; // trimmed: not bundled
var bwipp_code39; // trimmed: not bundled
var bwipp_code39ext; // trimmed: not bundled
var bwipp_code49; // trimmed: not bundled
var bwipp_code93; // trimmed: not bundled
var bwipp_code93ext; // trimmed: not bundled
var bwipp_codeone; // trimmed: not bundled
var bwipp_coop2of5; // trimmed: not bundled
var bwipp_d3aqr; // trimmed: not bundled
var bwipp_daft; // trimmed: not bundled
var bwipp_databarexpanded; // trimmed: not bundled
var bwipp_databarexpandedcomposite; // trimmed: not bundled
var bwipp_databarexpandedstacked; // trimmed: not bundled
var bwipp_databarexpandedstackedcomposite; // trimmed: not bundled
var bwipp_databarlimited; // trimmed: not bundled
var bwipp_databarlimitedcomposite; // trimmed: not bundled
var bwipp_databaromni; // trimmed: not bundled
var bwipp_databaromnicomposite; // trimmed: not bundled
var bwipp_databarstacked; // trimmed: not bundled
var bwipp_databarstackedcomposite; // trimmed: not bundled
var bwipp_databarstackedomni; // trimmed: not bundled
var bwipp_databarstackedomnicomposite; // trimmed: not bundled
var bwipp_databartruncated; // trimmed: not bundled
var bwipp_databartruncatedcomposite; // trimmed: not bundled
var bwipp_datalogic2of5; // trimmed: not bundled
var bwipp_datamatrixrectangular; // trimmed: not bundled
var bwipp_datamatrixrectangularextension; // trimmed: not bundled
var bwipp_dotcode; // trimmed: not bundled
var bwipp_ean13composite; // trimmed: not bundled
var bwipp_ean14; // trimmed: not bundled
var bwipp_ean8; // trimmed: not bundled
var bwipp_ean8composite; // trimmed: not bundled
var bwipp_flattermarken; // trimmed: not bundled
var bwipp_gs1_128; // trimmed: not bundled
var bwipp_gs1_128composite; // trimmed: not bundled
var bwipp_gs1_cc; // trimmed: not bundled
var bwipp_gs1datamatrix; // trimmed: not bundled
var bwipp_gs1datamatrixrectangular; // trimmed: not bundled
var bwipp_gs1dldatamatrix; // trimmed: not bundled
var bwipp_gs1dlqrcode; // trimmed: not bundled
var bwipp_gs1dotcode; // trimmed: not bundled
var bwipp_gs1northamericancoupon; // trimmed: not bundled
var bwipp_gs1qrcode; // trimmed: not bundled
var bwipp_hanxin; // trimmed: not bundled
var bwipp_hibcazteccode; // trimmed: not bundled
var bwipp_hibccodablockf; // trimmed: not bundled
var bwipp_hibccode128; // trimmed: not bundled
var bwipp_hibccode39; // trimmed: not bundled
var bwipp_hibcdatamatrix; // trimmed: not bundled
var bwipp_hibcdatamatrixrectangular; // trimmed: not bundled
var bwipp_hibcmicropdf417; // trimmed: not bundled
var bwipp_hibcpdf417; // trimmed: not bundled
var bwipp_hibcqrcode; // trimmed: not bundled
var bwipp_iata2of5; // trimmed: not bundled
var bwipp_identcode; // trimmed: not bundled
var bwipp_industrial2of5; // trimmed: not bundled
var bwipp_interleaved2of5; // trimmed: not bundled
var bwipp_isbn; // trimmed: not bundled
var bwipp_ismn; // trimmed: not bundled
var bwipp_issn; // trimmed: not bundled
var bwipp_itf14; // trimmed: not bundled
var bwipp_japanpost; // trimmed: not bundled
var bwipp_kix; // trimmed: not bundled
var bwipp_leitcode; // trimmed: not bundled
var bwipp_mailmark; // trimmed: not bundled
var bwipp_mands; // trimmed: not bundled
var bwipp_matrix2of5; // trimmed: not bundled
var bwipp_maxicode; // trimmed: not bundled
var bwipp_micropdf417; // trimmed: not bundled
var bwipp_microqrcode; // trimmed: not bundled
var bwipp_msi; // trimmed: not bundled
var bwipp_onecode; // trimmed: not bundled
var bwipp_pdf417; // trimmed: not bundled
var bwipp_pdf417compact; // trimmed: not bundled
var bwipp_pharmacode; // trimmed: not bundled
var bwipp_pharmacode2; // trimmed: not bundled
var bwipp_planet; // trimmed: not bundled
var bwipp_plessey; // trimmed: not bundled
var bwipp_posicode; // trimmed: not bundled
var bwipp_postnet; // trimmed: not bundled
var bwipp_pzn; // trimmed: not bundled
var bwipp_qrcode; // trimmed: not bundled
var bwipp_rationalizedCodabar; // trimmed: not bundled
var bwipp_raw; // trimmed: not bundled
var bwipp_rectangularmicroqrcode; // trimmed: not bundled
var bwipp_royalmail; // trimmed: not bundled
var bwipp_sscc18; // trimmed: not bundled
var bwipp_swissqrcode; // trimmed: not bundled
var bwipp_symbol; // trimmed: not bundled
var bwipp_telepen; // trimmed: not bundled
var bwipp_telepennumeric; // trimmed: not bundled
var bwipp_ultracode; // trimmed: not bundled
var bwipp_upca; // trimmed: not bundled
var bwipp_upcacomposite; // trimmed: not bundled
var bwipp_upce; // trimmed: not bundled
var bwipp_upcecomposite; // trimmed: not bundled

var BWIPP_VERSION = '2026-05-28';
export { bwipp_auspost,bwipp_azteccode,bwipp_azteccodecompact,bwipp_aztecrune,bwipp_bc412,bwipp_channelcode,bwipp_codablockf,bwipp_code11,bwipp_code128,bwipp_code16k,bwipp_code2of5,bwipp_code32,bwipp_code39,bwipp_code39ext,bwipp_code49,bwipp_code93,bwipp_code93ext,bwipp_codeone,bwipp_coop2of5,bwipp_d3aqr,bwipp_daft,bwipp_databarexpanded,bwipp_databarexpandedcomposite,bwipp_databarexpandedstacked,bwipp_databarexpandedstackedcomposite,bwipp_databarlimited,bwipp_databarlimitedcomposite,bwipp_databaromni,bwipp_databaromnicomposite,bwipp_databarstacked,bwipp_databarstackedcomposite,bwipp_databarstackedomni,bwipp_databarstackedomnicomposite,bwipp_databartruncated,bwipp_databartruncatedcomposite,bwipp_datalogic2of5,bwipp_datamatrix,bwipp_datamatrixrectangular,bwipp_datamatrixrectangularextension,bwipp_dotcode,bwipp_ean13,bwipp_ean13composite,bwipp_ean14,bwipp_ean2,bwipp_ean5,bwipp_ean8,bwipp_ean8composite,bwipp_flattermarken,bwipp_gs1_128,bwipp_gs1_128composite,bwipp_gs1_cc,bwipp_gs1datamatrix,bwipp_gs1datamatrixrectangular,bwipp_gs1dldatamatrix,bwipp_gs1dlqrcode,bwipp_gs1dotcode,bwipp_gs1northamericancoupon,bwipp_gs1qrcode,bwipp_hanxin,bwipp_hibcazteccode,bwipp_hibccodablockf,bwipp_hibccode128,bwipp_hibccode39,bwipp_hibcdatamatrix,bwipp_hibcdatamatrixrectangular,bwipp_hibcmicropdf417,bwipp_hibcpdf417,bwipp_hibcqrcode,bwipp_iata2of5,bwipp_identcode,bwipp_industrial2of5,bwipp_interleaved2of5,bwipp_isbn,bwipp_ismn,bwipp_issn,bwipp_itf14,bwipp_japanpost,bwipp_kix,bwipp_leitcode,bwipp_mailmark,bwipp_mands,bwipp_matrix2of5,bwipp_maxicode,bwipp_micropdf417,bwipp_microqrcode,bwipp_msi,bwipp_onecode,bwipp_pdf417,bwipp_pdf417compact,bwipp_pharmacode,bwipp_pharmacode2,bwipp_planet,bwipp_plessey,bwipp_posicode,bwipp_postnet,bwipp_pzn,bwipp_qrcode,bwipp_rationalizedCodabar,bwipp_raw,bwipp_rectangularmicroqrcode,bwipp_royalmail,bwipp_sscc18,bwipp_swissqrcode,bwipp_symbol,bwipp_telepen,bwipp_telepennumeric,bwipp_ultracode,bwipp_upca,bwipp_upcacomposite,bwipp_upce,bwipp_upcecomposite,bwipp_lookup,bwipp_symlist,bwipp_encode,BWIPP_VERSION };
