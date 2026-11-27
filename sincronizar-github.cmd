@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

REM Sincroniza automaticamente GitHub con la carpeta C:\Proyectos\Primitiva
REM Puedes ejecutarlo desde la carpeta del proyecto o copiarlo al Escritorio.

set "REPO_DIR=C:\Proyectos\Primitiva"
if not exist "%REPO_DIR%\.git" (
  set "SCRIPT_DIR=%~dp0"
  set "SCRIPT_DIR=!SCRIPT_DIR:~0,-1!"
  if exist "!SCRIPT_DIR!\.git" (
    set "REPO_DIR=!SCRIPT_DIR!"
  )
)

echo ========================================================
echo   Sincronizacion con GitHub - Primitiva
echo   Carpeta: %REPO_DIR%
echo ========================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Git en el sistema.
  echo Instala Git para Windows desde https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

if not exist "%REPO_DIR%\.git" (
  echo [ERROR] No se encontro un repositorio Git en:
  echo   %REPO_DIR%
  echo.
  pause
  exit /b 1
)

cd /d "%REPO_DIR%" || (
  echo [ERROR] No se pudo acceder a la carpeta %REPO_DIR%.
  pause
  exit /b 1
)

for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%B"
if "%BRANCH%"=="" set "BRANCH=main"
echo Rama actual: %BRANCH%

for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "BEFORE_HEAD=%%H"

set "STASHED=0"
git status --porcelain | findstr /r "." >nul
if not errorlevel 1 (
  echo.
  echo Guardando cambios locales temporalmente ^(stash^)...
  git stash push -u -m "auto-sync %DATE% %TIME%"
  if errorlevel 1 (
    echo [ERROR] No se pudieron guardar los cambios locales.
    pause
    exit /b 1
  )
  set "STASHED=1"
)

echo.
echo Descargando ultimos cambios desde GitHub ^(origin/%BRANCH%^)...
git fetch origin
if errorlevel 1 (
  echo [ERROR] No se pudo conectar con GitHub. Revisa tu conexion o credenciales.
  if "!STASHED!"=="1" git stash pop >nul 2>nul
  pause
  exit /b 1
)

git pull --rebase origin %BRANCH%
if errorlevel 1 (
  echo.
  echo [ERROR] Hubo un conflicto al actualizar desde GitHub.
  echo Cancelando rebase para dejar tu carpeta intacta...
  git rebase --abort >nul 2>nul
  if "!STASHED!"=="1" git stash pop >nul 2>nul
  echo Revisa los cambios manualmente con "git status".
  echo.
  pause
  exit /b 1
)

if "!STASHED!"=="1" (
  echo.
  echo Restaurando tus cambios locales...
  git stash pop
  if errorlevel 1 (
    echo [AVISO] Hubo un conflicto al restaurar tus cambios locales.
    echo Tus cambios siguen guardados en "git stash list".
  )
)

for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "AFTER_HEAD=%%H"

REM Si hay commits locales pendientes de subir, los envia a GitHub
for /f "delims=" %%C in ('git rev-list --count origin/%BRANCH%..HEAD 2^>nul') do set "AHEAD=%%C"
if not "%AHEAD%"=="" (
  if %AHEAD% GTR 0 (
    echo.
    echo Subiendo %AHEAD% commit^(s^) local^(es^) a GitHub...
    git push origin %BRANCH%
    if errorlevel 1 (
      echo [AVISO] No se pudieron subir los commits locales a GitHub.
    )
  )
)

REM Si cambio package.json o package-lock.json, actualiza dependencias automaticamente
if not "%BEFORE_HEAD%"=="%AFTER_HEAD%" (
  git diff --name-only %BEFORE_HEAD% %AFTER_HEAD% | findstr /i "package.json package-lock.json" >nul
  if not errorlevel 1 (
    echo.
    echo Se detectaron cambios en dependencias. Ejecutando npm install...
    call npm install
  )
)

echo.
echo ========================================================
if "%BEFORE_HEAD%"=="%AFTER_HEAD%" (
  echo   OK: Ya tenias la ultima version de GitHub.
) else (
  echo   OK: Sincronizacion completada correctamente.
)
echo   Ultimo commit:
git log -1 --oneline
echo ========================================================
echo.
pause
exit /b 0
