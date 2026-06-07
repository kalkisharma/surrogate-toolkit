@echo off
REM ============================================================
REM  Surrogate Toolkit — Windows release build script
REM  Run from the project root in the surrogate-toolkit conda env.
REM
REM  Prerequisites (one-time):
REM    pip install pyinstaller pyinstaller-hooks-contrib
REM
REM  Output: dist\SurrogateToolkit\SurrogateToolkit.exe
REM ============================================================

echo.
echo  Building Surrogate Toolkit...
echo.

pyinstaller surrogate_toolkit.spec --clean --noconfirm
if %ERRORLEVEL% neq 0 (
    echo.
    echo  ERROR: PyInstaller build failed. See output above.
    exit /b 1
)

echo.
echo  Copying docs and sample data into dist folder...
echo.

copy /Y README.md            dist\SurrogateToolkit\README.md
copy /Y docs\USERGUIDE.md    dist\SurrogateToolkit\USERGUIDE.md
copy /Y docs\CHANGELOG.md    dist\SurrogateToolkit\CHANGELOG.md
copy /Y LICENSE.md           dist\SurrogateToolkit\LICENSE.md
copy /Y tests\fixtures\sample_clean.csv  dist\SurrogateToolkit\sample_data.csv

echo.
echo  Build complete.
echo  Output folder: dist\SurrogateToolkit\
echo  Zip this folder and attach to the GitHub release.
echo.
