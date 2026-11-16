@echo off
title IoT Cardiac Health Monitoring System
cd /d "%~dp0"
echo ================================================================
echo   IoT Cardiac Health Monitoring & Early Warning System
echo   Starting Node.js Backend Server on http://localhost:3000
echo ================================================================
echo.
start http://localhost:3000
node server.js
pause

