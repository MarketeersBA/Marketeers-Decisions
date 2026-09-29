"""Simplified engine/license configuration (replaces Engine.ocx)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class EngineConfig:
    """Feature flags for the simulator UI."""

    pack_simulator: bool = False
    charts: bool = True
    nos_and_tdc: bool = True
    preference_share: bool = True
    penetration: bool = True
    volume_share: bool = True
    value_share: bool = True
    vsu: bool = True
    revenue: bool = True
    allowed_new_products: list[str] = field(default_factory=list)

    @classmethod
    def default(cls) -> "EngineConfig":
        return cls()
