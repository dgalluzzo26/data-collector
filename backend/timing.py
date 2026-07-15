"""Lightweight per-request phase timing for performance diagnosis."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

logger = logging.getLogger("data_collector.timing")

_active: ContextVar[PhaseTimer | None] = ContextVar("phase_timer", default=None)


class PhaseTimer:
    def __init__(self, operation: str) -> None:
        self.operation = operation
        self.phases: dict[str, float] = {}
        self.extra: dict[str, Any] = {}
        self._started = time.perf_counter()
        self._phase_started = self._started

    def mark(self, name: str) -> None:
        now = time.perf_counter()
        self.phases[name] = round((now - self._phase_started) * 1000, 2)
        self._phase_started = now

    def add_phase(self, name: str, duration_ms: float) -> None:
        self.phases[name] = round(self.phases.get(name, 0.0) + duration_ms, 2)

    @property
    def total_ms(self) -> float:
        return round((time.perf_counter() - self._started) * 1000, 2)

    def set_extra(self, **kwargs: Any) -> None:
        self.extra.update(kwargs)

    def server_timing_header(self) -> str:
        parts = [f'total;dur={self.total_ms}']
        for name, duration_ms in self.phases.items():
            safe = name.replace("_", "-")
            parts.append(f"{safe};dur={duration_ms}")
        return ", ".join(parts)

    def log(self) -> None:
        payload = {**self.phases, **self.extra, "total_ms": self.total_ms}
        fields = " ".join(f"{key}={value}" for key, value in payload.items())
        logger.info("%s %s", self.operation, fields)


def get_timer() -> PhaseTimer | None:
    return _active.get()


@contextmanager
def track_request(operation: str) -> Iterator[PhaseTimer]:
    timer = PhaseTimer(operation)
    token = _active.set(timer)
    try:
        yield timer
    finally:
        _active.reset(token)
        timer.log()
