#!/usr/bin/env python3
"""Minify CSS files for production deployment.

Usage:
    poetry run python scripts/minify_css.py

This script minifies all CSS files in app/static/css/ and creates
corresponding .min.css versions.
"""

from pathlib import Path

import rcssmin

# Project paths
STATIC_CSS_DIR = Path(__file__).parent.parent / "app" / "static" / "css"


def minify_css_file(source_path: Path) -> Path:
    """Minify a single CSS file.

    Args:
        source_path: Path to the source CSS file

    Returns:
        Path to the minified output file
    """
    output_path = source_path.with_suffix(".min.css")

    with open(source_path, encoding="utf-8") as f:
        source_css = f.read()

    minified = rcssmin.cssmin(source_css)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(minified)

    source_size = len(source_css)
    minified_size = len(minified)
    reduction = ((source_size - minified_size) / source_size) * 100

    print(
        f"✓ {source_path.name} -> {output_path.name} "
        f"({source_size:,} -> {minified_size:,} bytes, {reduction:.1f}% reduction)"
    )

    return output_path


def main() -> None:
    """Minify all CSS files in the static directory."""
    if not STATIC_CSS_DIR.exists():
        print(f"Error: CSS directory not found: {STATIC_CSS_DIR}")
        return

    css_files = list(STATIC_CSS_DIR.glob("*.css"))
    # Exclude already minified files
    css_files = [f for f in css_files if not f.name.endswith(".min.css")]

    if not css_files:
        print("No CSS files found to minify.")
        return

    print(f"Minifying {len(css_files)} CSS file(s)...\n")

    for css_file in css_files:
        minify_css_file(css_file)

    print("\n✓ CSS minification complete!")


if __name__ == "__main__":
    main()
