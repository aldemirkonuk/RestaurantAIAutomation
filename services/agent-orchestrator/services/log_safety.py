"""
Log Safety
==========
Escaping for request-derived values that end up in log lines (CodeQL py/log-injection).

Lives here rather than inside a feature module because the rule applies everywhere: any
value that reached us from a request — a path param, a body field, a JWT claim — can carry
a newline, and a newline in a log line lets one entry forge another. An audit trail that
can be forged is worth less than no audit trail, because it is trusted.

Signature verification is not a defence. A verified JWT proves *who* set a claim, not that
the claim is free of control characters, and the log formatter does not care which.
"""

__all__ = ["sanitize_for_log"]


def sanitize_for_log(value: object, max_len: int = 128) -> str:
    """
    Return `value` as a single-line string safe to interpolate into a log record.

    Escapes backslashes first so the CR/LF replacements cannot be spoofed by a literal
    "\\n" already present in the input, then truncates — an unbounded field is its own
    denial-of-service against whoever reads the logs.
    """
    text = str(value)
    return (
        text.replace("\\", "\\\\").replace("\r", "\\r").replace("\n", "\\n")[:max_len]
    )
