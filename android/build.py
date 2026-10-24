#!/usr/bin/env python3
"""Build an SDK 35 APK using public pinned tools, with no Gradle or cloud account.

The generated local-testing keystore stays outside the repository. Its password
is passed to keytool/apksigner through process environment, never CLI values.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
ARTIFACTS = {
    'platform-35_r02.zip': ('https://dl.google.com/android/repository/platform-35_r02.zip',
        '0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0'),
    'build-tools_r35_linux.zip': ('https://dl.google.com/android/repository/build-tools_r35_linux.zip',
        'bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88'),
    'ecj.jar': ('https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.39.0/ecj-3.39.0.jar',
        '01f5a92ac19bb2b3bf85e295a68f2c73c264369109158b566ce9b490af982948'),
}


def run(command, **kwargs):
    subprocess.run([str(value) for value in command], check=True, **kwargs)


def prepare_tools(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in ARTIFACTS.items():
        path = directory / name
        if not path.exists():
            temporary = path.with_suffix(path.suffix + '.part')
            run(['curl', '--fail', '--silent', '--show-error', '--location', url, '-o', temporary])
            temporary.rename(path)
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'Checksum incorrecto de {name}; descarga cancelada.')
        if name.endswith('.zip'):
            target = directory / ('android-35' if name.startswith('platform-') else 'android-15')
            if not target.exists():
                with zipfile.ZipFile(path) as archive:
                    for entry in archive.infolist():
                        resolved = (directory / entry.filename).resolve()
                        if not resolved.is_relative_to(directory.resolve()):
                            raise RuntimeError('Ruta no válida dentro de un paquete SDK.')
                    archive.extractall(directory)
    tools = directory / 'android-15'
    for name in ['aapt2', 'zipalign', 'apksigner', 'd8']:
        (tools / name).chmod(0o700)
    return tools, directory / 'android-35/android.jar', directory / 'ecj.jar'


def compile_java(compiler, platform, destination, files):
    destination.mkdir(parents=True, exist_ok=True)
    bootclasspath = str(platform) + os.pathsep + str(compiler.parent / 'android-15/core-lambda-stubs.jar')
    run(['java', '-jar', compiler, '-source', '1.8', '-target', '1.8',
         '-bootclasspath', bootclasspath, '-encoding', 'UTF-8', '-d', destination, *files])


def test_policy(compiler, platform, build):
    output = build / 'policy-tests'
    compile_java(compiler, platform, output,
                 [ROOT / 'src/com/nexocrm/mobile/UrlPolicy.java', ROOT / 'test/com/nexocrm/mobile/UrlPolicyTest.java'])
    run(['java', '-cp', output, 'com.nexocrm.mobile.UrlPolicyTest'])


def signing_config(args):
    directory = args.signing_dir.resolve()
    if directory.is_relative_to(PROJECT.resolve()):
        raise RuntimeError('La clave de firma debe guardarse fuera del repositorio.')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    record = directory / 'local-testing-signing.json'
    key = directory / 'nexo-local-testing.jks'
    if not record.exists():
        if key.exists():
            raise RuntimeError('Hay una clave sin su registro de firma. No se sobrescribirá.')
        password = secrets.token_urlsafe(32)
        record.write_text(json.dumps({'alias': 'nexo-local-testing', 'password': password}) + '\n')
        record.chmod(0o600)
    state = json.loads(record.read_text())
    environment = {**os.environ, 'NEXO_ANDROID_STORE_PASSWORD': state['password']}
    if not key.exists():
        run(['keytool', '-genkeypair', '-keystore', key, '-alias', state['alias'],
             '-keyalg', 'RSA', '-keysize', '3072', '-validity', '3650',
             '-dname', 'CN=Nexo CRM Local Testing,OU=Development,O=Nexo CRM',
             '-storepass:env', 'NEXO_ANDROID_STORE_PASSWORD',
             '-keypass:env', 'NEXO_ANDROID_STORE_PASSWORD', '-noprompt'], env=environment)
        key.chmod(0o600)
    return key, state['alias'], environment


def build_apk(args):
    build = args.build_dir.resolve()
    build.mkdir(parents=True, exist_ok=True)
    tools, platform, compiler = prepare_tools(args.tools_dir.resolve())
    test_policy(compiler, platform, build)
    if args.test_policy:
        return
    if args.signing_dir is None:
        raise RuntimeError('Indica --signing-dir con una carpeta privada fuera del repositorio.')
    key, alias, environment = signing_config(args)
    resource = build / 'res'
    if resource.exists():
        shutil.rmtree(resource)
    shutil.copytree(ROOT / 'res', resource)
    (resource / 'mipmap-nodpi').mkdir(exist_ok=True)
    shutil.copy2(PROJECT / 'app-icon-192.png', resource / 'mipmap-nodpi/ic_launcher.png')
    run([tools / 'aapt2', 'compile', '--dir', resource, '-o', build / 'resources.zip'])
    generated = build / 'generated'
    generated.mkdir(exist_ok=True)
    run([tools / 'aapt2', 'link', '-o', build / 'base.apk', '-I', platform,
         '--manifest', ROOT / 'AndroidManifest.xml', '--min-sdk-version', '26',
         '--target-sdk-version', '35', '--version-code', '1', '--version-name', '1.0.0',
         '--auto-add-overlay', '-R', build / 'resources.zip', '--java', generated])
    classes = build / 'classes'
    if classes.exists():
        shutil.rmtree(classes)
    compile_java(compiler, platform, classes,
                 [*sorted((ROOT / 'src').rglob('*.java')), *sorted(generated.rglob('*.java'))])
    dex = build / 'dex'
    dex.mkdir(exist_ok=True)
    run([tools / 'd8', '--lib', platform, '--min-api', '26', '--output', dex,
         *sorted(classes.rglob('*.class'))])
    with zipfile.ZipFile(build / 'base.apk', 'a', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(dex.glob('*.dex')):
            archive.write(path, path.name)
    run([tools / 'zipalign', '-f', '4', build / 'base.apk', build / 'aligned.apk'])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    run([tools / 'apksigner', 'sign', '--ks', key, '--ks-key-alias', alias,
         '--ks-pass', 'env:NEXO_ANDROID_STORE_PASSWORD', '--key-pass', 'env:NEXO_ANDROID_STORE_PASSWORD',
         '--out', args.output, build / 'aligned.apk'], env=environment)
    run([tools / 'apksigner', 'verify', '--verbose', args.output])
    run([tools / 'aapt2', 'dump', 'badging', args.output])
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    args.output.with_suffix('.apk.sha256').write_text(digest + '  ' + args.output.name + '\n')
    print(f'APK local de pruebas generado: {args.output}')
    print('Firma verificada; todavía requiere instalación y validación en un dispositivo Android.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tools-dir', type=Path, default=ROOT / 'build/tools')
    parser.add_argument('--build-dir', type=Path, default=ROOT / 'build/app')
    parser.add_argument('--signing-dir', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'build/nexo-crm-android-testing.apk')
    parser.add_argument('--test-policy', action='store_true')
    args = parser.parse_args()
    try:
        build_apk(args)
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        raise SystemExit(str(error)) from None


if __name__ == '__main__':
    main()
