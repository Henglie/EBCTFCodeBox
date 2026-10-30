/*
 * sshKey.js — OpenSSH 私钥容器（openssh-key-v1）解析 / 解密 / 转 PEM。
 *
 * 标准依据（照标准实现，不编造）：
 * - 容器格式 = OpenSSH PROTOCOL.key（AUTH_MAGIC "openssh-key-v1"）：
 *   byte[] AUTH_MAGIC; string ciphername; string kdfname; string kdfoptions;
 *   uint32 N; string pubkey×N; string 加密且按 1,2,3,… 补齐的私钥列表。
 *   私钥列表 = uint32 checkint; uint32 checkint; (私钥 blob + string 注释)×N; 补齐字节。
 * - KDF = bcrypt_pbkdf（OpenSSH openbsd-compat/bcrypt_pbkdf.c v1.17）：
 *   · SHA-512 预处理：sha2pass = SHA512(pass)；
 *   · 逐 32B 输出块 count=1,2,…：sha2salt = SHA512(salt‖BE32(count))，
 *     out = ⊕ᵢ bcrypt_hash(sha2pass, SHA512ᵢ(tmpout))；
 *   · bcrypt_hash = Blowfish_expandstate(sha2salt, sha2pass) + 64×(expand0(sha2salt),
 *     expand0(sha2pass))，再对 "OxychromaticBlowfishSwatDynamite" 64×blf_enc，
 *     输出按每字 4 字节小端写出；
 *   · 输出按 stride = ⌈keylen/32⌉ 交错散布（非线性写出，pbkdf2 偏差）。
 * - 私钥 blob = RFC 4251/4253 wire 格式（string/mpint 大端）。
 * - PEM 导出 = RFC 5958（Ed25519 PKCS#8，曲线 OID 见 RFC 8410）、
 *   RFC 8017 A.1.2（RSA PKCS#1）、SEC 1 v2 C.4（EC 私钥）。
 * - 指纹 = RFC 4716/FIDO 口径：SHA256:base64(SHA-256(pubkey blob))。
 *
 * 复用：SHA-512 ← ed25519.js；AES-256-CTR/CBC ← modern.js；DER/PEM ← rsagen.js。
 * Blowfish π 常量与 ExpandState/Expand0/Encipher 核心与 bcrypt.js 同源（该文件
 * 因 modernExt2.js 未导出常量而自带一份，此处同理自带，已按 bcrypt_pbkdf.c
 * 的调用次序（expand0 先 sha2salt 后 sha2pass）重排，不能直接复用 bcrypt 导出）。
 *
 * 红线：件内自注册，零 UI 依赖，node 可直测；口令与密钥材料只在本地处理，零外发。
 */

import { register } from "./registry.js";
import { sha512 } from "./ed25519.js";
import { aesDecrypt } from "./modern.js";
import {
  derEncode, derDecode, derInt, derSeq, derOid, derOctetString, derBitString,
  derBytesToBigint, bytesToBase64, derToPem,
} from "./rsagen.js";

// ============================================================
// Blowfish 核心（与 bcrypt.js 同源；π 初始常量 + ExpandState 族）
// ============================================================

const BF_P_INIT = new Uint32Array([
  0x243F6A88, 0x85A308D3, 0x13198A2E, 0x03707344, 0xA4093822, 0x299F31D0,
  0x082EFA98, 0xEC4E6C89, 0x452821E6, 0x38D01377, 0xBE5466CF, 0x34E90C6C,
  0xC0AC29B7, 0xC97C50DD, 0x3F84D5B5, 0xB5470917, 0x9216D5D9, 0x8979FB1B,
]);

