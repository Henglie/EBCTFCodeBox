var capstone$1 = (()=>{
    var _scriptDir = import.meta.url;
    return async function(moduleArg = {}) {
        var Module = moduleArg;
        var readyPromiseResolve, readyPromiseReject;
        Module["ready"] = new Promise((resolve, reject)=>{
            readyPromiseResolve = resolve;
            readyPromiseReject = reject;
        });
        var moduleOverrides = Object.assign({}, Module);
        var ENVIRONMENT_IS_WEB = typeof window == "object";
        var ENVIRONMENT_IS_WORKER = typeof importScripts == "function";
        var ENVIRONMENT_IS_NODE = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string";
        var scriptDirectory = "";
        function locateFile(path) {
            if (Module["locateFile"]) {
                return Module["locateFile"](path, scriptDirectory);
            }
            return scriptDirectory + path;
        }
        var read_, readAsync, readBinary;
        if (ENVIRONMENT_IS_NODE) {
            const { createRequire: createRequire } = await import('module');
            /** @suppress{duplicate} */ var require = createRequire(import.meta.url);
            var fs = require("fs");
            var nodePath = require("path");
            if (ENVIRONMENT_IS_WORKER) {
                scriptDirectory = nodePath.dirname(scriptDirectory) + "/";
            } else {
                scriptDirectory = require("url").fileURLToPath(new URL("./", import.meta.url));
            }
            read_ = (filename, binary)=>{
                filename = isFileURI(filename) ? new URL(filename) : nodePath.normalize(filename);
                return fs.readFileSync(filename, binary ? undefined : "utf8");
            };
            readBinary = (filename)=>{
                var ret = read_(filename, true);
                if (!ret.buffer) {
                    ret = new Uint8Array(ret);
                }
                return ret;
            };
            readAsync = (filename, onload, onerror, binary = true)=>{
                filename = isFileURI(filename) ? new URL(filename) : nodePath.normalize(filename);
                fs.readFile(filename, binary ? undefined : "utf8", (err, data)=>{
                    if (err) onerror(err);
                    else onload(binary ? data.buffer : data);
                });
            };
            if (!Module["thisProgram"] && process.argv.length > 1) {
                process.argv[1].replace(/\\/g, "/");
            }
            process.argv.slice(2);
            Module["inspect"] = ()=>"[Emscripten Module object]";
        } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
            if (ENVIRONMENT_IS_WORKER) {
                scriptDirectory = self.location.href;
            } else if (typeof document != "undefined" && document.currentScript) {
                scriptDirectory = document.currentScript.src;
            }
            if (_scriptDir) {
                scriptDirectory = _scriptDir;
            }
            if (scriptDirectory.indexOf("blob:") !== 0) {
                scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1);
            } else {
                scriptDirectory = "";
            }
            {
                read_ = (url)=>{
                    var xhr = new XMLHttpRequest;
                    xhr.open("GET", url, false);
                    xhr.send(null);
                    return xhr.responseText;
                };
                if (ENVIRONMENT_IS_WORKER) {
                    readBinary = (url)=>{
                        var xhr = new XMLHttpRequest;
                        xhr.open("GET", url, false);
                        xhr.responseType = "arraybuffer";
                        xhr.send(null);
                        return new Uint8Array(/** @type{!ArrayBuffer} */ xhr.response);
                    };
                }
                readAsync = (url, onload, onerror)=>{
                    var xhr = new XMLHttpRequest;
                    xhr.open("GET", url, true);
                    xhr.responseType = "arraybuffer";
                    xhr.onload = ()=>{
                        if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                            onload(xhr.response);
                            return;
                        }
                        onerror();
                    };
                    xhr.onerror = onerror;
                    xhr.send(null);
                };
            }
        } else ;
        Module["print"] || console.log.bind(console);
        var err = Module["printErr"] || console.error.bind(console);
        Object.assign(Module, moduleOverrides);
        moduleOverrides = null;
        if (Module["arguments"]) Module["arguments"];
        if (Module["thisProgram"]) Module["thisProgram"];
        if (Module["quit"]) Module["quit"];
        var wasmBinary;
        if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
        Module["noExitRuntime"] || true;
        if (typeof WebAssembly != "object") {
            abort("no native wasm support detected");
        }
        var wasmMemory;
        var ABORT = false;
        var /** @type {!Int8Array} */ HEAP8, /** @type {!Uint8Array} */ HEAPU8, /** @type {!Int16Array} */ HEAP16, /** @type {!Int32Array} */ HEAP32, /** @type {!Uint32Array} */ HEAPU32, /** @type {!Float32Array} */ HEAPF32, /* BigInt64Array type is not correctly defined in closure
/** not-@type {!BigInt64Array} */ HEAP64, /** @type {!Float64Array} */ HEAPF64;
        function updateMemoryViews() {
            var b = wasmMemory.buffer;
            Module["HEAP8"] = HEAP8 = new Int8Array(b);
            Module["HEAP16"] = HEAP16 = new Int16Array(b);
            Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
            Module["HEAPU16"] = new Uint16Array(b);
            Module["HEAP32"] = HEAP32 = new Int32Array(b);
            Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
            Module["HEAPF32"] = HEAPF32 = new Float32Array(b);
            Module["HEAPF64"] = HEAPF64 = new Float64Array(b);
            Module["HEAP64"] = HEAP64 = new BigInt64Array(b);
            Module["HEAPU64"] = new BigUint64Array(b);
        }
        var __ATPRERUN__ = [];
        var __ATINIT__ = [];
        var __ATPOSTRUN__ = [];
        function preRun() {
            if (Module["preRun"]) {
                if (typeof Module["preRun"] == "function") Module["preRun"] = [
                    Module["preRun"]
                ];
                while(Module["preRun"].length){
                    addOnPreRun(Module["preRun"].shift());
                }
            }
            callRuntimeCallbacks(__ATPRERUN__);
        }
        function initRuntime() {
            callRuntimeCallbacks(__ATINIT__);
        }
        function postRun() {
            if (Module["postRun"]) {
                if (typeof Module["postRun"] == "function") Module["postRun"] = [
                    Module["postRun"]
                ];
                while(Module["postRun"].length){
                    addOnPostRun(Module["postRun"].shift());
                }
            }
            callRuntimeCallbacks(__ATPOSTRUN__);
        }
        function addOnPreRun(cb) {
            __ATPRERUN__.unshift(cb);
        }
        function addOnInit(cb) {
            __ATINIT__.unshift(cb);
        }
        function addOnPostRun(cb) {
            __ATPOSTRUN__.unshift(cb);
        }
        var runDependencies = 0;
        var dependenciesFulfilled = null;
        function addRunDependency(id) {
            runDependencies++;
            if (Module["monitorRunDependencies"]) {
                Module["monitorRunDependencies"](runDependencies);
            }
        }
        function removeRunDependency(id) {
            runDependencies--;
            if (Module["monitorRunDependencies"]) {
                Module["monitorRunDependencies"](runDependencies);
            }
            if (runDependencies == 0) {
                if (dependenciesFulfilled) {
                    var callback = dependenciesFulfilled;
                    dependenciesFulfilled = null;
                    callback();
                }
            }
        }
        /** @param {string|number=} what */ function abort(what) {
            if (Module["onAbort"]) {
                Module["onAbort"](what);
            }
            what = "Aborted(" + what + ")";
            err(what);
            ABORT = true;
            what += ". Build with -sASSERTIONS for more info.";
            /** @suppress {checkTypes} */ var e = new WebAssembly.RuntimeError(what);
            readyPromiseReject(e);
            throw e;
        }
        var dataURIPrefix = "data:application/octet-stream;base64,";
        function isDataURI(filename) {
            return filename.startsWith(dataURIPrefix);
        }
        function isFileURI(filename) {
            return filename.startsWith("file://");
        }
        var wasmBinaryFile;
        if (Module["locateFile"]) {
            wasmBinaryFile = "disasm.wasm";
            if (!isDataURI(wasmBinaryFile)) {
                wasmBinaryFile = locateFile(wasmBinaryFile);
            }
        } else {
            wasmBinaryFile = new URL("disasm.wasm", import.meta.url).href;
        }
        function getBinarySync(file) {
            if (file == wasmBinaryFile && wasmBinary) {
                return new Uint8Array(wasmBinary);
            }
            if (readBinary) {
                return readBinary(file);
            }
            throw "both async and sync fetching of the wasm failed";
        }
        function getBinaryPromise(binaryFile) {
            if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER)) {
                if (typeof fetch == "function" && !isFileURI(binaryFile)) {
                    return fetch(binaryFile, {
                        credentials: "same-origin"
                    }).then((response)=>{
                        if (!response["ok"]) {
                            throw "failed to load wasm binary file at '" + binaryFile + "'";
                        }
                        return response["arrayBuffer"]();
                    }).catch(()=>getBinarySync(binaryFile));
                } else if (readAsync) {
                    return new Promise((resolve, reject)=>{
                        readAsync(binaryFile, (response)=>resolve(new Uint8Array(/** @type{!ArrayBuffer} */ response)), reject);
                    });
                }
            }
            return Promise.resolve().then(()=>getBinarySync(binaryFile));
        }
        function instantiateArrayBuffer(binaryFile, imports, receiver) {
            return getBinaryPromise(binaryFile).then((binary)=>WebAssembly.instantiate(binary, imports)).then((instance)=>instance).then(receiver, (reason)=>{
                err(`failed to asynchronously prepare wasm: ${reason}`);
                abort(reason);
            });
        }
        function instantiateAsync(binary, binaryFile, imports, callback) {
            if (!binary && typeof WebAssembly.instantiateStreaming == "function" && !isDataURI(binaryFile) && !isFileURI(binaryFile) && !ENVIRONMENT_IS_NODE && typeof fetch == "function") {
                return fetch(binaryFile, {
                    credentials: "same-origin"
                }).then((response)=>{
                    /** @suppress {checkTypes} */ var result = WebAssembly.instantiateStreaming(response, imports);
                    return result.then(callback, function(reason) {
                        err(`wasm streaming compile failed: ${reason}`);
                        err("falling back to ArrayBuffer instantiation");
                        return instantiateArrayBuffer(binaryFile, imports, callback);
                    });
                });
            }
            return instantiateArrayBuffer(binaryFile, imports, callback);
        }
        function createWasm() {
            var info = {
                "a": wasmImports
            };
            /** @param {WebAssembly.Module=} module*/ function receiveInstance(instance, module) {
                wasmExports = instance.exports;
                wasmMemory = wasmExports["c"];
                updateMemoryViews();
                addOnInit(wasmExports["d"]);
                removeRunDependency();
                return wasmExports;
            }
            addRunDependency();
            function receiveInstantiationResult(result) {
                receiveInstance(result["instance"]);
            }
            if (Module["instantiateWasm"]) {
                try {
                    return Module["instantiateWasm"](info, receiveInstance);
                } catch (e) {
                    err(`Module.instantiateWasm callback failed with error: ${e}`);
                    readyPromiseReject(e);
                }
            }
            instantiateAsync(wasmBinary, wasmBinaryFile, info, receiveInstantiationResult).catch(readyPromiseReject);
            return {};
        }
        var callRuntimeCallbacks = (callbacks)=>{
            while(callbacks.length > 0){
                callbacks.shift()(Module);
            }
        };
        /**
     * @param {number} ptr
     * @param {string} type
     */ function getValue(ptr, type = "i8") {
            if (type.endsWith("*")) type = "*";
            switch(type){
                case "i1":
                    return HEAP8[ptr >> 0];
                case "i8":
                    return HEAP8[ptr >> 0];
                case "i16":
                    return HEAP16[ptr >> 1];
                case "i32":
                    return HEAP32[ptr >> 2];
                case "i64":
                    return HEAP64[ptr >> 3];
                case "float":
                    return HEAPF32[ptr >> 2];
                case "double":
                    return HEAPF64[ptr >> 3];
                case "*":
                    return HEAPU32[ptr >> 2];
                default:
                    abort(`invalid type for getValue: ${type}`);
            }
        }
        var _emscripten_memcpy_js = (dest, src, num)=>HEAPU8.copyWithin(dest, src, src + num);
        var abortOnCannotGrowMemory = (requestedSize)=>{
            abort("OOM");
        };
        var _emscripten_resize_heap = (requestedSize)=>{
            HEAPU8.length;
            abortOnCannotGrowMemory();
        };
        var getCFunc = (ident)=>{
            var func = Module["_" + ident];
            return func;
        };
        var writeArrayToMemory = (array, buffer)=>{
            HEAP8.set(array, buffer);
        };
        var lengthBytesUTF8 = (str)=>{
            var len = 0;
            for(var i = 0; i < str.length; ++i){
                var c = str.charCodeAt(i);
                if (c <= 127) {
                    len++;
                } else if (c <= 2047) {
                    len += 2;
                } else if (c >= 55296 && c <= 57343) {
                    len += 4;
                    ++i;
                } else {
                    len += 3;
                }
            }
            return len;
        };
        var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite)=>{
            if (!(maxBytesToWrite > 0)) return 0;
            var startIdx = outIdx;
            var endIdx = outIdx + maxBytesToWrite - 1;
            for(var i = 0; i < str.length; ++i){
                var u = str.charCodeAt(i);
                if (u >= 55296 && u <= 57343) {
                    var u1 = str.charCodeAt(++i);
                    u = 65536 + ((u & 1023) << 10) | u1 & 1023;
                }
                if (u <= 127) {
                    if (outIdx >= endIdx) break;
                    heap[outIdx++] = u;
                } else if (u <= 2047) {
                    if (outIdx + 1 >= endIdx) break;
                    heap[outIdx++] = 192 | u >> 6;
                    heap[outIdx++] = 128 | u & 63;
                } else if (u <= 65535) {
                    if (outIdx + 2 >= endIdx) break;
                    heap[outIdx++] = 224 | u >> 12;
                    heap[outIdx++] = 128 | u >> 6 & 63;
                    heap[outIdx++] = 128 | u & 63;
                } else {
                    if (outIdx + 3 >= endIdx) break;
                    heap[outIdx++] = 240 | u >> 18;
                    heap[outIdx++] = 128 | u >> 12 & 63;
                    heap[outIdx++] = 128 | u >> 6 & 63;
                    heap[outIdx++] = 128 | u & 63;
                }
            }
            heap[outIdx] = 0;
            return outIdx - startIdx;
        };
        var stringToUTF8 = (str, outPtr, maxBytesToWrite)=>stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
        var stringToUTF8OnStack = (str)=>{
            var size = lengthBytesUTF8(str) + 1;
            var ret = stackAlloc(size);
            stringToUTF8(str, ret, size);
            return ret;
        };
        var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder("utf8") : undefined;
        /**
     * Given a pointer 'idx' to a null-terminated UTF8-encoded string in the given
     * array that contains uint8 values, returns a copy of that string as a
     * Javascript String object.
     * heapOrArray is either a regular array, or a JavaScript typed array view.
     * @param {number} idx
     * @param {number=} maxBytesToRead
     * @return {string}
     */ var UTF8ArrayToString = (heapOrArray, idx, maxBytesToRead)=>{
            var endIdx = idx + maxBytesToRead;
            var endPtr = idx;
            while(heapOrArray[endPtr] && !(endPtr >= endIdx))++endPtr;
            if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
                return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
            }
            var str = "";
            while(idx < endPtr){
                var u0 = heapOrArray[idx++];
                if (!(u0 & 128)) {
                    str += String.fromCharCode(u0);
                    continue;
                }
                var u1 = heapOrArray[idx++] & 63;
                if ((u0 & 224) == 192) {
                    str += String.fromCharCode((u0 & 31) << 6 | u1);
                    continue;
                }
                var u2 = heapOrArray[idx++] & 63;
                if ((u0 & 240) == 224) {
                    u0 = (u0 & 15) << 12 | u1 << 6 | u2;
                } else {
                    u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
                }
                if (u0 < 65536) {
                    str += String.fromCharCode(u0);
                } else {
                    var ch = u0 - 65536;
                    str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
                }
            }
            return str;
        };
        /**
     * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
     * emscripten HEAP, returns a copy of that string as a Javascript String object.
     *
     * @param {number} ptr
     * @param {number=} maxBytesToRead - An optional length that specifies the
     *   maximum number of bytes to read. You can omit this parameter to scan the
     *   string until the first 0 byte. If maxBytesToRead is passed, and the string
     *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
     *   string will cut short at that byte index (i.e. maxBytesToRead will not
     *   produce a string of exact length [ptr, ptr+maxBytesToRead[) N.B. mixing
     *   frequent uses of UTF8ToString() with and without maxBytesToRead may throw
     *   JS JIT optimizations off, so it is worth to consider consistently using one
     * @return {string}
     */ var UTF8ToString = (ptr, maxBytesToRead)=>ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
        /**
     * @param {string|null=} returnType
     * @param {Array=} argTypes
     * @param {Arguments|Array=} args
     * @param {Object=} opts
     */ var ccall = (ident, returnType, argTypes, args, opts)=>{
            var toC = {
                "string": (str)=>{
                    var ret = 0;
                    if (str !== null && str !== undefined && str !== 0) {
                        ret = stringToUTF8OnStack(str);
                    }
                    return ret;
                },
                "array": (arr)=>{
                    var ret = stackAlloc(arr.length);
                    writeArrayToMemory(arr, ret);
                    return ret;
                }
            };
            function convertReturnValue(ret) {
                if (returnType === "string") {
                    return UTF8ToString(ret);
                }
                if (returnType === "boolean") return Boolean(ret);
                return ret;
            }
            var func = getCFunc(ident);
            var cArgs = [];
            var stack = 0;
            if (args) {
                for(var i = 0; i < args.length; i++){
                    var converter = toC[argTypes[i]];
                    if (converter) {
                        if (stack === 0) stack = stackSave();
                        cArgs[i] = converter(args[i]);
                    } else {
                        cArgs[i] = args[i];
                    }
                }
            }
            var ret = func.apply(null, cArgs);
            function onDone(ret) {
                if (stack !== 0) stackRestore(stack);
                return convertReturnValue(ret);
            }
            ret = onDone(ret);
            return ret;
        };
        /**
     * @param {string=} returnType
     * @param {Array=} argTypes
     * @param {Object=} opts
     */ var cwrap = (ident, returnType, argTypes, opts)=>{
            var numericArgs = !argTypes || argTypes.every((type)=>type === "number" || type === "boolean");
            var numericRet = returnType !== "string";
            if (numericRet && numericArgs && !opts) {
                return getCFunc(ident);
            }
            return function() {
                return ccall(ident, returnType, argTypes, arguments);
            };
        };
        var wasmImports = {
            /** @export */ b: _emscripten_memcpy_js,
            /** @export */ a: _emscripten_resize_heap
        };
        var wasmExports = createWasm();
        Module["_cs_version"] = (a0, a1)=>(Module["_cs_version"] = wasmExports["e"])(a0, a1);
        Module["_cs_support"] = (a0)=>(Module["_cs_support"] = wasmExports["f"])(a0);
        Module["_cs_errno"] = (a0)=>(Module["_cs_errno"] = wasmExports["g"])(a0);
        Module["_cs_strerror"] = (a0)=>(Module["_cs_strerror"] = wasmExports["h"])(a0);
        Module["_cs_open"] = (a0, a1, a2)=>(Module["_cs_open"] = wasmExports["i"])(a0, a1, a2);
        Module["_cs_close"] = (a0)=>(Module["_cs_close"] = wasmExports["j"])(a0);
        Module["_cs_option"] = (a0, a1, a2)=>(Module["_cs_option"] = wasmExports["k"])(a0, a1, a2);
        Module["_cs_disasm"] = (a0, a1, a2, a3, a4, a5)=>(Module["_cs_disasm"] = wasmExports["l"])(a0, a1, a2, a3, a4, a5);
        Module["_cs_free"] = (a0, a1)=>(Module["_cs_free"] = wasmExports["m"])(a0, a1);
        Module["_cs_malloc"] = (a0)=>(Module["_cs_malloc"] = wasmExports["n"])(a0);
        Module["_cs_reg_name"] = (a0, a1)=>(Module["_cs_reg_name"] = wasmExports["o"])(a0, a1);
        Module["_cs_insn_name"] = (a0, a1)=>(Module["_cs_insn_name"] = wasmExports["p"])(a0, a1);
        Module["_cs_group_name"] = (a0, a1)=>(Module["_cs_group_name"] = wasmExports["q"])(a0, a1);
        Module["_cs_insn_group"] = (a0, a1, a2)=>(Module["_cs_insn_group"] = wasmExports["r"])(a0, a1, a2);
        Module["_cs_reg_read"] = (a0, a1, a2)=>(Module["_cs_reg_read"] = wasmExports["s"])(a0, a1, a2);
        Module["_cs_reg_write"] = (a0, a1, a2)=>(Module["_cs_reg_write"] = wasmExports["t"])(a0, a1, a2);
        Module["_cs_op_count"] = (a0, a1, a2)=>(Module["_cs_op_count"] = wasmExports["u"])(a0, a1, a2);
        Module["_cs_op_index"] = (a0, a1, a2, a3)=>(Module["_cs_op_index"] = wasmExports["v"])(a0, a1, a2, a3);
        Module["_cs_regs_access"] = (a0, a1, a2, a3, a4, a5)=>(Module["_cs_regs_access"] = wasmExports["w"])(a0, a1, a2, a3, a4, a5);
        Module["_malloc"] = (a0)=>(Module["_malloc"] = wasmExports["x"])(a0);
        Module["_free"] = (a0)=>(Module["_free"] = wasmExports["y"])(a0);
        var stackSave = ()=>(stackSave = wasmExports["z"])();
        var stackRestore = (a0)=>(stackRestore = wasmExports["A"])(a0);
        var stackAlloc = (a0)=>(stackAlloc = wasmExports["B"])(a0);
        Module["ccall"] = ccall;
        Module["cwrap"] = cwrap;
        Module["getValue"] = getValue;
        Module["UTF8ToString"] = UTF8ToString;
        var calledRun;
        dependenciesFulfilled = function runCaller() {
            if (!calledRun) run();
            if (!calledRun) dependenciesFulfilled = runCaller;
        };
        function run() {
            if (runDependencies > 0) {
                return;
            }
            preRun();
            if (runDependencies > 0) {
                return;
            }
            function doRun() {
                if (calledRun) return;
                calledRun = true;
                Module["calledRun"] = true;
                if (ABORT) return;
                initRuntime();
                readyPromiseResolve(Module);
                if (Module["onRuntimeInitialized"]) Module["onRuntimeInitialized"]();
                postRun();
            }
            if (Module["setStatus"]) {
                Module["setStatus"]("Running...");
                setTimeout(function() {
                    setTimeout(function() {
                        Module["setStatus"]("");
                    }, 1);
                    doRun();
                }, 1);
            } else {
                doRun();
            }
        }
        if (Module["preInit"]) {
            if (typeof Module["preInit"] == "function") Module["preInit"] = [
                Module["preInit"]
            ];
            while(Module["preInit"].length > 0){
                Module["preInit"].pop()();
            }
        }
        run();
        return moduleArg.ready;
    };
})();

