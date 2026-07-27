/*
 * edu-exe.en.js — English edu shard, exe/pyc tools (T318).
 *
 * Covers 1 op:
 * analysis: pycExeDecompile
 *
 * Pure data, no side effects, no import, no register.
 */
export default {
  pycExeDecompile: {
    what: "pyc/exe decompilation — recover readable .py source from Python .pyc bytecode or a PyInstaller-packaged .exe. Windows only.",
    principle:
      "The Python runtime executes .pyc bytecode (compiled by the CPython interpreter). A .pyc file header has a 4-byte magic number marking the Python version (e.g. `42 0d 0d 0a` is 3.8). Using xdis to look up the magic and pin the version, it picks the matching decompiler: 3.4-3.8 use `uncompyle6`/`decompyle3`; 3.9+ changed the bytecode architecture so the old tools don't support it, and it goes through the experimental `pylingual` path.\n\n" +
      "A PyInstaller-packaged .exe is essentially a self-extracting container (PIA archive): first PyInstxtractor unpacks the pile of .pyc inside, then each is decompiled.\n\n" +
      "This tool does not run decompilation in the browser directly (that's the Python ecosystem's job); instead it goes through a local bridge `bridge.py` (port 8181): the front end reads the file into base64 → POSTs it to the bridge → the bridge invokes the local Python toolchain to decompile → returns the source. Zero outbound; the sample never leaves the machine.",
    usage: "First start the bridge locally with `python bridge.py` (Windows only). Then drop in a .pyc or PyInstaller .exe file (or paste base64), pick the type (auto/pyc/exe, default auto by file header), and run to await the decompiled result. If the bridge is unavailable it returns a clear message rather than throwing.",
    examples: [
      { in: "(base64 of a .pyc file)", out: "[input · via uncompyle6]\n# Decompiled source\ndef hello():\n    print('Hello')", desc: "pyc decompiled to Python source" },
      { in: "(base64 of a PyInstaller .exe)", out: "[input · via PyInstxtractor + decompyle3]\n# Extracted from exe archive\nimport os\nprint(os.getcwd())", desc: "exe unpacked, then each pyc decompiled" },
    ],
    tips: [
      "Windows only + you must start the local bridge `python bridge.py` first; on non-Windows or without the bridge it gives a clear message rather than a blank screen.",
      "Python 3.9+ changed the bytecode architecture, unsupported by uncompyle6, so it goes through the experimental pylingual path (manual install required).",
      "A PyInstaller exe is unpacked first, then decompiled; an exe usually holds multiple .pyc, so decompile each to find the main logic.",
      "Zero outbound: the file is processed only by the localhost:8181 local bridge, nothing uploaded to any remote.",
    ],
    aka: ["pyc反编译", "pyc decompile", "exe反编", "pyinstaller extract", "python decompile", "uncompyle6", "decompyle3", "pyinstxtractor", "字节码反编译", "Python反编译", "pyc逆向", "exe逆向", "PyInstaller解包"],
  },
};