const BF_S_INIT = [
  new Uint32Array([
    0xD1310BA6, 0x98DFB5AC, 0x2FFD72DB, 0xD01ADFB7, 0xB8E1AFED, 0x6A267E96, 0xBA7C9045, 0xF12C7F99,
    0x24A19947, 0xB3916CF7, 0x0801F2E2, 0x858EFC16, 0x636920D8, 0x71574E69, 0xA458FEA3, 0xF4933D7E,
    0x0D95748F, 0x728EB658, 0x718BCD58, 0x82154AEE, 0x7B54A41D, 0xC25A59B5, 0x9C30D539, 0x2AF26013,
    0xC5D1B023, 0x286085F0, 0xCA417918, 0xB8DB38EF, 0x8E79DCB0, 0x603A180E, 0x6C9E0E8B, 0xB01E8A3E,
    0xD71577C1, 0xBD314B27, 0x78AF2FDA, 0x55605C60, 0xE65525F3, 0xAA55AB94, 0x57489862, 0x63E81440,
    0x55CA396A, 0x2AAB10B6, 0xB4CC5C34, 0x1141E8CE, 0xA15486AF, 0x7C72E993, 0xB3EE1411, 0x636FBC2A,
    0x2BA9C55D, 0x741831F6, 0xCE5C3E16, 0x9B87931E, 0xAFD6BA33, 0x6C24CF5C, 0x7A325381, 0x28958677,
    0x3B8F4898, 0x6B4BB9AF, 0xC4BFE81B, 0x66282193, 0x61D809CC, 0xFB21A991, 0x487CAC60, 0x5DEC8032,
    0xEF845D5D, 0xE98575B1, 0xDC262302, 0xEB651B88, 0x23893E81, 0xD396ACC5, 0x0F6D6FF3, 0x83F44239,
    0x2E0B4482, 0xA4842004, 0x69C8F04A, 0x9E1F9B5E, 0x21C66842, 0xF6E96C9A, 0x670C9C61, 0xABD388F0,
    0x6A51A0D2, 0xD8542F68, 0x960FA728, 0xAB5133A3, 0x6EEF0B6C, 0x137A3BE4, 0xBA3BF050, 0x7EFB2A98,
    0xA1F1651D, 0x39AF0176, 0x66CA593E, 0x82430E88, 0x8CEE8619, 0x456F9FB4, 0x7D84A5C3, 0x3B8B5EBE,
    0xE06F75D8, 0x85C12073, 0x401A449F, 0x56C16AA6, 0x4ED3AA62, 0x363F7706, 0x1BFEDF72, 0x429B023D,
    0x37D0D724, 0xD00A1248, 0xDB0FEAD3, 0x49F1C09B, 0x075372C9, 0x80991B7B, 0x25D479D8, 0xF6E8DEF7,
    0xE3FE501A, 0xB6794C3B, 0x976CE0BD, 0x04C006BA, 0xC1A94FB6, 0x409F60C4, 0x5E5C9EC2, 0x196A2463,
    0x68FB6FAF, 0x3E6C53B5, 0x1339B2EB, 0x3B52EC6F, 0x6DFC511F, 0x9B30952C, 0xCC814544, 0xAF5EBD09,
    0xBEE3D004, 0xDE334AFD, 0x660F2807, 0x192E4BB3, 0xC0CBA857, 0x45C8740F, 0xD20B5F39, 0xB9D3FBDB,
    0x5579C0BD, 0x1A60320A, 0xD6A100C6, 0x402C7279, 0x679F25FE, 0xFB1FA3CC, 0x8EA5E9F8, 0xDB3222F8,
    0x3C7516DF, 0xFD616B15, 0x2F501EC8, 0xAD0552AB, 0x323DB5FA, 0xFD238760, 0x53317B48, 0x3E00DF82,
    0x9E5C57BB, 0xCA6F8CA0, 0x1A87562E, 0xDF1769DB, 0xD542A8F6, 0x287EFFC3, 0xAC6732C6, 0x8C4F5573,
    0x695B27B0, 0xBBCA58C8, 0xE1FFA35D, 0xB8F011A0, 0x10FA3D98, 0xFD2183B8, 0x4AFCB56C, 0x2DD1D35B,
    0x9A53E479, 0xB6F84565, 0xD28E49BC, 0x4BFB9790, 0xE1DDF2DA, 0xA4CB7E33, 0x62FB1341, 0xCEE4C6E8,
    0xEF20CADA, 0x36774C01, 0xD07E9EFE, 0x2BF11FB4, 0x95DBDA4D, 0xAE909198, 0xEAAD8E71, 0x6B93D5A0,
    0xD08ED1D0, 0xAFC725E0, 0x8E3C5B2F, 0x8E7594B7, 0x8FF6E2FB, 0xF2122B64, 0x8888B812, 0x900DF01C,
    0x4FAD5EA0, 0x688FC31C, 0xD1CFF191, 0xB3A8C1AD, 0x2F2F2218, 0xBE0E1777, 0xEA752DFE, 0x8B021FA1,
    0xE5A0CC0F, 0xB56F74E8, 0x18ACF3D6, 0xCE89E299, 0xB4A84FE0, 0xFD13E0B7, 0x7CC43B81, 0xD2ADA8D9,
    0x165FA266, 0x80957705, 0x93CC7314, 0x211A1477, 0xE6AD2065, 0x77B5FA86, 0xC75442F5, 0xFB9D35CF,
    0xEBCDAF0C, 0x7B3E89A0, 0xD6411BD3, 0xAE1E7E49, 0x00250E2D, 0x2071B35E, 0x226800BB, 0x57B8E0AF,
    0x2464369B, 0xF009B91E, 0x5563911D, 0x59DFA6AA, 0x78C14389, 0xD95A537F, 0x207D5BA2, 0x02E5B9C5,
    0x83260376, 0x6295CFA9, 0x11C81968, 0x4E734A41, 0xB3472DCA, 0x7B14A94A, 0x1B510052, 0x9A532915,
    0xD60F573F, 0xBC9BC6E4, 0x2B60A476, 0x81E67400, 0x08BA6FB5, 0x571BE91F, 0xF296EC6B, 0x2A0DD915,
    0xB6636521, 0xE7B9F9B6, 0xFF34052E, 0xC5855664, 0x53B02D5D, 0xA99F8FA1, 0x08BA4799, 0x6E85076A,
  ]),
  new Uint32Array([
    0x4B7A70E9, 0xB5B32944, 0xDB75092E, 0xC4192623, 0xAD6EA6B0, 0x49A7DF7D, 0x9CEE60B8, 0x8FEDB266,
    0xECAA8C71, 0x699A17FF, 0x5664526C, 0xC2B19EE1, 0x193602A5, 0x75094C29, 0xA0591340, 0xE4183A3E,
    0x3F54989A, 0x5B429D65, 0x6B8FE4D6, 0x99F73FD6, 0xA1D29C07, 0xEFE830F5, 0x4D2D38E6, 0xF0255DC1,
    0x4CDD2086, 0x8470EB26, 0x6382E9C6, 0x021ECC5E, 0x09686B3F, 0x3EBAEFC9, 0x3C971814, 0x6B6A70A1,
    0x687F3584, 0x52A0E286, 0xB79C5305, 0xAA500737, 0x3E07841C, 0x7FDEAE5C, 0x8E7D44EC, 0x5716F2B8,
    0xB03ADA37, 0xF0500C0D, 0xF01C1F04, 0x0200B3FF, 0xAE0CF51A, 0x3CB574B2, 0x25837A58, 0xDC0921BD,
    0xD19113F9, 0x7CA92FF6, 0x94324773, 0x22F54701, 0x3AE5E581, 0x37C2DADC, 0xC8B57634, 0x9AF3DDA7,
    0xA9446146, 0x0FD0030E, 0xECC8C73E, 0xA4751E41, 0xE238CD99, 0x3BEA0E2F, 0x3280BBA1, 0x183EB331,
    0x4E548B38, 0x4F6DB908, 0x6F420D03, 0xF60A04BF, 0x2CB81290, 0x24977C79, 0x5679B072, 0xBCAF89AF,
    0xDE9A771F, 0xD9930810, 0xB38BAE12, 0xDCCF3F2E, 0x5512721F, 0x2E6B7124, 0x501ADDE6, 0x9F84CD87,
    0x7A584718, 0x7408DA17, 0xBC9F9ABC, 0xE94B7D8C, 0xEC7AEC3A, 0xDB851DFA, 0x63094366, 0xC464C3D2,
    0xEF1C1847, 0x3215D908, 0xDD433B37, 0x24C2BA16, 0x12A14D43, 0x2A65C451, 0x50940002, 0x133AE4DD,
    0x71DFF89E, 0x10314E55, 0x81AC77D6, 0x5F11199B, 0x043556F1, 0xD7A3C76B, 0x3C11183B, 0x5924A509,
    0xF28FE6ED, 0x97F1FBFA, 0x9EBABF2C, 0x1E153C6E, 0x86E34570, 0xEAE96FB1, 0x860E5E0A, 0x5A3E2AB3,
    0x771FE71C, 0x4E3D06FA, 0x2965DCB9, 0x99E71D0F, 0x803E89D6, 0x5266C825, 0x2E4CC978, 0x9C10B36A,
    0xC6150EBA, 0x94E2EA78, 0xA5FC3C53, 0x1E0A2DF4, 0xF2F74EA7, 0x361D2B3D, 0x1939260F, 0x19C27960,
    0x5223A708, 0xF71312B6, 0xEBADFE6E, 0xEAC31F66, 0xE3BC4595, 0xA67BC883, 0xB17F37D1, 0x018CFF28,
    0xC332DDEF, 0xBE6C5AA5, 0x65582185, 0x68AB9802, 0xEECEA50F, 0xDB2F953B, 0x2AEF7DAD, 0x5B6E2F84,
    0x1521B628, 0x29076170, 0xECDD4775, 0x619F1510, 0x13CCA830, 0xEB61BD96, 0x0334FE1E, 0xAA0363CF,
    0xB5735C90, 0x4C70A239, 0xD59E9E0B, 0xCBAADE14, 0xEECC86BC, 0x60622CA7, 0x9CAB5CAB, 0xB2F3846E,
    0x648B1EAF, 0x19BDF0CA, 0xA02369B9, 0x655ABB50, 0x40685A32, 0x3C2AB4B3, 0x319EE9D5, 0xC021B8F7,
    0x9B540B19, 0x875FA099, 0x95F7997E, 0x623D7DA8, 0xF837889A, 0x97E32D77, 0x11ED935F, 0x16681281,
    0x0E358829, 0xC7E61FD6, 0x96DEDFA1, 0x7858BA99, 0x57F584A5, 0x1B227263, 0x9B83C3FF, 0x1AC24696,
    0xCDB30AEB, 0x532E3054, 0x8FD948E4, 0x6DBC3128, 0x58EBF2EF, 0x34C6FFEA, 0xFE28ED61, 0xEE7C3C73,
    0x5D4A14D9, 0xE864B7E3, 0x42105D14, 0x203E13E0, 0x45EEE2B6, 0xA3AAABEA, 0xDB6C4F15, 0xFACB4FD0,
    0xC742F442, 0xEF6ABBB5, 0x654F3B1D, 0x41CD2105, 0xD81E799E, 0x86854DC7, 0xE44B476A, 0x3D816250,
    0xCF62A1F2, 0x5B8D2646, 0xFC8883A0, 0xC1C7B6A3, 0x7F1524C3, 0x69CB7492, 0x47848A0B, 0x5692B285,
    0x095BBF00, 0xAD19489D, 0x1462B174, 0x23820E00, 0x58428D2A, 0x0C55F5EA, 0x1DADF43E, 0x233F7061,
    0x3372F092, 0x8D937E41, 0xD65FECF1, 0x6C223BDB, 0x7CDE3759, 0xCBEE7460, 0x4085F2A7, 0xCE77326E,
    0xA6078084, 0x19F8509E, 0xE8EFD855, 0x61D99735, 0xA969A7AA, 0xC50C06C2, 0x5A04ABFC, 0x800BCADC,
    0x9E447A2E, 0xC3453484, 0xFDD56705, 0x0E1E9EC9, 0xDB73DBD3, 0x105588CD, 0x675FDA79, 0xE3674340,
    0xC5C43465, 0x713E38D8, 0x3D28F89E, 0xF16DFF20, 0x153E21E7, 0x8FB03D4A, 0xE6E39F2B, 0xDB83ADF7,
  ]),
  new Uint32Array([
    0xE93D5A68, 0x948140F7, 0xF64C261C, 0x94692934, 0x411520F7, 0x7602D4F7, 0xBCF46B2E, 0xD4A20068,
    0xD4082471, 0x3320F46A, 0x43B7D4B7, 0x500061AF, 0x1E39F62E, 0x97244546, 0x14214F74, 0xBF8B8840,
    0x4D95FC1D, 0x96B591AF, 0x70F4DDD3, 0x66A02F45, 0xBFBC09EC, 0x03BD9785, 0x7FAC6DD0, 0x31CB8504,
    0x96EB27B3, 0x55FD3941, 0xDA2547E6, 0xABCA0A9A, 0x28507825, 0x530429F4, 0x0A2C86DA, 0xE9B66DFB,
    0x68DC1462, 0xD7486900, 0x680EC0A4, 0x27A18DEE, 0x4F3FFEA2, 0xE887AD8C, 0xB58CE006, 0x7AF4D6B6,
    0xAACE1E7C, 0xD3375FEC, 0xCE78A399, 0x406B2A42, 0x20FE9E35, 0xD9F385B9, 0xEE39D7AB, 0x3B124E8B,
    0x1DC9FAF7, 0x4B6D1856, 0x26A36631, 0xEAE397B2, 0x3A6EFA74, 0xDD5B4332, 0x6841E7F7, 0xCA7820FB,
    0xFB0AF54E, 0xD8FEB397, 0x454056AC, 0xBA489527, 0x55533A3A, 0x20838D87, 0xFE6BA9B7, 0xD096954B,
    0x55A867BC, 0xA1159A58, 0xCCA92963, 0x99E1DB33, 0xA62A4A56, 0x3F3125F9, 0x5EF47E1C, 0x9029317C,
    0xFDF8E802, 0x04272F70, 0x80BB155C, 0x05282CE3, 0x95C11548, 0xE4C66D22, 0x48C1133F, 0xC70F86DC,
    0x07F9C9EE, 0x41041F0F, 0x404779A4, 0x5D886E17, 0x325F51EB, 0xD59BC0D1, 0xF2BCC18F, 0x41113564,
    0x257B7834, 0x602A9C60, 0xDFF8E8A3, 0x1F636C1B, 0x0E12B4C2, 0x02E1329E, 0xAF664FD1, 0xCAD18115,
    0x6B2395E0, 0x333E92E1, 0x3B240B62, 0xEEBEB922, 0x85B2A20E, 0xE6BA0D99, 0xDE720C8C, 0x2DA2F728,
    0xD0127845, 0x95B794FD, 0x647D0862, 0xE7CCF5F0, 0x5449A36F, 0x877D48FA, 0xC39DFD27, 0xF33E8D1E,
    0x0A476341, 0x992EFF74, 0x3A6F6EAB, 0xF4F8FD37, 0xA812DC60, 0xA1EBDDF8, 0x991BE14C, 0xDB6E6B0D,
    0xC67B5510, 0x6D672C37, 0x2765D43B, 0xDCD0E804, 0xF1290DC7, 0xCC00FFA3, 0xB5390F92, 0x690FED0B,
    0x667B9FFB, 0xCEDB7D9C, 0xA091CF0B, 0xD9155EA3, 0xBB132F88, 0x515BAD24, 0x7B9479BF, 0x763BD6EB,
    0x37392EB3, 0xCC115979, 0x8026E297, 0xF42E312D, 0x6842ADA7, 0xC66A2B3B, 0x12754CCC, 0x782EF11C,
    0x6A124237, 0xB79251E7, 0x06A1BBE6, 0x4BFB6350, 0x1A6B1018, 0x11CAEDFA, 0x3D25BDD8, 0xE2E1C3C9,
    0x44421659, 0x0A121386, 0xD90CEC6E, 0xD5ABEA2A, 0x64AF674E, 0xDA86A85F, 0xBEBFE988, 0x64E4C3FE,
    0x9DBC8057, 0xF0F7C086, 0x60787BF8, 0x6003604D, 0xD1FD8346, 0xF6381FB0, 0x7745AE04, 0xD736FCCC,
    0x83426B33, 0xF01EAB71, 0xB0804187, 0x3C005E5F, 0x77A057BE, 0xBDE8AE24, 0x55464299, 0xBF582E61,
    0x4E58F48F, 0xF2DDFDA2, 0xF474EF38, 0x8789BDC2, 0x5366F9C3, 0xC8B38E74, 0xB475F255, 0x46FCD9B9,
    0x7AEB2661, 0x8B1DDF84, 0x846A0E79, 0x915F95E2, 0x466E598E, 0x20B45770, 0x8CD55591, 0xC902DE4C,
    0xB90BACE1, 0xBB8205D0, 0x11A86248, 0x7574A99E, 0xB77F19B6, 0xE0A9DC09, 0x662D09A1, 0xC4324633,
    0xE85A1F02, 0x09F0BE8C, 0x4A99A025, 0x1D6EFE10, 0x1AB93D1D, 0x0BA5A4DF, 0xA186F20F, 0x2868F169,
    0xDCB7DA83, 0x573906FE, 0xA1E2CE9B, 0x4FCD7F52, 0x50115E01, 0xA70683FA, 0xA002B5C4, 0x0DE6D027,
    0x9AF88C27, 0x773F8641, 0xC3604C06, 0x61A806B5, 0xF0177A28, 0xC0F586E0, 0x006058AA, 0x30DC7D62,
    0x11E69ED7, 0x2338EA63, 0x53C2DD94, 0xC2C21634, 0xBBCBEE56, 0x90BCB6DE, 0xEBFC7DA1, 0xCE591D76,
    0x6F05E409, 0x4B7C0188, 0x39720A3D, 0x7C927C24, 0x86E3725F, 0x724D9DB9, 0x1AC15BB4, 0xD39EB8FC,
    0xED545578, 0x08FCA5B5, 0xD83D7CD3, 0x4DAD0FC4, 0x1E50EF5E, 0xB161E6F8, 0xA28514D9, 0x6C51133C,
    0x6FD5C7E7, 0x56E14EC4, 0x362ABFCE, 0xDDC6C837, 0xD79A3234, 0x92638212, 0x670EFA8E, 0x406000E0,
  ]),
  new Uint32Array([
    0x3A39CE37, 0xD3FAF5CF, 0xABC27737, 0x5AC52D1B, 0x5CB0679E, 0x4FA33742, 0xD3822740, 0x99BC9BBE,
    0xD5118E9D, 0xBF0F7315, 0xD62D1C7E, 0xC700C47B, 0xB78C1B6B, 0x21A19045, 0xB26EB1BE, 0x6A366EB4,
    0x5748AB2F, 0xBC946E79, 0xC6A376D2, 0x6549C2C8, 0x530FF8EE, 0x468DDE7D, 0xD5730A1D, 0x4CD04DC6,
    0x2939BBDB, 0xA9BA4650, 0xAC9526E8, 0xBE5EE304, 0xA1FAD5F0, 0x6A2D519A, 0x63EF8CE2, 0x9A86EE22,
    0xC089C2B8, 0x43242EF6, 0xA51E03AA, 0x9CF2D0A4, 0x83C061BA, 0x9BE96A4D, 0x8FE51550, 0xBA645BD6,
    0x2826A2F9, 0xA73A3AE1, 0x4BA99586, 0xEF5562E9, 0xC72FEFD3, 0xF752F7DA, 0x3F046F69, 0x77FA0A59,
    0x80E4A915, 0x87B08601, 0x9B09E6AD, 0x3B3EE593, 0xE990FD5A, 0x9E34D797, 0x2CF0B7D9, 0x022B8B51,
    0x96D5AC3A, 0x017DA67D, 0xD1CF3ED6, 0x7C7D2D28, 0x1F9F25CF, 0xADF2B89B, 0x5AD6B472, 0x5A88F54C,
    0xE029AC71, 0xE019A5E6, 0x47B0ACFD, 0xED93FA9B, 0xE8D3C48D, 0x283B57CC, 0xF8D56629, 0x79132E28,
    0x785F0191, 0xED756055, 0xF7960E44, 0xE3D35E8C, 0x15056DD4, 0x88F46DBA, 0x03A16125, 0x0564F0BD,
    0xC3EB9E15, 0x3C9057A2, 0x97271AEC, 0xA93A072A, 0x1B3F6D9B, 0x1E6321F5, 0xF59C66FB, 0x26DCF319,
    0x7533D928, 0xB155FDF5, 0x03563482, 0x8ABA3CBB, 0x28517711, 0xC20AD9F8, 0xABCC5167, 0xCCAD925F,
    0x4DE81751, 0x3830DC8E, 0x379D5862, 0x9320F991, 0xEA7A90C2, 0xFB3E7BCE, 0x5121CE64, 0x774FBE32,
    0xA8B6E37E, 0xC3293D46, 0x48DE5369, 0x6413E680, 0xA2AE0810, 0xDD6DB224, 0x69852DFD, 0x09072166,
    0xB39A460A, 0x6445C0DD, 0x586CDECF, 0x1C20C8AE, 0x5BBEF7DD, 0x1B588D40, 0xCCD2017F, 0x6BB4E3BB,
    0xDDA26A7E, 0x3A59FF45, 0x3E350A44, 0xBCB4CDD5, 0x72EACEA8, 0xFA6484BB, 0x8D6612AE, 0xBF3C6F47,
    0xD29BE463, 0x542F5D9E, 0xAEC2771B, 0xF64E6370, 0x740E0D8D, 0xE75B1357, 0xF8721671, 0xAF537D5D,
    0x4040CB08, 0x4EB4E2CC, 0x34D2466A, 0x0115AF84, 0xE1B00428, 0x95983A1D, 0x06B89FB4, 0xCE6EA048,
    0x6F3F3B82, 0x3520AB82, 0x011A1D4B, 0x277227F8, 0x611560B1, 0xE7933FDC, 0xBB3A792B, 0x344525BD,
    0xA08839E1, 0x51CE794B, 0x2F32C9B7, 0xA01FBAC9, 0xE01CC87E, 0xBCC7D1F6, 0xCF0111C3, 0xA1E8AAC7,
    0x1A908749, 0xD44FBD9A, 0xD0DADECB, 0xD50ADA38, 0x0339C32A, 0xC6913667, 0x8DF9317C, 0xE0B12B4F,
    0xF79E59B7, 0x43F5BB3A, 0xF2D519FF, 0x27D9459C, 0xBF97222C, 0x15E6FC2A, 0x0F91FC71, 0x9B941525,
    0xFAE59361, 0xCEB69CEB, 0xC2A86459, 0x12BAA8D1, 0xB6C1075E, 0xE3056A0C, 0x10D25065, 0xCB03A442,
    0xE0EC6E0E, 0x1698DB3B, 0x4C98A0BE, 0x3278E964, 0x9F1F9532, 0xE0D392DF, 0xD3A0342B, 0x8971F21E,
    0x1B0A7441, 0x4BA3348C, 0xC5BE7120, 0xC37632D8, 0xDF359F8D, 0x9B992F2E, 0xE60B6F47, 0x0FE3F11D,
    0xE54CDA54, 0x1EDAD891, 0xCE6279CF, 0xCD3E7E6F, 0x1618B166, 0xFD2C1D05, 0x848FD2C5, 0xF6FB2299,
    0xF523F357, 0xA6327623, 0x93A83531, 0x56CCCD02, 0xACF08162, 0x5A75EBB5, 0x6E163697, 0x88D273CC,
    0xDE966292, 0x81B949D0, 0x4C50901B, 0x71C65614, 0xE6C6C7BD, 0x327A140A, 0x45E1D006, 0xC3F27B9A,
    0xC9AA53FD, 0x62A80F00, 0xBB25BFE2, 0x35BDD2F6, 0x71126905, 0xB2040222, 0xB6CBCF7C, 0xCD769C2B,
    0x53113EC0, 0x1640E3D3, 0x38ABBD60, 0x2547ADF0, 0xBA38209C, 0xF746CE76, 0x77AFA1C5, 0x20756060,
    0x85CBFE4E, 0x8AE88DD8, 0x7AAAF9B0, 0x4CF9AA7E, 0x1948C25C, 0x02FB8A8C, 0x01C36AE4, 0xD6EBE1F9,
    0x90D4F869, 0xA65CDEA0, 0x3F09252D, 0xC208E69F, 0xB74E6132, 0xCE77E25B, 0x578FDFE3, 0x3AC372E6,
  ]),
];

