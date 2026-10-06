"""Start a private temporary server with random test-only credentials, then run E2E."""
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def main():
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix='crm-secure-test-') as temporary:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        password = secrets.token_urlsafe(24)
        environment = {
            **os.environ,
            'CRM_DB_PATH': str(Path(temporary)/'test.sqlite3'),
            'CRM_PUBLIC_URL': f'http://127.0.0.1:{port}',
            'CRM_ALLOW_HTTP': '1',
            'CRM_OWNER_EMAIL': 'owner@example.com',
            'CRM_OWNER_PASSWORD': password,
            'WHATSAPP_ACCESS_TOKEN': '',
            'WHATSAPP_PHONE_NUMBER_ID': '',
            'CRM_TEST_PASSWORD': password,
            'CRM_TEST_NEXT_PASSWORD': secrets.token_urlsafe(24),
            'CRM_TEST_URL': f'http://127.0.0.1:{port}/',
        }
        with open(Path(temporary)/'server.log', 'w+') as log:
            process = subprocess.Popen([sys.executable,'-m','gunicorn','--bind',f'127.0.0.1:{port}','--workers','2','backend.wsgi:app'],cwd=root,env=environment,stdout=log,stderr=log)
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError('El servidor de pruebas no pudo iniciarse.')
                    try:
                        with urllib.request.urlopen(environment['CRM_TEST_URL']+'healthz',timeout=1) as response:
                            if response.status == 200:
                                break
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError('El servidor no respondió al chequeo de salud.')
                completed = subprocess.run(['node','tests/browser_secure.cjs'],cwd=root,env=environment)
                if completed.returncode:
                    raise SystemExit(completed.returncode)
            finally:
                process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait()


if __name__ == '__main__':main()
