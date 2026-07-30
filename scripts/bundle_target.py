#!/usr/bin/env python3
"""Read per-target deploy settings from databricks.yml (single source of truth)."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def read_root_variable_defaults(path: Path | None = None) -> dict[str, str]:
    """Read `variables.<name>.default` values from the top-level bundle section."""
    text = (path or Path("databricks.yml")).read_text()
    values: dict[str, str] = {}
    in_variables = False
    current_key: str | None = None

    for line in text.splitlines():
        stripped = line.strip()
        if stripped == "variables:":
            in_variables = True
            current_key = None
            continue
        if not in_variables:
            continue
        # Next top-level section ends the variables block.
        if stripped and not line.startswith(" ") and stripped.endswith(":") and ":" == stripped[-1]:
            if stripped != "variables:":
                break
        if not line.startswith(" "):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent == 2 and stripped.endswith(":") and not stripped.startswith("default:"):
            current_key = stripped[:-1].strip()
            continue
        if current_key and stripped.startswith("default:"):
            values[current_key] = stripped.split(":", 1)[1].strip()
            current_key = None

    return values


def lakebase_project_from_path(path: str) -> str | None:
    parts = path.strip().strip("/").split("/")
    if len(parts) >= 2 and parts[0] == "projects" and parts[1]:
        return parts[1]
    return None


def read_target_variables(target: str, path: Path | None = None) -> dict[str, str]:
    yml = path or Path("databricks.yml")
    text = yml.read_text()
    section: str | None = None
    in_variables = False
    values: dict[str, str] = {}

    for line in text.splitlines():
        stripped = line.strip()
        if stripped == f"{target}:":
            section = target
            in_variables = False
            continue
        if section != target:
            continue
        if stripped == "variables:":
            in_variables = True
            continue
        if in_variables and stripped.startswith("workspace:"):
            break
        if in_variables and stripped and not line.startswith(" "):
            break
        if in_variables and ":" in stripped:
            key, value = stripped.split(":", 1)
            values[key.strip()] = value.strip()

    required = ("warehouse_id", "catalog", "schema", "app_name")
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise SystemExit(
            f"Target '{target}' in databricks.yml is missing variables: {', '.join(missing)}"
        )

    root_defaults = read_root_variable_defaults(yml)
    lakebase_branch = root_defaults.get("lakebase_branch", "")
    lakebase_database = root_defaults.get("lakebase_database", "")
    lakebase_project = (
        lakebase_project_from_path(lakebase_database)
        or lakebase_project_from_path(lakebase_branch)
        or ""
    )

    result = {key: values[key] for key in required}
    if lakebase_branch:
        result["lakebase_branch"] = lakebase_branch
    if lakebase_database:
        result["lakebase_database"] = lakebase_database
    if lakebase_project:
        result["lakebase_project"] = lakebase_project
    return result


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: bundle_target.py <dev|prod>", file=sys.stderr)
        return 1
    print(json.dumps(read_target_variables(argv[1])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
