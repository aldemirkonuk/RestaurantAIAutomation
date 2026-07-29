"""CLI: python3 -m scripts.docgen {generate|houses|scenarios|verify}

Writes to the local filesystem only. Nothing here touches Supabase, RabbitMQ or
any network service — a document pack is a set of files plus their ground truth,
and loading it into a tenant is a separate, explicitly gated step.

    python3 -m scripts.docgen generate --archetype bistro --deliveries 12
    python3 -m scripts.docgen generate --archetype all --deliveries 6 --out datasets/sim/documents
    python3 -m scripts.docgen scenarios          # what discrepancies exist, and their target verdicts
    python3 -m scripts.docgen houses             # the encoding coverage matrix
    python3 -m scripts.docgen verify --out ...   # re-check an existing pack
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Sequence

import cv2

from scripts.docgen.compose import build_delivery, render_context
from scripts.docgen.degrade import (
    IllegibleSampleError,
    PROFILES,
    apply_profile,
    autocrop,
    profiles_for_medium,
    stroke_density,
)
from scripts.docgen.errors import SCENARIOS, known_failing, verdicts_covered
from scripts.docgen.houses import HOUSES, coverage_report, house
from scripts.docgen.render import html_to_pdf, html_to_png, render_html
from scripts.docgen.truth import Artifact, delivery_truth, write_truth
from scripts.docgen.wineops_doc import build_context as wineops_context

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO_ROOT / "datasets" / "sim" / "documents"
MENUS_DIR = REPO_ROOT / "datasets" / "sim" / "menus"

#: 300dpi. A phone photographs a Letter page at roughly this resolution, and
#: degrading a 150dpi render simulates a much worse camera than anyone owns.
PAGE_PX = {
    "letter": (2550, 3300),
    "letter_landscape": (3300, 2550),
    "thermal_roll": (1230, 3300),
}


def _page_px(house_key: str) -> tuple[int, int]:
    if house_key == "goldenstate":
        return PAGE_PX["letter_landscape"]
    if house_key == "tri_state":
        return PAGE_PX["thermal_roll"]
    return PAGE_PX["letter"]


def _load_wines(archetype: str) -> list[dict[str, Any]]:
    path = MENUS_DIR / f"{archetype}.json"
    if not path.exists():
        raise SystemExit(
            f"No menu snapshot for archetype '{archetype}' at {path}. "
            f"Available: {sorted(p.stem for p in MENUS_DIR.glob('*.json'))}"
        )
    return json.loads(path.read_text())["items"]


def _restaurant_for(archetype: str) -> dict[str, str]:
    # Kept alongside the archetype recipes rather than invented here, so a
    # document pack and a seeded tenant describe the same restaurant.
    recipe = REPO_ROOT / "datasets" / "sim" / "archetypes" / f"{archetype}.json"
    name, city = f"Sim {archetype.title()}", "Chicago, IL 60622"
    if recipe.exists():
        r = json.loads(recipe.read_text()).get("restaurant", {})
        name = r.get("name", name)
        if r.get("city"):
            city = f"{r['city']}, IL 60622"
    return {
        "name": name,
        "address": "1841 W Division St",
        "city_state_zip": city,
        "license_no": "IL-RL-4471903",
    }


def _archetypes(spec: str) -> list[str]:
    known = sorted(p.stem for p in MENUS_DIR.glob("*.json"))
    if spec == "all":
        return known
    if spec not in known:
        raise SystemExit(f"Unknown archetype '{spec}'. Available: {known}")
    return [spec]


# --------------------------------------------------------------------------
# generate
# --------------------------------------------------------------------------


def cmd_generate(args: argparse.Namespace) -> int:
    out_root = Path(args.out).resolve()
    archetypes = _archetypes(args.archetype)
    rng = random.Random(args.seed)

    total_docs = 0
    total_rejected = 0
    manifest: list[dict[str, Any]] = []

    for archetype in archetypes:
        wines = _load_wines(archetype)
        restaurant = _restaurant_for(archetype)
        house_keys = list(HOUSES)

        for n in range(args.deliveries):
            # Deliveries land on a rhythm, not uniformly — twice a week is the
            # ordering cadence the archetypes already describe.
            delivery_date = date.today() - timedelta(days=3 * (args.deliveries - n))
            hkey = house_keys[n % len(house_keys)]
            h = house(hkey)
            seed = rng.randrange(1 << 30)

            d = build_delivery(
                seed=seed,
                house=h,
                wines=wines,
                restaurant=restaurant,
                delivery_date=delivery_date,
                sequence=n + 1,
            )

            rel_dir = Path(archetype) / d.delivery_id
            abs_dir = out_root / rel_dir

            if args.dry_run:
                print(
                    f"  [plan] {archetype}/{d.delivery_id:44s} "
                    f"{len(d.lines):2d} lines  ${d.total():>9,.2f}  "
                    f"risk ${d.dollars_at_risk():>7,.2f}"
                )
                total_docs += 1
                continue

            html = render_html(h.template, render_context(d))
            w, ht = _page_px(hkey)

            clean_png = abs_dir / "invoice.clean.png"
            html_to_png(html, clean_png, width=w, height=ht)
            html_to_pdf(html, abs_dir / "invoice.pdf")

            base_img = autocrop(cv2.imread(str(clean_png)))
            base_density = stroke_density(base_img)

            artifacts = [
                Artifact(
                    doc_type="invoice",
                    path=str((rel_dir / "invoice.pdf").as_posix()),
                    content_type="application/pdf",
                    degradation_profile="pristine",
                    stroke_retention=1.0,
                    source_channel="email",
                )
            ]

            for pkey in profiles_for_medium(h.medium):
                if pkey == "pristine":
                    continue
                dst = abs_dir / f"invoice.{pkey}.jpg"
                try:
                    apply_profile(clean_png, dst, PROFILES[pkey], seed=seed)
                except IllegibleSampleError as exc:
                    total_rejected += 1
                    print(f"  [reject] {d.delivery_id} / {pkey}: {exc}")
                    continue
                ret = stroke_density(cv2.imread(str(dst))) / max(base_density, 1e-9)
                artifacts.append(
                    Artifact(
                        doc_type="invoice",
                        path=str((rel_dir / dst.name).as_posix()),
                        content_type="image/jpeg",
                        degradation_profile=pkey,
                        stroke_retention=round(ret, 4),
                        source_channel="photo" if "phone" in pkey else "upload",
                    )
                )

            # The WineOps rendering of the same delivery. Emitted next to the
            # vendor original so the two are always comparable side by side —
            # that comparison IS the product demo.
            wo_html = render_html("wineops_document.html", wineops_context(d, archetype=archetype))
            html_to_pdf(wo_html, abs_dir / "wineops.pdf")
            html_to_png(wo_html, abs_dir / "wineops.png", width=2550, height=3300)
            artifacts.append(
                Artifact(
                    doc_type="wineops_normalized",
                    path=str((rel_dir / "wineops.pdf").as_posix()),
                    content_type="application/pdf",
                    degradation_profile="pristine",
                    stroke_retention=1.0,
                    source_channel="api",
                )
            )

            truth = delivery_truth(d, artifacts, archetype=archetype)
            write_truth(abs_dir / "truth.json", truth)

            total_docs += len(artifacts)
            manifest.append(
                {
                    "archetype": archetype,
                    "delivery_id": d.delivery_id,
                    "house": hkey,
                    "dir": str(rel_dir.as_posix()),
                    "artifact_count": len(artifacts),
                    "line_count": len(d.lines),
                    "dollars_at_risk": d.dollars_at_risk(),
                }
            )
            print(
                f"  {archetype:12s} {d.delivery_id:40s} {hkey:12s} "
                f"{len(d.lines):2d} lines  {len(artifacts)} artifacts  "
                f"risk ${d.dollars_at_risk():>8,.2f}"
            )

    if args.dry_run:
        print(f"\nDry run: {total_docs} deliveries planned. Re-run without --dry-run.")
        return 0

    manifest_path = out_root / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(
            {
                "pack_version": "1.0.0",
                "synthetic": True,
                "deliveries": manifest,
                "artifact_count": total_docs,
                "rejected_illegible": total_rejected,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        f"\n{len(manifest)} deliveries, {total_docs} artifacts -> {out_root}"
        + (f"  ({total_rejected} rejected as illegible)" if total_rejected else "")
    )
    return 0


# --------------------------------------------------------------------------
# inspection commands
# --------------------------------------------------------------------------


def cmd_scenarios(_: argparse.Namespace) -> int:
    print(f"{'scenario':24s} {'wt':>3s}  {'target verdict':20s} story")
    print("-" * 108)
    for s in SCENARIOS:
        o = s.build(24, 22.0)
        flag = f"  [FAILS -> {o.known_failing_verdict}]" if o.known_failing_verdict else ""
        print(f"{s.key:24s} {s.weight:3d}  {o.expected_verdict:20s} {s.story}{flag}")

    covered = verdicts_covered()
    all_verdicts = {
        "matched", "overbilled_vs_ship", "price_variance", "qty_over",
        "qty_short", "short_shipped", "rejected", "partial", "unmatched",
    }
    missing = all_verdicts - covered
    print(f"\nverdicts covered: {len(covered)}/9")
    if missing:
        print(f"NOT COVERED: {sorted(missing)}")
    for key, intended, actual in known_failing():
        print(f"known failing: {key} intends {intended}, engine returns {actual}")
    return 0


def cmd_houses(_: argparse.Namespace) -> int:
    print(f"{'house':14s} {'medium':13s} {'uom':22s} {'free goods':19s} {'vintage':15s} charges")
    print("-" * 108)
    for h in HOUSES.values():
        print(
            f"{h.key:14s} {h.medium:13s} {h.uom_style:22s} "
            f"{h.free_goods_style:19s} {h.vintage_style:15s} {h.charge_style}"
        )
    print("\nencoding coverage (each must appear >= 2x so a fix cannot overfit one house):")
    for dim, counts in coverage_report().items():
        thin = [k for k, v in counts.items() if v < 2]
        note = f"   <-- only once: {thin}" if thin else ""
        print(f"  {dim:20s} {counts}{note}")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    """Re-check an existing pack: files present, truth parses, artifacts exist."""
    out_root = Path(args.out).resolve()
    manifest_path = out_root / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"No manifest at {manifest_path}. Generate a pack first.")

    manifest = json.loads(manifest_path.read_text())
    problems: list[str] = []
    checked = 0
    for entry in manifest["deliveries"]:
        tpath = out_root / entry["dir"] / "truth.json"
        if not tpath.exists():
            problems.append(f"{entry['delivery_id']}: truth.json missing")
            continue
        truth = json.loads(tpath.read_text())
        if truth.get("synthetic") is not True:
            problems.append(f"{entry['delivery_id']}: truth.synthetic is not true")
        for a in truth["artifacts"]:
            if not (out_root / a["path"]).exists():
                problems.append(f"{entry['delivery_id']}: missing artifact {a['path']}")
            checked += 1

    print(f"checked {checked} artifacts across {len(manifest['deliveries'])} deliveries")
    for p in problems:
        print(f"  PROBLEM {p}")
    print("OK" if not problems else f"{len(problems)} problems")
    return 1 if problems else 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="scripts.docgen",
        description="Synthetic procurement document factory",
    )
    sub = p.add_subparsers(dest="command", required=True)

    g = sub.add_parser("generate", help="Render a document pack")
    g.add_argument("--archetype", default="bistro", help="Archetype id or 'all'")
    g.add_argument("--deliveries", type=int, default=6, help="Deliveries per archetype")
    g.add_argument("--out", default=str(DEFAULT_OUT))
    g.add_argument("--seed", type=int, default=20260729)
    g.add_argument(
        "--dry-run",
        action="store_true",
        help="Plan only — compose deliveries and print them, render nothing",
    )
    g.set_defaults(func=cmd_generate)

    s = sub.add_parser("scenarios", help="List discrepancy scenarios + target verdicts")
    s.set_defaults(func=cmd_scenarios)

    h = sub.add_parser("houses", help="List houses + encoding coverage")
    h.set_defaults(func=cmd_houses)

    v = sub.add_parser("verify", help="Re-check an existing pack")
    v.add_argument("--out", default=str(DEFAULT_OUT))
    v.set_defaults(func=cmd_verify)
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
