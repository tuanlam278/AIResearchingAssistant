from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable
from typing import TypeVar

import httpcore
import httpx

from app.config import settings

logger = logging.getLogger(__name__)
T = TypeVar("T")

_RETRYABLE_TEXT = (
    "winerror 10035",
    "non-blocking socket operation could not be completed immediately",
    "readerror",
    "writeerror",
    "connecterror",
    "timeout",
    "timed out",
    "connection reset",
    "connection aborted",
    "temporarily unavailable",
    "server disconnected",
)


def is_retryable_supabase_error(exc: BaseException) -> bool:
    if isinstance(
        exc,
        (
            TimeoutError,
            ConnectionError,
            OSError,
            httpx.TimeoutException,
            httpx.NetworkError,
            httpx.ReadError,
            httpx.WriteError,
            httpx.ConnectError,
            httpcore.NetworkError,
            httpcore.TimeoutException,
            httpcore.ReadError,
            httpcore.WriteError,
            httpcore.ConnectError,
        ),
    ):
        return True
    text = f"{type(exc).__name__}: {exc}".lower()
    return any(marker in text for marker in _RETRYABLE_TEXT)


def execute_supabase_with_retry(operation: Callable[[], T], *, label: str = "supabase request") -> T:
    """Run a synchronous Supabase SDK operation with bounded retry/backoff.

    This is intentionally sync because the Supabase client used by the app is sync and most
    heavy indexing writes already run inside asyncio.to_thread. It prevents transient socket
    congestion from killing the whole indexing task and cascading into unrelated requests.
    """
    attempts = int(getattr(settings, "SUPABASE_RETRY_ATTEMPTS", 4) or 4)
    base_delay = float(getattr(settings, "SUPABASE_RETRY_BASE_DELAY_SECONDS", 2.0) or 2.0)
    last_exc: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except Exception as exc:  # noqa: BLE001 - must wrap SDK/network exceptions broadly.
            last_exc = exc
            if attempt >= attempts or not is_retryable_supabase_error(exc):
                raise
            delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, min(1.0, base_delay))
            logger.warning(
                "%s failed with retryable network error (attempt %s/%s); retrying in %.1fs: %s",
                label,
                attempt,
                attempts,
                delay,
                exc,
            )
            time.sleep(delay)
    if last_exc:
        raise last_exc
    raise RuntimeError(f"{label} failed without an exception")
