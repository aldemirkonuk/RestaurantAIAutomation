import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_decision_index import BEGIN, END, header, render, replace_table


class DecisionIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def put(self, name, text):
        path = self.root / name
        path.write_text(text)
        return path

    def test_frontmatter_and_legacy_without_promoting_status(self):
        self.put("0001-one.md", '---\ntitle: "One | test"\nstatus: proposed\nupdated: 2026-09-16\n---\n# One\n')
        self.put("0002-two.md", "# 0002 - Two\n- **Status:** Locked by founder\n- **Date:** 2026-09-01\n")
        self.put("README.md", "not an ADR")
        table = render(self.root)
        self.assertIn("2 numbered ADR files", table)
        self.assertIn("1 locked, 1 proposed", table)
        self.assertIn("One \\| test", table)
        self.assertEqual(table, render(self.root))

    def test_bad_yaml_warns_and_uses_legacy_evidence(self):
        p = self.put("0001-one.md", "---\nlinks: [[a]], [[b]]\n---\n# 0001 - One\n- **Status:** **Merged**\n")
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(header(p)[1], "merged")
        self.assertIn("0001-one.md", stderr.getvalue())

    def test_duplicate_and_empty_rejected(self):
        with self.assertRaises(ValueError):
            render(self.root)
        self.put("0001-one.md", "# One")
        self.put("0001-two.md", "# Two")
        with self.assertRaises(ValueError):
            render(self.root)

    def test_preserves_history_and_requires_unique_markers(self):
        source = "before\n" + BEGIN + "old" + END + "\nafter"
        replacement = BEGIN + "new" + END
        self.assertEqual(replace_table(source, replacement), "before\n" + replacement + "\nafter")
        with self.assertRaises(ValueError):
            replace_table("no markers", replacement)

    def test_source_changes_invalidate_digest(self):
        p = self.put("0001-one.md", "# One\n")
        first = render(self.root)
        p.write_text("# One\nNew reasoning.\n")
        self.assertNotEqual(first, render(self.root))


if __name__ == "__main__":
    unittest.main()
