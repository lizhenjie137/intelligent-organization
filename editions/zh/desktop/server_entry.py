"""Windows desktop backend entry point; business data never lives in the bundle."""
from __future__ import annotations
import os
from pathlib import Path
import sys

EDITION = "zh"


def _value(arguments, flag):
    for index, item in enumerate(arguments):
        if item.startswith(flag + "="):
            return item.split("=", 1)[1]
        if item == flag and index + 1 < len(arguments):
            return arguments[index + 1]
    return None


def main():
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
    arguments = list(sys.argv[1:])
    override = os.environ.get("XIAOLAJIAO_DATA_DIR")
    app_root = Path(override).resolve() if override else Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "Xiaolajiao" / EDITION
    database = Path(_value(arguments, "--db") or app_root / "workspace" / "harness.db").resolve()
    if _value(arguments, "--db") is None:
        arguments.extend(["--db", str(database)])
    if _value(arguments, "--runtime-root") is None:
        arguments.extend(["--runtime-root", str(database.parent / "runtime")])
    if _value(arguments, "--model-settings") is None:
        arguments.extend(["--model-settings", str(database.with_suffix(".model-settings.json"))])
    os.environ.setdefault("DSH_RESOURCE_CACHE", str(database.parent / "runtime" / "resource-cache"))
    sys.argv = [sys.argv[0], *arguments]
    from server import main as serve
    serve()


if __name__ == "__main__":
    main()
