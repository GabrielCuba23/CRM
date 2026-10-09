"""Exercise multiple HTTPS CRM hosts with disposable data and test credentials."""
import http.client
import os
from pathlib import Path
import secrets
import socket
import ssl
import subprocess
import sys
import tempfile
import time


def main():
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix='crm-retail-test-') as temporary:
        directory = Path(temporary)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        certificate, key = directory/'cert.pem', directory/'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(key), '-out', str(certificate), '-days', '1',
                        '-subj', '/CN=admin.retail.test', '-addext',
                        'subjectAltName=DNS:admin.retail.test,DNS:*.clients.retail.test,IP:127.0.0.1'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.chmod(key, 0o600)
        environment = {
            **os.environ,
            'RETAIL_PUBLIC_URL': f'https://admin.retail.test:{port}',
            'RETAIL_BASE_DOMAIN': 'clients.retail.test',
            'RETAIL_DATA_ROOT': str(directory/'data'),
            'RETAIL_ADMIN_EMAIL': 'operator@example.com',
            'RETAIL_ADMIN_PASSWORD': secrets.token_urlsafe(24),
            'RETAIL_TENANT_PORT': str(port),
            'RETAIL_ALLOW_HTTP': '0',
            'CRM_TEST_PASSWORD': secrets.token_urlsafe(24),
            'CRM_OWNER_EMAIL': '', 'CRM_OWNER_PASSWORD': '',
            'WHATSAPP_ACCESS_TOKEN': '', 'WHATSAPP_PHONE_NUMBER_ID': '',
            'RESEND_API_KEY': '', 'REPORT_FROM_EMAIL': '',
        }
        with open(directory/'server.log', 'w+') as log:
            process = subprocess.Popen([sys.executable, '-m', 'gunicorn', '--bind', f'127.0.0.1:{port}',
                                        '--workers', '2', '--certfile', str(certificate), '--keyfile', str(key),
                                        'retail.wsgi:app'], cwd=root, env=environment, stdout=log, stderr=log)
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError('El servidor retail de prueba no pudo iniciarse.')
                    try:
                        connection = http.client.HTTPSConnection('127.0.0.1', port, timeout=1,
                            context=ssl.create_default_context(cafile=certificate))
                        connection.request('GET', '/healthz', headers={'Host': f'admin.retail.test:{port}'})
                        response = connection.getresponse()
                        body = response.read()
                        connection.close()
                        if response.status == 200 and b'"ok"' in body:
                            break
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError('El panel no respondió al chequeo de salud.')
                result = subprocess.run(['node', 'tests/browser_retail.cjs'], cwd=root, env=environment)
                if result.returncode:
                    raise SystemExit(result.returncode)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    main()
