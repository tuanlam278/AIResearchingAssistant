"""Lightweight structured metrics logging for long-running AI flows."""

from __future__ import annotations

import json
import logging
import time
from contextlib import contextmanager
from typing import Any, Iterator

logger = logging.getLogger("app.metrics")


def emit_metric(event: str, **fields: Any) -> None:
    payload = {"event": event, **{key: value for key, value in fields.items() if value is not None}}
    try:
        logger.info(json.dumps(payload, ensure_ascii=False, default=str))
    except Exception:
        logger.info("%s %s", event, payload)


@contextmanager
def metric_timer(event: str, **fields: Any) -> Iterator[dict[str, Any]]:
    start = time.perf_counter()
    mutable = dict(fields)
    try:
        yield mutable
    finally:
        emit_metric(event, duration_ms=round((time.perf_counter() - start) * 1000, 2), **mutable)
