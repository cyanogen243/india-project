from pathlib import Path

import pypdfium2 as pdfium

OUTPUT = Path("tmp/pdfs")
OUTPUT.mkdir(parents=True, exist_ok=True)

for source in [
    Path("public/offline-pack/field-pack-en.pdf"),
    Path("public/offline-pack/field-pack-hi.pdf"),
]:
    document = pdfium.PdfDocument(source)
    for index, page in enumerate(document):
        image = page.render(scale=1.7).to_pil()
        image.save(OUTPUT / f"{source.stem}-{index + 1}.png")
