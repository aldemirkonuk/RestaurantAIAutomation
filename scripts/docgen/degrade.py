"""Turn a clean render into something that looks like it arrived in the real world.

A clean 150dpi render is not the input this system will ever see. Documents reach
a restaurant as a phone photo taken one-handed on a loading dock, a fax-quality
scan, a thermal roll that has been in an apron pocket, or a carbon that was under
a case of Sancerre. An extractor measured only on clean renders reports an
accuracy number that does not survive contact with a delivery.

Degradation is applied AFTER ground truth is written, never before. The truth
file describes what the document says; this module only changes how hard that is
to read. Nothing here may alter a quantity, a price, or a date.

Each profile is keyed to the house's physical medium, because the failure modes
are specific: thermal fades and curls, carbon smudges and drops strokes, dot
matrix bites into the paper and misaligns, letterhead gets folded into thirds to
go in an envelope.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


# --------------------------------------------------------------------------
# Cropping
# --------------------------------------------------------------------------


def autocrop(img: np.ndarray, pad: int = 18, thresh: int = 247) -> np.ndarray:
    """Trim the uniform white margin a full-page screenshot leaves behind.

    A rendered sheet sits in a browser window that is usually taller than the
    content, and photographing a document does not include half a page of empty
    white below it. Cropping first also keeps every later transform working on
    real pixels instead of padding.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    mask = gray < thresh
    if not mask.any():
        return img
    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    y0, y1 = max(0, rows[0] - pad), min(img.shape[0], rows[-1] + pad + 1)
    x0, x1 = max(0, cols[0] - pad), min(img.shape[1], cols[-1] + pad + 1)
    return img[y0:y1, x0:x1]


# --------------------------------------------------------------------------
# Individual effects
# --------------------------------------------------------------------------


def perspective(img: np.ndarray, rng: random.Random, strength: float) -> np.ndarray:
    """Photograph the page from an angle rather than straight on."""
    h, w = img.shape[:2]
    m = strength * min(h, w)

    def j() -> float:
        return rng.uniform(-m, m)

    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32(
        [[j(), j()], [w + j(), j()], [w + j(), h + j()], [j(), h + j()]]
    )
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(
        img, M, (w, h), borderMode=cv2.BORDER_REPLICATE, flags=cv2.INTER_LINEAR
    )


def rotate(img: np.ndarray, degrees: float) -> np.ndarray:
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    return cv2.warpAffine(
        img, M, (w, h), borderMode=cv2.BORDER_REPLICATE, flags=cv2.INTER_LINEAR
    )


def lighting(img: np.ndarray, rng: random.Random, strength: float) -> np.ndarray:
    """A soft off-centre light falloff — a phone photo under one ceiling lamp."""
    h, w = img.shape[:2]
    cx, cy = rng.uniform(0.15, 0.85) * w, rng.uniform(0.15, 0.85) * h
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    dist /= dist.max()
    grad = 1.0 - strength * dist
    return np.clip(img.astype(np.float32) * grad[..., None], 0, 255).astype(np.uint8)


def shadow(img: np.ndarray, rng: random.Random, strength: float) -> np.ndarray:
    """The photographer's own hand or phone shading one corner."""
    h, w = img.shape[:2]
    overlay = np.ones((h, w), np.float32)
    pts = np.array(
        [
            [rng.uniform(-0.2, 0.5) * w, -0.1 * h],
            [rng.uniform(0.5, 1.2) * w, rng.uniform(-0.1, 0.3) * h],
            [rng.uniform(0.6, 1.3) * w, rng.uniform(0.4, 1.1) * h],
            [rng.uniform(-0.2, 0.4) * w, rng.uniform(0.6, 1.2) * h],
        ],
        np.int32,
    )
    cv2.fillPoly(overlay, [pts], 1.0 - strength)
    overlay = cv2.GaussianBlur(overlay, (0, 0), sigmaX=max(w, h) * 0.05)
    return np.clip(img.astype(np.float32) * overlay[..., None], 0, 255).astype(np.uint8)


