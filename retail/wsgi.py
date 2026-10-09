"""Gunicorn entry point: gunicorn retail.wsgi:app."""

from .dispatcher import create_dispatcher

app = create_dispatcher()
