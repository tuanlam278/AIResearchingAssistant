import httpx
from supabase import Client, ClientOptions, create_client

from app.config import settings

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
    settings.SUPABASE_URL,
    settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_SERVICE_KEY,
    options=ClientOptions(
        httpx_client=_httpx_client,
        postgrest_client_timeout=float(settings.SUPABASE_REQUEST_TIMEOUT_SECONDS),
        storage_client_timeout=float(settings.SUPABASE_STORAGE_TIMEOUT_SECONDS),
        function_client_timeout=float(settings.SUPABASE_FUNCTION_TIMEOUT_SECONDS),
    ),
)