function bfEncipher(P, S, xl, xr) {
  let L = xl >>> 0, R = xr >>> 0;
  for (let i = 0; i < 16; i++) {
    L = (L ^ P[i]) >>> 0;
    const f = ((((S[0][(L >>> 24) & 0xFF] + S[1][(L >>> 16) & 0xFF]) >>> 0) ^ S[2][(L >>> 8) & 0xFF]) + S[3][L & 0xFF]) >>> 0;
    R = (R ^ f) >>> 0;
    const t = L; L = R; R = t;
  }
  const t = L; L = R; R = t; // 撤销最后一次交换
  R = (R ^ P[16]) >>> 0;
  L = (L ^ P[17]) >>> 0;
  return [L >>> 0, R >>> 0];
}

// 从字节流按 32bit 大端循环读取一个字（ExpandKey 用；cursor 为外部游标）
function streamWord(data, cursor) {
  let word = 0;
  for (let i = 0; i < 4; i++) {
    word = ((word << 8) | data[cursor.off % data.length]) >>> 0;
    cursor.off++;
  }
  return word >>> 0;
}

// Blowfish_expandstate：key 循环 XOR 进 P，data 循环 XOR 进加密链逐步填充 P/S
function expandKey(P, S, data, key) {
  const kc = { off: 0 };
  for (let i = 0; i < 18; i++) {
    P[i] = (P[i] ^ streamWord(key, kc)) >>> 0;
  }
  const dc = { off: 0 };
  let L = 0, R = 0;
  for (let i = 0; i < 18; i += 2) {
    L = (L ^ streamWord(data, dc)) >>> 0;
    R = (R ^ streamWord(data, dc)) >>> 0;
    [L, R] = bfEncipher(P, S, L, R);
    P[i] = L; P[i + 1] = R;
  }
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < 256; i += 2) {
      L = (L ^ streamWord(data, dc)) >>> 0;
      R = (R ^ streamWord(data, dc)) >>> 0;
      [L, R] = bfEncipher(P, S, L, R);
      S[s][i] = L; S[s][i + 1] = R;
    }
  }
}

