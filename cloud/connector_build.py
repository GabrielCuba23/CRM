"""Build self-contained Workers for the authorized Cloudflare API connector.

This is an offline build. It neither reads credentials nor creates resources.
Only the application's explicit public asset allowlists are embedded. The normal
Worker still authenticates requests before serving any private frontend assets.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ESBUILD = Path('/tmp/crm-cloud-tools/node_modules/.bin/esbuild')
MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
}
PANEL_FILES = {
    'panel.html': 'retail/templates/panel.html',
    'retail-static/panel.js': 'retail/static/panel.js',
    'retail-static/panel.css': 'retail/static/panel.css',
}
CONFIG = {
    'crm': {
        'worker_name': 'nexo-crm',
        'database_name': 'nexo-crm',
        'entry': 'cloud/index.mjs',
        'schema': 'cloud/schema.sql',
        'cron': ['0 * * * *'],
        'plain_text': ['OWNER_EMAIL', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'],
        'optional_secrets': [
            'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
            'RESEND_API_KEY', 'INTEGRATION_API_TOKEN',
        ],
    },
    'panel': {
        'worker_name': 'nexo-retail-panel',
        'database_name': 'nexo-retail-registry',
        'entry': 'cloud/panel/index.mjs',
        'schema': 'cloud/panel/schema.sql',
        'cron': ['*/5 * * * *'],
        'plain_text': [
            'OWNER_EMAIL', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ACCOUNT_ID',
            'WORKERS_SUBDOMAIN', 'PIN_PROVIDER_ID', 'PANEL_WORKER_NAME',
            'PUBLIC_URL',
        ],
        'optional_secrets': ['RETAIL_PROVISION_TOKEN'],
    },
}


def read_public_file(root, filename):
    """Reject traversal, unknown file kinds, symlinks and allowlist mistakes."""
    root = Path(root).resolve()
    if not isinstance(filename, str) or not filename or '\\' in filename:
        raise ValueError('Ruta de recurso público no válida.')
    relative = PurePosixPath(filename)
    if relative.is_absolute() or any(part in ('.', '..') for part in filename.split('/')):
        raise ValueError('Ruta de recurso público no válida.')
    if relative.suffix not in MIME_TYPES:
        raise ValueError('Tipo de recurso público no autorizado.')
    path = root.joinpath(*relative.parts)
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError('Un recurso público sale del directorio del proyecto.')
    if not path.is_file():
        raise ValueError(f'Falta un recurso público autorizado: {filename}')
    return path.read_bytes(), MIME_TYPES[relative.suffix]


def asset_map(root, filenames):
    result = {}
    for route, filename in filenames.items():
        relative_route = PurePosixPath(route)
        if (not isinstance(route, str) or not route or '\\' in route
                or relative_route.is_absolute()
                or any(part in ('', '.', '..') for part in route.split('/'))):
            raise ValueError('Ruta pública no válida.')
        value, mime = read_public_file(root, filename)
        result['/' + route] = {
            'body': base64.b64encode(value).decode('ascii'), 'type': mime,
        }
    return result


def app_files(root=ROOT):
    """Use the same source of truth as Wrangler's frontend build."""
    spec = importlib.util.spec_from_file_location(
        '_nexo_public_asset_allowlist', Path(root) / 'cloud/build.py',
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    names = list(module.FILES)
    if len(set(names)) != len(names):
        raise ValueError('La lista pública contiene recursos duplicados.')
    return {name: name for name in names}


def write_assets(path, assets):
    Path(path).write_text('export const assets=' + json.dumps(
        assets, ensure_ascii=False, separators=(',', ':'),
    ) + ';\n', encoding='utf8')


def compile_module(entry, destination, executable):
    subprocess.run([
        str(executable), str(entry), '--bundle', '--format=esm', '--minify',
        '--platform=browser', '--target=es2022', '--charset=utf8',
        '--legal-comments=none', '--outfile=' + str(destination),
    ], cwd=ROOT, check=True, capture_output=True, text=True)


def prepare_customer_module(esbuild, root=ROOT):
    """Produce the same generated imports consumed by the existing panel.

    Customer creation keeps its lifecycle binding, independent D1, authentication
    and schedule. The standalone CRM wrapper below is intentionally different.
    """
    root = Path(root)
    panel = root / 'cloud/panel'
    output = panel / 'build'
    output.mkdir(parents=True, exist_ok=True)
    write_assets(panel / 'generated-assets.mjs', asset_map(root, app_files(root)))
    compile_module(panel / 'client-entry.mjs', output / 'client.mjs', esbuild)
    (panel / 'generated-client.mjs').write_text(
        'export const clientSource=' + json.dumps(
            (output / 'client.mjs').read_text(encoding='utf8'),
            ensure_ascii=False,
        ) + ';\nexport const customerSchema=' + json.dumps(
            (root / 'cloud/schema.sql').read_text(encoding='utf8'),
            ensure_ascii=False,
        ) + ';\n', encoding='utf8',
    )


def compatibility_date(root=ROOT):
    config = (Path(root) / 'cloud/wrangler.jsonc').read_text(encoding='utf8')
    match = re.search(r'"compatibility_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"', config)
    if not match:
        raise ValueError('Falta compatibility_date en cloud/wrangler.jsonc.')
    return match[1]


def build_worker(kind, output_dir, esbuild=DEFAULT_ESBUILD, root=ROOT):
    if kind not in CONFIG:
        raise ValueError('Elige crm o panel.')
    root, esbuild = Path(root).resolve(), Path(esbuild).resolve()
    if not esbuild.is_file():
        raise ValueError('Instala esbuild con las herramientas de Cloudflare.')
    configuration = CONFIG[kind]
    output = Path(output_dir).resolve() / kind
    source = output / '_sources'
    source.mkdir(parents=True, exist_ok=True)
    files = app_files(root) if kind == 'crm' else PANEL_FILES
    assets = asset_map(root, files)
    write_assets(source / 'assets.mjs', assets)
    if kind == 'panel':
        prepare_customer_module(esbuild, root)
    template = (root / 'cloud/connector-entry.mjs').read_text(encoding='utf8')
    entry = template.replace(
        json.dumps('__NEXO_WORKER_ENTRY__'),
        json.dumps(str(root / configuration['entry'])),
    ).replace(
        json.dumps('__NEXO_ASSETS_ENTRY__'),
        json.dumps(str(source / 'assets.mjs')),
    )
    (source / 'entry.mjs').write_text(entry, encoding='utf8')
    worker = output / 'worker.mjs'
    compile_module(source / 'entry.mjs', worker, esbuild)
    content = worker.read_bytes()
    schema = root / configuration['schema']
    manifest = {
        'format_version': 1,
        'kind': kind,
        'worker_name': configuration['worker_name'],
        'database_name': configuration['database_name'],
        'main_module': worker.name,
        'worker_path': str(worker),
        'worker_sha256': hashlib.sha256(content).hexdigest(),
        'worker_bytes': len(content),
        'compatibility_date': compatibility_date(root),
        'schema_path': str(schema),
        'schema_sha256': hashlib.sha256(schema.read_bytes()).hexdigest(),
        'required_bindings': [
            {'name': 'DB', 'type': 'd1', 'value_field': 'id'},
            *[{'name': name, 'type': 'plain_text', 'value_field': 'text'}
              for name in configuration['plain_text']],
        ],
        'optional_secret_bindings': configuration['optional_secrets'],
        'cron': configuration['cron'],
        'public_asset_routes': sorted(assets),
        'assets_embedded': True,
        'resources_created': False,
    }
    (output / 'manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8',
    )
    return manifest


def main():
    parser = argparse.ArgumentParser(
        description='Compilar Workers autocontenidos sin credenciales ni publicación.',
    )
    parser.add_argument('--kind', choices=['crm', 'panel', 'all'], default='all')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'work/connector-bundles')
    parser.add_argument('--esbuild', type=Path, default=DEFAULT_ESBUILD)
    arguments = parser.parse_args()
    try:
        kinds = ['crm', 'panel'] if arguments.kind == 'all' else [arguments.kind]
        for kind in kinds:
            manifest = build_worker(kind, arguments.output_dir, arguments.esbuild)
            print(json.dumps({
                'kind': kind, 'worker_path': manifest['worker_path'],
                'sha256': manifest['worker_sha256'], 'bytes': manifest['worker_bytes'],
                'resources_created': False,
            }, ensure_ascii=False))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        message = error.stderr if isinstance(error, subprocess.CalledProcessError) else str(error)
        raise SystemExit('No se pudo compilar: ' + message.strip()) from None


if __name__ == '__main__':
    main()
