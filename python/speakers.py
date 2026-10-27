"""Local voice clustering and word-to-speaker alignment; no remote inference."""
from pathlib import Path
import os
import tarfile
import urllib.request

SEGMENTATION = "sherpa-onnx-pyannote-segmentation-3-0"
EMBEDDING = "wespeaker_en_voxceleb_resnet34_LM.onnx"
RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download"


def download(url, target, offline):
    if target.is_file():
        return
    if offline:
        raise RuntimeError("Faltan modelos de hablantes. Desactiva el modo sin conexión y pulsa «Descargar modelo».")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".part")
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Dev-Transcription/0.2"})
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as stream:
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > 512 * 1024 * 1024:
                    raise RuntimeError("El modelo de hablantes excede el tamaño esperado.")
                stream.write(chunk)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_models(cache, offline=False):
    root = Path(cache) / "speakers"
    segmentation = root / SEGMENTATION / "model.onnx"
    embedding = root / EMBEDDING
    if not segmentation.is_file():
        archive = root / f"{SEGMENTATION}.tar.bz2"
        download(f"{RELEASE}/speaker-segmentation-models/{archive.name}", archive, offline)
        # Read only known regular files; never extract paths or symlinks from a tar.
        with tarfile.open(archive, "r:bz2") as bundle:
            for name in ("LICENSE", "README.md", "model.onnx"):
                member = bundle.getmember(f"{SEGMENTATION}/{name}")
                if not member.isfile() or member.size > 20 * 1024 * 1024:
                    raise RuntimeError("Archivo de segmentación inválido.")
                stream = bundle.extractfile(member)
                if stream is None:
                    raise RuntimeError("Modelo de segmentación incompleto.")
                destination = segmentation.parent / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = destination.with_suffix(destination.suffix + ".part")
                temporary.write_bytes(stream.read())
                temporary.replace(destination)
    download(f"{RELEASE}/speaker-recongition-models/{EMBEDDING}", embedding, offline)
    return segmentation, embedding


def diarize(audio, cache, offline, num_speakers, threshold, emit):
    import sherpa_onnx
    emit("status", stage="speakers", message="Preparando modelos de voces…")
    segmentation, embedding = prepare_models(cache, offline)
    threads = min(4, os.cpu_count() or 2)
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(segmentation)),
            num_threads=threads, provider="cpu",
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(embedding), num_threads=threads, provider="cpu"),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=num_speakers if num_speakers > 0 else -1, threshold=threshold),
        min_duration_on=0.3, min_duration_off=0.5,
    )
    if not config.validate():
        raise RuntimeError("La configuración de detección de hablantes no es válida.")
    detector = sherpa_onnx.OfflineSpeakerDiarization(config)
    if detector.sample_rate != 16000:
        raise RuntimeError("El modelo de hablantes requiere audio a 16 kHz.")
    emit("progress", stage="speakers", percent=0, message="Identificando voces…")
    def progress(done, total):
        emit("progress", stage="speakers", percent=min(99, 100 * done / max(total, 1)), message="Identificando voces…")
        return 0
    turns = detector.process(audio, callback=progress).sort_by_start_time()
    labels = {}
    result = []
    for turn in turns:
        if turn.speaker not in labels:
            labels[turn.speaker] = f"actor-{len(labels) + 1:03d}"
        result.append({"start": turn.start, "end": turn.end, "speakerId": labels[turn.speaker]})
    emit("progress", stage="speakers", percent=100, message="Voces identificadas")
    return result


def assign_speaker(start, end, turns):
    scores = {}
    for turn in turns:
        overlap = max(0, min(end, turn["end"]) - max(start, turn["start"]))
        if overlap:
            label = turn["speakerId"]
            scores[label] = scores.get(label, 0) + overlap
    # Never invent a confident attribution for words outside detected speech.
    if scores:
        return max(scores, key=scores.get)
    nearest = min(turns, key=lambda turn: max(turn["start"] - end, start - turn["end"], 0), default=None)
    if nearest and max(nearest["start"] - end, start - nearest["end"], 0) <= 0.35:
        return nearest["speakerId"]
    return "actor-unknown"


def speech_chunks(audio, turns):
    """Short speech windows, also split at speaker changes for language detection."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    speech = get_speech_timestamps(audio, VadOptions(max_speech_duration_s=12, min_silence_duration_ms=300, speech_pad_ms=150))
    cuts = sorted(set(
        int((a["end"] + b["start"]) / 2 * 16000)
        for a, b in zip(turns, turns[1:]) if a["speakerId"] != b["speakerId"]
    ))
    result = []
    for span in speech:
        boundaries = [span["start"]] + [c for c in cuts if span["start"] + 4000 < c < span["end"] - 4000] + [span["end"]]
        result.extend((start, end) for start, end in zip(boundaries, boundaries[1:]) if end > start)
    return result


def split_by_speaker(segment, turns):
    words = getattr(segment, "words", None)
    if not words:
        return [{"start": segment.start, "end": segment.end, "text": segment.text.strip(),
                 "speakerId": assign_speaker(segment.start, segment.end, turns)}]
    result = []
    for word in words:
        label = assign_speaker(word.start, word.end, turns)
        if result and result[-1]["speakerId"] == label:
            result[-1]["text"] += word.word
            result[-1]["end"] = max(result[-1]["end"], word.end)
        else:
            result.append({"start": word.start, "end": word.end, "text": word.word, "speakerId": label})
    for item in result:
        item["text"] = item["text"].strip()
    return [item for item in result if item["text"]]
