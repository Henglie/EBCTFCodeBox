"""Development-only independent fixtures: pip gmssl 3.2.2, deterministic k."""
import json
from importlib.metadata import version
from unittest.mock import patch
from gmssl import sm2

cases = []
for d, k, m1, m2 in [
    (1, 1, b"known plaintext!", b"flag{sm2_reuse!}"),
    (2, 2, bytes(range(1, 65)), bytes(range(255, 191, -1))),
    (int("3945208F7B213123ACF663123F7F13A9F14D1F4D5B7C2B3A19B2B4E5E6F70819", 16), 123456789, "中文已知明文 UTF-8 sample".encode(), b"flag{known_prefix}_longer_message"),
]:
    private = f"{d:064x}"
    nonce = f"{k:064x}"
    crypt = sm2.CryptSM2(private_key=private, public_key="", mode=1)
    public = crypt._kg(d, crypt.ecc_table["g"])
    crypt.public_key = public
    with patch("gmssl.func.random_hex", return_value=nonce):
        c1 = crypt.encrypt(m1)
        c2 = crypt.encrypt(m2)
    sig1 = crypt.sign_with_sm3(m1, random_hex_str=nonce)
    sig2 = crypt.sign_with_sm3(m2, random_hex_str=nonce)
    related = crypt.sign_with_sm3(m2, random_hex_str=f"{2*k+3:064x}")
    assert crypt.verify_with_sm3(sig1, m1) and crypt.verify_with_sm3(sig2, m2)
    assert crypt.decrypt(c1) == m1 and crypt.decrypt(c2) == m2
    cases.append(dict(d=private, k=nonce, publicKey="04" + public, m1=m1.hex(), m2=m2.hex(),
                      c1="04" + c1.hex(), c2="04" + c2.hex(),
                      sig=dict(r1=sig1[:64], s1=sig1[64:], e1=crypt._sm3_z(m1),
                               r2=sig2[:64], s2=sig2[64:], e2=crypt._sm3_z(m2), publicKey="04" + public),
                      related=dict(r1=sig1[:64], s1=sig1[64:], e1=crypt._sm3_z(m1),
                                   r2=related[:64], s2=related[64:], e2=crypt._sm3_z(m2), a="2", b="3", publicKey="04" + public)))
print(json.dumps(dict(reference="gmssl", version=version("gmssl"), cases=cases)))
