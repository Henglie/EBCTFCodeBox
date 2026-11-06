/*
 * t842Crc.js — CyberChef 对齐的 CRC Checksum / Generate all checksums 候选实现（T842）。
 *
 * 仅新增 op，不改既有 crcGeneric/crc32/crc16 行为：
 *   crcChecksum          —— 与 CC CRCChecksum 同 171 个命名预设 + Custom，输出同格式小写 hex
 *   generateAllChecksums —— 与 CC GenerateAllChecksums 同顺序、同 25 字符标签填充
 *
 * CRC 参数表逐条取自本地 CyberChef 源码 CRCChecksum.mjs（Apache-2.0）；
 * 宽度 3/4/.../82 位全部用 BigInt 实现，>=8 位走查表，<8 位逐位，与 CC 同算法。
 */
import { register } from "./registry.js";

const CRC_TABLE = {
  "CRC-3/GSM": [3, 0x3n, 0x0n, false, false, 0x7n],
  "CRC-3/ROHC": [3, 0x3n, 0x7n, true, true, 0x0n],
  "CRC-4/G-704": [4, 0x3n, 0x0n, true, true, 0x0n],
  "CRC-4/INTERLAKEN": [4, 0x3n, 0xFn, false, false, 0xFn],
  "CRC-4/ITU": [4, 0x3n, 0x0n, true, true, 0x0n],
  "CRC-5/EPC": [5, 0x09n, 0x09n, false, false, 0x00n],
  "CRC-5/EPC-C1G2": [5, 0x09n, 0x09n, false, false, 0x00n],
  "CRC-5/G-704": [5, 0x15n, 0x00n, true, true, 0x00n],
  "CRC-5/ITU": [5, 0x15n, 0x00n, true, true, 0x00n],
  "CRC-5/USB": [5, 0x05n, 0x1Fn, true, true, 0x1Fn],
  "CRC-6/CDMA2000-A": [6, 0x27n, 0x3Fn, false, false, 0x00n],
  "CRC-6/CDMA2000-B": [6, 0x07n, 0x3Fn, false, false, 0x00n],
  "CRC-6/DARC": [6, 0x19n, 0x00n, true, true, 0x00n],
  "CRC-6/G-704": [6, 0x03n, 0x00n, true, true, 0x00n],
  "CRC-6/GSM": [6, 0x2Fn, 0x00n, false, false, 0x3Fn],
  "CRC-6/ITU": [6, 0x03n, 0x00n, true, true, 0x00n],
  "CRC-7/MMC": [7, 0x09n, 0x00n, false, false, 0x00n],
  "CRC-7/ROHC": [7, 0x4Fn, 0x7Fn, true, true, 0x00n],
  "CRC-7/UMTS": [7, 0x45n, 0x00n, false, false, 0x00n],
  "CRC-8": [8, 0x07n, 0x00n, false, false, 0x00n],
  "CRC-8/8H2F": [8, 0x2Fn, 0xFFn, false, false, 0xFFn],
  "CRC-8/AES": [8, 0x1Dn, 0xFFn, true, true, 0x00n],
  "CRC-8/AUTOSAR": [8, 0x2Fn, 0xFFn, false, false, 0xFFn],
  "CRC-8/BLUETOOTH": [8, 0xA7n, 0x00n, true, true, 0x00n],
  "CRC-8/CDMA2000": [8, 0x9Bn, 0xFFn, false, false, 0x00n],
  "CRC-8/DARC": [8, 0x39n, 0x00n, true, true, 0x00n],
  "CRC-8/DVB-S2": [8, 0xD5n, 0x00n, false, false, 0x00n],
  "CRC-8/EBU": [8, 0x1Dn, 0xFFn, true, true, 0x00n],
  "CRC-8/GSM-A": [8, 0x1Dn, 0x00n, false, false, 0x00n],
  "CRC-8/GSM-B": [8, 0x49n, 0x00n, false, false, 0xFFn],
  "CRC-8/HITAG": [8, 0x1Dn, 0xFFn, false, false, 0x00n],
  "CRC-8/I-432-1": [8, 0x07n, 0x00n, false, false, 0x55n],
  "CRC-8/I-CODE": [8, 0x1Dn, 0xFDn, false, false, 0x00n],
  "CRC-8/ITU": [8, 0x07n, 0x00n, false, false, 0x55n],
  "CRC-8/LTE": [8, 0x9Bn, 0x00n, false, false, 0x00n],
  "CRC-8/MAXIM": [8, 0x31n, 0x00n, true, true, 0x00n],
  "CRC-8/MAXIM-DOW": [8, 0x31n, 0x00n, true, true, 0x00n],
  "CRC-8/MIFARE-MAD": [8, 0x1Dn, 0xC7n, false, false, 0x00n],
  "CRC-8/NRSC-5": [8, 0x31n, 0xFFn, false, false, 0x00n],
  "CRC-8/OPENSAFETY": [8, 0x2Fn, 0x00n, false, false, 0x00n],
  "CRC-8/ROHC": [8, 0x07n, 0xFFn, true, true, 0x00n],
  "CRC-8/SAE-J1850": [8, 0x1Dn, 0xFFn, false, false, 0xFFn],
  "CRC-8/SAE-J1850-ZERO": [8, 0x1Dn, 0x00n, false, false, 0x00n],
  "CRC-8/SMBUS": [8, 0x07n, 0x00n, false, false, 0x00n],
  "CRC-8/TECH-3250": [8, 0x1Dn, 0xFFn, true, true, 0x00n],
  "CRC-8/WCDMA": [8, 0x9Bn, 0x00n, true, true, 0x00n],
  "CRC-10/ATM": [10, 0x233n, 0x000n, false, false, 0x000n],
  "CRC-10/CDMA2000": [10, 0x3D9n, 0x3FFn, false, false, 0x000n],
  "CRC-10/GSM": [10, 0x175n, 0x000n, false, false, 0x3FFn],
  "CRC-10/I-610": [10, 0x233n, 0x000n, false, false, 0x000n],
  "CRC-11/FLEXRAY": [11, 0x385n, 0x01An, false, false, 0x000n],
  "CRC-11/UMTS": [11, 0x307n, 0x000n, false, false, 0x000n],
  "CRC-12/3GPP": [12, 0x80Fn, 0x000n, false, true, 0x000n],
  "CRC-12/CDMA2000": [12, 0xF13n, 0xFFFn, false, false, 0x000n],
  "CRC-12/DECT": [12, 0x80Fn, 0x000n, false, false, 0x000n],
  "CRC-12/GSM": [12, 0xD31n, 0x000n, false, false, 0xFFFn],
  "CRC-12/UMTS": [12, 0x80Fn, 0x000n, false, true, 0x000n],
  "CRC-13/BBC": [13, 0x1CF5n, 0x0000n, false, false, 0x0000n],
  "CRC-14/DARC": [14, 0x0805n, 0x0000n, true, true, 0x0000n],
  "CRC-14/GSM": [14, 0x202Dn, 0x0000n, false, false, 0x3FFFn],
  "CRC-15/CAN": [15, 0x4599n, 0x0000n, false, false, 0x0000n],
  "CRC-15/MPT1327": [15, 0x6815n, 0x0000n, false, false, 0x0001n],
  "CRC-16": [16, 0x8005n, 0x0000n, true, true, 0x0000n],
  "CRC-16/A": [16, 0x1021n, 0xC6C6n, true, true, 0x0000n],
  "CRC-16/ACORN": [16, 0x1021n, 0x0000n, false, false, 0x0000n],
  "CRC-16/ARC": [16, 0x8005n, 0x0000n, true, true, 0x0000n],
  "CRC-16/AUG-CCITT": [16, 0x1021n, 0x1D0Fn, false, false, 0x0000n],
  "CRC-16/AUTOSAR": [16, 0x1021n, 0xFFFFn, false, false, 0x0000n],
  "CRC-16/B": [16, 0x1021n, 0xFFFFn, true, true, 0xFFFFn],
  "CRC-16/BLUETOOTH": [16, 0x1021n, 0x0000n, true, true, 0x0000n],
  "CRC-16/BUYPASS": [16, 0x8005n, 0x0000n, false, false, 0x0000n],
  "CRC-16/CCITT": [16, 0x1021n, 0x0000n, true, true, 0x0000n],
  "CRC-16/CCITT-FALSE": [16, 0x1021n, 0xFFFFn, false, false, 0x0000n],
  "CRC-16/CCITT-TRUE": [16, 0x1021n, 0x0000n, true, true, 0x0000n],
  "CRC-16/CCITT-ZERO": [16, 0x1021n, 0x0000n, false, false, 0x0000n],
  "CRC-16/CDMA2000": [16, 0xC867n, 0xFFFFn, false, false, 0x0000n],
  "CRC-16/CMS": [16, 0x8005n, 0xFFFFn, false, false, 0x0000n],
  "CRC-16/DARC": [16, 0x1021n, 0xFFFFn, false, false, 0xFFFFn],
  "CRC-16/DDS-110": [16, 0x8005n, 0x800Dn, false, false, 0x0000n],
  "CRC-16/DECT-R": [16, 0x0589n, 0x0000n, false, false, 0x0001n],
  "CRC-16/DECT-X": [16, 0x0589n, 0x0000n, false, false, 0x0000n],
  "CRC-16/DNP": [16, 0x3D65n, 0x0000n, true, true, 0xFFFFn],
  "CRC-16/EN-13757": [16, 0x3D65n, 0x0000n, false, false, 0xFFFFn],
  "CRC-16/EPC": [16, 0x1021n, 0xFFFFn, false, false, 0xFFFFn],
  "CRC-16/EPC-C1G2": [16, 0x1021n, 0xFFFFn, false, false, 0xFFFFn],
  "CRC-16/GENIBUS": [16, 0x1021n, 0xFFFFn, false, false, 0xFFFFn],
  "CRC-16/GSM": [16, 0x1021n, 0x0000n, false, false, 0xFFFFn],
  "CRC-16/I-CODE": [16, 0x1021n, 0xFFFFn, false, false, 0xFFFFn],
  "CRC-16/IBM": [16, 0x8005n, 0x0000n, true, true, 0x0000n],
  "CRC-16/IBM-3740": [16, 0x1021n, 0xFFFFn, false, false, 0x0000n],
  "CRC-16/IBM-SDLC": [16, 0x1021n, 0xFFFFn, true, true, 0xFFFFn],
  "CRC-16/IEC-61158-2": [16, 0x1DCFn, 0xFFFFn, false, false, 0xFFFFn],
  "CRC-16/ISO-HDLC": [16, 0x1021n, 0xFFFFn, true, true, 0xFFFFn],
  "CRC-16/ISO-IEC-14443-3-A": [16, 0x1021n, 0xC6C6n, true, true, 0x0000n],
  "CRC-16/ISO-IEC-14443-3-B": [16, 0x1021n, 0xFFFFn, true, true, 0xFFFFn],
  "CRC-16/KERMIT": [16, 0x1021n, 0x0000n, true, true, 0x0000n],
  "CRC-16/LHA": [16, 0x8005n, 0x0000n, true, true, 0x0000n],
  "CRC-16/LJ1200": [16, 0x6F63n, 0x0000n, false, false, 0x0000n],
  "CRC-16/LTE": [16, 0x1021n, 0x0000n, false, false, 0x0000n],
  "CRC-16/M17": [16, 0x5935n, 0xFFFFn, false, false, 0x0000n],
  "CRC-16/MAXIM": [16, 0x8005n, 0x0000n, true, true, 0xFFFFn],
  "CRC-16/MAXIM-DOW": [16, 0x8005n, 0x0000n, true, true, 0xFFFFn],
  "CRC-16/MCRF4XX": [16, 0x1021n, 0xFFFFn, true, true, 0x0000n],
  "CRC-16/MODBUS": [16, 0x8005n, 0xFFFFn, true, true, 0x0000n],
  "CRC-16/NRSC-5": [16, 0x080Bn, 0xFFFFn, true, true, 0x0000n],
  "CRC-16/OPENSAFETY-A": [16, 0x5935n, 0x0000n, false, false, 0x0000n],
  "CRC-16/OPENSAFETY-B": [16, 0x755Bn, 0x0000n, false, false, 0x0000n],
  "CRC-16/PROFIBUS": [16, 0x1DCFn, 0xFFFFn, false, false, 0xFFFFn],
  "CRC-16/RIELLO": [16, 0x1021n, 0xB2AAn, true, true, 0x0000n],
  "CRC-16/SPI-FUJITSU": [16, 0x1021n, 0x1D0Fn, false, false, 0x0000n],
  "CRC-16/T10-DIF": [16, 0x8BB7n, 0x0000n, false, false, 0x0000n],
  "CRC-16/TELEDISK": [16, 0xA097n, 0x0000n, false, false, 0x0000n],
  "CRC-16/TMS37157": [16, 0x1021n, 0x89ECn, true, true, 0x0000n],
  "CRC-16/UMTS": [16, 0x8005n, 0x0000n, false, false, 0x0000n],
  "CRC-16/USB": [16, 0x8005n, 0xFFFFn, true, true, 0xFFFFn],
  "CRC-16/V-41-LSB": [16, 0x1021n, 0x0000n, true, true, 0x0000n],
  "CRC-16/V-41-MSB": [16, 0x1021n, 0x0000n, false, false, 0x0000n],
  "CRC-16/VERIFONE": [16, 0x8005n, 0x0000n, false, false, 0x0000n],
  "CRC-16/X-25": [16, 0x1021n, 0xFFFFn, true, true, 0xFFFFn],
  "CRC-16/XMODEM": [16, 0x1021n, 0x0000n, false, false, 0x0000n],
  "CRC-16/ZMODEM": [16, 0x1021n, 0x0000n, false, false, 0x0000n],
  "CRC-17/CAN-FD": [17, 0x1685Bn, 0x00000n, false, false, 0x00000n],
  "CRC-21/CAN-FD": [21, 0x102899n, 0x000000n, false, false, 0x000000n],
  "CRC-24/BLE": [24, 0x00065Bn, 0x555555n, true, true, 0x000000n],
  "CRC-24/FLEXRAY-A": [24, 0x5D6DCBn, 0xFEDCBAn, false, false, 0x000000n],
  "CRC-24/FLEXRAY-B": [24, 0x5D6DCBn, 0xABCDEFn, false, false, 0x000000n],
  "CRC-24/INTERLAKEN": [24, 0x328B63n, 0xFFFFFFn, false, false, 0xFFFFFFn],
  "CRC-24/LTE-A": [24, 0x864CFBn, 0x000000n, false, false, 0x000000n],
  "CRC-24/LTE-B": [24, 0x800063n, 0x000000n, false, false, 0x000000n],
  "CRC-24/OPENPGP": [24, 0x864CFBn, 0xB704CEn, false, false, 0x000000n],
  "CRC-24/OS-9": [24, 0x800063n, 0xFFFFFFn, false, false, 0xFFFFFFn],
  "CRC-30/CDMA": [30, 0x2030B9C7n, 0x3FFFFFFFn, false, false, 0x3FFFFFFFn],
  "CRC-31/PHILIPS": [31, 0x04C11DB7n, 0x7FFFFFFFn, false, false, 0x7FFFFFFFn],
  "CRC-32": [32, 0x04C11DB7n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/AAL5": [32, 0x04C11DB7n, 0xFFFFFFFFn, false, false, 0xFFFFFFFFn],
  "CRC-32/ADCCP": [32, 0x04C11DB7n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/AIXM": [32, 0x814141ABn, 0x00000000n, false, false, 0x00000000n],
  "CRC-32/AUTOSAR": [32, 0xF4ACFB13n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/BASE91-C": [32, 0x1EDC6F41n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/BASE91-D": [32, 0xA833982Bn, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/BZIP2": [32, 0x04C11DB7n, 0xFFFFFFFFn, false, false, 0xFFFFFFFFn],
  "CRC-32/C": [32, 0x1EDC6F41n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/CASTAGNOLI": [32, 0x1EDC6F41n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/CD-ROM-EDC": [32, 0x8001801Bn, 0x00000000n, true, true, 0x00000000n],
  "CRC-32/CKSUM": [32, 0x04C11DB7n, 0x00000000n, false, false, 0xFFFFFFFFn],
  "CRC-32/D": [32, 0xA833982Bn, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/DECT-B": [32, 0x04C11DB7n, 0xFFFFFFFFn, false, false, 0xFFFFFFFFn],
  "CRC-32/INTERLAKEN": [32, 0x1EDC6F41n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/ISCSI": [32, 0x1EDC6F41n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/ISO-HDLC": [32, 0x04C11DB7n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/JAMCRC": [32, 0x04C11DB7n, 0xFFFFFFFFn, true, true, 0x00000000n],
  "CRC-32/MEF": [32, 0x741B8CD7n, 0xFFFFFFFFn, true, true, 0x00000000n],
  "CRC-32/MPEG-2": [32, 0x04C11DB7n, 0xFFFFFFFFn, false, false, 0x00000000n],
  "CRC-32/NVME": [32, 0x1EDC6F41n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/PKZIP": [32, 0x04C11DB7n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/POSIX": [32, 0x04C11DB7n, 0x00000000n, false, false, 0xFFFFFFFFn],
  "CRC-32/Q": [32, 0x814141ABn, 0x00000000n, false, false, 0x00000000n],
  "CRC-32/SATA": [32, 0x04C11DB7n, 0x52325032n, false, false, 0x00000000n],
  "CRC-32/V-42": [32, 0x04C11DB7n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-32/XFER": [32, 0x000000AFn, 0x00000000n, false, false, 0x00000000n],
  "CRC-32/XZ": [32, 0x04C11DB7n, 0xFFFFFFFFn, true, true, 0xFFFFFFFFn],
  "CRC-40/GSM": [40, 0x0004820009n, 0x0000000000n, false, false, 0xFFFFFFFFFFn],
  "CRC-64/ECMA-182": [64, 0x42F0E1EBA9EA3693n, 0x0000000000000000n, false, false, 0x0000000000000000n],
  "CRC-64/GO-ECMA": [64, 0x42F0E1EBA9EA3693n, 0xFFFFFFFFFFFFFFFFn, true, true, 0xFFFFFFFFFFFFFFFFn],
  "CRC-64/GO-ISO": [64, 0x000000000000001Bn, 0xFFFFFFFFFFFFFFFFn, true, true, 0xFFFFFFFFFFFFFFFFn],
  "CRC-64/MS": [64, 0x259C84CBA6426349n, 0xFFFFFFFFFFFFFFFFn, true, true, 0x0000000000000000n],
  "CRC-64/NVME": [64, 0xAD93D23594C93659n, 0xFFFFFFFFFFFFFFFFn, true, true, 0xFFFFFFFFFFFFFFFFn],
  "CRC-64/REDIS": [64, 0xAD93D23594C935A9n, 0x0000000000000000n, true, true, 0x0000000000000000n],
  "CRC-64/WE": [64, 0x42F0E1EBA9EA3693n, 0xFFFFFFFFFFFFFFFFn, false, false, 0xFFFFFFFFFFFFFFFFn],
  "CRC-64/XZ": [64, 0x42F0E1EBA9EA3693n, 0xFFFFFFFFFFFFFFFFn, true, true, 0xFFFFFFFFFFFFFFFFn],
  "CRC-82/DARC": [82, 0x0308C0111011401440411n, 0x000000000000000000000n, true, true, 0x000000000000000000000n],
};

const CHECKSUM_ORDER = [
  "CRC-3/GSM", // crc
  "CRC-3/ROHC", // crc
  "CRC-4/G-704", // crc
  "CRC-4/INTERLAKEN", // crc
  "CRC-4/ITU", // crc
  "CRC-5/EPC", // crc
  "CRC-5/EPC-C1G2", // crc
  "CRC-5/G-704", // crc
  "CRC-5/ITU", // crc
  "CRC-5/USB", // crc
  "CRC-6/CDMA2000-A", // crc
  "CRC-6/CDMA2000-B", // crc
  "CRC-6/DARC", // crc
  "CRC-6/G-704", // crc
  "CRC-6/GSM", // crc
  "CRC-6/ITU", // crc
  "CRC-7/MMC", // crc
  "CRC-7/ROHC", // crc
  "CRC-7/UMTS", // crc
  "CRC-8", // crc
  "CRC-8/8H2F", // crc
  "CRC-8/AES", // crc
  "CRC-8/AUTOSAR", // crc
  "CRC-8/BLUETOOTH", // crc
  "CRC-8/CDMA2000", // crc
  "CRC-8/DARC", // crc
  "CRC-8/DVB-S2", // crc
  "CRC-8/EBU", // crc
  "CRC-8/GSM-A", // crc
  "CRC-8/GSM-B", // crc
  "CRC-8/HITAG", // crc
  "CRC-8/I-432-1", // crc
  "CRC-8/I-CODE", // crc
  "CRC-8/ITU", // crc
  "CRC-8/LTE", // crc
  "CRC-8/MAXIM", // crc
  "CRC-8/MAXIM-DOW", // crc
  "CRC-8/MIFARE-MAD", // crc
  "CRC-8/NRSC-5", // crc
  "CRC-8/OPENSAFETY", // crc
  "CRC-8/ROHC", // crc
  "CRC-8/SAE-J1850", // crc
  "CRC-8/SAE-J1850-ZERO", // crc
  "CRC-8/SMBUS", // crc
  "CRC-8/TECH-3250", // crc
  "CRC-8/WCDMA", // crc
  "Fletcher-8", // fletcher8
  "CRC-10/ATM", // crc
  "CRC-10/CDMA2000", // crc
  "CRC-10/GSM", // crc
  "CRC-10/I-610", // crc
  "CRC-11/FLEXRAY", // crc
  "CRC-11/UMTS", // crc
  "CRC-12/3GPP", // crc
  "CRC-12/CDMA2000", // crc
  "CRC-12/DECT", // crc
  "CRC-12/GSM", // crc
  "CRC-12/UMTS", // crc
  "CRC-13/BBC", // crc
  "CRC-14/DARC", // crc
  "CRC-14/GSM", // crc
  "CRC-15/CAN", // crc
  "CRC-15/MPT1327", // crc
  "CRC-16", // crc
  "CRC-16/A", // crc
  "CRC-16/ACORN", // crc
  "CRC-16/ARC", // crc
  "CRC-16/AUG-CCITT", // crc
  "CRC-16/AUTOSAR", // crc
  "CRC-16/B", // crc
  "CRC-16/BLUETOOTH", // crc
  "CRC-16/BUYPASS", // crc
  "CRC-16/CCITT", // crc
  "CRC-16/CCITT-FALSE", // crc
  "CRC-16/CCITT-TRUE", // crc
  "CRC-16/CCITT-ZERO", // crc
  "CRC-16/CDMA2000", // crc
  "CRC-16/CMS", // crc
  "CRC-16/DARC", // crc
  "CRC-16/DDS-110", // crc
  "CRC-16/DECT-R", // crc
  "CRC-16/DECT-X", // crc
  "CRC-16/DNP", // crc
  "CRC-16/EN-13757", // crc
  "CRC-16/EPC", // crc
  "CRC-16/EPC-C1G2", // crc
  "CRC-16/GENIBUS", // crc
  "CRC-16/GSM", // crc
  "CRC-16/I-CODE", // crc
  "CRC-16/IBM", // crc
  "CRC-16/IBM-3740", // crc
  "CRC-16/IBM-SDLC", // crc
  "CRC-16/IEC-61158-2", // crc
  "CRC-16/ISO-HDLC", // crc
  "CRC-16/ISO-IEC-14443-3-A", // crc
  "CRC-16/ISO-IEC-14443-3-B", // crc
  "CRC-16/KERMIT", // crc
  "CRC-16/LHA", // crc
  "CRC-16/LJ1200", // crc
  "CRC-16/LTE", // crc
  "CRC-16/M17", // crc
  "CRC-16/MAXIM", // crc
  "CRC-16/MAXIM-DOW", // crc
  "CRC-16/MCRF4XX", // crc
  "CRC-16/MODBUS", // crc
  "CRC-16/NRSC-5", // crc
  "CRC-16/OPENSAFETY-A", // crc
  "CRC-16/OPENSAFETY-B", // crc
  "CRC-16/PROFIBUS", // crc
  "CRC-16/RIELLO", // crc
  "CRC-16/SPI-FUJITSU", // crc
  "CRC-16/T10-DIF", // crc
  "CRC-16/TELEDISK", // crc
  "CRC-16/TMS37157", // crc
  "CRC-16/UMTS", // crc
  "CRC-16/USB", // crc
  "CRC-16/V-41-LSB", // crc
  "CRC-16/V-41-MSB", // crc
  "CRC-16/VERIFONE", // crc
  "CRC-16/X-25", // crc
  "CRC-16/XMODEM", // crc
  "CRC-16/ZMODEM", // crc
  "Fletcher-16", // fletcher16
  "CRC-17/CAN-FD", // crc
  "CRC-21/CAN-FD", // crc
  "CRC-24/BLE", // crc
  "CRC-24/FLEXRAY-A", // crc
  "CRC-24/FLEXRAY-B", // crc
  "CRC-24/INTERLAKEN", // crc
  "CRC-24/LTE-A", // crc
  "CRC-24/LTE-B", // crc
  "CRC-24/OPENPGP", // crc
  "CRC-24/OS-9", // crc
  "CRC-30/CDMA", // crc
  "CRC-31/PHILIPS", // crc
  "Adler-32", // adler32
  "CRC-32", // crc
  "CRC-32/AAL5", // crc
  "CRC-32/ADCCP", // crc
  "CRC-32/AIXM", // crc
  "CRC-32/AUTOSAR", // crc
  "CRC-32/BASE91-C", // crc
  "CRC-32/BASE91-D", // crc
  "CRC-32/BZIP2", // crc
  "CRC-32/C", // crc
  "CRC-32/CASTAGNOLI", // crc
  "CRC-32/CD-ROM-EDC", // crc
  "CRC-32/CKSUM", // crc
  "CRC-32/D", // crc
  "CRC-32/DECT-B", // crc
  "CRC-32/INTERLAKEN", // crc
  "CRC-32/ISCSI", // crc
  "CRC-32/ISO-HDLC", // crc
  "CRC-32/JAMCRC", // crc
  "CRC-32/MEF", // crc
  "CRC-32/MPEG-2", // crc
  "CRC-32/NVME", // crc
  "CRC-32/PKZIP", // crc
  "CRC-32/POSIX", // crc
  "CRC-32/Q", // crc
  "CRC-32/SATA", // crc
  "CRC-32/V-42", // crc
  "CRC-32/XFER", // crc
  "CRC-32/XZ", // crc
  "Fletcher-32", // fletcher32
  "CRC-40/GSM", // crc
  "CRC-64/ECMA-182", // crc
  "CRC-64/GO-ECMA", // crc
  "CRC-64/GO-ISO", // crc
  "CRC-64/MS", // crc
  "CRC-64/NVME", // crc
  "CRC-64/REDIS", // crc
  "CRC-64/WE", // crc
  "CRC-64/XZ", // crc
  "Fletcher-64", // fletcher64
  "CRC-82/DARC", // crc
];

function reflectData(data, reflect) {
  let value = 0n;
  for (let bit = 0n; bit < reflect; bit++) {
    if ((data & 1n) === 1n) value |= (1n << ((reflect - 1n) - bit));
    data >>= 1n;
  }
  return value;
}

function generateTable(width, poly, MASK, TOP_BIT) {
  const table = new Array(256);
  for (let byte = 0n; byte < 256n; byte++) {
    let value = ((byte << (width - 8n)) & MASK);
    for (let bit = 0n; bit < 8n; bit++) {
      value = (value & TOP_BIT) === 0n
        ? ((value << 1n) & MASK)
        : (((value << 1n) & MASK) ^ poly);
    }
    table[Number(byte)] = value;
  }
  return table;
}

function crcValue(width, input, poly, init, reflectIn, reflectOut, xorOut) {
  width = BigInt(width);
  const TOP_BIT = 1n << (width - 1n);
  const MASK = (1n << width) - 1n;
  let remainder = init;
  if (width < 8n) {
    for (let byte of input) {
      byte = BigInt(byte);
      if (reflectIn) byte = reflectData(byte, 8n);
      for (let i = 0x80n; i !== 0n; i >>= 1n) {
        let bit = remainder & TOP_BIT;
        remainder = (remainder << 1n) & MASK;
        if ((byte & i) !== 0n) bit ^= TOP_BIT;
        if (bit !== 0n) remainder ^= poly;
      }
    }
  } else {
    const TABLE = generateTable(width, poly, MASK, TOP_BIT);
    for (let byte of input) {
      byte = BigInt(byte);
      if (reflectIn) byte = reflectData(byte, 8n);
      remainder ^= (byte << (width - 8n)) & MASK;
      const index = remainder >> (width - 8n);
      remainder = (remainder << 8n) & MASK;
      remainder ^= TABLE[Number(index)];
    }
  }
  if (reflectOut) remainder = reflectData(remainder, width);
  remainder ^= xorOut;
  return remainder.toString(16).padStart(Math.ceil(Number(width) / 4), "0");
}

function toBytes(t, p) {
  const raw = p && p.rawBytes;
  if (raw && (raw instanceof Uint8Array ? raw.length : raw.length)) return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const s = String(t == null ? "" : t);
  if (p && p.inputMode === "hex") {
    const clean = s.trim().replace(/^0x/i, "").replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2) throw new Error("CRC：hex 输入非法（须偶数长度纯 hex）");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return new TextEncoder().encode(s);
}

function fletcher8(bytes) {
  let a = 0, b = 0;
  for (const x of bytes) { a = (a + x) % 0xf; b = (b + a) % 0xf; }
  return ((b << 4) | a).toString(16).padStart(2, "0");
}
function fletcher16(bytes) {
  let a = 0, b = 0;
  for (const x of bytes) { a = (a + x) % 0xff; b = (b + a) % 0xff; }
  return ((b << 8) | a).toString(16).padStart(4, "0");
}
function fletcher32(bytes) {
  let a = 0, b = 0;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  for (; i < bytes.length - 1; i += 2) { a = (a + dv.getUint16(i, true)) % 0xffff; b = (b + a) % 0xffff; }
  if (bytes.length % 2 !== 0) { a = (a + bytes[bytes.length - 1]) % 0xffff; b = (b + a) % 0xffff; }
  return (((b << 16) | a) >>> 0).toString(16).padStart(8, "0");
}
function fletcher64(bytes) {
  let a = 0n, b = 0n;
  const MOD = 0xffffffffn;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  for (; i < bytes.length - 3; i += 4) { a = (a + BigInt(dv.getUint32(i, true))) % MOD; b = (b + a) % MOD; }
  const rem = bytes.length % 4;
  if (rem !== 0) {
    let last = 0;
    for (let k = 0; k < rem; k++) last = (last << 8) | bytes[bytes.length - 1 - k];
    a = (a + BigInt(last >>> 0)) % MOD;
    b = (b + a) % MOD;
  }
  return b.toString(16).padStart(8, "0") + a.toString(16).padStart(8, "0");
}
function adler32(bytes) {
  let a = 1, b = 0;
  for (const x of bytes) { a += x; b += a; }
  a %= 65521; b %= 65521;
  return (((b << 16) | a) >>> 0).toString(16).padStart(8, "0");
}

const ALGO_NAMES = ["Custom", ...Object.keys(CRC_TABLE)];
const LENGTHS = ["All", "3", "4", "5", "6", "7", "8", "10", "11", "12", "13", "14", "15", "16", "17", "21", "24", "30", "31", "32", "40", "64", "82"];

register({
  id: "crcChecksum",
  cat: "hash",
  name: "CRC Checksum（CC 全预设）",
  desc: "CyberChef CRC Checksum 对齐：171 个命名 CRC 预设 + Custom（width/poly/init/refIn/refOut/xorOut），输出小写 hex。BigInt 支持 3-82 位宽度；不影响既有 crcGeneric/crc32/crc16。",
  acceptsBytes: true,
  params: [
    { key: "algorithm", label: "Algorithm", type: "select", default: "CRC-32/ISO-HDLC", options: ALGO_NAMES },
    { key: "width", label: "Width (bits)", type: "text", default: "0", placeholder: "Custom 时生效" },
    { key: "poly", label: "Polynomial (hex)", type: "text", default: "0", placeholder: "如 04C11DB7" },
    { key: "init", label: "Initialization (hex)", type: "text", default: "0", placeholder: "如 FFFFFFFF" },
    { key: "refIn", label: "Reflect input", type: "bool", default: false },
    { key: "refOut", label: "Reflect output", type: "bool", default: false },
    { key: "xorOut", label: "Xor Output (hex)", type: "text", default: "0", placeholder: "如 FFFFFFFF" },
    { key: "inputMode", label: "输入编码", type: "select", default: "auto", options: [
      { value: "auto", label: "自动（真字节 / UTF-8 文本）" },
      { value: "text", label: "UTF-8 文本" },
      { value: "hex", label: "Hex" },
    ] },
  ],
  run: (t, p = {}) => {
    const bytes = toBytes(t, p);
    if (p.algorithm === "Custom") {
      const width = Number(p.width);
      if (!Number.isInteger(width) || width < 1) throw new Error("CRC Custom：width 须为正整数");
      const poly = BigInt("0x" + String(p.poly || "0").replace(/^0x/i, ""));
      const init = BigInt("0x" + String(p.init || "0").replace(/^0x/i, ""));
      const xorOut = BigInt("0x" + String(p.xorOut || "0").replace(/^0x/i, ""));
      return crcValue(width, bytes, poly, init, !!p.refIn, !!p.refOut, xorOut);
    }
    const spec = CRC_TABLE[p.algorithm || "CRC-32/ISO-HDLC"];
    if (!spec) throw new Error("CRC：未知算法 " + p.algorithm);
    return crcValue(spec[0], bytes, spec[1], spec[2], spec[3], spec[4], spec[5]);
  },
});

register({
  id: "generateAllChecksums",
  cat: "hash",
  name: "Generate all checksums（CC 对齐）",
  desc: "CyberChef Generate all checksums 对齐：按 CC 同顺序输出 171 个 CRC + Fletcher-8/16/32/64 + Adler-32，支持 Length (bits) 过滤与 Include names。",
  acceptsBytes: true,
  params: [
    { key: "length", label: "Length (bits)", type: "select", default: "All", options: LENGTHS },
    { key: "includeNames", label: "Include names", type: "bool", default: true },
    { key: "inputMode", label: "输入编码", type: "select", default: "auto", options: [
      { value: "auto", label: "自动（真字节 / UTF-8 文本）" },
      { value: "text", label: "UTF-8 文本" },
      { value: "hex", label: "Hex" },
    ] },
  ],
  run: (t, p = {}) => {
    const bytes = toBytes(t, p);
    const length = String(p.length || "All");
    const includeNames = p.includeNames !== false;
    let out = "";
    for (const name of CHECKSUM_ORDER) {
      const m = name.match(/-(\d{1,2})(\/|$)/);
      const bits = m ? m[1] : "";
      if (length !== "All" && length !== bits) continue;
      let value;
      const spec = CRC_TABLE[name];
      if (spec) value = crcValue(spec[0], bytes, spec[1], spec[2], spec[3], spec[4], spec[5]);
      else if (name === "Fletcher-8") value = fletcher8(bytes);
      else if (name === "Fletcher-16") value = fletcher16(bytes);
      else if (name === "Fletcher-32") value = fletcher32(bytes);
      else if (name === "Fletcher-64") value = fletcher64(bytes);
      else if (name === "Adler-32") value = adler32(bytes);
      else throw new Error("未知 checksum " + name);
      out += includeNames ? name + ":" + " ".repeat(25 - name.length) + value + "\n" : value + "\n";
    }
    return out;
  },
});

export { crcValue, fletcher8, fletcher16, fletcher32, fletcher64, adler32, CRC_TABLE, CHECKSUM_ORDER };
