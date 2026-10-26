"""Package the focused WhatsApp workspace and its shared CRM logic. No user data."""
import argparse
import ast
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "extension"
EXTENSION_FILES = ["manifest.json", "policy.mjs", "background.mjs", "crm-bridge.js", "whatsapp.js", "dock.js", "bootstrap.mjs", "options.html", "options.css", "options.mjs", "companion.css", "clipboard.html", "clipboard.js", "README.md"]


def public_files():
    # Read the explicit allowlist without importing side-effectful build modules.
    tree = ast.parse((ROOT / "cloud/build.py").read_text())
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "FILES" for target in statement.targets):
            return ast.literal_eval(statement.value)
    raise RuntimeError("No se encontró la lista de archivos públicos del CRM.")


def build(destination):
    destination = Path(destination).resolve()
    if destination == SOURCE or destination == ROOT:
        raise ValueError("Elige un directorio de salida diferente al código fuente.")
    destination.mkdir(parents=True, exist_ok=True)
    app = destination / "app"
    app.mkdir(exist_ok=True)
    for name in public_files():
        target = app / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    for name in EXTENSION_FILES:
        shutil.copy2(SOURCE / name, destination / name)
    html_path = app / "index.html"
    html = html_path.read_text()
    html = html.replace("<head>", '<head>\n<meta name="crm-backend" content="required">')
    html = html.replace('<script src="app.js" type="module"></script>', '<script src="../bootstrap.mjs" type="module"></script>')
    if 'src="../bootstrap.mjs"' not in html or 'name="crm-backend"' not in html:
        raise RuntimeError("Cambió el punto de entrada del CRM; revisa el empaquetado.")
    html_path.write_text(html)
    # A Chrome extension has its own service worker and browser identity.
    (app / "sw.js").unlink(missing_ok=True)
    manifest = json.loads((destination / "manifest.json").read_text())
    assert manifest["manifest_version"] == 3 and not manifest.get("externally_connectable")
    return destination


def archive(directory, destination):
    directory, destination = Path(directory), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as bundle:
        # Archive only the allowlisted outputs, even if a reused destination has
        # an unrelated local file. User data and credentials never enter a ZIP.
        names = EXTENSION_FILES + ["app/" + name for name in public_files() if name != "sw.js"]
        for name in sorted(names):
            path = directory / name
            if not path.is_file():
                raise RuntimeError("Falta un recurso público de la extensión: " + name)
            bundle.write(path, name)
    return destination


def main():
    parser = argparse.ArgumentParser(description="Construir extensión Nexo CRM para cargar en Chrome.")
    parser.add_argument("--output-dir", default=str(ROOT / "work/extension-unpacked"))
    parser.add_argument("--zip", dest="zip_path", default=str(ROOT / "work/nexo-crm-chrome.zip"))
    args = parser.parse_args()
    directory = build(args.output_dir)
    package = archive(directory, args.zip_path)
    print("Extensión preparada:", directory)
    print("Archivo ZIP:", package)


if __name__ == "__main__":
    main()
