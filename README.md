# Dev Transcription

Extensión de VS Code para administrar videos y generar transcripciones en tu equipo. Sigue el patrón de Dev Notes: colecciones en la barra lateral, archivos reales en almacenamiento privado y edición con guardado automático.

## Instalación desde GitHub

1. Descarga el archivo `dev-transcription-<versión>.vsix` de [Releases](https://github.com/MauAlvarado43/dev-transcription/releases/latest).
2. En VS Code, abre **Extensiones → ⋯ → Instalar desde VSIX…** y selecciona el archivo descargado.
3. Recarga VS Code si lo solicita. Para actualizar, instala el VSIX de la siguiente versión de la misma forma.

También puedes usar `code --install-extension ruta/al/archivo.vsix`. El paquete sirve para Windows, macOS y Linux; el motor Python se prepara en el equipo donde uses la extensión.

## Uso

1. Abre **Dev Transcription** en la barra de actividades.
2. Crea una colección o pulsa **Importar videos**. Sin colecciones se crea «General».
3. Abre un video y pulsa **Transcribir video**. El motor se instala en un entorno Python privado cuando hace falta. También puedes prepararlo desde **Configuración → Motor y almacenamiento**.
4. Lee la transcripción, pulsa una marca de tiempo para saltar en el video o usa **Editar** para corregir el Markdown. Los cambios se guardan automáticamente. `Ctrl+E` alterna lectura/edición y `Ctrl+S` vuelve a guardar (`Cmd` en macOS).
5. Exporta el **Markdown editado**, o el reconocimiento original en TXT, SRT, VTT o JSON. Las correcciones Markdown no modifican los tiempos ni el reconocimiento original.

El menú `⋯` de cada video permite transcribir, cancelar, renombrar, mover y enviar a la papelera. El de una colección permite importar, transcribir todos los pendientes, renombrar o eliminarla cuando está vacía. La búsqueda incluye títulos, colecciones, texto de las transcripciones y nombres de hablantes.

Los videos se **copian** a la biblioteca. Eliminar una copia usa la papelera y conserva el original. Importar videos grandes requiere espacio para esa copia. La cancelación de una importación detiene los siguientes archivos después de terminar la copia actual.

## Motor local

Se usa [faster-whisper](https://github.com/SYSTRAN/faster-whisper) con **Whisper large-v3**, reconocimiento multilingüe, búsqueda con cinco candidatos y detección de voz para filtrar silencios. Se prioriza calidad sobre velocidad. No se traduce el audio. Con idioma **Automático**, el reconocimiento elige exclusivamente entre español e inglés para cada fragmento de voz y admite ambos en una misma conversación. El decodificador queda fijado al idioma elegido; no se habilita la detección de todos los idiomas. Si aun así se genera una escritura ajena a esos dos idiomas, se marca el fragmento como no reconocido en vez de presentarlo como diálogo válido. Se reinicia el contexto entre fragmentos cortos para reducir traducciones accidentales al idioma dominante; los cambios muy breves dentro de una misma frase aún pueden fallar.

- **NVIDIA:** el modo automático intenta CUDA con precisión FP16. En Linux, el instalador prepara cuBLAS y cuDNN dentro del entorno privado. Si CUDA falla, el trabajo se reintenta en CPU INT8.
- **CPU:** funciona sin NVIDIA, incluyendo Apple y AMD; `large-v3` puede tardar bastante. Los modelos `turbo`, `medium`, `small`, `base` y `tiny` permiten reducir tiempo y memoria.
- **Python:** si tienes `uv`, se crea un entorno con Python 3.12. Si no, se usa `python3` (`python` en Windows) con `venv` y `pip`. Puedes indicar el ejecutable en `devTranscription.pythonPath`. Se recomienda Python 3.12 para disponer de paquetes binarios compatibles.
- El decodificador PyAV incluye bibliotecas FFmpeg: no necesitas instalar el ejecutable FFmpeg.
- Windows con CUDA requiere las bibliotecas NVIDIA compatibles disponibles en `PATH`; CPU funciona sin ellas.

La instalación inicial y la primera descarga de cada modelo requieren internet y varios GB de espacio. Solo se descargan paquetes y pesos: no se envía el video ni su transcripción a un servicio. El modelo queda en caché. **Configuración → Descargar modelos** permite preparar el reconocimiento y la separación de voces de antemano; después activa `devTranscription.offline` para exigir el uso de los archivos locales.

La calidad depende del audio: ruido, música, voces superpuestas y nombres propios pueden producir errores. La detección de hablantes puede unir voces parecidas o dividir una misma voz; las voces superpuestas no se separan en pistas individuales. Puedes fijar el idioma y aportar vocabulario en Configuración.

## Lectura de diálogos

**Agrupar diálogos** está activo por defecto en Lectura: une fragmentos consecutivos de un mismo hablante con pausas de hasta 3 segundos y un máximo de 60 segundos por bloque combinado. Los cambios de hablante siempre abren otro bloque. Si la transcripción no tiene hablantes asignados, se agrupa solo por tiempo.

Puedes volver a los fragmentos con el conmutador de Lectura, o cambiar la pausa y duración máxima en **Configuración → Lectura**. Cada bloque muestra el intervalo, el hablante cuando está asignado y el texto unido. Los fragmentos originales, sus tiempos e IDs se conservan en Tiempos y JSON; la agrupación de lectura no altera el Markdown editado ni sus exportaciones.

## Hablantes e idiomas

La separación de voces se ejecuta localmente con [sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html), segmentación pyannote 3.0 y embeddings WeSpeaker ResNet34-LM. Los modelos se descargan de las distribuciones públicas de sherpa-onnx y se ejecutan en CPU; el reconocimiento de palabras sigue usando GPU cuando está disponible. No necesitas una cuenta ni un token.

Cada fragmento nuevo tiene un `id` estable, un `speakerId` y un `language` (`en`, `es`, etc.) en el JSON. Los hablantes reciben IDs como `actor-001` y `actor-002`, locales a esa transcripción; no se intenta reconocer a una persona entre videos distintos. La categoría `actor-unknown` representa voz sin atribución suficiente.

- En **Hablantes → Renombrar**, cambia «Hablante 1» por el nombre que quieras. Las intervenciones, la búsqueda y las exportaciones resuelven ese nombre sin cambiar el ID.
- En **Tiempos**, cambia el selector de hablante de un fragmento para corregir una atribución. **Agregar** crea otro hablante sin regenerar el reconocimiento.
- En **Configuración → Hablantes**, puedes indicar la cantidad conocida de voces, ajustar el umbral automático o desactivar su separación.
- Las transcripciones anteriores siguen abriendo. Puedes agregar y asignar hablantes manualmente o regenerar para detectarlos.

El Markdown interno conserva referencias estables a fragmentos y hablantes; la vista de lectura y la exportación muestran los nombres actuales. La edición libre del cuerpo se conserva al cambiar nombres o asignaciones. Si eliminas manualmente una referencia de fragmento en el Markdown, su asociación estructurada sigue disponible en Tiempos y JSON.

Regenerar vuelve a estimar los hablantes y puede cambiar sus IDs; el resultado anterior, incluidos sus nombres, se respalda en `transcript.previous.json` y `transcript.previous.md`.

## Guardado y recuperación

La biblioteca es global al perfil de VS Code y permanece al cambiar de proyecto. Usa **Abrir carpeta de la biblioteca** para encontrarla. En una instalación estándar de Linux:

```text
~/.config/Code/User/globalStorage/raide.dev-transcription/
  library/
    collections/<uuid>.json
    videos/<uuid>/
      video.json                 # Título, colección y metadatos
      source.mp4                 # Copia del video (con su extensión original)
      transcript.md              # Texto editable con guardado automático
      transcript.json            # Reconocimiento original y tiempos
      transcript.previous.md     # Texto anterior a la última regeneración
      transcript.previous.json   # Hablantes y reconocimiento anteriores
  runtime/                       # Entorno Python aislado
  models/                        # Pesos descargados
```

Copia **toda la carpeta `library`** para respaldar tus colecciones y videos. Para restaurar en otro equipo, cierra las ventanas de VS Code y reemplaza la carpeta `library` de esa instalación con la copia. El entorno Python no es portable: se reinstala con **Instalar o reparar motor local**. El modelo puede descargarse de nuevo. No hay sincronización ni subida automática a la nube.

Las escrituras de texto usan archivos temporales y reemplazo atómico. Un trabajo cancelado o fallido conserva la transcripción existente. Antes de regenerar se pide confirmación y se guarda el Markdown anterior en `transcript.previous.md`. Cada trabajo muestra su etapa actual en la biblioteca, el reproductor y la barra de estado. La identificación de voces y la transcripción tienen porcentajes independientes de 0 a 100; las etapas completadas quedan visibles en el reproductor mientras avanza el trabajo. El avance se calcula a partir de bloques de análisis de voz y audio hablado procesado, no del tiempo estimado restante. La carga del modelo, extracción de audio, localización de voz y guardado muestran actividad sin inventar un porcentaje. Los trabajos se ejecutan de uno en uno para limitar la memoria usada. Cerrar una pestaña no cancela el trabajo; cerrar o recargar VS Code detiene los trabajos, que se deben iniciar de nuevo. La cola no se restaura automáticamente.

## Reproducción y formatos

Importa MP4, MKV, MOV, WebM, AVI, M4V, MPEG, MPG, WMV, FLV, MTS, M2TS y OGV. La reproducción integrada depende de los códecs de VS Code; si no son compatibles, usa **Abrir en reproductor** para abrir la copia con la aplicación del sistema. El motor de transcripción decodifica el audio independientemente del reproductor integrado. Un video sin pista de audio produce un error; uno sin voz puede generar una transcripción vacía.

## Configuración

| Ajuste | Predeterminado | Uso |
| --- | --- | --- |
| `devTranscription.model` | `large-v3` | Modelo de reconocimiento. |
| `devTranscription.device` | `auto` | `auto`, `cpu` o `cuda`. |
| `devTranscription.language` | `auto` | Solo español o inglés por fragmento; `es` / `en` fuerzan un solo idioma. |
| `devTranscription.groupDialogues` | `true` | Agrupar la lectura por voz y pausas. |
| `devTranscription.dialogueGapSeconds` | `3` | Pausa máxima entre fragmentos del mismo bloque. |
| `devTranscription.dialogueMaxSeconds` | `60` | Duración máxima al unir fragmentos. |
| `devTranscription.diarization` | `true` | Separar voces y asignar IDs. |
| `devTranscription.numSpeakers` | `0` | Cantidad conocida de voces; 0 estima automáticamente. |
| `devTranscription.speakerThreshold` | `0.5` | Umbral de agrupación; menor valor tiende a separar más voces. |
| `devTranscription.initialPrompt` | vacío | Vocabulario y nombres propios. |
| `devTranscription.offline` | `false` | Exigir un modelo previamente descargado. |
| `devTranscription.pythonPath` | vacío | Python para crear el entorno privado. |

Abre el botón o engranaje **Configuración** para ver los ajustes y las acciones del motor. El estado del motor, su preparación, la descarga de modelos y el acceso a la carpeta de la biblioteca viven en esa pantalla.

En **Dev Transcription: Mostrar registro del motor** puedes revisar errores de instalación, audio o CUDA. **Instalar o reparar motor local** vuelve a instalar dependencias sin tocar la biblioteca.

## Desarrollo e instalación

Requiere Node.js 22 o posterior y Python 3.12 recomendado, disponible como `python3` para ejecutar las pruebas. Las pruebas usan dobles del motor: no instalan dependencias de transcripción, descargan modelos ni requieren GPU.

```sh
npm ci
npm run check
npm run package
code --install-extension dist/dev-transcription-0.3.0.vsix
```

Abre el proyecto y usa `F5` → **Run Dev Transcription** para iniciar un host de desarrollo. `npm run watch` mantiene la compilación actualizada.

El código TypeScript está dividido en dominio, almacenamiento, procesos, motor, cola, host de VS Code e interfaz webview. `python/transcribe.py` es el trabajador local con protocolo JSON por líneas. La extensión no tiene dependencias npm de producción; el VSIX contiene el código compilado, la interfaz y el trabajador Python, sin modelos ni entornos.

`npm run package` toma la versión de `package.json` para generar `dist/dev-transcription-<versión>.vsix`. Puedes comprobar su contenido con `python3 scripts/verify-package.py`.

GitHub Actions valida y empaqueta los pull requests y los pushes a `develop` y `main`. Cada push a `main` con una versión nueva crea el tag `v<versión>` y un release con el VSIX validado y las notas correspondientes de `CHANGELOG.md`. Consulta [RELEASE.md](RELEASE.md) para la primera subida y las siguientes versiones, [CONTRIBUTING.md](CONTRIBUTING.md) para desarrollo y [SECURITY.md](SECURITY.md) para el manejo de datos y reportes de seguridad.

Licencia MIT.

Los resultados guardados anteriormente no se corrigen automáticamente: regenera la transcripción para aplicar el reconocimiento limitado a español e inglés. Se conserva el respaldo anterior con sus nombres y texto.

## Modelos de terceros

El código de la extensión usa MIT. Los pesos descargados conservan sus propias licencias: [pyannote segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0) (MIT), [WeSpeaker VoxCeleb ResNet34-LM](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM) (CC BY 4.0) y [Whisper large-v3](https://huggingface.co/openai/whisper-large-v3) (Apache 2.0). La conversión ONNX y su distribución corresponden a [sherpa-onnx / k2-fsa](https://github.com/k2-fsa/sherpa-onnx). Los pesos no se incluyen en el VSIX.
