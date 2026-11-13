from argparse import ArgumentParser
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import json


def main():
    parser = ArgumentParser(description="Build the Teman Pora Chrome extension ZIP.")
    parser.add_argument("output", type=Path)
    output = parser.parse_args().output
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    files = {
        "manifest.json", "config.js", "styles.css", "popup.html", "popup.js",
        manifest["background"]["service_worker"],
        *manifest["icons"].values(),
        *(script for entry in manifest["content_scripts"] for script in entry["js"]),
        *(file.relative_to(root).as_posix() for file in (root / "modules").glob("*.js")),
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name in sorted(files):
            archive.write(root / name, f"Teman-Pora-Extension/{name}")


if __name__ == "__main__":
    main()
