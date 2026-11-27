@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

REM Sincroniza automaticamente GitHub con la carpeta C:\Proyectos\Primitiva
REM Compatible con actualizaciones forzadas (AI Studio -> GitHub).
REM Conserva tus archivos locales ignorados por Git (.env, syndicate_store.json, .wrangler).

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

echo.
echo Descargando ultimos cambios desde GitHub ^(origin/%BRANCH%^)...
git fetch origin
if errorlevel 1 (
  echo [ERROR] No se pudo conectar con GitHub. Revisa tu conexion o credenciales.
  echo.
  pause
  exit /b 1
)

echo.
echo Actualizando archivos locales a la ultima version de GitHub...
git reset --hard origin/%BRANCH%
if errorlevel 1 (
  echo [ERROR] No se pudo actualizar la carpeta al estado de origin/%BRANCH%.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "AFTER_HEAD=%%H"

set "NEED_INSTALL=0"
if not exist "node_modules\.bin\tsx.cmd" set "NEED_INSTALL=1"
if not exist "node_modules\.bin\vite.cmd" set "NEED_INSTALL=1"
if not "%BEFORE_HEAD%"=="%AFTER_HEAD%" (
  git diff --name-only %BEFORE_HEAD% %AFTER_HEAD% 2>nul | findstr /i "package.json package-lock.json" >nul
  if not errorlevel 1 set "NEED_INSTALL=1"
)

if "!NEED_INSTALL!"=="1" (
  echo.
  echo Instalando dependencias ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo [AVISO] Hubo un problema ejecutando npm install.
  )
)

if not "%BEFORE_HEAD%"=="%AFTER_HEAD%" (
  echo.
  echo Compilando nueva version local ^(npm run build^)...
  call npm run build
  if errorlevel 1 (
    echo [AVISO] Hubo un problema compilando dist/.
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
