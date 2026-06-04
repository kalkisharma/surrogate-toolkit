"""
bump_version.py — update the version string across all canonical locations.

Usage:
    python scripts/bump_version.py 3.5.54

Files updated:
    config/settings.py      — VERSION constant + file header comment
    app/templates/index.html — version display span + all ?v= cache busters

The script reads the current version from settings.py, validates the new
version is a valid semver-style string, performs the substitution in each
file, and prints a summary of every line changed.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _write(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def _current_version() -> str:
    settings = _read(ROOT / "config" / "settings.py")
    m = re.search(r'^VERSION\s*=\s*"([^"]+)"', settings, re.MULTILINE)
    if not m:
        raise RuntimeError("Could not find VERSION constant in config/settings.py")
    return m.group(1)


def _validate(version: str) -> None:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError(f"Version must be X.Y.Z format, got: {version!r}")


def _replace_and_report(path: Path, old: str, new: str, label: str) -> int:
    content = _read(path)
    count   = content.count(old)
    if count == 0:
        print(f"  {label}: no occurrences of {old!r} found — skipped")
        return 0
    _write(path, content.replace(old, new))
    print(f"  {label}: replaced {count} occurrence(s)  {old} -> {new}")
    return count


def bump(new_version: str) -> None:
    _validate(new_version)
    old_version = _current_version()

    if old_version == new_version:
        print(f"Version is already {new_version}. Nothing to do.")
        return

    print(f"\nBumping version  {old_version}  ->  {new_version}\n")

    # ── config/settings.py ───────────────────────────────────────────────────
    settings_path = ROOT / "config" / "settings.py"
    settings      = _read(settings_path)

    # VERSION constant
    settings = re.sub(
        r'(^VERSION\s*=\s*")[^"]+(")',
        rf'\g<1>{new_version}\g<2>',
        settings, count=1, flags=re.MULTILINE,
    )
    # File header comment (e.g. "VERSION: 3.5.52") — match any version, not just old_version,
    # so the script corrects a stale header even if it was never previously synced.
    settings = re.sub(
        r'(VERSION:\s*)\d+\.\d+\.\d+',
        rf'\g<1>{new_version}',
        settings,
    )
    _write(settings_path, settings)
    print(f"  config/settings.py: VERSION constant + header comment updated")

    # ── app/templates/index.html ──────────────────────────────────────────────
    _replace_and_report(
        ROOT / "app" / "templates" / "index.html",
        old_version, new_version,
        "app/templates/index.html",
    )

    print(f"\nDone. Remember to:\n"
          f"  1. Update file headers in any files you modified this release\n"
          f"  2. Add a CHANGELOG entry in docs/CHANGELOG.md\n"
          f"  3. Commit with message: v{new_version} - <short description>\n")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/bump_version.py <new_version>")
        print("Example: python scripts/bump_version.py 3.5.54")
        sys.exit(1)
    try:
        bump(sys.argv[1])
    except (ValueError, RuntimeError) as e:
        print(f"Error: {e}")
        sys.exit(1)