def fold_lines(img: np.ndarray, rng: random.Random, count: int = 2) -> np.ndarray:
    """Creases from being folded into an envelope or stuffed in an apron."""
    h, w = img.shape[:2]
    out = img.astype(np.float32)
    for i in range(count):
        y = int(h * (i + 1) / (count + 1) + rng.uniform(-0.02, 0.02) * h)
        band = np.zeros((h, w), np.float32)
        thickness = max(2, int(h * 0.004))
        cv2.line(band, (0, y), (w, y), 1.0, thickness)
        band = cv2.GaussianBlur(band, (0, 0), sigmaX=h * 0.006)
        # A crease darkens on one side and catches light on the other.
        out *= (1.0 - 0.22 * band)[..., None]
        out += (14 * np.roll(band, -thickness * 2, axis=0))[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def thermal_fade(img: np.ndarray, rng: random.Random) -> np.ndarray:
    """Thermal paper loses the top of the roll first and yellows overall."""
    h, w = img.shape[:2]
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    # Fade is strongest at the start of the roll and at the very end.
    fade = 1.0 - 0.30 * np.clip(1.4 * (1.0 - yy) - 0.35, 0, 1)
    out = img.astype(np.float32)
    out = 255 - (255 - out) * fade[..., None]
    # Yellow-brown cast.
    out[..., 0] *= 0.93  # B
    out[..., 1] *= 0.985  # G
    return np.clip(out, 0, 255).astype(np.uint8)


def ink_dropout(img: np.ndarray, rng: random.Random, amount: float) -> np.ndarray:
    """Carbon and dot matrix drop parts of strokes — the classic OCR killer."""
    h, w = img.shape[:2]
    noise = np.random.default_rng(rng.randrange(1 << 30)).random((h, w)).astype(np.float32)
    speckle = cv2.GaussianBlur(noise, (0, 0), sigmaX=0.7)
    mask = (speckle > (1.0 - amount)).astype(np.float32)
    mask = cv2.dilate(mask, np.ones((2, 2), np.uint8))
    out = img.astype(np.float32)
    # Push masked pixels toward paper white, thinning strokes rather than
    # erasing whole glyphs.
    out += mask[..., None] * (255 - out) * 0.75
    return np.clip(out, 0, 255).astype(np.uint8)


def blur_and_noise(
    img: np.ndarray, rng: random.Random, blur: float, noise_sigma: float
) -> np.ndarray:
    out = img
    if blur > 0:
        out = cv2.GaussianBlur(out, (0, 0), sigmaX=blur)
    if noise_sigma > 0:
        n = np.random.default_rng(rng.randrange(1 << 30)).normal(
            0, noise_sigma, out.shape
        )
        out = np.clip(out.astype(np.float32) + n, 0, 255).astype(np.uint8)
    return out


def photocopy(img: np.ndarray, contrast: float = 1.45) -> np.ndarray:
    """Fax / photocopy: paper blows out to white, ink stays dark.

    The pivot sits high (near paper, not near mid-grey) on purpose. Pivoting at
    128 drives everything lighter than mid-grey to pure white, which erases
    7pt dot-matrix text and light zebra banding entirely — the document survives
    as a letterhead and nothing else. A fax degrades legibility; it does not
    delete the body.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    pivot = 186.0
    out = np.clip((gray - pivot) * contrast + pivot + 8, 0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_GRAY2BGR)


def ink_coverage(img: np.ndarray, thresh: int = 200) -> float:
    """Fraction of pixels dark enough to be ink.

    Reported for diagnostics only. Do NOT use it as the legibility test: shadow
    and lighting push paper below the threshold, so coverage can rise while text
    is being destroyed — measured at over 1000% on `phone_bad`. `stroke_density`
    is the honest measure.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    return float((gray < thresh).mean())


def stroke_density(img: np.ndarray) -> float:
    """Density of local edges — a proxy for "are there still glyph strokes here".

    Uniformly darkening a page adds no edges, so unlike `ink_coverage` this does
    not reward a shadow for looking like ink. Blur, downsampling, dropout and
    binarisation all reduce it, which is exactly the direction that matters.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    # Normalise contrast first so a dim photo is not penalised for being dim.
    gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    edges = cv2.Canny(gray, 60, 160)
    return float((edges > 0).mean())


# --------------------------------------------------------------------------
# Profiles
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Profile:
    """A named degradation recipe."""

    key: str
    label: str
    perspective: float = 0.0
    rotate_deg: float = 0.0
    lighting: float = 0.0
    shadow: float = 0.0
    folds: int = 0
    thermal: bool = False
    dropout: float = 0.0
    blur: float = 0.0
    noise: float = 0.0
    photocopy: bool = False
    jpeg_quality: int | None = None
    #: Downscale then upscale — a photo that was never in focus to begin with.
    resample: float = 1.0


PROFILES: dict[str, Profile] = {
    "pristine": Profile("pristine", "Clean render, no degradation"),
    "scan": Profile(
        "scan",
        "Flatbed scan — straight, slight noise",
        rotate_deg=0.35,
        noise=2.0,
        jpeg_quality=92,
    ),
    "phone_good": Profile(
        "phone_good",
        "Phone photo, decent light",
        perspective=0.006,
        rotate_deg=1.1,
        lighting=0.16,
        blur=0.5,
        noise=3.0,
        jpeg_quality=82,
    ),
    "phone_bad": Profile(
        "phone_bad",
        "Phone photo at the door — angled, shadowed, hurried",
        perspective=0.017,
        rotate_deg=3.4,
        lighting=0.30,
        shadow=0.30,
        # Tuned against the stroke-density guard on the densest houses. The
        # original 1.5 blur / 0.72 resample destroyed 70-87% of strokes on 7pt
        # dot-matrix and carbon bodies. People do photograph these invoices
        # successfully, so a profile that makes them unreadable is modelling a
        # failure that does not happen, not a hard case.
        blur=1.1,
        noise=6.0,
        jpeg_quality=62,
        resample=0.82,
    ),
    "crumpled": Profile(
        "crumpled",
        "Folded into an envelope, then photographed",
        perspective=0.011,
        rotate_deg=2.0,
        lighting=0.22,
        folds=2,
        blur=0.9,
        noise=4.0,
        jpeg_quality=70,
    ),
    "thermal_worn": Profile(
        "thermal_worn",
        "Thermal roll from an apron pocket",
        perspective=0.009,
        rotate_deg=1.8,
        thermal=True,
        folds=1,
        dropout=0.020,
        blur=0.7,
        noise=4.0,
        jpeg_quality=68,
    ),
    "carbon_smudged": Profile(
        "carbon_smudged",
        "Carbon copy, unevenly struck and smudged",
        perspective=0.008,
        rotate_deg=1.3,
        lighting=0.18,
        dropout=0.035,
        blur=1.0,
        noise=5.0,
        jpeg_quality=72,
    ),
    "faxed": Profile(
        "faxed",
        "Emailed as a fax-quality scan",
        rotate_deg=0.8,
        photocopy=True,
        dropout=0.012,
        noise=3.0,
        jpeg_quality=64,
        # 0.6 destroyed 7pt dot-matrix bodies outright. Degradation must make
        # reading hard, never impossible — see `assert_legible`.
        resample=0.78,
    ),
}


class IllegibleSampleError(RuntimeError):
    """Raised when a degradation profile removed the document's information."""


def assert_legible(
    before: np.ndarray, after: np.ndarray, *, min_retention: float = 0.35
) -> float:
    """Fail when degradation has erased the page rather than obscured it.

    A sample whose text is gone is not a harder test case — it is a broken one,
    and scoring an extractor against it measures nothing except that blank paper
    contains no invoice. The same principle as filtering incoherent
    house/scenario pairings in compose.py: every artifact must remain a fair
    question with a knowable answer.

    Measured on stroke density, not ink coverage — see `ink_coverage`.

    Returns the retention ratio so callers can log it.
    """
    b = stroke_density(before)
    if b <= 0:
        return 1.0
    after_d = stroke_density(after)
    retention = after_d / b
    if retention < min_retention:
        raise IllegibleSampleError(
            f"degradation retained only {retention:.0%} of stroke density "
            f"({b:.4f} -> {after_d:.4f}); sample would be unreadable"
        )
    return retention

#: Which profiles suit which physical medium. A thermal roll does not get
#: folded into thirds; a laser invoice does not fade from the top.
#:
#: `phone_bad` is deliberately absent from `carbon_copy` and `thermal`. Those
#: media are already low-contrast before anything happens to them, and stacking
#: a hurried phone photo on top measured 22-25% stroke retention even at 300dpi
#: — an artifact nobody could read and no extractor could fairly be scored on.
#: They keep their own medium-specific harsh profile instead. `assert_legible`
#: remains the backstop for combinations not anticipated here.
PROFILES_BY_MEDIUM: dict[str, tuple[str, ...]] = {
    "laser": ("pristine", "scan", "phone_good", "phone_bad", "crumpled", "faxed"),
    "letterhead": ("pristine", "scan", "phone_good", "crumpled"),
    "carbon_copy": ("carbon_smudged", "faxed", "scan", "phone_good"),
    "thermal": ("thermal_worn", "phone_good", "scan"),
    "dot_matrix": ("scan", "faxed", "phone_good", "crumpled"),
}


def profile(key: str) -> Profile:
    try:
        return PROFILES[key]
    except KeyError:
        raise KeyError(f"Unknown profile '{key}'. Known: {sorted(PROFILES)}") from None


def profiles_for_medium(medium: str) -> tuple[str, ...]:
    return PROFILES_BY_MEDIUM.get(medium, ("pristine", "scan", "phone_good"))


# --------------------------------------------------------------------------
# Apply
# --------------------------------------------------------------------------


def apply_profile(
    src: Path,
    dst: Path,
    prof: Profile,
    *,
    seed: int = 0,
    crop: bool = True,
    check_legible: bool = True,
) -> Path:
    """Read `src`, degrade per `prof`, write `dst`. Deterministic in `seed`.

    Raises IllegibleSampleError when the profile erased the document, unless
    `check_legible=False`.
    """
    img = cv2.imread(str(src), cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(f"Could not read image: {src}")

    rng = random.Random(f"{prof.key}:{seed}")

    if crop:
        img = autocrop(img)
    original = img.copy()

    if prof.resample != 1.0:
        h, w = img.shape[:2]
        small = cv2.resize(
            img,
            (max(1, int(w * prof.resample)), max(1, int(h * prof.resample))),
            interpolation=cv2.INTER_AREA,
        )
        img = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)

    if prof.thermal:
        img = thermal_fade(img, rng)
    if prof.photocopy:
        img = photocopy(img)
    if prof.dropout:
        img = ink_dropout(img, rng, prof.dropout)
    if prof.folds:
        img = fold_lines(img, rng, prof.folds)
    if prof.perspective:
        img = perspective(img, rng, prof.perspective)
    if prof.rotate_deg:
        img = rotate(img, rng.uniform(-prof.rotate_deg, prof.rotate_deg))
    if prof.lighting:
        img = lighting(img, rng, prof.lighting)
    if prof.shadow:
        img = shadow(img, rng, prof.shadow)
    if prof.blur or prof.noise:
        img = blur_and_noise(img, rng, prof.blur, prof.noise)

    dst.parent.mkdir(parents=True, exist_ok=True)
    if prof.jpeg_quality is not None and dst.suffix.lower() in (".jpg", ".jpeg"):
        cv2.imwrite(str(dst), img, [int(cv2.IMWRITE_JPEG_QUALITY), prof.jpeg_quality])
    else:
        cv2.imwrite(str(dst), img)

    # Check the artifact that actually ships, not the pre-encode buffer. JPEG at
    # quality 58 costs several more points of stroke density, so verifying the
    # in-memory image passes samples that are unreadable on disk.
    if check_legible:
        written = cv2.imread(str(dst), cv2.IMREAD_COLOR)
        try:
            assert_legible(original, written)
        except IllegibleSampleError:
            dst.unlink(missing_ok=True)
            raise
    return dst
