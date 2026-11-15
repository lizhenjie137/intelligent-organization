# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, copy_metadata

ROOT = Path(SPECPATH).parent
assets = []
for folder in ("web", "examples", "THIRD_PARTY"):
    for source in (ROOT / folder).rglob("*"):
        if source.is_file():
            assets.append((str(source), str(source.relative_to(ROOT).parent)))
for relative in ("LICENSE", "LICENSING.md", "THIRD_PARTY_NOTICES.md", "deepseek-harness-base/config/text-only.patch.yml"):
    assets.append((str(ROOT / relative), str(Path(relative).parent)))
for source in (ROOT / "deepseek-harness-base" / "bridge").glob("*.py"):
    assets.append((str(source), "deepseek-harness-base/bridge"))
hidden = ["server", "harness.model_settings", "harness.runtime"]
binaries = []
for package in ("deepseek_harness", "deepseek_harness_runtime", "pydantic"):
    data, binary, imports = collect_all(package)
    assets += data
    binaries += binary
    hidden += imports
for distribution in ("deepseek-harness-sdk", "deepseek-harness-runtime-bin", "pydantic"):
    assets += copy_metadata(distribution, recursive=True)
a = Analysis([str(ROOT / "desktop" / "server_entry.py")], pathex=[str(ROOT)], binaries=binaries, datas=assets,
             hiddenimports=hidden, hookspath=[], runtime_hooks=[], excludes=["tkinter", "unittest", "pytest"], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="xiaolajiao-server", debug=False,
          bootloader_ignore_signals=False, strip=False, upx=False, console=True, disable_windowed_traceback=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="xiaolajiao-server")
