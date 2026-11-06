/*
 * outguess.worker.js - single-threaded Worker adapter for the OutGuess 0.4
 * WASM build.
 *
 * Design notes
 * ------------
 * - One module instance per job.  OutGuess keeps process-global state
 *   (steg_stat, the JPEG handler's `quality`, the bitmap pointers), so
 *   reusing one instance across jobs risks cross-job pollution.  A fresh
 *   instance also means a fresh MEMFS.
 * - stderr/stdout are captured via printErr/print instead of being written to
 *   console.error/console.log, so a normal run stays quiet in the console.
 * - After callMain() the output stream is flushed explicitly with fflush(0):
 *   upstream never fcloses `fout` and relies on exit() to flush, which we do
 *   not call (EXIT_RUNTIME=0).
 * - The carrier is written into MEMFS under the extension upstream dispatches
 *   on (jpg / ppm / pnm), derived by the caller from the real magic bytes -
 *   upstream get_handler() looks at the file name only.
 * - Cancellation is the parent's job: Worker.terminate() kills the whole
 *   instance; this worker holds no state that survives a job.
 */
import createOutguessModule from "./outguess.js";

function logLine(s) {
  return String(s).replace(/\s+$/, "");
}

async function runJob(msg) {
  const log = [];
  const mod = await createOutguessModule({
    // The wasm is resolved relative to this module's URL.  Without an
    // explicit locateFile emscripten resolves it relative to the *page*,
    // which 404s when the module is loaded from a Worker.
    locateFile: (p) => new URL("./" + p, import.meta.url).href,
    print: (s) => log.push(logLine(s)),
    printErr: (s) => log.push(logLine(s)),
  });

  const FS = mod.FS;
  const ext = msg.ext;
  const inName = "/in." + ext;
  FS.writeFile(inName, msg.carrier);

  const argv = [];
  // Upstream treats an explicit `-k ""` as a *different* key from omitting -k
  // (empty-string key yields a different PRNG seed than the no-flag default).
  // The empty passphrase must therefore map to "no -k at all", never to -k "".
  if (msg.key) argv.push("-k", msg.key);
  if (msg.ecc) argv.push("-e");
  if (msg.noFoil) argv.push("-F-");

  let outName;
  if (msg.op === "encode") {
    FS.writeFile("/payload.bin", msg.payload);
    if (msg.quality) argv.push("-p", String(msg.quality));
    argv.push("-d", "/payload.bin", inName, "/out." + ext);
    outName = "/out." + ext;
  } else {
    argv.push("-r", inName, "/out.bin");
    outName = "/out.bin";
  }

  let rc = 0;
  let trapped = false;
  try {
    rc = mod.callMain(argv);
  } catch (e) {
    trapped = true;
    rc = e && e.status !== undefined ? e.status : "trap";
    log.push("callMain threw: " + String(e));
  }
  if (typeof mod._fflush === "function") mod._fflush(0);

  let bytes = null;
  try {
    bytes = FS.readFile(outName);
  } catch (e) {
    bytes = null;
  }

  const ok = !trapped && rc === 0 && bytes && bytes.length > 0;
  const result = {
    id: msg.id,
    ok: !!ok,
    rc,
    trapped,
    // A failed run must not hand back a residual (possibly 0-byte) file as
    // if it were the product.
    bytes: ok ? bytes : null,
    outBytes: bytes ? bytes.length : 0,
    log,
  };
  return result;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    const res = await runJob(msg);
    if (res.bytes) {
      self.postMessage(res, [res.bytes.buffer]);
    } else {
      self.postMessage(res);
    }
  } catch (e) {
    self.postMessage({
      id: msg && msg.id,
      ok: false,
      rc: null,
      trapped: false,
      bytes: null,
      outBytes: 0,
      log: [],
      error: String(e && e.stack ? e.stack : e),
    });
  }
};