// AUTO-GENERATED FILE, DO NOT EDIT
/* eslint-disable */ const CS_API_MAJOR = 5;
const CS_API_MINOR = 0;
const CS_ARCH_ARM = 0;
const CS_ARCH_ARM64 = 1;
const CS_ARCH_MIPS = 2;
const CS_ARCH_X86 = 3;
const CS_ARCH_PPC = 4;
const CS_ARCH_SPARC = 5;
const CS_ARCH_SYSZ = 6;
const CS_ARCH_XCORE = 7;
const CS_ARCH_M68K = 8;
const CS_ARCH_TMS320C64X = 9;
const CS_ARCH_M680X = 10;
const CS_ARCH_MAX = 11;
const CS_ARCH_ALL = 0xFFFF;
const CS_MODE_LITTLE_ENDIAN = 0;
const CS_MODE_ARM = 0;
const CS_MODE_16 = 1 << 1;
const CS_MODE_32 = 1 << 2;
const CS_MODE_64 = 1 << 3;
const CS_MODE_THUMB = 1 << 4;
const CS_MODE_MCLASS = 1 << 5;
const CS_MODE_V8 = 1 << 6;
const CS_MODE_MICRO = 1 << 4;
const CS_MODE_MIPS3 = 1 << 5;
const CS_MODE_MIPS32R6 = 1 << 6;
const CS_MODE_MIPS2 = 1 << 7;
const CS_MODE_BIG_ENDIAN = 1 << 31;
const CS_MODE_V9 = 1 << 4;
const CS_MODE_MIPS32 = CS_MODE_32;
const CS_MODE_MIPS64 = CS_MODE_64;
const CS_MODE_QPX = 1 << 4;
const CS_MODE_M680X_6301 = 1 << 1;
const CS_MODE_M680X_6309 = 1 << 2;
const CS_MODE_M680X_6800 = 1 << 3;
const CS_MODE_M680X_6801 = 1 << 4;
const CS_MODE_M680X_6805 = 1 << 5;
const CS_MODE_M680X_6808 = 1 << 6;
const CS_MODE_M680X_6809 = 1 << 7;
const CS_MODE_M680X_6811 = 1 << 8;
const CS_MODE_M680X_CPU12 = 1 << 9;
const CS_MODE_M680X_HCS08 = 1 << 10;
const CS_ERR_OK = 0;
const CS_ERR_MEM = 1;
const CS_ERR_ARCH = 2;
const CS_ERR_HANDLE = 3;
const CS_ERR_CSH = 4;
const CS_ERR_MODE = 5;
const CS_ERR_OPTION = 6;
const CS_ERR_DETAIL = 7;
const CS_ERR_MEMSETUP = 8;
const CS_ERR_VERSION = 9;
const CS_ERR_DIET = 10;
const CS_ERR_SKIPDATA = 11;
const CS_ERR_X86_ATT = 12;
const CS_ERR_X86_INTEL = 13;
const CS_OPT_SYNTAX = 1;
const CS_OPT_DETAIL = 2;
const CS_OPT_MODE = 3;
const CS_OPT_OFF = 0;
const CS_OPT_SYNTAX_INTEL = 1;
const CS_OPT_SYNTAX_ATT = 2;
const CS_OPT_ON = 3;
const CS_OPT_SYNTAX_NOREGNAME = 3;
const CS_OP_INVALID = 0;
const CS_OP_REG = 1;
const CS_OP_IMM = 2;
const CS_OP_MEM = 3;
const CS_OP_FP = 4;
const CS_AC_INVALID = 0;
const CS_AC_READ = 1 << 0;
const CS_AC_WRITE = 1 << 1;
const CS_GRP_INVALID = 0;
const CS_GRP_JUMP = 1;
const CS_GRP_CALL = 2;
const CS_GRP_RET = 3;
const CS_GRP_INT = 4;
const CS_GRP_IRET = 5;
const CS_GRP_PRIVILEGE = 6;
const CS_SUPPORT_DIET = CS_ARCH_ALL + 1;
const CS_SUPPORT_X86_REDUCE = CS_ARCH_ALL + 2;

