"""Extension interfaces for real local vision, training and controller engines.

The current application intentionally does not provide fake implementations.
Adapters should report readiness only after real hardware or model resources
have been verified.
"""

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class GameState:
    frame_id: str = ""
    timestamp: str = ""
    ocr_texts: list[dict[str, Any]] = field(default_factory=list)
    screen_type: str = "unknown"
    frame_features: dict[str, Any] = field(default_factory=dict)
    rank: int | None = None
    speed_kmh: float | None = None
    progress_percent: float | None = None
    item_state: str = ""
    crashed: bool = False
    falling_behind: bool = False
    failed: bool = False
    confidence: float = 0.0
    learning_score: float | None = None


@dataclass
class ActionCommand:
    left_stick: tuple[float, float] = (0.0, 0.0)
    right_stick: tuple[float, float] = (0.0, 0.0)
    buttons: dict[str, bool] = field(default_factory=dict)
    duration_ms: int = 0
    priority: int = 0


class VisionProvider(Protocol):
    def ready(self) -> bool: ...
    def read_state(self) -> GameState: ...


class TrainingEngine(Protocol):
    def ready(self) -> bool: ...
    def pretrain(self, dataset_path: str) -> None: ...
    def train_live(self) -> None: ...
    def checkpoint(self, target_path: str) -> None: ...
    def resume(self, checkpoint_path: str) -> None: ...


class LiveLearningEngine(Protocol):
    def ready(self) -> bool: ...
    def adapt_safely(self, state: GameState) -> None: ...
    def update_shadow_model(self, state: GameState) -> None: ...
    def rollback(self) -> None: ...


class ControllerBackend(Protocol):
    def ready(self) -> bool: ...
    def send(self, command: ActionCommand) -> None: ...
    def neutral(self) -> None: ...
    def emergency_stop(self) -> None: ...
