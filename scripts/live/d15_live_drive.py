#!/usr/bin/env python3
"""ADR 0104 D15 pre-merge live drive on the sim tenant, gateway :4030.

Migration 20260911120000 is NOT on the sim database until this PR merges, so
`providers.tax_id_normalized` and `document_vendor_resolutions` do not exist
there. That is not a blocker for this drive — it is exactly the condition the
honest-absence rules were written for, and it makes TWO of the four states
measurable live instead of only on the Docker build:

  * a document that prints NO verifiable identity must answer `unresolved` with
    the reason, and must do so WITHOUT ever reading the providers table;
  * a document that prints a good one must answer `unavailable` — because the
    providers read fails — and must NOT answer `unresolved`, which would blame
    the paper for a column WE have not applied yet.

`matched` and `created` need the columns and therefore wait for the merge; they
are listed at the end as waited-for. Every fixture below is SYNTHETIC.
"""
import base64, json, os, time, urllib.request, urllib.error

# Intake deduplicates on sha256 per restaurant (correctly), so a re-run needs
# bytes it has not seen — otherwise every upload comes back `duplicate` and the
# extraction door answers 409 about a document it already read.
RUN = str(int(time.time()))

GW = os.environ.get("GW", "http://localhost:4030") + "/api/v1"
S = "/private/tmp/claude-501/-Users-aldemirkonuk-Projects-restaurant-ai-automation/9d440f0f-a482-40ca-a49d-8d356f254c72/scratchpad"
TOK = json.load(open(f"{S}/sim-owner-session-9d440f0f.json"))["accessToken"]
TR_INVOICE = "b1e02edf-e696-4c93-8c41-a3433873c8dd"

log = []