var _const = /*#__PURE__*/Object.freeze({
  __proto__: null,
  CS_AC_INVALID: CS_AC_INVALID,
  CS_AC_READ: CS_AC_READ,
  CS_AC_WRITE: CS_AC_WRITE,
  CS_API_MAJOR: CS_API_MAJOR,
  CS_API_MINOR: CS_API_MINOR,
  CS_ARCH_ALL: CS_ARCH_ALL,
  CS_ARCH_ARM: CS_ARCH_ARM,
  CS_ARCH_ARM64: CS_ARCH_ARM64,
  CS_ARCH_M680X: CS_ARCH_M680X,
  CS_ARCH_M68K: CS_ARCH_M68K,
  CS_ARCH_MAX: CS_ARCH_MAX,
  CS_ARCH_MIPS: CS_ARCH_MIPS,
  CS_ARCH_PPC: CS_ARCH_PPC,
  CS_ARCH_SPARC: CS_ARCH_SPARC,
  CS_ARCH_SYSZ: CS_ARCH_SYSZ,
  CS_ARCH_TMS320C64X: CS_ARCH_TMS320C64X,
  CS_ARCH_X86: CS_ARCH_X86,
  CS_ARCH_XCORE: CS_ARCH_XCORE,
  CS_ERR_ARCH: CS_ERR_ARCH,
  CS_ERR_CSH: CS_ERR_CSH,
  CS_ERR_DETAIL: CS_ERR_DETAIL,
  CS_ERR_DIET: CS_ERR_DIET,
  CS_ERR_HANDLE: CS_ERR_HANDLE,
  CS_ERR_MEM: CS_ERR_MEM,
  CS_ERR_MEMSETUP: CS_ERR_MEMSETUP,
  CS_ERR_MODE: CS_ERR_MODE,
  CS_ERR_OK: CS_ERR_OK,
  CS_ERR_OPTION: CS_ERR_OPTION,
  CS_ERR_SKIPDATA: CS_ERR_SKIPDATA,
  CS_ERR_VERSION: CS_ERR_VERSION,
  CS_ERR_X86_ATT: CS_ERR_X86_ATT,
  CS_ERR_X86_INTEL: CS_ERR_X86_INTEL,
  CS_GRP_CALL: CS_GRP_CALL,
  CS_GRP_INT: CS_GRP_INT,
  CS_GRP_INVALID: CS_GRP_INVALID,
  CS_GRP_IRET: CS_GRP_IRET,
  CS_GRP_JUMP: CS_GRP_JUMP,
  CS_GRP_PRIVILEGE: CS_GRP_PRIVILEGE,
  CS_GRP_RET: CS_GRP_RET,
  CS_MODE_16: CS_MODE_16,
  CS_MODE_32: CS_MODE_32,
  CS_MODE_64: CS_MODE_64,
  CS_MODE_ARM: CS_MODE_ARM,
  CS_MODE_BIG_ENDIAN: CS_MODE_BIG_ENDIAN,
  CS_MODE_LITTLE_ENDIAN: CS_MODE_LITTLE_ENDIAN,
  CS_MODE_M680X_6301: CS_MODE_M680X_6301,
  CS_MODE_M680X_6309: CS_MODE_M680X_6309,
  CS_MODE_M680X_6800: CS_MODE_M680X_6800,
  CS_MODE_M680X_6801: CS_MODE_M680X_6801,
  CS_MODE_M680X_6805: CS_MODE_M680X_6805,
  CS_MODE_M680X_6808: CS_MODE_M680X_6808,
  CS_MODE_M680X_6809: CS_MODE_M680X_6809,
  CS_MODE_M680X_6811: CS_MODE_M680X_6811,
  CS_MODE_M680X_CPU12: CS_MODE_M680X_CPU12,
  CS_MODE_M680X_HCS08: CS_MODE_M680X_HCS08,
  CS_MODE_MCLASS: CS_MODE_MCLASS,
  CS_MODE_MICRO: CS_MODE_MICRO,
  CS_MODE_MIPS2: CS_MODE_MIPS2,
  CS_MODE_MIPS3: CS_MODE_MIPS3,
  CS_MODE_MIPS32: CS_MODE_MIPS32,
  CS_MODE_MIPS32R6: CS_MODE_MIPS32R6,
  CS_MODE_MIPS64: CS_MODE_MIPS64,
  CS_MODE_QPX: CS_MODE_QPX,
  CS_MODE_THUMB: CS_MODE_THUMB,
  CS_MODE_V8: CS_MODE_V8,
  CS_MODE_V9: CS_MODE_V9,
  CS_OPT_DETAIL: CS_OPT_DETAIL,
  CS_OPT_MODE: CS_OPT_MODE,
  CS_OPT_OFF: CS_OPT_OFF,
  CS_OPT_ON: CS_OPT_ON,
  CS_OPT_SYNTAX: CS_OPT_SYNTAX,
  CS_OPT_SYNTAX_ATT: CS_OPT_SYNTAX_ATT,
  CS_OPT_SYNTAX_INTEL: CS_OPT_SYNTAX_INTEL,
  CS_OPT_SYNTAX_NOREGNAME: CS_OPT_SYNTAX_NOREGNAME,
  CS_OP_FP: CS_OP_FP,
  CS_OP_IMM: CS_OP_IMM,
  CS_OP_INVALID: CS_OP_INVALID,
  CS_OP_MEM: CS_OP_MEM,
  CS_OP_REG: CS_OP_REG,
  CS_SUPPORT_DIET: CS_SUPPORT_DIET,
  CS_SUPPORT_X86_REDUCE: CS_SUPPORT_X86_REDUCE
});

