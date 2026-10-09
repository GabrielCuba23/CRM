"""Prepare, then explicitly publish one isolated white-label CRM on Cloudflare.

The default is offline preparation. Each instance receives a new Worker, D1
database and owner-only Access application. Existing namespaces are never reused.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from build import build
from deploy import Cloudflare, ROOT, ensure_access_team, ensure_pin, worker_config


def instance_manifest(instance_id, slug, owner, brand):
    if not re.fullmatch(r"[0-9a-f]{32}", instance_id or ""):
        raise ValueError("El identificador debe tener 32 caracteres hexadecimales en minúscula.")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?", slug or ""):
        raise ValueError("El nombre corto debe usar entre 1 y 40 letras minúsculas, números o guiones.")
    owner = (owner or "").strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", owner) or len(owner) > 254:
        raise ValueError("Indica el correo del propietario de esta instancia.")
    brand = (brand or "").strip()
    if not brand or len(brand) > 100 or any(ord(c) < 32 for c in brand):
        raise ValueError("El nombre de marca debe tener entre 1 y 100 caracteres.")
    namespace = f"crm-r-{slug[:16].rstrip('-')}-{instance_id}"
    return {
        "version": 1, "instance_id": instance_id, "slug": slug,
        "owner_email": owner, "brand_name": brand,
        "worker_name": namespace, "database_name": namespace,
        "status": "prepared", "data_copied": False,
        "integrations_connected": False,
    }


def fresh_workspace(brand):
    # Only import the public factory: no existing workspace or customer data is read.
    program = (
        "import { emptyState } from " + json.dumps((ROOT / "cloud/state.mjs").as_uri()) + ";"
        "const s=emptyState(); s.settings.crmName=process.argv[1];"
        "s.settings.business=process.argv[1]; console.log(JSON.stringify(s));"
    )
    result = subprocess.run(["node", "--input-type=module", "-e", program, brand],
                            check=True, text=True, capture_output=True, cwd=ROOT)
    state = json.loads(result.stdout)
    if any(state.get(key) for key in ("clients", "accounts", "ledger", "rules", "taskReceipts", "combos")):
        raise RuntimeError("La fábrica de datos dejó de producir una instancia vacía. Publicación bloqueada.")
    return state


def save_manifest(directory, manifest):
    path = Path(directory) / "instance.json"
    # Local deployment manifests include the owner's email; they are never assets.
    with path.open("w", encoding="utf8") as file:
        json.dump(manifest, file, ensure_ascii=False, indent=2)
        file.write("\n")
    path.chmod(0o600)


def prepare(manifest, directory=None):
    if directory is None:
        directory = Path(tempfile.mkdtemp(prefix="crm-retail-"))
    else:
        directory = Path(directory)
        # Refuse accidental overwrite, symlink destinations and public shared folders.
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    directory.chmod(0o700)
    build(directory / "assets")
    save_manifest(directory, manifest)
    return directory


def instance_config(manifest, account, database, team, audience, assets):
    config = worker_config(account, database, manifest["owner_email"], team, audience, assets)
    config["name"] = manifest["worker_name"]
    config["d1_databases"][0]["database_name"] = manifest["database_name"]
    return config


def preflight(api, manifest):
    subdomain = api.call("GET", "/workers/subdomain").get("subdomain", "")
    if not re.fullmatch(r"[a-z0-9-]+", subdomain):
        raise RuntimeError("Activa el subdominio workers.dev de tu cuenta antes de publicar.")
    hostname = f"{manifest['worker_name']}.{subdomain}.workers.dev"
    databases = api.call("GET", "/d1/database?per_page=100")
    applications = api.call("GET", "/access/apps?per_page=100")
    if len(databases) >= 100 or len(applications) >= 100:
        raise RuntimeError("La cuenta requiere paginación. No se aprovisionarán recursos ambiguos.")
    if any(db.get("name") == manifest["database_name"] for db in databases):
        raise RuntimeError("La base de esta instancia ya existe. No se reutiliza ni se copia su información.")
    if any(app.get("domain") == hostname for app in applications):
        raise RuntimeError("El dominio ya tiene una aplicación Access. No se reemplazará.")
    scripts = api.call("GET", "/workers/scripts")
    if not isinstance(scripts, list):
        raise RuntimeError("No se confirmó la lista de Workers de esta cuenta.")
    if any(worker.get("id", worker.get("name")) == manifest["worker_name"] for worker in scripts):
        raise RuntimeError("El Worker ya existe. No se sobrescribirá otra instancia.")
    return hostname, applications


def publish(config, executable, hostname):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", prefix="retail-wrangler-", delete=False) as file:
        json.dump(config, file)
        path = Path(file.name)
    try:
        result = subprocess.run(
            [executable, "deploy", "--config", str(path)], cwd=ROOT,
            env={**os.environ, "WRANGLER_SEND_METRICS": "false",
                 "XDG_CONFIG_HOME": os.environ.get("XDG_CONFIG_HOME", "/tmp/crm-cloud-config"),
                 "WRANGLER_LOG_PATH": "/tmp/crm-cloud-logs"},
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        if result.returncode or "https://" + hostname not in result.stdout:
            raise RuntimeError("Wrangler no confirmó la URL esperada. Revisa el manifiesto: la instancia puede seguir bloqueada.")
    finally:
        path.unlink(missing_ok=True)


def deploy_instance(manifest, directory, api, executable):
    canonical = instance_manifest(manifest.get("instance_id"), manifest.get("slug"),
                                  manifest.get("owner_email"), manifest.get("brand_name"))
    if any(manifest.get(key) != canonical[key] for key in
           ("worker_name", "database_name", "owner_email", "brand_name")):
        raise RuntimeError("El manifiesto no corresponde a la instancia. No se modificarán recursos.")
    directory = Path(directory)
    state = fresh_workspace(manifest["brand_name"])
    team = ensure_access_team(api)
    hostname, applications = preflight(api, manifest)
    provider = ensure_pin(api)
    database = api.call("POST", "/d1/database", {"name": manifest["database_name"]})
    if not isinstance(database.get("uuid"), str) or not database["uuid"]:
        raise RuntimeError("Cloudflare no confirmó la nueva base de datos.")
    manifest.update(database_id=database["uuid"], hostname=hostname, status="database_created")
    save_manifest(directory, manifest)
    results = api.call("POST", f"/d1/database/{database['uuid']}/query", {
        "sql": (ROOT / "cloud/schema.sql").read_text(),
    })
    if any(result.get("success") is False for result in (results or [])):
        raise RuntimeError("D1 no confirmó el esquema. Se conserva la instancia bloqueada para revisión.")
    results = api.call("POST", f"/d1/database/{database['uuid']}/query", {
        "sql": "INSERT INTO workspace(id,revision,body) VALUES(1,0,?)",
        "params": [json.dumps(state, ensure_ascii=False)],
    })
    if any(result.get("success") is False for result in (results or [])):
        raise RuntimeError("D1 no confirmó los datos iniciales. No se abrirá el acceso.")
    config = instance_config(manifest, api.account, database["uuid"], team,
                             "not-configured-closed", directory / "assets")
    publish(config, executable, hostname)
    manifest["status"] = "worker_locked"
    save_manifest(directory, manifest)
    application = api.call("POST", "/access/apps", {
        "name": "CRM " + manifest["instance_id"], "type": "self_hosted", "domain": hostname,
        "session_duration": "8h", "allowed_idps": [provider["id"]],
        "http_only_cookie_attribute": True,
        "policies": [{"name": "Solo el propietario", "decision": "allow",
                      "include": [{"email": {"email": manifest["owner_email"]}}]}],
    })
    manifest.update(access_app_id=application.get("id"), status="access_pending_validation")
    save_manifest(directory, manifest)
    audience = application.get("aud")
    if not isinstance(audience, str) or not audience or audience == "not-configured-closed" or any(app.get("aud") == audience for app in applications):
        raise RuntimeError("Access no confirmó un identificador exclusivo. La instancia permanece bloqueada.")
    manifest.update(access_aud=audience, status="access_created")
    save_manifest(directory, manifest)
    config["vars"]["ACCESS_AUD"] = audience
    publish(config, executable, hostname)
    manifest["status"] = "published_pending_verification"
    save_manifest(directory, manifest)
    return "https://" + hostname


def main():
    parser = argparse.ArgumentParser(description="Preparar una copia privada del CRM; --deploy publica recursos nuevos.")
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--owner-email", required=True)
    parser.add_argument("--brand-name", required=True)
    parser.add_argument("--output-dir")
    parser.add_argument("--deploy", action="store_true")
    parser.add_argument("--account-id", default=os.environ.get("CLOUDFLARE_ACCOUNT_ID"))
    parser.add_argument("--wrangler", default="/tmp/crm-cloud-tools/node_modules/.bin/wrangler")
    args = parser.parse_args()
    try:
        manifest = instance_manifest(args.instance_id, args.slug, args.owner_email, args.brand_name)
    except ValueError as error:
        parser.error(str(error))
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if args.deploy and (not token or not re.fullmatch(r"[0-9a-f]{32}", args.account_id or "")):
        parser.error("Publicar requiere CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID en el entorno seguro.")
    directory = prepare(manifest, args.output_dir)
    if not args.deploy:
        print("Instancia preparada sin crear recursos externos:", directory / "instance.json")
        print("Publica con --deploy solo después de revisar propietario, marca y los límites de tu cuenta.")
        return
    url = deploy_instance(manifest, directory, Cloudflare(args.account_id, token), args.wrangler)
    print("Instancia publicada, pendiente de verificar:", url)
    print("Confirma acceso con el propietario y rechazo para otro cliente. Integraciones de WhatsApp y correo siguen desconectadas.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from None
