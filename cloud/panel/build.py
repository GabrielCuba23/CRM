"""Build allowlisted panel assets and a self-contained customer Worker; no secrets."""
import base64
import json
from pathlib import Path
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[2]
DIRECTORY=ROOT/'cloud/panel'

def build_panel(destination=None):
    from build import FILES
    assets={}
    types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'}
    for filename in FILES:
        path=ROOT/filename
        assets['/'+filename]={'body':base64.b64encode(path.read_bytes()).decode(),'type':types[path.suffix]}
    DIRECTORY.joinpath('generated-assets.mjs').write_text('export const assets='+json.dumps(assets)+';\n')
    output=DIRECTORY/'build'
    output.mkdir(exist_ok=True)
    executable='/tmp/crm-cloud-tools/node_modules/.bin/esbuild'
    subprocess.run([executable,str(DIRECTORY/'client-entry.mjs'),'--bundle','--format=esm','--minify',f'--outfile={output}/client.mjs'],cwd=ROOT,check=True,capture_output=True)
    DIRECTORY.joinpath('generated-client.mjs').write_text('export const clientSource='+json.dumps((output/'client.mjs').read_text())+';\nexport const customerSchema='+json.dumps((ROOT/'cloud/schema.sql').read_text())+';\n')
    destination=Path(destination) if destination else output/'assets'
    (destination/'retail-static').mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/'retail/templates/panel.html',destination/'panel.html')
    for name in ['panel.js','panel.css']:
        shutil.copy2(ROOT/'retail/static'/name,destination/'retail-static'/name)
    return destination

if __name__=='__main__':
    import sys
    sys.path.insert(0,str(ROOT/'cloud'))
    build_panel()
    print('Panel y Worker de clientes preparados, sin datos ni credenciales.')
