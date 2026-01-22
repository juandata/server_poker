@echo off
:loop
echo Reintentando descarga de Qwen...
ollama pull qwen2.5-coder:7b
if %errorlevel% neq 0 (
    goto loop
)
echo Descarga completada con éxito.
pause