// Blowfish_expand0state：data=0 的快路
function expandKeyZero(P, S, key) {
  const kc = { off: 0 };
  for (let i = 0; i < 18; i++) {
    P[i] = (P[i] ^ streamWord(key, kc)) >>> 0;
  }
  let L = 0, R = 0;
  for (let i = 0; i < 18; i += 2) {
    [L, R] = bfEncipher(P, S, L, R);
    P[i] = L; P[i + 1] = R;
  }
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < 256; i += 2) {
      [L, R] = bfEncipher(P, S, L, R);
      S[s][i] = L; S[s][i + 1] = R;
    }
  }
}

// ============================================================
// bcrypt_pbkdf（OpenSSH openbsd-compat/bcrypt_pbkdf.c v1.17 照抄口径）
// ============================================================

const BC_MAGIC = "OxychromaticBlowfishSwatDynamite"; // 32 字节，注意与 bcrypt 本体的 Orphean… 不同

/** bcrypt_hash(sha2pass, sha2salt) → 32 字节（字内小端写出） */
function bcryptHash(sha2pass, sha2salt) {
  if (sha2pass.length !== 64 || sha2salt.length !== 64) throw new Error("bcrypt_hash 输入必须是 64 字节 SHA-512 摘要");
  const P = new Uint32Array(BF_P_INIT);
  const S = [
    new Uint32Array(BF_S_INIT[0]), new Uint32Array(BF_S_INIT[1]),
    new Uint32Array(BF_S_INIT[2]), new Uint32Array(BF_S_INIT[3]),
  ];
  // key expansion：ExpandState(data=sha2salt, key=sha2pass)，再 64×(expand0(salt), expand0(pass))
  expandKey(P, S, sha2salt, sha2pass);
  for (let i = 0; i < 64; i++) {
    expandKeyZero(P, S, sha2salt);
    expandKeyZero(P, S, sha2pass);
  }
  // encryption：magic 串切成 8 个大端字，64×blf_enc(4 blocks) 原地加密
  let j = 0;
  const cdata = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    cdata[i] = ((BC_MAGIC.charCodeAt(j++) & 0xff) << 24)
      | ((BC_MAGIC.charCodeAt(j++) & 0xff) << 16)
      | ((BC_MAGIC.charCodeAt(j++) & 0xff) << 8)
      | (BC_MAGIC.charCodeAt(j++) & 0xff);
  }
  for (let i = 0; i < 64; i++) {
    for (let b = 0; b < 8; b += 2) {
      const [l, r] = bfEncipher(P, S, cdata[b], cdata[b + 1]);
      cdata[b] = l; cdata[b + 1] = r;
    }
  }
  // copy out：每字 4 字节按小端写出（C: out[4i+0]=cdata[i]&0xff …）
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[4 * i + 0] = cdata[i] & 0xff;
    out[4 * i + 1] = (cdata[i] >>> 8) & 0xff;
    out[4 * i + 2] = (cdata[i] >>> 16) & 0xff;
    out[4 * i + 3] = (cdata[i] >>> 24) & 0xff;
  }
  return out;
}

