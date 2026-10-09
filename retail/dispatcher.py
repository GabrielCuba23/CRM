"""Exact-host WSGI dispatcher. Host names never become filesystem paths."""

import threading

from werkzeug.wrappers import Response

from .app import configuration, create_app
from .registry import Registry
from .tenant import create_tenant_app


class HostDispatcher:
    def __init__(self, config=None):
        self.config = configuration(config)
        self.registry = Registry(self.config)
        self.admin_app = create_app(self.config, self.registry)
        self.config['ADMIN_PASSWORD'] = ''
        self.apps = {}
        self.lock = threading.Lock()

    def __call__(self, environ, start_response):
        # Intentionally ignore X-Forwarded-Host, Forwarded and user-supplied paths.
        host = environ.get('HTTP_HOST', '')
        if host == self.registry.admin_host:
            return self.admin_app(environ, start_response)
        suffix = f":{self.registry.tenant_port}" if self.registry.tenant_port != 443 else ''
        if suffix and not host.endswith(suffix):
            return self.reject(environ, start_response)
        hostname = host[:-len(suffix)] if suffix else host
        instance = self.registry.get(hostname=hostname)
        if not instance or self.registry.tenant_url(instance).removeprefix('https://') != host:
            return self.reject(environ, start_response)
        with self.lock:
            if instance['id'] not in self.apps:
                self.apps[instance['id']] = create_tenant_app(self.registry, instance['id'], self.config.get('TESTING', False))
            app = self.apps[instance['id']]
        return app(environ, start_response)

    @staticmethod
    def reject(environ, start_response):
        response = Response('{"error":"Dominio no reconocido."}', status=404, content_type='application/json')
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response(environ, start_response)


def create_dispatcher(config=None):
    return HostDispatcher(config)
