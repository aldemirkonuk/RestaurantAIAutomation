import { NfVerdict } from "../common/model-client/nf-verdict.service";
import { PARSE_YIELD_BASIS } from "../common/model-client/verdict-bases";
import { ExtractionResult } from "./vendor-page-extraction";

export { PARSE_YIELD_BASIS };

export function parseYieldVerdict(extraction: ExtractionResult): NfVerdict {
  const evidence: Record<string, unknown> = {
    parse_status: extraction.parseStatus,
    row_count: extraction.rowCount,
    items: extraction.items.length,
    rejected: extraction.rejected.length,
  };

  if (extraction.parseStatus !== "ok") {
    return { outcome: "failure", evidence };
  }

  if (extraction.yieldCollapsed) {
    return { outcome: "partial", evidence };
  }

  if (extraction.rowCount === 0) {
    return {
      outcome: null,
      evidence: { ...evidence, untestable: "zero_rows_parsed_cleanly" },
    };
  }

  return { outcome: "success", evidence };
}
