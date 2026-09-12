"""The two signers. Both sign the EXACT bytes put on the wire.

A - Square's genuine recipe (research-square-day-9d440f0f.md 1.12, confirmed from
    square-php-sdk WebhooksHelper.php):
        base64( HMAC-SHA256( signature_key, notification_url + raw_body ) )
        header: x-square-hmacsha256-signature
    The notification_url is an INPUT TO THE MAC and must be the URL registered on
    the subscription, byte-for-byte - here, the URL we post to.

B - our legacy scheme (pos-hub.service.ts:414-423, legacy_global rung):
        hex( HMAC-SHA256( POS_HUB_WEBHOOK_SECRET, raw_body ) )
        header: X-Pos-Hub-Signature
    On the legacy rung the signed message is rawBody ALONE. The scoped form
    ("<provider>:<rid>." + body) applies only when POS_WEBHOOK_SECRET_SQUARE[__RID]
    is set; neither is set in this environment, so the legacy rung is live.
"""

from __future__ import annotations

import base64
import hashlib
import hmac

SQUARE_HEADER = "x-square-hmacsha256-signature"
LEGACY_HEADER = "X-Pos-Hub-Signature"


def square_signature(signature_key: str, notification_url: str, raw_body: bytes) -> str:
    payload = notification_url.encode("utf-8") + raw_body
    return base64.b64encode(
        hmac.new(signature_key.encode("utf-8"), payload, hashlib.sha256).digest()
    ).decode("ascii")


def legacy_signature(secret: str, raw_body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def scoped_legacy_signature(
    secret: str, provider: str, rid: str, raw_body: bytes
) -> str:
    msg = f"{provider}:{rid}.".encode("utf-8") + raw_body
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


if __name__ == "__main__":
    # self-test against the PHP SDK's stated algebra
    k, u, b = "wJc6...key", "https://example.com/hook", b'{"a":1}'
    assert (
        square_signature(k, u, b)
        == base64.b64encode(
            hmac.new(k.encode(), u.encode() + b, hashlib.sha256).digest()
        ).decode()
    )
    print("sign_square self-test ok")