const POINTER_SIZE = 4;
function defineMethods(obj) {
    return obj;
}
function getNativeTypeSize(type) {
    switch(type){
        case '*':
            return POINTER_SIZE;
        case 'i1':
        case 'i8':
            return 1;
        case 'i16':
            return 2;
        case 'i32':
            return 4;
        case 'i64':
            return 8;
        case 'float':
            return 4;
        case 'double':
            return 8;
        default:
            {
                throw new Error(`Unsupported type: ${type}`);
            }
    }
}
function getFieldSize(field) {
    if (field.type === 'string' || field.type === 'bytes') {
        return field.size;
    }
    return getNativeTypeSize(field.type);
}
function getStructFieldPadding(offset, size) {
    const remainder = offset % size;
    if (remainder) {
        return size - remainder;
    }
    return 0;
}
function sizeOfStruct(fields) {
    return fields.reduce((acc, field)=>{
        const size = getFieldSize(field);
        const padding = field.type === 'string' || field.type === 'bytes' ? 0 : getStructFieldPadding(acc, size);
        return acc + padding + size;
    }, 0);
}
function readStruct(module, ptr, fields) {
    let offset = 0;
    return fields.reduce((obj, field)=>{
        let value;
        let size;
        if (field.type === 'string') {
            size = field.size;
            value = module.UTF8ToString(ptr + offset, size);
        } else if (field.type === 'bytes') {
            size = field.size;
            value = module.HEAPU8.slice(ptr + offset, ptr + offset + size);
        } else {
            size = getNativeTypeSize(field.type);
            offset += getStructFieldPadding(offset, size);
            value = module.getValue(ptr + offset, field.type);
        }
        offset += size;
        if (field.name) {
            return {
                ...obj,
                [field.name]: value
            };
        }
        return obj;
    }, {});
}