/**
 * bcrypt_pbkdf(pass, salt, keylen, rounds) → keylen 字节。
 * 输出块间按 stride 交错散布（非线性写出，与 PBKDF2 线性输出不同）。
 */
export function bcryptPbkdf(pass, salt, keylen, rounds) {
  if (!(rounds >= 1)) throw new Error("bcrypt_pbkdf：rounds 必须 ≥ 1");
  if (!pass || pass.length === 0) throw new Error("bcrypt_pbkdf：口令不能为空");
  if (!salt || salt.length === 0) throw new Error("bcrypt_pbkdf：salt 不能为空");
  if (keylen < 1 || keylen > 32 * 32) throw new Error("bcrypt_pbkdf：keylen 超范围（1..1024）");
  if (salt.length > (1 << 20)) throw new Error("bcrypt_pbkdf：salt 过长（>1 MiB）");
  const origkeylen = keylen;
  const sha2pass = sha512(pass);
  const stride = Math.ceil(keylen / 32);
  const amt0 = Math.ceil(keylen / stride);
  const key = new Uint8Array(keylen);
  const countsalt = new Uint8Array(salt.length + 4);
  countsalt.set(salt);
  let remaining = keylen;
  for (let count = 1; remaining > 0; count++) {
    countsalt[salt.length + 0] = (count >>> 24) & 0xff;
    countsalt[salt.length + 1] = (count >>> 16) & 0xff;
    countsalt[salt.length + 2] = (count >>> 8) & 0xff;
    countsalt[salt.length + 3] = count & 0xff;
    let sha2salt = sha512(countsalt);
    let tmpout = bcryptHash(sha2pass, sha2salt);
    const out = tmpout.slice();
    for (let i = 1; i < rounds; i++) {
      sha2salt = sha512(tmpout);      // 后续轮 salt = 上一轮输出
      tmpout = bcryptHash(sha2pass, sha2salt);
      for (let j = 0; j < 32; j++) out[j] ^= tmpout[j];
    }
    const amt = Math.min(amt0, remaining);
    let i = 0;
    for (; i < amt; i++) {
      const dest = i * stride + (count - 1);
      if (dest >= origkeylen) break;
      key[dest] = out[i];
    }
    remaining -= i;
  }
  return key;
}

