#!/usr/bin/env python3
"""Patch app.yaml env/resources for a bundle deploy target."""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bundle_target import read_target_variables


def sync_app_yaml(
    target: str,
    *,
    path: Path | None = None,
    overrides: dict[str, str] | None = None,
) -> dict[str, str]:
    values = read_target_variables(target)
    if overrides:
        values.update(overrides)

    app_path = path or Path("app.yaml")
    text = app_path.read_text()
    text = re.sub(
        r'(id:\s*")[^"]+(")',
        rf'\g<1>{values["warehouse_id"]}\2',
        text,
        count=1,
    )
    text = re.sub(
        r'(- name: DATABRICKS_APP_NAME\n\s+value:\s*")[^"]*(")',
        rf'\1{values["app_name"]}\2',
        text,
        count=1,
    )
    text = re.sub(
        r'(- name: DATABRICKS_CATALOG\n\s+value:\s*)[^\n]+',
        rf'\1{values["catalog"]}',
        text,
        count=1,
    )
    text = re.sub(
        r'(- name: DATABRICKS_SCHEMA\n\s+value:\s*)[^\n]+',
        rf'\1{values["schema"]}',
        text,
        count=1,
    )
    if values.get("lakebase_project"):
        if re.search(r'- name: LAKEBASE_PROJECT\n\s+value:', text):
            text = re.sub(
                r'(- name: LAKEBASE_PROJECT\n\s+value:\s*")[^"]*(")',
                rf'\1{values["lakebase_project"]}\2',
                text,
                count=1,
            )
        else:
            text = re.sub(
                r'(- name: ENDPOINT_NAME\n\s+valueFrom: database\n)',
                rf'\1  - name: LAKEBASE_PROJECT\n    value: "{values["lakebase_project"]}"\n',
                text,
                count=1,
            )
    app_path.write_text(text)
    return values


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: sync_app_yaml.py <dev|prod>", file=sys.stderr)
        return 1
    values = sync_app_yaml(argv[1])
    print(
        f"synced app.yaml for {argv[1]}: "
        f"{values['catalog']}.{values['schema']} "
        f"warehouse={values['warehouse_id']} app={values['app_name']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
