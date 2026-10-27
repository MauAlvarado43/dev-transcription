# Contribuir a Dev Transcription

## Preparar el entorno

1. Instala Node.js 22 o posterior y Python 3.12 recomendado, accesible como `python3` para las pruebas.
2. Ejecuta `npm ci` y `npm run check`.
3. Usa `F5` → **Run Dev Transcription** para abrir el host de desarrollo, o `npm run watch` para recompilar al editar.

Las pruebas no requieren GPU, modelos ni instalar `python/requirements.txt`: sustituyen las dependencias del motor. Para probar una transcripción real, prepara el motor desde la extensión y utiliza un video de prueba sin datos privados.

## Criterios de los cambios

- Mantén las reglas de dominio en `src/domain.ts` y `src/dialogues.ts`, sin dependencias de VS Code.
- Accede a la biblioteca mediante `LibraryStore`; conserva IDs, ediciones, respaldos y escrituras atómicas.
- Mantén el protocolo JSON por líneas entre `src/engine.ts` y `python/transcribe.py`. Los mensajes de diagnóstico no deben mezclarse con los eventos JSON de salida estándar.
- Conserva la ejecución local del audio y el comportamiento de cancelación y modo sin conexión.
- Agrega pruebas cuando cambies reglas, datos persistidos o el protocolo del trabajador.
- Documenta cambios visibles en `## [Unreleased]` del changelog. Sigue [RELEASE.md](RELEASE.md) al preparar una versión.
- No agregues videos personales, transcripciones, modelos descargados, entornos virtuales ni credenciales al repositorio.

## Pull requests

Incluye una descripción del cambio y su validación, además de capturas cuando cambie la interfaz. Ejecuta `npm run package` y `python3 scripts/verify-package.py` antes de solicitar revisión. Evita mezclar refactors amplios con cambios de comportamiento sin relación.
