import loadBZip2WASM from './bzip2-1.0.8/bzip2.mjs';

const ERROR_MESSAGES = {
    '-2': 'BZ_PARAM_ERROR: incorrect parameters',
    '-3': "BZ_MEM_ERROR: couldn't allocate enough memory",
    '-4': 'BZ_DATA_ERROR: data integrity error when decompressing',
    '-5': 'BZ_DATA_ERROR_MAGIC: compressed data has incorrect header',
    '-7': 'BZ_UNEXPECTED_EOF: compressed data ends too early',
    '-8': 'BZ_OUTBUFF_FULL: destination buffer is full'
};

class BZip2 {
    constructor() {
        this.wasmModule = undefined;
    }

    // fetch the wasm and initialize it
    async init() {
        if (this.wasmModule) {
            return;
        }

        let moduleArg;

        // check if node
        // http://philiplassen.com/2021/08/11/node-es6-emscripten.html
        if (typeof process !== 'undefined' && process.versions && process.versions.node) {
            const { dirname } = await import/* webpackIgnore: true */('path');
            const { createRequire } = await import/* webpackIgnore: true */('module');

            globalThis.__dirname = dirname(import.meta.url);
            globalThis.require = createRequire(import.meta.url);

            // Node 下 Emscripten 会把 file:// URL 裁成 "/C:/..."，在 Windows 上变成 C:\C:\...。
            // 直接读 wasm 字节交给 Module.wasmBinary，绕开文件路径解析（浏览器仍走默认 URL）。
            const { readFile } = await import/* webpackIgnore: true */('node:fs/promises');
            moduleArg = {
                wasmBinary: await readFile(
                    new URL('./bzip2-1.0.8/bzip2.wasm', import.meta.url)
                )
            };
        }

        this.wasmModule = await loadBZip2WASM(moduleArg);
    }

    ensureInitialized() {
        if (!this.wasmModule) {
            throw new Error(
                `${this.constructor.name} not initalized. call .init()`
            );
        }
    }

    // turn bzip's integer return values into an error message and throw it.
    // also free the destination pointers
    handleError(returnValue, destPtr, destLengthPtr) {
        if (returnValue === 0) {
            return;
        }

        this.wasmModule._free(destPtr);
        this.wasmModule._free(destLengthPtr);

        const errorMessage = ERROR_MESSAGES[returnValue];

        if (errorMessage) {
            throw new Error(errorMessage);
        }

        throw new Error(`error code: ${returnValue}`);
    }

    // create source, destination and length buffers
    createWASMBuffers(source, destLength) {
        const { _malloc, setValue, HEAPU8 } = this.wasmModule;

        const sourcePtr = _malloc(source.length);
        HEAPU8.set(source, sourcePtr);

        const destPtr = _malloc(destLength);

        const destLengthPtr = _malloc(destLength);
        setValue(destLengthPtr, destLength, 'i32');

        return { sourcePtr, destPtr, destLengthPtr };
    }

    // read the length returned by bzip, create a new Uint8Array of that size
    // and copy the decompressed/compressed data into it
    createBuffer(destPtr, destLengthPtr) {
        const { _free, getValue, HEAPU8 } = this.wasmModule;

        const destLength = getValue(destLengthPtr, 'i32');

        const dest = new Uint8Array(destLength);
        dest.set(HEAPU8.subarray(destPtr, destPtr + destLength));

        _free(destPtr);
        _free(destLengthPtr);

        return dest;
    }

    decompress(compressed, decompressedLength) {
        this.ensureInitialized();

        const {
            sourcePtr: compressedPtr,
            destPtr: decompressedPtr,
            destLengthPtr: decompressedLengthPtr
        } = this.createWASMBuffers(compressed, decompressedLength);

        const returnValue = this.wasmModule._BZ2_bzBuffToBuffDecompress(
            decompressedPtr,
            decompressedLengthPtr,
            compressedPtr,
            compressed.length,
            0,
            0
        );

        this.wasmModule._free(compressedPtr);

        this.handleError(returnValue, decompressedPtr, decompressedLengthPtr);

        return this.createBuffer(decompressedPtr, decompressedLengthPtr);
    }

    compress(decompressed, blockSize = 5, compressedLength, workFactor = 30) {
        this.ensureInitialized();

        if (!compressedLength) {
            compressedLength = decompressed.length;
        }

        if (compressedLength < 128) {
            compressedLength = 128;
        }

        if (blockSize <= 0 || blockSize > 9) {
            throw new RangeError('blockSize should be between 1-9');
        }

        const {
            sourcePtr: decompressedPtr,
            destPtr: compressedPtr,
            destLengthPtr: compressedLengthPtr
        } = this.createWASMBuffers(decompressed, compressedLength);

        const returnValue = this.wasmModule._BZ2_bzBuffToBuffCompress(
            compressedPtr,
            compressedLengthPtr,
            decompressedPtr,
            decompressed.length,
            blockSize,
            0,
            workFactor
        );

        this.wasmModule._free(decompressedPtr);

        this.handleError(returnValue, compressedPtr, compressedLengthPtr);

        return this.createBuffer(compressedPtr, compressedLengthPtr);
    }
}

export default BZip2;
