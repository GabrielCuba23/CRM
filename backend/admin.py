"""Owner setup/recovery from a private server terminal; never from a public URL."""
import argparse
import getpass
import os
from werkzeug.security import generate_password_hash
from .storage import connect, initialize


def main():
    parser = argparse.ArgumentParser(description='Crear o recuperar la única cuenta de administrador.')
    parser.add_argument('--email', required=True)
    args = parser.parse_args()
    password = getpass.getpass('Nueva contraseña (mínimo 12 caracteres): ')
    confirmation = getpass.getpass('Repetir contraseña: ')
    if len(password) < 12 or password != confirmation:
        parser.error('Las contraseñas deben coincidir y tener al menos 12 caracteres.')
    path = os.environ.get('CRM_DB_PATH', '/workspace/crm-data/crm.sqlite3')
    initialize(path)
    with connect(path) as db:
        db.execute('INSERT OR REPLACE INTO owner VALUES(1,?,?)', (args.email.strip().lower(), generate_password_hash(password)))
        db.execute('DELETE FROM sessions')
    print('Administrador actualizado. Las sesiones anteriores se cerraron.')


if __name__ == '__main__':
    main()
