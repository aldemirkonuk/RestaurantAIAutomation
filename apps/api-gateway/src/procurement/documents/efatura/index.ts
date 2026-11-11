import { ParsedDocument } from "../parsed-document";
import { looksLikeUbl, readUblTr } from "./ubl-tr";
import { XmlRefused } from "./xml-lite";
import { looksLikeZip, readZip, ZipRefused } from "./zip-lite";

export { looksLikeUbl, readUblTr } from "./ubl-tr";
export { looksLikeZip } from "./zip-lite";

/** Largest e-invoice XML read, in bytes. A real one is tens of kilobytes. */
export const MAX_XML_BYTES = 5 * 1024 * 1024;

export type EinvoiceRead =
  | { kind: "not_einvoice" }
  | { kind: "read"; doc: ParsedDocument }
  | {
      kind: "refused";
      reason: string;
      /**
       * True when the file is plainly NOT an e-invoice (a zip with no UBL
       * inside, an XML whose root is not a UBL paper), as against an
       * e-invoice that could not be read (too large, broken, corrupt zip).
       * The email sweep records the first as `not_a_document` with the
       * reason; the desk still stores it unread, because a person chose it.
       */
      notADocument?: boolean;
    };

/**
 * Is this file an e-invoice (UBL-TR XML, or a zip holding one), and if so,
 * what does it say? `not_einvoice` hands the file back to the other readers;
 * `refused` stores it unread with the sentence, never silently.
 *
 * A ZIP HOLDING SEVERAL E-INVOICES (the session's call, 2026-11-11): the
 * first is read and filed, and a warning on it names every other one, so the
 * person sees exactly which papers still need sending on their own. Rejected:
 * refusing the whole zip (files nothing); filing each as its own document
 * (one upload would then answer with several ids, which no caller reads).
 */
export function readEinvoiceFile(
  bytes: Buffer,
  filename: string | null | undefined,
  mimeType: string | null | undefined,
): EinvoiceRead {
  const name = (filename ?? "").toLowerCase();
  const mime = (mimeType ?? "").toLowerCase();

  if (looksLikeZip(bytes)) {
    const named = /\.zip$/.test(name) || /zip/.test(mime);
    if (!named) return { kind: "not_einvoice" };
    let entries;
    try {
      entries = readZip(bytes);
    } catch (e) {
      if (e instanceof ZipRefused) return { kind: "refused", reason: e.message };
      throw e;
    }
    const xmls = entries.filter(
      (en) => /\.xml$/i.test(en.name) && looksLikeUbl(en.bytes.toString("utf8")),
    );
    if (!xmls.length)
      return {
        kind: "refused",
        reason: `The zip file holds no e-invoice XML (it holds: ${entries.map((e) => e.name).join(", ") || "nothing"}).`,
        notADocument: true,
      };
    const first = readXml(xmls[0].bytes);
    if (first.kind !== "read") return first;
    const rest = xmls.slice(1).map((x) => x.name);
    return rest.length
      ? {
          kind: "read",
          doc: {
            ...first.doc,
            warnings: [
              ...first.doc.warnings,
              `The zip file held ${xmls.length} e-invoices; only ${xmls[0].name} was read. Send these on their own: ${rest.join(", ")}.`,
            ],
          },
        }
      : first;
  }

  const xmlNamed = /\.xml$/.test(name) || /xml/.test(mime);
  const head = bytes.subarray(0, 4000).toString("utf8");
  if (!looksLikeUbl(head)) {
    // An XML file the house sent as an invoice but that is not UBL is said,
    // not passed to the model as if it were a photo.
    return xmlNamed && /^\s*(﻿)?</.test(head)
      ? {
          kind: "refused",
          reason:
            "The XML file is not an e-invoice (UBL-TR Invoice or DespatchAdvice), so it was stored unread.",
          notADocument: true,
        }
      : { kind: "not_einvoice" };
  }
  return readXml(bytes);
}

function readXml(bytes: Buffer): EinvoiceRead {
  if (bytes.length > MAX_XML_BYTES)
    return {
      kind: "refused",
      reason: `The e-invoice XML is larger than ${MAX_XML_BYTES / (1024 * 1024)} MB; it was not read.`,
    };
  try {
    return { kind: "read", doc: readUblTr(bytes.toString("utf8")) };
  } catch (e) {
    if (e instanceof XmlRefused)
      return { kind: "refused", reason: `The e-invoice file could not be read: ${e.message}` };
    throw e;
  }
}
