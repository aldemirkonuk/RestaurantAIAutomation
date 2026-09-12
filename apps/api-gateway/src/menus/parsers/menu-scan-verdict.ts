import { NfVerdict } from "../../common/model-client/nf-verdict.service";

export { PARSE_YIELD_BASIS } from "../../common/model-client/verdict-bases";

/** What `parseJsonResponseGraded` observed about the model's response. */
export type MenuParseStatus =
  | "parsed_array"
  | "parsed_not_array"
  | "salvaged"
  | "unparseable";

/**
 * Grade one menu extraction (OD-59, P3.0).
 *
 * ## Why zero items is `null` and not `failure`
 *
 * The census proposed "failure when zero items and the response was non-empty
 * and untruncated". That heuristic is close, and it is still a guess: a menu
 * page really can have no wines on it, and `scan-parser.service.ts` carries a
 * comment naming exactly that confusion as the historical bug.
 *
 * So the verdict grades on HOW THE PARSE ENDED rather than on how many items
 * came out, which is information the code already had and was throwing away:
 *
 * | parse ended | verdict | why |
 * |---|---|---|
 * | `unparseable` | **failure** | the model returned text nothing could read |
 * | `parsed_not_array` | **failure** | wrong shape entirely — an object, a string |
 * | truncated (`max_tokens`) | **partial** | already load-bearing: the caller re-splits the PDF |
 * | `salvaged` | **partial** | recovered items out of a broken response |
 * | `parsed_array`, items > 0 | **success** | |
 * | `parsed_array`, items = 0 | **null** | the model answered "no wines". Untestable, not failed |
 *
 * Truncation is checked BEFORE salvage because they co-occur — a truncated
 * response is the usual reason salvage runs — and `max_tokens` is the more
 * specific statement of what went wrong.
 */
export function menuScanVerdict(input: {
  parseStatus: MenuParseStatus;
  itemCount: number;
  truncated: boolean;
  responseChars: number;
}): NfVerdict {
  const evidence: Record<string, unknown> = {
    parse_status: input.parseStatus,
    items: input.itemCount,
    truncated: input.truncated,
    response_chars: input.responseChars,
  };

  if (
    input.parseStatus === "unparseable" ||
    input.parseStatus === "parsed_not_array"
  ) {
    return { outcome: "failure", evidence };
  }

  if (input.truncated || input.parseStatus === "salvaged") {
    return { outcome: "partial", evidence };
  }

  if (input.itemCount === 0) {
    return {
      outcome: null,
      evidence: { ...evidence, untestable: "model_returned_an_empty_list" },
    };
  }

  return { outcome: "success", evidence };
}
