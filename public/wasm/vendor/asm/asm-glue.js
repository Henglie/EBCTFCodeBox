var keystone$1 = (()=>{
    var _scriptDir = import.meta.url;
    return async function(moduleArg = {}) {
        var Module = moduleArg;
        var readyPromiseResolve, readyPromiseReject;
        Module["ready"] = new Promise((resolve, reject)=>{
            readyPromiseResolve = resolve;
            readyPromiseReject = reject;
        });
        var moduleOverrides = Object.assign({}, Module);
        var thisProgram = "./this.program";
        var quit_ = (status, toThrow)=>{
            throw toThrow;
        };
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
                thisProgram = process.argv[1].replace(/\\/g, "/");
            }
            process.argv.slice(2);
            quit_ = (status, toThrow)=>{
                process.exitCode = status;
                throw toThrow;
            };
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
        var out = Module["print"] || console.log.bind(console);
        var err = Module["printErr"] || console.error.bind(console);
        Object.assign(Module, moduleOverrides);
        moduleOverrides = null;
        if (Module["arguments"]) Module["arguments"];
        if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
        if (Module["quit"]) quit_ = Module["quit"];
        var wasmBinary;
        if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
        var noExitRuntime = Module["noExitRuntime"] || true;
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
        var runtimeKeepaliveCounter = 0;
        function keepRuntimeAlive() {
            return noExitRuntime || runtimeKeepaliveCounter > 0;
        }
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
            wasmBinaryFile = "asm.wasm";
            if (!isDataURI(wasmBinaryFile)) {
                wasmBinaryFile = locateFile(wasmBinaryFile);
            }
        } else {
            wasmBinaryFile = new URL("asm.wasm", import.meta.url).href;
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
                wasmMemory = wasmExports["v"];
                updateMemoryViews();
                addOnInit(wasmExports["w"]);
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
        /** @constructor */ function ExitStatus(status) {
            this.name = "ExitStatus";
            this.message = `Program terminated with exit(${status})`;
            this.status = status;
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
        /** @constructor */ function ExceptionInfo(excPtr) {
            this.excPtr = excPtr;
            this.ptr = excPtr - 24;
            this.set_type = function(type) {
                HEAPU32[this.ptr + 4 >> 2] = type;
            };
            this.get_type = function() {
                return HEAPU32[this.ptr + 4 >> 2];
            };
            this.set_destructor = function(destructor) {
                HEAPU32[this.ptr + 8 >> 2] = destructor;
            };
            this.get_destructor = function() {
                return HEAPU32[this.ptr + 8 >> 2];
            };
            this.set_caught = function(caught) {
                caught = caught ? 1 : 0;
                HEAP8[this.ptr + 12 >> 0] = caught;
            };
            this.get_caught = function() {
                return HEAP8[this.ptr + 12 >> 0] != 0;
            };
            this.set_rethrown = function(rethrown) {
                rethrown = rethrown ? 1 : 0;
                HEAP8[this.ptr + 13 >> 0] = rethrown;
            };
            this.get_rethrown = function() {
                return HEAP8[this.ptr + 13 >> 0] != 0;
            };
            this.init = function(type, destructor) {
                this.set_adjusted_ptr(0);
                this.set_type(type);
                this.set_destructor(destructor);
            };
            this.set_adjusted_ptr = function(adjustedPtr) {
                HEAPU32[this.ptr + 16 >> 2] = adjustedPtr;
            };
            this.get_adjusted_ptr = function() {
                return HEAPU32[this.ptr + 16 >> 2];
            };
            this.get_exception_ptr = function() {
                var isPointer = ___cxa_is_pointer_type(this.get_type());
                if (isPointer) {
                    return HEAPU32[this.excPtr >> 2];
                }
                var adjusted = this.get_adjusted_ptr();
                if (adjusted !== 0) return adjusted;
                return this.excPtr;
            };
        }
        var exceptionLast = 0;
        var ___cxa_throw = (ptr, type, destructor)=>{
            var info = new ExceptionInfo(ptr);
            info.init(type, destructor);
            exceptionLast = ptr;
            throw exceptionLast;
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
        var ___syscall_fstat64 = (fd, buf)=>{};
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
        var ___syscall_getcwd = (buf, size)=>{};
        var ___syscall_lstat64 = (path, buf)=>{};
        var ___syscall_newfstatat = (dirfd, path, buf, flags)=>{};
        function ___syscall_openat(dirfd, path, flags, varargs) {
        }
        var ___syscall_stat64 = (path, buf)=>{};
        function __mmap_js(len, prot, flags, fd, offset, allocated, addr) {
            return -52;
        }
        function __munmap_js(addr, len, prot, flags, fd, offset) {
        }
        var _abort = ()=>{
            abort("");
        };
        var _emscripten_memcpy_js = (dest, src, num)=>HEAPU8.copyWithin(dest, src, src + num);
        var abortOnCannotGrowMemory = (requestedSize)=>{
            abort("OOM");
        };
        var _emscripten_resize_heap = (requestedSize)=>{
            HEAPU8.length;
            abortOnCannotGrowMemory();
        };
        var ENV = {};
        var getExecutableName = ()=>thisProgram || "./this.program";
        var getEnvStrings = ()=>{
            if (!getEnvStrings.strings) {
                var lang = (typeof navigator == "object" && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8";
                var env = {
                    "USER": "web_user",
                    "LOGNAME": "web_user",
                    "PATH": "/",
                    "PWD": "/",
                    "HOME": "/home/web_user",
                    "LANG": lang,
                    "_": getExecutableName()
                };
                for(var x in ENV){
                    if (ENV[x] === undefined) delete env[x];
                    else env[x] = ENV[x];
                }
                var strings = [];
                for(var x in env){
                    strings.push(`${x}=${env[x]}`);
                }
                getEnvStrings.strings = strings;
            }
            return getEnvStrings.strings;
        };
        var stringToAscii = (str, buffer)=>{
            for(var i = 0; i < str.length; ++i){
                HEAP8[buffer++ >> 0] = str.charCodeAt(i);
            }
            HEAP8[buffer >> 0] = 0;
        };
        var _environ_get = (__environ, environ_buf)=>{
            var bufSize = 0;
            getEnvStrings().forEach((string, i)=>{
                var ptr = environ_buf + bufSize;
                HEAPU32[__environ + i * 4 >> 2] = ptr;
                stringToAscii(string, ptr);
                bufSize += string.length + 1;
            });
            return 0;
        };
        var _environ_sizes_get = (penviron_count, penviron_buf_size)=>{
            var strings = getEnvStrings();
            HEAPU32[penviron_count >> 2] = strings.length;
            var bufSize = 0;
            strings.forEach((string)=>bufSize += string.length + 1);
            HEAPU32[penviron_buf_size >> 2] = bufSize;
            return 0;
        };
        var _proc_exit = (code)=>{
            if (!keepRuntimeAlive()) {
                if (Module["onExit"]) Module["onExit"](code);
                ABORT = true;
            }
            quit_(code, new ExitStatus(code));
        };
        /** @param {boolean|number=} implicit */ var exitJS = (status, implicit)=>{
            _proc_exit(status);
        };
        var _exit = exitJS;
        var _fd_close = (fd)=>52;
        var _fd_fdstat_get = (fd, pbuf)=>{
            var rightsBase = 0;
            var rightsInheriting = 0;
            var flags = 0;
            {
                var type = 2;
                if (fd == 0) {
                    rightsBase = 2;
                } else if (fd == 1 || fd == 2) {
                    rightsBase = 64;
                }
                flags = 1;
            }
            HEAP8[pbuf >> 0] = type;
            HEAP16[pbuf + 2 >> 1] = flags;
            HEAP64[pbuf + 8 >> 3] = BigInt(rightsBase);
            HEAP64[pbuf + 16 >> 3] = BigInt(rightsInheriting);
            return 0;
        };
        function _fd_pread(fd, iov, iovcnt, offset, pnum) {
            return 52;
        }
        var _fd_read = (fd, iov, iovcnt, pnum)=>52;
        function _fd_seek(fd, offset, whence, newOffset) {
            return 70;
        }
        var printCharBuffers = [
            null,
            [],
            []
        ];
        var printChar = (stream, curr)=>{
            var buffer = printCharBuffers[stream];
            if (curr === 0 || curr === 10) {
                (stream === 1 ? out : err)(UTF8ArrayToString(buffer, 0));
                buffer.length = 0;
            } else {
                buffer.push(curr);
            }
        };
        var _fd_write = (fd, iov, iovcnt, pnum)=>{
            var num = 0;
            for(var i = 0; i < iovcnt; i++){
                var ptr = HEAPU32[iov >> 2];
                var len = HEAPU32[iov + 4 >> 2];
                iov += 8;
                for(var j = 0; j < len; j++){
                    printChar(fd, HEAPU8[ptr + j]);
                }
                num += len;
            }
            HEAPU32[pnum >> 2] = num;
            return 0;
        };
        var getCFunc = (ident)=>{
            var func = Module["_" + ident];
            return func;
        };
        var writeArrayToMemory = (array, buffer)=>{
            HEAP8.set(array, buffer);
        };
        var stringToUTF8OnStack = (str)=>{
            var size = lengthBytesUTF8(str) + 1;
            var ret = stackAlloc(size);
            stringToUTF8(str, ret, size);
            return ret;
        };
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
            /** @export */ b: ___cxa_throw,
            /** @export */ c: ___syscall_fstat64,
            /** @export */ o: ___syscall_getcwd,
            /** @export */ r: ___syscall_lstat64,
            /** @export */ s: ___syscall_newfstatat,
            /** @export */ p: ___syscall_openat,
            /** @export */ t: ___syscall_stat64,
            /** @export */ k: __mmap_js,
            /** @export */ l: __munmap_js,
            /** @export */ a: _abort,
            /** @export */ j: _emscripten_memcpy_js,
            /** @export */ u: _emscripten_resize_heap,
            /** @export */ m: _environ_get,
            /** @export */ n: _environ_sizes_get,
            /** @export */ h: _exit,
            /** @export */ g: _fd_close,
            /** @export */ e: _fd_fdstat_get,
            /** @export */ i: _fd_pread,
            /** @export */ q: _fd_read,
            /** @export */ d: _fd_seek,
            /** @export */ f: _fd_write
        };
        var wasmExports = createWasm();
        Module["_ks_version"] = (a0, a1)=>(Module["_ks_version"] = wasmExports["x"])(a0, a1);
        Module["_ks_errno"] = (a0)=>(Module["_ks_errno"] = wasmExports["y"])(a0);
        Module["_ks_strerror"] = (a0)=>(Module["_ks_strerror"] = wasmExports["z"])(a0);
        Module["_ks_arch_supported"] = (a0)=>(Module["_ks_arch_supported"] = wasmExports["A"])(a0);
        Module["_ks_open"] = (a0, a1, a2)=>(Module["_ks_open"] = wasmExports["B"])(a0, a1, a2);
        Module["_ks_close"] = (a0)=>(Module["_ks_close"] = wasmExports["C"])(a0);
        Module["_ks_option"] = (a0, a1, a2)=>(Module["_ks_option"] = wasmExports["D"])(a0, a1, a2);
        Module["_ks_free"] = (a0)=>(Module["_ks_free"] = wasmExports["E"])(a0);
        Module["_ks_asm"] = (a0, a1, a2, a3, a4, a5)=>(Module["_ks_asm"] = wasmExports["F"])(a0, a1, a2, a3, a4, a5);
        Module["_malloc"] = (a0)=>(Module["_malloc"] = wasmExports["G"])(a0);
        Module["_free"] = (a0)=>(Module["_free"] = wasmExports["H"])(a0);
        var stackSave = ()=>(stackSave = wasmExports["I"])();
        var stackRestore = (a0)=>(stackRestore = wasmExports["J"])(a0);
        var stackAlloc = (a0)=>(stackAlloc = wasmExports["K"])(a0);
        var ___cxa_is_pointer_type = (a0)=>(___cxa_is_pointer_type = wasmExports["L"])(a0);
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
/* eslint-disable */ const KS_API_MAJOR = 0;
const KS_API_MINOR = 9;
const KS_VERSION_MAJOR = 0;
const KS_VERSION_MINOR = 9;
const KS_VERSION_EXTRA = 2;
const KS_ARCH_ARM = 1;
const KS_ARCH_ARM64 = 2;
const KS_ARCH_MIPS = 3;
const KS_ARCH_X86 = 4;
const KS_ARCH_PPC = 5;
const KS_ARCH_SPARC = 6;
const KS_ARCH_SYSTEMZ = 7;
const KS_ARCH_HEXAGON = 8;
const KS_ARCH_EVM = 9;
const KS_ARCH_MAX = 10;
const KS_MODE_LITTLE_ENDIAN = 0;
const KS_MODE_BIG_ENDIAN = 1073741824;
const KS_MODE_ARM = 1;
const KS_MODE_THUMB = 16;
const KS_MODE_V8 = 64;
const KS_MODE_MICRO = 16;
const KS_MODE_MIPS3 = 32;
const KS_MODE_MIPS32R6 = 64;
const KS_MODE_MIPS32 = 4;
const KS_MODE_MIPS64 = 8;
const KS_MODE_16 = 2;
const KS_MODE_32 = 4;
const KS_MODE_64 = 8;
const KS_MODE_PPC32 = 4;
const KS_MODE_PPC64 = 8;
const KS_MODE_QPX = 16;
const KS_MODE_SPARC32 = 4;
const KS_MODE_SPARC64 = 8;
const KS_MODE_V9 = 16;
const KS_ERR_ASM = 128;
const KS_ERR_ASM_ARCH = 512;
const KS_ERR_OK = 0;
const KS_ERR_NOMEM = 1;
const KS_ERR_ARCH = 2;
const KS_ERR_HANDLE = 3;
const KS_ERR_MODE = 4;
const KS_ERR_VERSION = 5;
const KS_ERR_OPT_INVALID = 6;
const KS_ERR_ASM_EXPR_TOKEN = 128;
const KS_ERR_ASM_DIRECTIVE_VALUE_RANGE = 129;
const KS_ERR_ASM_DIRECTIVE_ID = 130;
const KS_ERR_ASM_DIRECTIVE_TOKEN = 131;
const KS_ERR_ASM_DIRECTIVE_STR = 132;
const KS_ERR_ASM_DIRECTIVE_COMMA = 133;
const KS_ERR_ASM_DIRECTIVE_RELOC_NAME = 134;
const KS_ERR_ASM_DIRECTIVE_RELOC_TOKEN = 135;
const KS_ERR_ASM_DIRECTIVE_FPOINT = 136;
const KS_ERR_ASM_DIRECTIVE_UNKNOWN = 137;
const KS_ERR_ASM_DIRECTIVE_EQU = 138;
const KS_ERR_ASM_DIRECTIVE_INVALID = 139;
const KS_ERR_ASM_VARIANT_INVALID = 140;
const KS_ERR_ASM_EXPR_BRACKET = 141;
const KS_ERR_ASM_SYMBOL_MODIFIER = 142;
const KS_ERR_ASM_SYMBOL_REDEFINED = 143;
const KS_ERR_ASM_SYMBOL_MISSING = 144;
const KS_ERR_ASM_RPAREN = 145;
const KS_ERR_ASM_STAT_TOKEN = 146;
const KS_ERR_ASM_UNSUPPORTED = 147;
const KS_ERR_ASM_MACRO_TOKEN = 148;
const KS_ERR_ASM_MACRO_PAREN = 149;
const KS_ERR_ASM_MACRO_EQU = 150;
const KS_ERR_ASM_MACRO_ARGS = 151;
const KS_ERR_ASM_MACRO_LEVELS_EXCEED = 152;
const KS_ERR_ASM_MACRO_STR = 153;
const KS_ERR_ASM_MACRO_INVALID = 154;
const KS_ERR_ASM_ESC_BACKSLASH = 155;
const KS_ERR_ASM_ESC_OCTAL = 156;
const KS_ERR_ASM_ESC_SEQUENCE = 157;
const KS_ERR_ASM_ESC_STR = 158;
const KS_ERR_ASM_TOKEN_INVALID = 159;
const KS_ERR_ASM_INSN_UNSUPPORTED = 160;
const KS_ERR_ASM_FIXUP_INVALID = 161;
const KS_ERR_ASM_LABEL_INVALID = 162;
const KS_ERR_ASM_FRAGMENT_INVALID = 163;
const KS_ERR_ASM_INVALIDOPERAND = 512;
const KS_ERR_ASM_MISSINGFEATURE = 513;
const KS_ERR_ASM_MNEMONICFAIL = 514;
const KS_OPT_SYNTAX = 1;
const KS_OPT_SYM_RESOLVER = 2;
const KS_OPT_SYNTAX_INTEL = 1;
const KS_OPT_SYNTAX_ATT = 2;
const KS_OPT_SYNTAX_NASM = 4;
const KS_OPT_SYNTAX_MASM = 8;
const KS_OPT_SYNTAX_GAS = 16;
const KS_OPT_SYNTAX_RADIX16 = 32;

var _const = /*#__PURE__*/Object.freeze({
  __proto__: null,
  KS_API_MAJOR: KS_API_MAJOR,
  KS_API_MINOR: KS_API_MINOR,
  KS_ARCH_ARM: KS_ARCH_ARM,
  KS_ARCH_ARM64: KS_ARCH_ARM64,
  KS_ARCH_EVM: KS_ARCH_EVM,
  KS_ARCH_HEXAGON: KS_ARCH_HEXAGON,
  KS_ARCH_MAX: KS_ARCH_MAX,
  KS_ARCH_MIPS: KS_ARCH_MIPS,
  KS_ARCH_PPC: KS_ARCH_PPC,
  KS_ARCH_SPARC: KS_ARCH_SPARC,
  KS_ARCH_SYSTEMZ: KS_ARCH_SYSTEMZ,
  KS_ARCH_X86: KS_ARCH_X86,
  KS_ERR_ARCH: KS_ERR_ARCH,
  KS_ERR_ASM: KS_ERR_ASM,
  KS_ERR_ASM_ARCH: KS_ERR_ASM_ARCH,
  KS_ERR_ASM_DIRECTIVE_COMMA: KS_ERR_ASM_DIRECTIVE_COMMA,
  KS_ERR_ASM_DIRECTIVE_EQU: KS_ERR_ASM_DIRECTIVE_EQU,
  KS_ERR_ASM_DIRECTIVE_FPOINT: KS_ERR_ASM_DIRECTIVE_FPOINT,
  KS_ERR_ASM_DIRECTIVE_ID: KS_ERR_ASM_DIRECTIVE_ID,
  KS_ERR_ASM_DIRECTIVE_INVALID: KS_ERR_ASM_DIRECTIVE_INVALID,
  KS_ERR_ASM_DIRECTIVE_RELOC_NAME: KS_ERR_ASM_DIRECTIVE_RELOC_NAME,
  KS_ERR_ASM_DIRECTIVE_RELOC_TOKEN: KS_ERR_ASM_DIRECTIVE_RELOC_TOKEN,
  KS_ERR_ASM_DIRECTIVE_STR: KS_ERR_ASM_DIRECTIVE_STR,
  KS_ERR_ASM_DIRECTIVE_TOKEN: KS_ERR_ASM_DIRECTIVE_TOKEN,
  KS_ERR_ASM_DIRECTIVE_UNKNOWN: KS_ERR_ASM_DIRECTIVE_UNKNOWN,
  KS_ERR_ASM_DIRECTIVE_VALUE_RANGE: KS_ERR_ASM_DIRECTIVE_VALUE_RANGE,
  KS_ERR_ASM_ESC_BACKSLASH: KS_ERR_ASM_ESC_BACKSLASH,
  KS_ERR_ASM_ESC_OCTAL: KS_ERR_ASM_ESC_OCTAL,
  KS_ERR_ASM_ESC_SEQUENCE: KS_ERR_ASM_ESC_SEQUENCE,
  KS_ERR_ASM_ESC_STR: KS_ERR_ASM_ESC_STR,
  KS_ERR_ASM_EXPR_BRACKET: KS_ERR_ASM_EXPR_BRACKET,
  KS_ERR_ASM_EXPR_TOKEN: KS_ERR_ASM_EXPR_TOKEN,
  KS_ERR_ASM_FIXUP_INVALID: KS_ERR_ASM_FIXUP_INVALID,
  KS_ERR_ASM_FRAGMENT_INVALID: KS_ERR_ASM_FRAGMENT_INVALID,
  KS_ERR_ASM_INSN_UNSUPPORTED: KS_ERR_ASM_INSN_UNSUPPORTED,
  KS_ERR_ASM_INVALIDOPERAND: KS_ERR_ASM_INVALIDOPERAND,
  KS_ERR_ASM_LABEL_INVALID: KS_ERR_ASM_LABEL_INVALID,
  KS_ERR_ASM_MACRO_ARGS: KS_ERR_ASM_MACRO_ARGS,
  KS_ERR_ASM_MACRO_EQU: KS_ERR_ASM_MACRO_EQU,
  KS_ERR_ASM_MACRO_INVALID: KS_ERR_ASM_MACRO_INVALID,
  KS_ERR_ASM_MACRO_LEVELS_EXCEED: KS_ERR_ASM_MACRO_LEVELS_EXCEED,
  KS_ERR_ASM_MACRO_PAREN: KS_ERR_ASM_MACRO_PAREN,
  KS_ERR_ASM_MACRO_STR: KS_ERR_ASM_MACRO_STR,
  KS_ERR_ASM_MACRO_TOKEN: KS_ERR_ASM_MACRO_TOKEN,
  KS_ERR_ASM_MISSINGFEATURE: KS_ERR_ASM_MISSINGFEATURE,
  KS_ERR_ASM_MNEMONICFAIL: KS_ERR_ASM_MNEMONICFAIL,
  KS_ERR_ASM_RPAREN: KS_ERR_ASM_RPAREN,
  KS_ERR_ASM_STAT_TOKEN: KS_ERR_ASM_STAT_TOKEN,
  KS_ERR_ASM_SYMBOL_MISSING: KS_ERR_ASM_SYMBOL_MISSING,
  KS_ERR_ASM_SYMBOL_MODIFIER: KS_ERR_ASM_SYMBOL_MODIFIER,
  KS_ERR_ASM_SYMBOL_REDEFINED: KS_ERR_ASM_SYMBOL_REDEFINED,
  KS_ERR_ASM_TOKEN_INVALID: KS_ERR_ASM_TOKEN_INVALID,
  KS_ERR_ASM_UNSUPPORTED: KS_ERR_ASM_UNSUPPORTED,
  KS_ERR_ASM_VARIANT_INVALID: KS_ERR_ASM_VARIANT_INVALID,
  KS_ERR_HANDLE: KS_ERR_HANDLE,
  KS_ERR_MODE: KS_ERR_MODE,
  KS_ERR_NOMEM: KS_ERR_NOMEM,
  KS_ERR_OK: KS_ERR_OK,
  KS_ERR_OPT_INVALID: KS_ERR_OPT_INVALID,
  KS_ERR_VERSION: KS_ERR_VERSION,
  KS_MODE_16: KS_MODE_16,
  KS_MODE_32: KS_MODE_32,
  KS_MODE_64: KS_MODE_64,
  KS_MODE_ARM: KS_MODE_ARM,
  KS_MODE_BIG_ENDIAN: KS_MODE_BIG_ENDIAN,
  KS_MODE_LITTLE_ENDIAN: KS_MODE_LITTLE_ENDIAN,
  KS_MODE_MICRO: KS_MODE_MICRO,
  KS_MODE_MIPS3: KS_MODE_MIPS3,
  KS_MODE_MIPS32: KS_MODE_MIPS32,
  KS_MODE_MIPS32R6: KS_MODE_MIPS32R6,
  KS_MODE_MIPS64: KS_MODE_MIPS64,
  KS_MODE_PPC32: KS_MODE_PPC32,
  KS_MODE_PPC64: KS_MODE_PPC64,
  KS_MODE_QPX: KS_MODE_QPX,
  KS_MODE_SPARC32: KS_MODE_SPARC32,
  KS_MODE_SPARC64: KS_MODE_SPARC64,
  KS_MODE_THUMB: KS_MODE_THUMB,
  KS_MODE_V8: KS_MODE_V8,
  KS_MODE_V9: KS_MODE_V9,
  KS_OPT_SYM_RESOLVER: KS_OPT_SYM_RESOLVER,
  KS_OPT_SYNTAX: KS_OPT_SYNTAX,
  KS_OPT_SYNTAX_ATT: KS_OPT_SYNTAX_ATT,
  KS_OPT_SYNTAX_GAS: KS_OPT_SYNTAX_GAS,
  KS_OPT_SYNTAX_INTEL: KS_OPT_SYNTAX_INTEL,
  KS_OPT_SYNTAX_MASM: KS_OPT_SYNTAX_MASM,
  KS_OPT_SYNTAX_NASM: KS_OPT_SYNTAX_NASM,
  KS_OPT_SYNTAX_RADIX16: KS_OPT_SYNTAX_RADIX16,
  KS_VERSION_EXTRA: KS_VERSION_EXTRA,
  KS_VERSION_MAJOR: KS_VERSION_MAJOR,
  KS_VERSION_MINOR: KS_VERSION_MINOR
});

const POINTER_SIZE = 4;
function defineMethods(obj) {
    return obj;
}

const METHODS_TYPES = defineMethods({
    ks_open: {
        returnType: 'number',
        argTypes: [
            'number',
            'number',
            'number'
        ]
    },
    ks_asm: {
        returnType: 'number',
        argTypes: [
            'number',
            'string',
            'number',
            'number',
            'number',
            'number'
        ]
    },
    ks_free: {
        returnType: null,
        argTypes: [
            'number'
        ]
    },
    ks_close: {
        returnType: 'number',
        argTypes: [
            'number'
        ]
    },
    ks_option: {
        returnType: 'number',
        argTypes: [
            'number',
            'number',
            'number'
        ]
    },
    ks_errno: {
        returnType: 'number',
        argTypes: [
            'number'
        ]
    },
    ks_version: {
        returnType: 'number',
        argTypes: [
            'number',
            'number'
        ]
    },
    ks_arch_supported: {
        returnType: 'boolean',
        argTypes: [
            'number'
        ]
    },
    ks_strerror: {
        returnType: 'string',
        argTypes: [
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
let keystone;
class Keystone {
    get handle() {
        return keystone.getValue(this.handle_ptr, '*');
    }
    setOption(opt, value) {
        return Keystone.call('ks_option', this.handle, opt, value);
    }
    close() {
        const ret = Keystone.call('ks_close', this.handle);
        if (ret !== KS_ERR_OK) {
            throw new Error(`Failed to close keystone: ${Keystone.strError(ret)}`);
        }
        this.handle_ptr = null;
    }
    asm(data, options = {}) {
        const { address = 0 } = options;
        const bytesPtrPtr = Keystone.call('malloc', POINTER_SIZE);
        const bytesLenPtr = Keystone.call('malloc', POINTER_SIZE);
        const statCountPtr = Keystone.call('malloc', POINTER_SIZE);
        const errNo = Keystone.call('ks_asm', this.handle, data, BigInt(address), bytesPtrPtr, bytesLenPtr, statCountPtr);
        try {
            if (errNo !== KS_ERR_OK) {
                throw new Error(`Failed to assemble, error: ${Keystone.strError(this.errNo())}`);
            }
            const bytesPtr = keystone.getValue(bytesPtrPtr, '*');
            const bytesLen = keystone.getValue(bytesLenPtr, 'i32');
            const bytes = keystone.HEAPU8.slice(bytesPtr, bytesPtr + bytesLen);
            Keystone.call('ks_free', bytesPtr);
            return bytes;
        } finally{
            Keystone.call('free', bytesPtrPtr);
            Keystone.call('free', bytesLenPtr);
            Keystone.call('free', statCountPtr);
        }
    }
    errNo() {
        return Keystone.call('ks_errno', this.handle);
    }
    static call(name, ...args) {
        const methodType = METHODS_TYPES[name];
        return keystone.ccall(name, methodType.returnType, methodType.argTypes, args);
    }
    static version() {
        const int = this.call('ks_version');
        /* eslint-disable no-bitwise */ return {
            major: int >> 8,
            minor: int & 0xff
        };
    /* eslint-enable no-bitwise */ }
    static archSupported(query) {
        return this.call('ks_arch_supported', query);
    }
    static strError(errNo) {
        return this.call('ks_strerror', errNo);
    }
    constructor(arch, mode){
        this.arch = arch;
        this.mode = mode;
        this.handle_ptr = Keystone.call('malloc', POINTER_SIZE);
        const ret = Keystone.call('ks_open', arch, mode, this.handle_ptr);
        if (ret !== KS_ERR_OK) {
            throw new Error(`Failed to initialize keystone: ${Keystone.strError(ret)}`);
        }
    }
}
async function factory(args) {
    if (keystone) {
        return;
    }
    keystone = await keystone$1(args);
}

export { _const as Const, Keystone, factory as loadKeystone };
