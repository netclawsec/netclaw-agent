@echo off
chcp 65001 >nul
title NetClaw Agent
echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║                  NetClaw Agent                           ║
echo  ║                                                          ║
echo  ║  常用命令 / Common commands:                             ║
echo  ║    netclaw license activate ^<NCLW-XXX^>   激活            ║
echo  ║    netclaw license status                查看状态        ║
echo  ║    netclaw chat                          开始对话        ║
echo  ║    netclaw doctor                        诊断            ║
echo  ║    netclaw --help                        所有命令        ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.
cd /d "%USERPROFILE%"
cmd /k
