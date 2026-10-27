"""JSON-lines worker. Media never leaves this process; downloads only fetch weights."""
import argparse
import json
import os
from pathlib import Path
import sys


def emit(kind, **fields):
    print(json.dumps({"type": kind, **fields}, ensure_ascii=False), flush=True)


def bootstrap_cuda():
    # The dynamic loader must see pip-installed NVIDIA libraries before startup.
    if sys.platform != "linux" or os.environ.get("DEV_TRANSCRIPTION_CUDA_BOOTSTRAPPED"):
        return
    import site
    directories = []
    for base in site.getsitepackages():
        directories.extend(str(p) for p in Path(base).glob("nvidia/*/lib") if p.is_dir())
    if directories:
        env = dict(os.environ, DEV_TRANSCRIPTION_CUDA_BOOTSTRAPPED="1")
        env["LD_LIBRARY_PATH"] = os.pathsep.join(directories + [env.get("LD_LIBRARY_PATH", "")])
        os.execve(sys.executable, [sys.executable, *sys.argv], env)


def run(args):
    if args.offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    from faster_whisper import WhisperModel
    if args.check:
        import av
        import ctranslate2
        import sherpa_onnx
        emit("ready", version=ctranslate2.__version__, cuda=ctranslate2.get_cuda_device_count(), av=av.__version__)
        return
    emit("status", stage="preparing", message="Cargando modelo local…" if args.offline else "Descargando / cargando modelo (la primera vez puede tardar)…")
    model = WhisperModel(args.model, device=args.device,
                         compute_type="float16" if args.device == "cuda" else "int8",
                         download_root=args.cache, local_files_only=args.offline,
                         cpu_threads=min(8, os.cpu_count() or 4))
    if args.download:
        if not args.no_speakers:
            from speakers import prepare_models
            emit("status", stage="preparing", message="Preparando modelos locales de hablantes…")
            prepare_models(args.cache, args.offline)
        emit("done", downloaded=True)
        return
    if not args.input or not args.output:
        raise ValueError("Falta el archivo de entrada o salida")
    emit("status", stage="audio", message="Extrayendo audio del video…")
    from faster_whisper.audio import decode_audio
    from speakers import diarize, speech_chunks, split_by_speaker
    from languages import choose_language, supported_script
    source = decode_audio(args.input, sampling_rate=16000)
    duration = len(source) / 16000
    turns = []
    if not args.no_speakers:
        emit("status", stage="speakers", message="Preparando detección de voces…")
        turns = diarize(source, args.cache, args.offline, args.num_speakers, args.speaker_threshold, emit)
    result = []
    languages = set()
    previous_language = "es" if args.language == "auto" else args.language
    emit("status", stage="speech", message="Localizando fragmentos de voz…")
    chunks = speech_chunks(source, turns)
    speech_samples = sum(end - start for start, end in chunks)
    processed_samples = 0
    emit("progress", stage="transcription", percent=0, duration=duration, message="Transcribiendo en el idioma de cada fragmento…" if args.language == "auto" else "Transcribiendo…")
    # A single language prompt for a mixed-language 30 s window can translate or
    # omit speech. Decode each short voice span independently, resetting context.
    for index, (start, end) in enumerate(chunks):
        offset = start / 16000
        clip = source[start:end]
        language = choose_language(model, clip, previous_language) if args.language == "auto" else args.language
        previous_language = language
        segments, info = model.transcribe(
            clip, beam_size=5, language=language,
            task="transcribe", vad_filter=False, initial_prompt=args.prompt or None,
            multilingual=False, condition_on_previous_text=False,
            word_timestamps=not args.no_speakers,
        )
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
            if not supported_script(text):
                text = segment.text = "[Fragmento no reconocido]"
                segment.words = None
            segment.start = max(offset, segment.start + offset)
            segment.end = max(segment.start, min(duration, segment.end + offset))
            for word in getattr(segment, "words", None) or []:
                word.start = max(offset, word.start + offset)
                word.end = max(word.start, min(duration, word.end + offset))
            if args.no_speakers:
                items = [{"start": segment.start, "end": segment.end, "text": text, "speakerId": "actor-unknown"}]
            else:
                items = split_by_speaker(segment, turns)
            for item in items:
                item["language"] = language
            result.extend(items)
            languages.add(language)
        processed_samples += end - start
        emit("progress", stage="transcription", percent=100 * processed_samples / max(speech_samples, 1),
             message=f"Transcribiendo fragmento {index + 1} / {len(chunks)}")
    emit("progress", stage="transcription", percent=100, message="Transcripción completada")
    result.sort(key=lambda item: item["start"])
    actors = {}
    for index, item in enumerate(result):
        item["id"] = f"segment-{index + 1:06d}"
        label = item["speakerId"]
        if label not in actors:
            actors[label] = {"id": label, "name": "Sin identificar" if label == "actor-unknown" else f"Hablante {int(label.split('-')[1])}"}
    language = next(iter(languages)) if len(languages) == 1 else "mul" if languages else "und"
    payload = {"version": 1, "language": language, "languages": sorted(languages), "multilingual": args.language == "auto", "duration": duration,
               "model": args.model, "device": args.device, "segments": result, "speakers": sorted(actors.values(), key=lambda a: a["id"])}
    # Only completed results reach the host. Cancellation cannot replace saved text.
    target = Path(args.output)
    temporary = target.with_suffix(".partial")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(target)
    emit("done", segments=len(result), duration=duration)


def parser():
    p = argparse.ArgumentParser()
    p.add_argument("--input")
    p.add_argument("--output")
    p.add_argument("--cache", required=True)
    p.add_argument("--model", default="large-v3")
    p.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    p.add_argument("--language", choices=["auto", "es", "en"], default="auto")
    p.add_argument("--prompt", default="")
    p.add_argument("--offline", action="store_true")
    p.add_argument("--download", action="store_true")
    p.add_argument("--check", action="store_true")
    p.add_argument("--no-speakers", action="store_true")
    p.add_argument("--num-speakers", type=int, default=0)
    p.add_argument("--speaker-threshold", type=float, default=0.5)
    return p


if __name__ == "__main__":
    bootstrap_cuda()
    try:
        run(parser().parse_args())
    except Exception as error:
        emit("error", message=str(error))
        print(str(error), file=sys.stderr)
        sys.exit(1)