// ============================================================
// 基础工具：hex / base64 / SSH wire
// ============================================================

function bytesToHex(b) { let s = ""; for (const x of b) s += x.toString(16).padStart(2, "0"); return s; }

/** 标准 base64 解码（RFC 4648 ±_ 字母表不适用；容忍空白与缺 padding） */
function b64ToBytes(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  if (!t) throw new Error("base64 输入为空");
  const pad = (4 - (t.length % 4)) % 4;
  let out = "";
  try { out = atob(t + "=".repeat(pad)); } catch { throw new Error("base64 解码失败（字符集非法）"); }
  const u8 = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) u8[i] = out.charCodeAt(i);
  return u8;
}

/** SSH wire：大端 uint32 */
function rdU32(b, o) {
  if (o + 4 > b.length) throw new Error("SSH wire：uint32 越界");
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
/** SSH wire：string（uint32 长度 + 字节） */
function rdStr(b, o) {
  const len = rdU32(b, o);
  if (o + 4 + len > b.length) throw new Error("SSH wire：string 长度越界");
  return { s: b.slice(o + 4, o + 4 + len), next: o + 4 + len };
}
function te(s) { return new TextEncoder().encode(String(s)); }
function bytesToUtf8(b) { return new TextDecoder().decode(b); }

// ============================================================
// openssh-key-v1 容器解析 + 解密
// ============================================================

const SSH_CIPHERS = {
  "aes256-ctr": { keyLen: 32, ivLen: 16, mode: "CTR" },
  "aes256-cbc": { keyLen: 32, ivLen: 16, mode: "CBC" },
  "none": null,
};

/** 解析 OpenSSH 私钥容器（已 base64 解码的字节）→ 结构化对象（不解密） */
export function parseOpensshContainer(b) {
  const MAGIC = "openssh-key-v1";
  if (b.length < 15) throw new Error(`OpenSSH 私钥：数据过短（${b.length} 字节）`);
  for (let i = 0; i < 14; i++) if (b[i] !== MAGIC.charCodeAt(i)) throw new Error("OpenSSH 私钥：magic 非法（应 openssh-key-v1）");
  if (b[14] !== 0x00) throw new Error("OpenSSH 私钥：magic 未以 NUL 终止");
  let o = 15;
  const cipher = (() => { const r = rdStr(b, o); o = r.next; return bytesToUtf8(r.s); })();
  const kdfname = (() => { const r = rdStr(b, o); o = r.next; return bytesToUtf8(r.s); })();
  const kdfopts = (() => { const r = rdStr(b, o); o = r.next; return r.s; })();
  const nkeys = rdU32(b, o); o += 4;
  if (nkeys < 1 || nkeys > 16) throw new Error(`OpenSSH 私钥：密钥数 N=${nkeys} 超范围（1..16）`);
  const pubkeys = [];
  for (let i = 0; i < nkeys; i++) { const r = rdStr(b, o); o = r.next; pubkeys.push(r.s); }
  // PROTOCOL.key：最后一字段是 string（uint32 长度 + 加密且补齐的私钥列表）
  const listR = rdStr(b, o);
  if (listR.next !== b.length) throw new Error(`OpenSSH 私钥：容器尾部有 ${b.length - listR.next} 字节尾随数据`);
  const encList = listR.s;
  if (encList.length === 0) throw new Error("OpenSSH 私钥：私钥列表为空");
  return { ciphername: cipher, kdfname, kdfopts, nkeys, pubkeys, encList };
}

/** 解析 bcrypt kdfopts（string salt + uint32 rounds） */
export function parseBcryptKdfOptions(opts) {
  const salt = rdStr(opts, 0);
  const rounds = rdU32(opts, salt.next);
  if (salt.next + 4 !== opts.length) throw new Error("bcrypt kdfopts 长度不符（应 salt‖rounds）");
  return { salt: salt.s, rounds };
}

/** 解密并解析私钥列表（口令为 UTF-8 字节；返回 [{checkint, type, …部件, comment}]） */
export async function decryptOpensshList(cont, passphrase) {
  const { ciphername, kdfname, kdfopts, encList } = cont;
  let plain;
  if (ciphername === "none") {
    if (kdfname !== "none") throw new Error(`cipher=none 但 kdf=${kdfname}，两者不一致`);
    if (kdfopts.length !== 0) throw new Error("kdf=none 时 kdfopts 应为空");
    plain = encList;
  } else {
    const c = SSH_CIPHERS[ciphername];
    if (!c) throw new Error(`不支持的 cipher：${ciphername}（支持 aes256-ctr / aes256-cbc / none）`);
    if (kdfname !== "bcrypt") throw new Error(`不支持的 kdf：${kdfname}（加密时仅支持 bcrypt）`);
    const { salt, rounds } = parseBcryptKdfOptions(kdfopts);
    if (!passphrase) throw new Error("该私钥已加密，必须提供口令");
    const km = bcryptPbkdf(te(passphrase), salt, c.keyLen + c.ivLen, rounds);
    const key = km.slice(0, c.keyLen), iv = km.slice(c.keyLen);
    plain = c.mode === "CTR"
      ? await aesCtrDecrypt(encList, key, iv)
      : aesDecrypt(encList, key, { mode: c.mode, iv, pad: false });
  }
  if (plain.length % 8 !== 0) throw new Error(`解密后长度 ${plain.length} 不是分组整数倍（口令错误或数据损坏）`);
  const c1 = rdU32(plain, 0), c2 = rdU32(plain, 4);
  if (c1 !== c2) throw new Error("解密失败：checkint 校验不一致（口令错误或密文损坏）");
  let o = 8;
  const keys = [];
  for (let i = 0; i < cont.nkeys; i++) {
    // 实测布局（sshkey_private_serialize_opt 内联写法）：私钥字段逐个 string/mpint 排布，
    // 尾随 string 注释；PROTOCOL.key 的 byte[] privatekey1 记法不带外层长度前缀。
    const dec = decodeSshPrivateKey(plain, o);
    o = dec.next;
    const cm = rdStr(plain, o); o = cm.next;
    keys.push({ checkint: c1, comment: bytesToUtf8(cm.s), ...dec });
  }
  const padlen = plain.length - o;
  if (padlen > 255) throw new Error("补齐字节异常（>255）");
  for (let i = 0; i < padlen; i++) {
    if (plain[o + i] !== (i + 1)) throw new Error(`补齐字节非法：第 ${i + 1} 字节应为 ${i + 1}（口令可能错误）`);
  }
  return keys;
}

// ============================================================
// 私钥 blob 解码 + PEM 构建
// ============================================================

const EC_CURVES = {
  "nistp256": { oid: [1, 2, 840, 10045, 3, 1, 7], size: 32 },
  "nistp384": { oid: [1, 3, 132, 0, 34], size: 48 },
  "nistp521": { oid: [1, 3, 132, 0, 35], size: 66 },
};

/** 从 buf[o] 起解码内联私钥字段 → { next, type, …部件, pem, pubPem? } */
export function decodeSshPrivateKey(buf, o) {
  const t0 = rdStr(buf, o); o = t0.next;
  const type = bytesToUtf8(t0.s);
  if (type === "ssh-ed25519") {
    const pub = rdStr(buf, o); o = pub.next;
    const priv = rdStr(buf, o); o = priv.next;
    if (pub.s.length !== 32) throw new Error(`ssh-ed25519：公钥应为 32 字节，实际 ${pub.s.length}`);
    if (priv.s.length !== 64) throw new Error(`ssh-ed25519：私钥应为 64 字节（seed‖pub），实际 ${priv.s.length}`);
    const seed = priv.s.slice(0, 32), pub2 = priv.s.slice(32);
    for (let i = 0; i < 32; i++) if (pub.s[i] !== pub2[i]) throw new Error("ssh-ed25519：私钥段内嵌公钥与外层公钥不一致");
    // PKCS#8（RFC 5958）：SEQ{0, SEQ{OID 1.3.101.112}, OCTETSTRING(OCTETSTRING(seed))}
    const pkcs8 = derSeq(derInt(0n), derSeq(derOid([1, 3, 101, 112])),
      derOctetString(derEncode(derOctetString(seed))));
    const spki = derSeq(derSeq(derOid([1, 3, 101, 112])), derBitString(pub.s));
    return { next: o, type, pub: pub.s, seed, pubHex: bytesToHex(pub.s), seedHex: bytesToHex(seed),
      pem: derToPem("PRIVATE KEY", derEncode(pkcs8)), pubPem: derToPem("PUBLIC KEY", derEncode(spki)) };
  }
  if (type === "ssh-rsa") {
    const n = rdStr(buf, o); o = n.next;
    const e = rdStr(buf, o); o = e.next;
    const d = rdStr(buf, o); o = d.next;
    const iqmp = rdStr(buf, o); o = iqmp.next;
    const p = rdStr(buf, o); o = p.next;
    const q = rdStr(buf, o); o = q.next;
    const N = derBytesToBigint(n.s), E = derBytesToBigint(e.s), D = derBytesToBigint(d.s);
    const P_ = derBytesToBigint(p.s), Q = derBytesToBigint(q.s);
    const Iqmp = derBytesToBigint(iqmp.s);
    if (P_ * Q !== N) throw new Error("ssh-rsa：p·q ≠ n（数据损坏）");
    if ((Iqmp * Q) % P_ !== 1n) throw new Error("ssh-rsa：iqmp 校验失败（应 q⁻¹ mod p）");
    const dP = D % (P_ - 1n), dQ = D % (Q - 1n);
    const pkcs1 = derSeq(derInt(0n), derInt(N), derInt(E), derInt(D), derInt(P_), derInt(Q),
      derInt(dP), derInt(dQ), derInt(Iqmp));
    const pkcs8 = derSeq(derInt(0n), derSeq(derOid([1, 2, 840, 113549, 1, 1, 1]), { tag: 0x05, value: new Uint8Array(0) }),
      derOctetString(derEncode(pkcs1)));
    const spkiBody = derSeq(derSeq(derOid([1, 2, 840, 113549, 1, 1, 1]), { tag: 0x05, value: new Uint8Array(0) }),
      derBitString(derEncode(derSeq(derInt(N), derInt(E)))));
    return { next: o, type, n: N, e: E, d: D, p: P_, q: Q, iqmp: Iqmp,
      pem: derToPem("PRIVATE KEY", derEncode(pkcs8)), pubPem: derToPem("PUBLIC KEY", derEncode(spkiBody)) };
  }
  const m = type.match(/^ecdsa-sha2-(\w+)$/);
  if (m && EC_CURVES[m[1]]) {
    const curve = EC_CURVES[m[1]];
    const cn = rdStr(buf, o); o = cn.next;
    const Q = rdStr(buf, o); o = Q.next;
    const d = rdStr(buf, o); o = d.next;
    if (bytesToUtf8(cn.s) !== m[1]) throw new Error("ecdsa：类型与曲线名不一致");
    const D = derBytesToBigint(d.s);
    if (D <= 0n) throw new Error("ecdsa：私钥必须为正");
    const dBytes = new Uint8Array(curve.size);
    let hex = D.toString(16); if (hex.length % 2) hex = "0" + hex;
    const raw = new Uint8Array(hex.length / 2);
    for (let i = 0; i < raw.length; i++) raw[i] = parseInt(hex.substr(i * 2, 2), 16);
    dBytes.set(raw, curve.size - raw.length);
    // SEC 1 v2 C.4：SEQ{1, OCTETSTRING(d), [0] OID, [1] BITSTRING(Q)}
    const sec1 = derSeq(derInt(1n), derOctetString(dBytes),
      { tag: 0xA0, children: [derOid(curve.oid)] },
      { tag: 0xA1, children: [derBitString(Q.s)] });
    const pkcs8 = derSeq(derInt(0n), derSeq(derOid([1, 2, 840, 10045, 2, 1]), derOid(curve.oid)),
      derOctetString(derEncode(sec1)));
    return { next: o, type, curve: m[1], d: D, pub: Q.s,
      pem: derToPem("PRIVATE KEY", derEncode(pkcs8)), sec1Pem: derToPem("EC PRIVATE KEY", derEncode(sec1)) };
  }
  throw new Error(`不支持的 SSH 密钥类型：${type}（支持 ssh-ed25519 / ssh-rsa / ecdsa-sha2-nistp256/384/521）`);
}

/** 公钥 blob → 授权行 + SHA256 指纹 */
export async function sshPubInfo(pubBlob) {
  let o = 0;
  const t0 = rdStr(pubBlob, o); o = t0.next;
  const type = bytesToUtf8(t0.s);
  const b64 = bytesToBase64(pubBlob);
  const digest = await sha256Bytes(pubBlob);
  const fp = "SHA256:" + bytesToBase64(digest).replace(/=+$/, "");
  return { type, authLine: `${type} ${b64}`, fingerprint: fp };
}

async function sha256Bytes(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（需 HTTPS 或 localhost）");
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** AES-256-CTR 解密（WebCrypto 原生，128 位大端计数器，与 SSH aes*-ctr 语义一致） */
async function aesCtrDecrypt(ct, key, iv) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（需 HTTPS 或 localhost）");
  const k = await crypto.subtle.importKey("raw", key, "AES-CTR", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 128 }, k, ct);
  return new Uint8Array(pt);
}

