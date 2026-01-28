@echo off
echo ===================================================
echo Art Assistant - Emergency Local Mode
echo ===================================================
echo.
echo Your network is blocking the Shopify Cloudflare Tunnel.
echo I am switching to "Local Vite Mode" to bypass this.
echo.
echo 1. The app will start locally.
echo 2. You will NOT see it in the Shopify Admin (that requires the tunnel).
echo 3. Instead, open your browser to: http://localhost:3000
echo.
echo Starting Server...
echo.
call npx vite dev
pause
