"""Offline routing, fail-closed, telemetry and preflight regression checks."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import pr_audit_gate as gate
from pr_audit_review import OPUS, SONNET, ReviewRun, usage_cost


def response(text, model, stop="end_turn"):
    usage = dict(input_tokens=10, output_tokens=20, cache_read_input_tokens=30,
                 cache_creation_input_tokens=40)
    return types.SimpleNamespace(model=model, stop_reason=stop,
        usage=types.SimpleNamespace(model_dump=lambda: usage),
        content=[types.SimpleNamespace(type="text", text=text)])


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "usage.json"
        self.calls = []

    def client(self, block=False, final="HOLDS", plan="PLAN: READY", stop="end_turn", parallel=False):
        barrier = threading.Barrier(2) if parallel else None

        def create(**kw):
            self.calls.append(kw)
            if len(kw["messages"]) > 1:
                return response("VERDICT: " + final, OPUS)
            if kw["model"] == OPUS:
                return response(plan, OPUS, stop)
            if barrier:
                barrier.wait(timeout=3)
            return response("VERDICT: " + ("BLOCK" if block else "APPROVE"), SONNET)

        return types.SimpleNamespace(messages=types.SimpleNamespace(create=create))

    def test_four_calls_three_roles_and_parallel_review(self):
        result = ReviewRun(self.client(parallel=True), "original evidence", self.path).run(gate._verdict_of)
        self.assertEqual(result[-1], "PASS")
        self.assertEqual([c["model"] for c in self.calls], [OPUS, SONNET, SONNET, OPUS])
        self.assertEqual(self.calls[0]["messages"][0], self.calls[-1]["messages"][0])
        for call in self.calls:
            self.assertEqual(call["messages"][0]["content"][0]["text"], "original evidence")
            self.assertEqual(call["messages"][0]["content"][0]["cache_control"], {"type": "ephemeral"})
        data = json.loads(self.path.read_text())
        self.assertEqual(len(data["requests"]), 4)
        self.assertEqual(data["outcome"], "PASS")
        self.assertIsNotNone(data["total_estimated_api_usd"])
        self.assertNotIn("original evidence", self.path.read_text())
        self.assertTrue(all(r["estimated_api_usd"] is not None for r in data["requests"]))

    def test_blocked_reviewer_skips_opus_final(self):
        result = ReviewRun(self.client(block=True), "bundle", self.path).run(gate._verdict_of)
        self.assertEqual(result[-1], "BLOCK")
        self.assertEqual(len(self.calls), 3)

    def test_invalid_plans_never_fan_out(self):
        for plan in ("PLAN: BLOCK", "", "PLAN: READY\nadditional text", "VERDICT: APPROVE"):
            with self.subTest(plan=plan):
                self.calls.clear()
                try:
                    result = ReviewRun(self.client(plan=plan), "bundle", self.path).run(gate._verdict_of)
                    self.assertEqual(result[-1], "BLOCK")
                except RuntimeError:
                    self.assertEqual(plan, "")
                self.assertEqual(len(self.calls), 1)

    def test_only_holds_can_pass(self):
        for final in ("OVERTURNED", "BLOCK", "APPROVE", "unparseable", "HOLDS\nappendix"):
            with self.subTest(final=final):
                result = ReviewRun(self.client(final=final), "bundle", self.path).run(gate._verdict_of)
                self.assertEqual(result[-1], "BLOCK")

    def test_incomplete_response_records_usage_and_fails(self):
        with self.assertRaises(RuntimeError):
            ReviewRun(self.client(stop="max_tokens"), "bundle", self.path).run(gate._verdict_of)
        data = json.loads(self.path.read_text())["requests"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["stop_reason"], "max_tokens")
        self.assertIsNotNone(data[0]["estimated_api_usd"])

    def test_incomplete_review_or_final_cannot_approve(self):
        for index in (1, 3):
            with self.subTest(index=index):
                client = self.client()
                original = client.messages.create
                count = 0
                lock = threading.Lock()

                def create(**kw):
                    nonlocal count
                    with lock:
                        current = count
                        count += 1
                    value = original(**kw)
                    if current == index:
                        value.stop_reason = "max_tokens"
                    return value

                client.messages.create = create
                with self.assertRaises(RuntimeError):
                    ReviewRun(client, "bundle", self.path).run(gate._verdict_of)

    def test_sdk_error_is_not_zero_cost_or_secret_in_artifact(self):
        client = self.client()
        client.messages.create = Mock(side_effect=RuntimeError("secret exception body"))
        with self.assertRaises(RuntimeError):
            ReviewRun(client, "bundle", self.path).run(gate._verdict_of)
        text = self.path.read_text()
        self.assertNotIn("secret exception body", text)
        self.assertIsNone(json.loads(text)["requests"][0]["estimated_api_usd"])
        self.assertEqual(json.loads(text)["outcome"], "ERROR")
        self.assertIsNone(json.loads(text)["total_estimated_api_usd"])

    def test_fingerprint_changes_with_evidence(self):
        first = ReviewRun(self.client(), "a", self.path).data["fingerprint"]
        second = ReviewRun(self.client(), "b", self.path).data["fingerprint"]
        self.assertNotEqual(first, second)

    def test_cost_unknown_and_cache_breakdown(self):
        self.assertIsNone(usage_cost(OPUS, {}))
        u = dict(input_tokens=1_000_000, output_tokens=1_000_000,
                 cache_read_input_tokens=1_000_000, cache_creation_input_tokens=2_000_000,
                 cache_creation=dict(ephemeral_1h_input_tokens=1_000_000,
                                     ephemeral_5m_input_tokens=1_000_000))
        self.assertEqual(usage_cost(OPUS, u), 46.75)
        self.assertEqual(usage_cost(SONNET, u), 18.7)
        self.assertIsNone(usage_cost("unknown", u))


class GatePreflightTests(unittest.TestCase):
    def test_final_verdict_and_comment_control_pinned_merge(self):
        for overall, comment_code, expected in (("PASS", 0, 0), ("BLOCK", 0, 1), ("PASS", 1, 1)):
            with self.subTest(overall=overall, comment_code=comment_code), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "CLAUDE.md").write_text("trusted policy")
                commands = []
                pr = dict(number=1, headRefOid="a" * 40, title="test", url="https://example.test/pr/1")

                def run(cmd, **kw):
                    commands.append(cmd)
                    output = "apps/example.ts" if "--name-only" in cmd else "complete diff"
                    code = comment_code if "comment" in cmd else 0
                    return subprocess.CompletedProcess(cmd, code, output, "")

                result = ("PLAN: READY", {"correctness": "VERDICT: APPROVE"},
                          {"correctness": "APPROVE"}, "VERDICT: HOLDS", overall)
                with patch.dict(sys.modules, {"anthropic": types.SimpleNamespace(Anthropic=Mock())}), \
                     patch.dict(os.environ, {"ANTHROPIC_API_KEY": "fake-test-key"}), \
                     patch.object(gate, "ROOT", root), \
                     patch.object(gate, "_gh_json", side_effect=[pr, []]), \
                     patch.object(gate, "_run", side_effect=run), \
                     patch("pr_audit_review.ReviewRun") as review, \
                     patch("sys.stdout", new=__import__("io").StringIO()), \
                     patch("sys.stderr", new=__import__("io").StringIO()):
                    review.return_value.run.return_value = result
                    self.assertEqual(gate._run_audit_inner("1"), expected)
                merges = [cmd for cmd in commands if "PUT" in cmd]
                if expected == 0:
                    self.assertEqual(len(merges), 1)
                    self.assertIn("sha=" + "a" * 40, merges[0])
                    self.assertLess(next(i for i, cmd in enumerate(commands) if "comment" in cmd),
                                    commands.index(merges[0]))
                else:
                    self.assertFalse(merges)

    def test_unreviewable_pr_never_calls_model_or_merges(self):
        for changed, diff, code in (
            ("scripts/pr_audit_review.py", "diff", 0),
            (".claude/agents/pr-merge-planner.md", "diff", 0),
            (".planning/decisions/0050-agent-dispatch-hardness-threshold.md", "diff", 0),
            ("apps/example.ts", "x" * 300001, 0),
            ("", "diff", 1), ("", "diff", 0),
        ):
            with self.subTest(changed=changed, size=len(diff), code=code):
                client = Mock()
                module = types.SimpleNamespace(Anthropic=Mock(return_value=client))
                commands = []

                def run(cmd, **kw):
                    commands.append(cmd)
                    names = "--name-only" in cmd
                    return subprocess.CompletedProcess(cmd, code if names else 0,
                                                       changed if names else diff, "")

                with patch.dict(sys.modules, {"anthropic": module}), \
                     patch.dict(os.environ, {"ANTHROPIC_API_KEY": "fake-test-key"}), \
                     patch.object(gate, "_gh_json", return_value={"number": 1, "headRefOid": "a" * 40}), \
                     patch.object(gate, "_run", side_effect=run), \
                     patch.object(gate, "_fail_closed", return_value=1) as failed:
                    self.assertEqual(gate._run_audit_inner("1"), 1)
                    failed.assert_called_once()
                client.messages.create.assert_not_called()
                self.assertTrue(all("merge" not in cmd for cmd in commands))


if __name__ == "__main__":
    unittest.main()
