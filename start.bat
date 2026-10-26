@echo off
title VoxLink Server
color 0b
cls
echo ========================================================
echo                 VOXLINK SERVER LAUNCHER
echo ========================================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found in your PATH.
    echo Please install Node.js from https://nodejs.org/ to run VoxLink.
    echo.
    pause
    exit /b
)

:: Navigate to project directory
cd /d "%~dp0"

echo [1/2] Launching browser to http://localhost:3000...
timeout /t 2 /nobreak >nul 2>&1
start http://localhost:3000

echo [2/2] Starting Node.js server...
echo.
node server.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] The server exited with code %errorlevel%.
    pause
)
