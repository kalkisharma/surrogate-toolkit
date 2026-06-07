# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Surrogate Modeling Toolkit — Windows one-dir build.
#
# Build:  pyinstaller surrogate_toolkit.spec --clean --noconfirm
# Output: dist/SurrogateToolkit/SurrogateToolkit.exe
#
# Dependencies: pip install pyinstaller pyinstaller-hooks-contrib waitress

from PyInstaller.utils.hooks import collect_all, collect_data_files

# Collect all submodules and data for packages that use dynamic/lazy imports.
pymoo_datas,    pymoo_bins,    pymoo_hidden    = collect_all("pymoo")
chaospy_datas,  chaospy_bins,  chaospy_hidden  = collect_all("chaospy")
salib_datas,    salib_bins,    salib_hidden     = collect_all("SALib")

# Application data files — templates, static assets, and learning content.
app_datas = [
    ("app/templates", "app/templates"),
    ("static",        "static"),
    ("app/learning",  "app/learning"),
]

all_datas    = app_datas + pymoo_datas + chaospy_datas + salib_datas
all_binaries = pymoo_bins + chaospy_bins + salib_bins
all_hidden   = pymoo_hidden + chaospy_hidden + salib_hidden + [
    "waitress",
    "sklearn.utils._cython_blas",
    "sklearn.neighbors._typedefs",
    "sklearn.neighbors._quad_tree",
    "sklearn.tree._utils",
    "scipy.special.cython_special",
    "scipy._lib.messagestream",
]

a = Analysis(
    ["run.py"],
    pathex=[],
    binaries=all_binaries,
    datas=all_datas,
    hiddenimports=all_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["gunicorn", "pytest", "pytest_flask", "matplotlib"],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zlib)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="SurrogateToolkit",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,   # keep console window so startup message is visible
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="SurrogateToolkit",
)