def call(method, path, body=None):
    req = urllib.request.Request(
        GW + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {TOK}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.status, json.loads(raw or "{}")
        except Exception:
            return e.status, {"raw": raw[:400]}


def record(name, status, detail):
    log.append({"case": name, "status": status, "detail": detail})
    print(f"{status:>4}  {name}\n      {detail}")


def upload(tag):
    """Store bytes unread (the D6 degradation), so the extraction door is open."""
    content = base64.b64encode(
        f"SYNTHETIC TEST FIXTURE {tag} run {RUN} - not a real document".encode()
    ).decode()
    return call(
        "POST",
        "/procurement/documents",
        {
            "contentBase64": content,
            "filename": f"SYNTHETIC-{tag}.txt",
            "mimeType": "text/plain",
            "source": "upload",
        },
    )


def extraction(doc_id, seller):
    """Post a transcription in the extractor's own contract."""
    payload = {
        "docType": "invoice",
        "docNumber": f"SYN-D15-{seller['tag']}-{RUN}",
        "docDate": "2026-09-11",
        "deliveredDate": None,
        "poNumber": None,
        "referencesDocNumber": None,
        "vendorName": seller.get("name"),
        "vendorTaxId": seller.get("taxId"),
        "vendorTaxOffice": seller.get("taxOffice"),
        "vendorAddress": seller.get("address"),
        "vendorCountry": seller.get("country"),
        "buyerName": "SYNTHETIC Meyhane",
        "buyerTaxId": seller.get("buyerTaxId"),
        "currency": seller.get("currency", "TRY"),
        "subtotal": 1704.00,
        "freight": None,
        "fuelSurcharge": None,
        "splitCaseFee": None,
        "deliveryFee": None,
        "depositTotal": None,
        "tax": None,
        "otherCharges": None,
        "discountTotal": None,
        "total": 1704.00,
        "taxBreakdown": [],
        "printed": {"subtotal": "1.704,00", "total": "1.704,00"},
        "lines": [
            {
                "vendorSku": "SYN-D15-750",
                "description": "SYNTHETIC Öküzgözü 2021",
                "vintage": 2021,
                "formatMl": 750,
                "qty": 12,
                "uom": "bottle",
                "packSize": None,
                "unitPrice": 142.00,
                "priceBaseQty": None,
                "priceBaseUom": None,
                "lineTotal": 1704.00,
                "allowance": None,
                "deposit": None,
                "lineKind": "goods",
                "printed": {"qty": "12", "unitPrice": "142,00", "lineTotal": "1.704,00"},
            }
        ],
        "unreadable": [],
    }
    return call(
        "POST",
        f"/procurement/documents/{doc_id}/extraction",
        {"rawText": json.dumps(payload), "model": "claude-code:claude-fable-5-1"},
    )


CASES = [
    # A real, checksum-valid VKN. Pre-merge this must reach the providers read
    # and come back `unavailable` — never `unresolved`.
    {
        "tag": "TRVKN",
        "name": "SENTETİK ŞARAP DAĞITIM A.Ş.",
        "taxId": "VKN: 1234567890",
        "taxOffice": "Kadıköy V.D.",
        "address": "SYNTHETIC Caddesi 1, İstanbul",
        "country": "TR",
        "expect": "unavailable",
        "why": "a good identity, and the column it matches on is not on this database yet",
    },
    {
        "tag": "USEIN",
        "name": "SYNTHETIC WEST COAST DISTRIBUTING LLC",
        "taxId": "EIN 12-3456789",
        "address": "1 SYNTHETIC Street, Oakland CA",
        "country": "US",
        "currency": "USD",
        "expect": "unavailable",
        "why": "same, from the US side of the corpus",
    },
    {
        "tag": "NOID",
        "name": "SYNTHETIC Vendor With No Number",
        "taxId": None,
        "country": "TR",
        "expect": "unresolved",
        "why": "nothing printed — refused BEFORE any providers read",
    },
    {
        "tag": "BADCHK",
        "name": "SYNTHETIC Vendor With A Slip",
        "taxId": "1234567891",
        "country": "TR",
        "expect": "unresolved",
        "why": "ten digits that fail the VKN check digit",
    },
    {
        "tag": "SELFBILL",
        "name": "SYNTHETIC Meyhane",
        "taxId": "1234567890",
        "buyerTaxId": "1234567890",
        "country": "TR",
        "expect": "unresolved",
        "why": "the seller and the buyer carry one identity — self-billed, creates nothing",
    },
    {
        "tag": "NOCOUNTRY",
        "name": "SYNTHETIC Vendor Abroad",
        "taxId": "1234567890",
        "country": None,
        "currency": "EUR",
        "expect": "unresolved",
        "why": "digits with no country anywhere are not an identity",
    },
]


def main():
    for c in CASES:
        st, up = upload(c["tag"])
        doc_id = up.get("documentId")
        if st not in (200, 201) or not doc_id:
            record(c["tag"], st, f"upload failed: {json.dumps(up)[:200]}")
            continue
        st, res = extraction(doc_id, c)
        vendor = res.get("vendor")
        if not vendor:
            record(c["tag"], st, f"NO vendor field on the response: {json.dumps(res)[:220]}")
            continue
        ok = "PASS" if vendor["state"] == c["expect"] else "FAIL"
        record(
            f'{ok} {c["tag"]} ({c["why"]})',
            st,
            f'state={vendor["state"]} expected={c["expect"]} providerId={vendor["providerId"]}'
            f'\n      reason: {vendor["reason"][:220]}',
        )
        log[-1]["documentId"] = doc_id
        log[-1]["vendor"] = vendor

    # The canonical read of an EXISTING document: the resolution line must say
    # `unavailable` (the log table is not there), not draw a blank.
    st, doc = call("GET", f"/procurement/documents/{TR_INVOICE}/canonical")
    can = doc.get("canonical", {})
    vr = can.get("layer2", {}).get("vendorResolution")
    record(
        "an existing document: the resolution line says `unavailable`, not blank",
        st,
        f'state={(vr or {}).get("state")} reason={(vr or {}).get("reason","")[:180]}',
    )
    log[-1]["vendorResolution"] = vr

    # And a document THIS drive created, whose snapshot carries `vendorTaxId`:
    # BT-31 must render from the PAGE, with its glyphs, even though no provider
    # resolved. That is the fallback half of D15 on the sheet.
    first = next((e for e in log if e.get("documentId") and "TRVKN" in e["case"]), None)
    if first:
        st, doc = call("GET", f'/procurement/documents/{first["documentId"]}/canonical')
        vat = (
            doc.get("canonical", {})
            .get("layer1", {})
            .get("seller", {})
            .get("vatIdentifier", {})
        )
        record(
            "BT-31 renders from the page when no provider resolved",
            st,
            f'value={vat.get("value")!r} as_printed={vat.get("as_printed")!r} source={vat.get("source")!r}',
        )
        log[-1]["vatIdentifier"] = vat

    json.dump(log, open(f"{S}/lens-slice4b/d15-live.json", "w"), indent=1, ensure_ascii=False)
    print(f"\nwrote {S}/lens-slice4b/d15-live.json")


main()
