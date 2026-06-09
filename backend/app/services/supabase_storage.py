"""Small Supabase Storage REST helpers.

The supabase/storage3 SDK can produce confusing errors when a local `SUPABASE_URL`
contains an API suffix. These helpers always build `/storage/v1/...` URLs from the
normalized project origin and use the backend service-role key.
"""
from __future__ import annotations

from urllib.parse import quote

import httpx

from app.config import settings
from app.db.supabase_client import supabase_project_url


def service_key() -> str:
    key = str(settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_SERVICE_KEY or "").strip()
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for Supabase Storage operations")
    return key


def auth_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    key = service_key()
    headers = {"apikey": key, "authorization": f"Bearer {key}"}
    if extra:
        headers.update(extra)
    return headers


def storage_url(path: str) -> str:
    return f"{supabase_project_url()}/storage/v1{path}"


def response_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = response.text
    return f"{response.status_code} {payload}"


def public_url(bucket: str, path: str) -> str:
    return f"{supabase_project_url()}/storage/v1/object/public/{quote(bucket, safe='')}/{quote(path, safe='/')}"


def upload_file(bucket: str, path: str, content: bytes, content_type: str, *, upsert: bool = False) -> None:
    quoted_bucket = quote(bucket, safe="")
    quoted_path = quote(path, safe="/")
    filename = path.rsplit("/", maxsplit=1)[-1]
    headers = auth_headers({"x-upsert": "true"} if upsert else None)
    with httpx.Client(timeout=float(settings.SUPABASE_STORAGE_TIMEOUT_SECONDS)) as client:
        response = client.post(
            storage_url(f"/object/{quoted_bucket}/{quoted_path}"),
            headers=headers,
            files={"file": (filename, content, content_type)},
        )
    if response.status_code >= 400:
        raise RuntimeError(response_detail(response))


def download_file(bucket: str, path: str) -> bytes:
    quoted_bucket = quote(bucket, safe="")
    quoted_path = quote(path, safe="/")
    with httpx.Client(timeout=float(settings.SUPABASE_STORAGE_TIMEOUT_SECONDS)) as client:
        response = client.get(
            storage_url(f"/object/{quoted_bucket}/{quoted_path}"),
            headers=auth_headers(),
        )
    if response.status_code >= 400:
        raise RuntimeError(response_detail(response))
    return response.content


def ensure_bucket(bucket: str, *, public: bool) -> None:
    quoted_bucket = quote(bucket, safe="")
    with httpx.Client(timeout=float(settings.SUPABASE_STORAGE_TIMEOUT_SECONDS)) as client:
        response = client.get(storage_url(f"/bucket/{quoted_bucket}"), headers=auth_headers())
        if response.status_code == 404:
            create_response = client.post(
                storage_url("/bucket"),
                headers=auth_headers({"content-type": "application/json"}),
                json={"id": bucket, "name": bucket, "public": public},
            )
            if create_response.status_code >= 400 and create_response.status_code != 409:
                raise RuntimeError(response_detail(create_response))
            return
        if response.status_code >= 400:
            raise RuntimeError(response_detail(response))

        bucket_info = response.json() or {}
        if bool(bucket_info.get("public")) != public:
            update_response = client.put(
                storage_url(f"/bucket/{quoted_bucket}"),
                headers=auth_headers({"content-type": "application/json"}),
                json={"public": public},
            )
            if update_response.status_code >= 400:
                raise RuntimeError(response_detail(update_response))
