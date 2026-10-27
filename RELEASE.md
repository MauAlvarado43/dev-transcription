# Publicar una versión

El repositorio sigue el flujo de las otras extensiones Dev: GitHub Actions valida los cambios y publica un release al llegar una versión nueva a `main`.

## Primera subida a GitHub

Los metadatos apuntan a `MauAlvarado43/dev-transcription`, siguiendo la cuenta de las otras extensiones. Si eliges otro propietario o nombre, actualiza `repository`, `homepage` y `bugs` en `package.json` y los enlaces del README.

1. Crea un repositorio vacío llamado `dev-transcription` en GitHub, sin inicializar README, licencia ni `.gitignore`.
2. Desde este directorio, valida el paquete:

   ```sh
   npm ci
   npm run package
   python3 scripts/verify-package.py
   ```

3. Revisa los archivos y realiza la primera subida:

   ```sh
   git add .
   git commit -m "Prepare Dev Transcription for GitHub releases"
   git remote add origin git@github.com:MauAlvarado43/dev-transcription.git
   git push -u origin main
   ```

El primer push inicia **Validate and release** y publica `v0.3.0` con `dev-transcription-0.3.0.vsix`. No hace falta crear el tag ni el release manualmente. GitHub Actions debe estar habilitado; el workflow solicita `contents: write` solo para el job de publicación y usa el `GITHUB_TOKEN` automático, sin secretos adicionales. Las políticas de la cuenta u organización deben permitir ese permiso.

## Siguientes versiones

1. Trabaja en una rama `feature/<tema>`; puedes integrar primero a `develop` como en las otras extensiones.
2. Documenta cambios visibles en `## [Unreleased]` de `CHANGELOG.md`.
3. Al preparar la publicación, incrementa la versión y sincroniza el lockfile sin crear un tag:

   ```sh
   npm version patch --no-git-tag-version
   ```

   Usa `minor` para funcionalidad nueva o cambios relevantes del flujo durante `0.x`; usa `patch` para correcciones y mejoras compatibles.

4. Mueve las notas pendientes a `## [<versión>]`, con la misma versión de `package.json`. Puedes agregar una fecha: `## [0.3.1] - AAAA-MM-DD`. La sección debe contener notas reales; una sección vacía o con solo comentarios bloquea la validación.
5. Ejecuta `npm run package` y `python3 scripts/verify-package.py`, incluye `package-lock.json` en el commit y abre el pull request hacia `main`.
6. Al fusionarlo, Actions publica el VSIX validado, sus notas y el tag que apunta al commit que se verificó.

Cada versión se publica una sola vez. Un push con una versión ya publicada valida los cambios y conserva el release existente. Para distribuir cambios nuevos hay que incrementar la versión. No se reemplazan archivos de releases anteriores.

## Qué verifica Actions

- Instala las dependencias npm del lockfile con Node.js 22 y configura Python 3.12.
- Ejecuta TypeScript, pruebas TypeScript/Python, compilación y extracción de notas mediante `npm run package`.
- Comprueba metadatos y contenido del VSIX, incluido el trabajador Python y la interfaz compilada. Solo se incluyen los archivos enumerados en `.vscodeignore`; se excluyen modelos, entornos, pruebas, scripts y datos locales.
- Guarda el VSIX y las notas como artefacto del run, también en pull requests. El job de release descarga ese mismo artefacto.
- Publica únicamente desde `main`. Los pull requests y `develop` no publican releases.

El VSIX es universal: no incluye binarios nativos ni modelos. Las pruebas de CI usan dobles del motor y no verifican reconocimiento real ni compatibilidad de CUDA en cada sistema.

## Reintentos

Si una publicación falla, revisa el run de **Actions → Validate and release** y vuelve a ejecutar los jobs fallidos. También puedes usar **Run workflow** sobre `main`. Un tag preexistente sin release debe apuntar al mismo commit que se está publicando; si no coincide, el workflow falla.

Si el release ya existe, el workflow lo conserva. Para corregir su contenido, prepara una versión nueva.

## Distribución

Los usuarios descargan el VSIX de GitHub Releases y lo instalan con **Instalar desde VSIX…**. Este flujo publica en GitHub; una publicación en Visual Studio Marketplace requiere configurar por separado el publisher y su autenticación.
