# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Surrogate Modeling Toolkit — Windows one-dir build.
#
# Build:  pyinstaller surrogate_toolkit.spec --clean --noconfirm
# Output: dist/SurrogateToolkit/SurrogateToolkit.exe
#
# Dependencies: pip install pyinstaller pyinstaller-hooks-contrib waitress

from PyInstaller.utils.hooks import collect_data_files, collect_all

# collect_all() crashes on pymoo.gradient.toolbox.core (Cython access violation
# in PyInstaller's isolated import scanner on Windows). Use collect_data_files
# only for pymoo, then list the submodules we actually use as hiddenimports.
pymoo_datas   = collect_data_files("pymoo")
chaospy_datas, chaospy_bins, chaospy_hidden = collect_all("chaospy")
salib_datas,   salib_bins,   salib_hidden   = collect_all("SALib")

app_datas = [
    ("app/templates", "app/templates"),
    ("static",        "static"),
    ("app/learning",  "app/learning"),
]

all_datas    = app_datas + pymoo_datas + chaospy_datas + salib_datas
all_binaries = chaospy_bins + salib_bins
all_hidden   = chaospy_hidden + salib_hidden + [
    "waitress",
    # pymoo — only the submodules the app actually uses
    "pymoo",
    "pymoo.core.problem",
    "pymoo.optimize",
    "pymoo.algorithms.moo.nsga2",
    "pymoo.operators.crossover.sbx",
    "pymoo.operators.mutation.pm",
    "pymoo.operators.sampling.rnd",
    "pymoo.termination.default",
    "pymoo.util.nds.non_dominated_sorting",
    # sklearn / scipy commonly missed by static analysis
    "sklearn.utils._cython_blas",
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

pyz = PYZ(a.pure)

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
