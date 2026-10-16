# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for InventoryLedger.

Produces a single executable with the whole PWA embedded, so a clean Windows
laptop with no Python, no Node, no npm and no internet can run the system from
one unzipped folder.

Build (from the ledger/ directory, after `npx vite build`):
    pyinstaller host/InventoryLedger.spec --distpath build/dist --workpath build/work

PyInstaller cannot cross-compile: a Windows .exe must be built on Windows.
CI does that on windows-latest. Building this spec on macOS produces a working
macOS binary, which is how we verify the spec itself is correct before CI runs.
"""
import os

block_cipher = None

# The spec runs with SPECPATH set to the directory containing it (ledger/host).
LEDGER_DIR = os.path.abspath(os.path.join(SPECPATH, ".."))
DIST_DIR = os.path.join(LEDGER_DIR, "dist")

if not os.path.isdir(DIST_DIR):
    raise SystemExit(
        "ledger/dist is missing. Run `npx vite build` before packaging -- the "
        "executable is useless without the PWA embedded in it."
    )

a = Analysis(
    [os.path.join(SPECPATH, "host.py")],
    pathex=[LEDGER_DIR],
    binaries=[],
    # The built PWA is embedded under `static/`, which is where bundled_dir()
    # looks when sys._MEIPASS is set.
    datas=[(DIST_DIR, "static")],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Nothing here needs a GUI toolkit, a compiler, or a test framework. Excluding
    # them keeps the executable small and the attack surface boring.
    excludes=[
        "tkinter", "unittest", "pydoc", "doctest", "test",
        "numpy", "pandas", "PIL", "setuptools", "pip",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="InventoryLedger",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,                 # UPX-packed binaries trip antivirus heuristics
    upx_exclude=[],
    runtime_tmpdir=None,
    # Console stays visible on purpose: it prints the device id, the data
    # directory and the URL. If the browser fails to open, the user can still
    # read the address, and if something breaks there is a message on screen
    # rather than a window that vanished.
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
