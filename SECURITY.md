# Seguridad y datos locales

Dev Transcription guarda copias de videos, transcripciones, nombres de hablantes y metadatos en el almacenamiento privado de la extensión de VS Code. Los archivos no tienen cifrado adicional de la extensión; su protección depende del equipo y sus permisos. Los respaldos y exportaciones también pueden contener información personal.

El reconocimiento y la separación de voces se ejecutan localmente. La instalación del motor y la descarga de modelos usan internet para obtener paquetes y pesos; no suben el audio ni sus transcripciones. El modo sin conexión exige modelos previamente descargados. Las licencias de esos modelos se describen en el [README](README.md#modelos-de-terceros).

El VSIX incluye el trabajador Python y sus requisitos, pero no el entorno, los pesos ni la biblioteca del usuario. No incluyas videos, transcripciones, rutas personales o registros con información sensible en issues, pull requests o capturas.

## Reportar una vulnerabilidad

Usa **Security → Report a vulnerability** del repositorio cuando esté habilitado el reporte privado de vulnerabilidades. Si no está disponible, solicita al mantenedor un canal privado sin publicar los detalles de explotación o datos personales. Incluye las versiones de la extensión y VS Code, el sistema operativo, pasos mínimos de reproducción y el impacto esperado.
