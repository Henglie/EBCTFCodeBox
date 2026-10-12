export default {
  pemToHex: {
    what: "Extract the original bytes from a PEM block. Hex and hexdump are display formats; the DER file contains the payload bytes.",
    principle: "RFC 7468 defines the labeled textual enclosure and Base64 body. This tool removes whitespace and colon-bearing header lines, skips EC PARAMETERS blocks, and extracts the first remaining block. It does not validate the DER structure. The Base64 parser also accepts unpadded and URL-safe input as compatibility extensions; generated Base64 uses the RFC 4648 standard alphabet.",
    usage: "Paste PEM text or import a UTF-8 PEM file. Raw file bytes take precedence over text; invalid UTF-8 is rejected. Pass the DER file bytes unchanged to DER to PEM and choose the original label. The explanatory report is not inverse-operation input.",
    examples: [
      { in: "-----BEGIN PUBLIC KEY-----\nMAMCAQE=\n-----END PUBLIC KEY-----", out: "DER file bytes: 30 03 02 01 01", desc: "Envelope-only example: SEQUENCE containing INTEGER 1, not a usable public key." },
    ],
    tips: ["The label is retained in the report and filename, not encoded inside arbitrary DER bytes.", "Use a key or certificate parser to validate the extracted structure.", "Whitespace normalization does not recover missing Base64 data."],
    aka: ["PEM to DER", "PEM to hex", "PEM decode", "PEM extract", "DER bytes", "PEM parser", "RFC 7468", "Base64 PEM", "PEM hexdump", "certificate to hex", "pemToHex"],
  },
  hexToPem: {
    what: "Wrap raw DER bytes, hex text or Base64 text in a labeled PEM enclosure with 64-character Base64 lines.",
    principle: "RFC 7468 section 2 requires generators to wrap Base64 at 64 characters except the last line. Raw bytes bypass text encoding selection. Text auto mode prefers an even-length all-hex string; choose Base64 explicitly for ambiguous text. The chosen label does not change the payload. DER parsing is advisory: this operation can wrap arbitrary nonempty bytes.",
    usage: "Paste hex/Base64 or import a DER file, then choose the correct label. Raw bytes take precedence over text and input encoding; empty bytes are rejected. Pass the PEM file bytes unchanged to PEM to DER or an OpenSSL-based tool. The explanatory report is not inverse-operation input.",
    examples: [
      { in: "3003020101", param: "input=hex, label=PUBLIC KEY", out: "-----BEGIN PUBLIC KEY-----\nMAMCAQE=\n-----END PUBLIC KEY-----", desc: "Envelope-only example, not a valid SubjectPublicKeyInfo." },
    ],
    tips: ["A mismatched label may cause downstream libraries to reject the file.", "Base64 uses the RFC 4648 standard alphabet and padding.", "Preserve raw binary bytes rather than converting through UTF-8 text."],
    aka: ["DER to PEM", "hex to PEM", "PEM encode", "PEM wrap", "PEM generator", "DER Base64", "RFC 7468", "64 column PEM", "binary to PEM", "Base64 to PEM", "hexToPem"],
  },
};
