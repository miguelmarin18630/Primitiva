@echo off
setlocal
REM Abre una sola ventana de Windows Terminal con tres pestañas:
REM   - Desarrollo local (npm run dev, puerto 3100) -> evita el 3000 de AI Hub
REM   - Servidor de produccion local (npm start, puerto 3001)
REM   - Worker de Cloudflare en local (npm run dev:cloud, puerto 8787)
REM Si el script ya se habia ejecutado, cierra primero esos tres puertos para
REM que no aparezca el error EADDRINUSE al volver a iniciarlos.
REM Nota: npm run dev:cloud solo levanta una vista previa local; para publicar en
REM primitiva.marinweb.org hay que desplegar en Cloudflare (GitHub Actions o npm run deploy).

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

if not exist "node_modules\.bin\tsx.cmd" goto :install_deps
if not exist "node_modules\.bin\vite.cmd" goto :install_deps
goto :check_build

:install_deps
echo Faltan dependencias en node_modules. Ejecutando npm install...
call npm install
if errorlevel 1 (
  echo [ERROR] Fallo npm install. Revisa los mensajes de arriba.
  pause
  exit /b 1
)

:check_build
if not exist "dist\index.html" (
  echo Compilando dist/ para el servidor local ^(npm start^)...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] Fallo npm run build. Revisa los mensajes de arriba.
    pause
    exit /b 1
  )
)

echo Cerrando instancias anteriores en los puertos 3100, 3001 y 8787...
call :free_port 3100
call :free_port 3001
call :free_port 8787

set /a TRIES=0
:wait_ports
netstat -ano | findstr /r /c:":3100 .*LISTENING" /c:":3001 .*LISTENING" /c:":8787 .*LISTENING" >nul 2>nul
if errorlevel 1 goto :ports_ready
set /a TRIES+=1
if %TRIES% GEQ 10 goto :ports_ready
timeout /t 1 /nobreak >nul
goto :wait_ports

:ports_ready
where wt.exe >nul 2>nul
if errorlevel 1 goto :fallback

wt.exe -w 1 new-tab --title "Local (dev)" cmd /k "cd /d %ROOT% && set PORT=3100 && npm run dev" ; split-pane -H --title "Local (start)" cmd /k "cd /d %ROOT% && set PORT=3001 && npm start" ; split-pane -V --title "Cloud (wrangler)" cmd /k "cd /d %ROOT% && npm run dev:cloud"
endlocal
exit /b 0

:free_port
set "P=%~1"
for /f "tokens=5" %%A in ('netstat -ano ^| findstr /r /c:":%P% .*LISTENING"') do (
  taskkill /PID %%A /F >nul 2>nul
)
exit /b 0

:fallback
echo Windows Terminal (wt.exe) no esta disponible.
echo Abre tres terminales en esta carpeta y ejecuta:
echo   1) set PORT=3100 ^&^& npm run dev
echo   2) set PORT=3001 ^&^& npm start
echo   3) npm run dev:cloud
endlocal
pause
exit /b 0