// ============================================================
// op 注册：OpenSSH 私钥解析
// ============================================================

register({
  id: "sshKeyParse",
  cat: "asym",
  family: "sshKey",
  familyLabel: "parse",
  name: "OpenSSH 私钥解析",
  desc: "OpenSSH openssh-key-v1 容器解析/解密转 PEM（PROTOCOL.key）：支持 aes256-ctr/aes256-cbc + bcrypt KDF（bcrypt_pbkdf）与未加密档；ssh-ed25519/ssh-rsa/ecdsa-nistp256/384/521；输出结构报告、SHA256 指纹与 PKCS#8/SEC1 私钥 PEM（RFC 5958/8017/SEC1）。口令只在本地处理，零外发",
  params: [
    { key: "pass", label: "口令（加密私钥才填）", type: "text", default: "", placeholder: "加密私钥的 passphrase，留空仅支持未加密" },
  ],
  run: async (_text, p) => {
    const raw = String(_text || "");
    let body;
    if (/BEGIN OPENSSH PRIVATE KEY/.test(raw)) {
      const m = raw.match(/-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/);
      if (!m) throw new Error("找到 BEGIN 但缺 END 标记");
      body = b64ToBytes(m[1]);
    } else {
      body = b64ToBytes(raw);
    }
    const cont = parseOpensshContainer(body);
    const lines = [
      "=== OpenSSH 私钥（openssh-key-v1）===",
      `cipher = ${cont.ciphername}`,
      `kdf    = ${cont.kdfname}`,
    ];
    if (cont.kdfname === "bcrypt") {
      const { salt, rounds } = parseBcryptKdfOptions(cont.kdfopts);
      lines.push(`kdfopts: salt = ${bytesToHex(salt)}（${salt.length} 字节）`, `kdfopts: rounds = ${rounds}`);
    }
    lines.push(`密钥数 N = ${cont.nkeys}`, "");
    const files = [];
    const pass = String((p && p.pass) || "");
    const keys = await decryptOpensshList(cont, pass);
    let idx = 0;
    for (const k of keys) {
      if (!cont.pubkeys[idx]) throw new Error(`公钥列表缺第 ${idx + 1} 项`);
      const pub = await sshPubInfo(cont.pubkeys[idx]);
      idx++;
      lines.push(`—— 密钥 ${idx} ——`, `类型 = ${k.type}`, `指纹 = ${pub.fingerprint}`);
      if (k.comment) lines.push(`注释 = ${k.comment}`);
      if (k.seedHex) {
        lines.push(`seed (32B hex) = ${k.seedHex}`, `公钥 (32B hex) = ${k.pubHex}`);
      }
      if (k.n !== undefined) {
        lines.push(`n = ${k.n}`, `e = ${k.e}`, `d = ${k.d}`, `p = ${k.p}`, `q = ${k.q}`,
          `dP = d mod (p-1) = ${k.d % (k.p - 1n)}`, `dQ = d mod (q-1) = ${k.d % (k.q - 1n)}`,
          `qInv = q⁻¹ mod p = ${k.iqmp}`);
      }
      if (k.curve) {
        lines.push(`曲线 = ${k.curve}`, `d (hex) = ${k.d.toString(16)}`, `公钥点 (hex) = ${bytesToHex(k.pub)}`);
      }
      lines.push(`授权行 = ${pub.authLine}`, "");
      files.push({ name: `ssh_key_${idx}_private.pem`, mime: "text/plain", bytes: te(k.pem + "\n") });
      if (k.pubPem) files.push({ name: `ssh_key_${idx}_public.pem`, mime: "text/plain", bytes: te(k.pubPem + "\n") });
      if (k.sec1Pem) files.push({ name: `ssh_key_${idx}_ec.pem`, mime: "text/plain", bytes: te(k.sec1Pem + "\n") });
    }
    lines.push("说明：私钥/公钥已按 PKCS#8（RFC 5958）与 SPKI 输出为 PEM，可下载；EC 另有 SEC1 传统格式。",
      "口令与密钥材料只在本地内存处理，不上传。");
    return { text: lines.join("\n"), files };
  },
});
