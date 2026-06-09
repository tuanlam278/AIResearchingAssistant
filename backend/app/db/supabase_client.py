import httpx
from supabase import Client, ClientOptions, create_client

from app.config import settings


def supabase_project_url() -> str:
    """Normalize Supabase project URL before SDK clients derive REST/Auth/Storage URLs.

    Some local .env files accidentally paste a service endpoint such as
    `https://project.supabase.co/rest/v1` instead of the project origin. Passing
    that through to supabase-py can produce broken routes for PostgREST/Storage.
    """
    url = str(settings.SUPABASE_URL or "").strip().rstrip("/")
    for suffix in ("/rest/v1", "/storage/v1", "/auth/v1", "/functions/v1"):
        if url.endswith(suffix):
            url = url[: -len(suffix)]
    return url

_timeout = httpx.Timeout(
    timeout=float(settings.SUPABASE_REQUEST_TIMEOUT_SECONDS),
    connect=30.0,
    read=float(settings.SUPABASE_REQUEST_TIMEOUT_SECONDS),
    write=float(settings.SUPABASE_REQUEST_TIMEOUT_SECONDS),
    pool=30.0,
)
_limits = httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=30.0)
_httpx_client = httpx.Client(timeout=_timeout, limits=_limits)

supabase: Client = create_client(
    supabase_project_url(),
    settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_SERVICE_KEY,
    options=ClientOptions(
        httpx_client=_httpx_client,
        postgrest_client_timeout=float(settings.SUPABASE_REQUEST_TIMEOUT_SECONDS),
        storage_client_timeout=float(settings.SUPABASE_STORAGE_TIMEOUT_SECONDS),
        function_client_timeout=float(settings.SUPABASE_FUNCTION_TIMEOUT_SECONDS),
    ),
)
