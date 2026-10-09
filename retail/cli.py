"""Bootstrap operator login locally without putting a password in the command line."""

import argparse
import getpass

from werkzeug.security import generate_password_hash

from .app import configuration
from .registry import Registry, email


def main():
    parser = argparse.ArgumentParser(description='Configurar acceso privado al panel de marca blanca.')
    parser.add_argument('command', choices=['init-admin'])
    parser.add_argument('--email', required=True, help='Correo del propietario del panel.')
    args = parser.parse_args()
    owner_email = email(args.email)
    password = getpass.getpass('Contraseña del panel (mínimo 12 caracteres): ')
    confirmation = getpass.getpass('Repite la contraseña: ')
    if password != confirmation or not 12 <= len(password) <= 1024:
        parser.error('Las contraseñas deben coincidir y tener entre 12 y 1024 caracteres.')
    registry = Registry(configuration())
    with registry.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        if db.execute('SELECT id FROM owner WHERE id=1').fetchone():
            parser.error('El panel ya tiene un propietario. Cambia la contraseña desde su sesión.')
        db.execute('INSERT INTO owner VALUES(1,?,?)', (owner_email, generate_password_hash(password)))
    print('Propietario del panel configurado. No se ha creado ni accedido a ningún CRM de cliente.')


if __name__ == '__main__':
    main()
