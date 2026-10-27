# Changelog

## 0.3.0

- Modo automático restringido a español e inglés por fragmento; las escrituras ajenas se marcan como no reconocidas.

- Lectura agrupada por hablante, pausa y duración máxima; conmutador para volver a los fragmentos originales.
- Ajustes de lectura en Configuración. La agrupación conserva las ediciones, IDs y tiempos de cada fragmento.

- Porcentajes independientes para identificación de voces y transcripción, con historial de etapas completadas en el reproductor.
- Etapa y porcentaje visibles en la biblioteca y la barra de estado; reinicio del indicador al cambiar de etapa o reintentar en CPU.

## 0.2.1

- Corregido el desbordamiento horizontal de la biblioteca con mensajes largos de progreso o nombres extensos.
- Ajustados el espaciado del webview y los menús para barras laterales estrechas.

## 0.2.0

- Reconocimiento por fragmentos para conversaciones que alternan inglés y español, con idioma guardado por intervención.
- Separación local de voces con IDs de hablante y de fragmento.
- Nombres editables, alta manual de hablantes y corrección de asignaciones desde Tiempos.
- Exportaciones y búsqueda con nombres e IDs; respaldo del JSON anterior al regenerar.
- Pantalla de Configuración con ajustes, estado del motor, preparación, descargas y acceso al almacenamiento. Retirado el bloque inferior de la biblioteca.

## 0.1.0

- Biblioteca local organizada por colecciones con importación, búsqueda, renombrado y movimiento de videos.
- Transcripción con faster-whisper y large-v3, GPU NVIDIA o CPU, cola y cancelación.
- Reproductor, lectura con marcas de tiempo y edición Markdown con guardado automático.
- Exportación Markdown, TXT, SRT, VTT y JSON.
- Entorno privado del motor, descarga de modelos y modo sin conexión.
