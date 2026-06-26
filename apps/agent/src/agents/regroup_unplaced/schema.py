"""Stage1 unplaced-photo assignment contract."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class UnplacedAssignments:
    assignments: dict[str, str]
