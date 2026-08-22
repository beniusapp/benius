from __future__ import annotations

from pathlib import Path

import fitz


INPUT_DIR = Path("attached_assets")
OUTPUT_DIR = Path(".agents/outputs/financial-analytics-pdf-audit")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for pdf_path in sorted(INPUT_DIR.glob("financial-analytics-*.pdf")):
        report_dir = OUTPUT_DIR / pdf_path.stem
        report_dir.mkdir(parents=True, exist_ok=True)
        document = fitz.open(pdf_path)
        text_parts: list[str] = []

        for page_number, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            pixmap.save(report_dir / f"page-{page_number:02d}.png")
            text_parts.append(
                f"\n\n===== PAGE {page_number} | {page.rect.width:.0f}×{page.rect.height:.0f} pt =====\n"
                + page.get_text("text")
            )

        (report_dir / "extracted-text.txt").write_text("".join(text_parts), encoding="utf-8")
        (report_dir / "metadata.txt").write_text(
            f"source={pdf_path}\npages={document.page_count}\nmetadata={document.metadata}\n",
            encoding="utf-8",
        )
        print(f"{pdf_path.name}: {document.page_count} pages rendered")


if __name__ == "__main__":
    main()