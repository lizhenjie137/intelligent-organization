"""Build the self-contained Windows backend with the active build interpreter."""
from pathlib import Path
import subprocess
import shutil
from importlib.metadata import distribution
import sys

ROOT = Path(__file__).resolve().parents[1]
if sys.platform != "win32":
    raise SystemExit("The desktop distribution is currently supported on Windows x64 only.")
# Preserve the notices belonging to the exact interpreter and bootloader used.
python_license = Path(sys.base_prefix) / "LICENSE.txt"
pyinstaller_license = distribution("pyinstaller").locate_file("pyinstaller-6.22.3.dist-info/licenses/COPYING.txt")
for source, name in ((python_license, "Python-LICENSE.txt"), (pyinstaller_license, "PyInstaller-COPYING.txt")):
    if not source.is_file():
        raise SystemExit("Required runtime redistribution notice is missing: " + name)
    shutil.copyfile(source, ROOT / "THIRD_PARTY" / name)
command = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--distpath", str(ROOT / "build" / "backend"),
           "--workpath", str(ROOT / "build" / "pyinstaller"), str(ROOT / "desktop" / "backend.spec")]
raise SystemExit(subprocess.call(command, cwd=ROOT))