const METHODS_TYPES = defineMethods({
    cs_open: {
        returnType: 'number',
        argTypes: [
            'number',
            'number',
            'number'
        ]
    },
    cs_disasm: {
        returnType: 'number',
        argTypes: [
            'number',
            'array',
            'number',
            'number',
            'number',
            'number'
        ]
    },
    cs_free: {
        returnType: null,
        argTypes: [
            'number',
            'number'
        ]
    },
    cs_close: {
        returnType: 'number',
        argTypes: [
            'number'
        ]
    },
    cs_option: {
        returnType: 'number',
        argTypes: [
            'number',
            'number',
            'number'
        ]
    },
    cs_reg_name: {
        returnType: 'string',
        argTypes: [
            'number',
            'number'
        ]
    },
    cs_op_count: {
        returnType: 'number',
        argTypes: [
            'number',
            'number',
            'number'
        ]
    },
    cs_op_index: {
        returnType: 'number',
        argTypes: [
            'number',
            'number',
            'number',
            'number'
        ]
    },
    cs_insn_name: {
        returnType: 'string',
        argTypes: [
            'number',
            'number'
        ]
    },
    cs_group_name: {
        returnType: 'string',
        argTypes: [
            'number',
            'number'
        ]
    },
    cs_insn_group: {
        returnType: 'boolean',
        argTypes: [
            'number',
            'number',
            'number'
        ]
    },
    cs_reg_read: {
        returnType: 'boolean',
        argTypes: [
            'number',
            'number',
            'number'
        ]
    },
    cs_reg_write: {
        returnType: 'boolean',
        argTypes: [
            'number',
            'number',
            'number'
        ]
    },
    cs_errno: {
        returnType: 'number',
        argTypes: [
            'number'
        ]
    },
    cs_version: {
        returnType: 'number',
        argTypes: [
            'number',
            'number'
        ]
    },
    cs_support: {
        returnType: 'boolean',
        argTypes: [
            'number'
        ]
    },
    cs_strerror: {
        returnType: 'string',
        argTypes: [
            'number'
        ]
    },
    cs_regs_access: {
        returnType: 'number',
        argTypes: [
            'number',
            'number',
            'number',
            'number',
            'number',
            'number'
        ]
    },
    malloc: {
        returnType: 'number',
        argTypes: [
            'number'
        ]
    },
    free: {
        returnType: null,
        argTypes: [
            'number'
        ]
    }
});
let capstone;
const INSN_FIELDS = [
    {
        name: 'id',
        type: 'i32'
    },
    {
        name: 'address',
        type: 'i64'
    },
    {
        name: 'size',
        type: 'i16'
    },
    {
        name: 'bytes',
        type: 'bytes',
        size: 24
    },
    {
        name: 'mnemonic',
        type: 'string',
        size: 32
    },
    {
        name: 'opStr',
        type: 'string',
        size: 160
    },
    {
        // detail pointer
        type: 'i32'
    }
];
const INSN_SIZE = sizeOfStruct(INSN_FIELDS);
class Capstone {
    get handle() {
        return capstone.getValue(this.handle_ptr, '*');
    }
    setOption(opt, value) {
        return Capstone.call('cs_option', this.handle, opt, value);
    }
    close() {
        const ret = Capstone.call('cs_close', this.handle_ptr);
        if (ret !== CS_ERR_OK) {
            throw new Error(`Failed to close capstone: ${Capstone.strError(ret)}`);
        }
        this.handle_ptr = null;
    }
    static readInsn(insnPtr) {
        const insn = readStruct(capstone, insnPtr, INSN_FIELDS);
        insn.bytes = insn.bytes.subarray(0, insn.size);
        return insn;
    }
    disasm(data, options = {}) {
        const { address = 0, count: maxCount = 0 } = options;
        const insnPtrPtr = Capstone.call('malloc', POINTER_SIZE);
        const count = Capstone.call('cs_disasm', this.handle, data, data.length, BigInt(address), maxCount, insnPtrPtr);
        if (count === 0) {
            Capstone.call('free', insnPtrPtr);
            throw new Error(`Failed to disassemble, error: ${Capstone.strError(this.errNo())}`);
        }
        const insnPtr = capstone.getValue(insnPtrPtr, '*');
        const instructions = [];
        for(let i = 0; i < count; i++){
            const insn = Capstone.readInsn(insnPtr + i * INSN_SIZE);
            if (insn.address <= Number.MAX_SAFE_INTEGER) {
                insn.address = Number(insn.address);
            }
            instructions.push(insn);
        }
        Capstone.call('cs_free', insnPtr, count);
        Capstone.call('free', insnPtrPtr);
        return instructions;
    }
    getRegName(id) {
        return Capstone.call('cs_reg_name', this.handle, id);
    }
    getInsnName(id) {
        return Capstone.call('cs_insn_name', this.handle, id);
    }
    getGroupName(id) {
        return Capstone.call('cs_group_name', this.handle, id);
    }
    errNo() {
        return Capstone.call('cs_errno', this.handle);
    }
    static call(name, ...args) {
        const methodType = METHODS_TYPES[name];
        return capstone.ccall(name, methodType.returnType, methodType.argTypes, args);
    }
    static version() {
        const int = this.call('cs_version');
        /* eslint-disable no-bitwise */ return {
            major: int >> 8,
            minor: int & 0xff
        };
    /* eslint-enable no-bitwise */ }
    static support(query) {
        return this.call('cs_support', query);
    }
    static strError(errNo) {
        return this.call('cs_strerror', errNo);
    }
    constructor(arch, mode){
        this.arch = arch;
        this.mode = mode;
        this.handle_ptr = Capstone.call('malloc', POINTER_SIZE);
        const ret = Capstone.call('cs_open', arch, mode, this.handle_ptr);
        if (ret !== CS_ERR_OK) {
            throw new Error(`Failed to initialize capstone: ${Capstone.strError(ret)}`);
        }
    }
}
async function factory(args) {
    if (capstone) {
        return;
    }
    capstone = await capstone$1(args);
}

export { Capstone, _const as Const, factory as loadCapstone };
