@echo off
setlocal
echo [ROUTER] Checking 9Router status and port 20128...
node scripts/d7_router_startup.js
exit /b %errorlevel%
