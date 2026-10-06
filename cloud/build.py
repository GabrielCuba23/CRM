"""Copy only public application assets into the Worker asset directory."""
from pathlib import Path
import shutil

FILES = ['index.html','app.js','crm.mjs','styles.css','icons.svg','login.html','login.js']


def build(destination=None):
    root=Path(__file__).resolve().parent.parent
    destination=Path(destination) if destination else root/'cloud'/'assets'
    destination.mkdir(parents=True,exist_ok=True)
    for filename in FILES:shutil.copy2(root/filename,destination/filename)
    return destination


if __name__ == '__main__':
    build()
    print('Recursos listos; no se copiaron datos, credenciales ni archivos del servidor.')
