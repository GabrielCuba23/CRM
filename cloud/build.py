"""Copy only public application assets into the Worker asset directory."""
from pathlib import Path
import shutil

FILES = ['index.html','app.js','crm.mjs','automation.mjs','bulk.mjs','growth.mjs','growth-ui.mjs','vendor/exceljs-4.4.0.min.js','styles.css','icons.svg','login.html','login.js','sw.js','manifest.webmanifest','app-icon.svg','app-icon-192.png','app-icon-512.png']


def build(destination=None):
    root=Path(__file__).resolve().parent.parent
    destination=Path(destination) if destination else root/'cloud'/'assets'
    destination.mkdir(parents=True,exist_ok=True)
    for filename in FILES:
        (destination/filename).parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(root/filename,destination/filename)
    return destination


if __name__ == '__main__':
    build()
    print('Recursos listos; no se copiaron datos, credenciales ni archivos del servidor.')
