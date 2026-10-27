import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'python'))
import speakers

spec = importlib.util.spec_from_file_location("worker", Path(__file__).parents[1] / "python" / "transcribe.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTest(unittest.TestCase):
    def test_worker_decodes_locally_and_writes_only_a_completed_result(self):
        calls = []

        class Model:
            def __init__(self, model, **kwargs):
                calls.append((model, kwargs))

            def transcribe(self, source, **kwargs):
                calls.append((source, kwargs))
                return iter([types.SimpleNamespace(start=0, end=2, text=" Hola. ")]), types.SimpleNamespace(duration=2, language="es")

        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / "result.json"
            args = worker.parser().parse_args(["--input", "video con espacios.mp4", "--output", str(output), "--cache", root, "--language", "es", "--offline", "--no-speakers"])
            with patch.dict("sys.modules", {"faster_whisper": types.SimpleNamespace(WhisperModel=Model), "faster_whisper.audio": types.SimpleNamespace(decode_audio=lambda *a, **kw: [0] * 32000)}), patch.object(speakers, 'speech_chunks', return_value=[(0, 32000)]), patch.object(worker, "emit"):
                worker.run(args)
            data = json.loads(output.read_text())
            self.assertEqual(data["segments"], [{"id": "segment-000001", "speakerId": "actor-unknown", "language": "es", "start": 0, "end": 2, "text": "Hola."}])
            self.assertTrue(calls[0][1]["local_files_only"])
            self.assertEqual(calls[0][1]["compute_type"], "int8")
            self.assertEqual(calls[1][1]["task"], "transcribe")
            self.assertEqual(calls[1][1]["beam_size"], 5)
            self.assertFalse(calls[1][1]["vad_filter"])
            self.assertFalse(calls[1][1]["multilingual"])
            self.assertFalse(output.with_suffix(".partial").exists())

    def test_failed_recognition_cannot_overwrite_output(self):
        class BrokenModel:
            def __init__(self, *a, **kw):
                pass
            def detect_language(self, **kw):
                return 'es', 1, [('es', 1), ('en', 0)]

            def transcribe(self, *a, **kw):
                def segments():
                    yield types.SimpleNamespace(start=0, end=1, text="Partial")
                    raise RuntimeError("Decoder failed")
                return segments(), types.SimpleNamespace(duration=2, language="es")

        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / "result.json"
            output.write_text("Previous result")
            args = worker.parser().parse_args(["--input", "video.mp4", "--output", str(output), "--cache", root, "--no-speakers"])
            with patch.dict("sys.modules", {"faster_whisper": types.SimpleNamespace(WhisperModel=BrokenModel), "faster_whisper.audio": types.SimpleNamespace(decode_audio=lambda *a, **kw: [0] * 32000)}), patch.object(speakers, 'speech_chunks', return_value=[(0, 32000)]), patch.object(worker, "emit"), self.assertRaises(RuntimeError):
                worker.run(args)
            self.assertEqual(output.read_text(), "Previous result")

    def test_mixed_languages_are_decoded_independently_with_global_offsets_and_stable_actors(self):
        calls = []
        class Model:
            def __init__(self, *a, **kw):
                pass
            def detect_language(self, **kw):
                language = 'en' if not calls else 'es'
                return language, 0.9, [(language, 0.9), ('es' if language == 'en' else 'en', 0.1)]
            def transcribe(self, source, **options):
                calls.append(options)
                english = len(calls) == 1
                text = 'Hello.' if english else 'Hola.'
                return iter([types.SimpleNamespace(start=0, end=1, text=text, words=[types.SimpleNamespace(start=0, end=1, word=text)])]), types.SimpleNamespace(language='en' if english else 'es')
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / 'result.json'
            args = worker.parser().parse_args(['--input', 'conversation.mp4', '--output', str(output), '--cache', root, '--offline'])
            turns = [{'start': 0, 'end': 1, 'speakerId': 'actor-001'}, {'start': 1, 'end': 2, 'speakerId': 'actor-002'}]
            with patch.dict('sys.modules', {'faster_whisper': types.SimpleNamespace(WhisperModel=Model), 'faster_whisper.audio': types.SimpleNamespace(decode_audio=lambda *a, **kw: [0] * 32000)}), patch.object(speakers, 'speech_chunks', return_value=[(0, 16000), (16000, 32000)]), patch.object(speakers, 'diarize', return_value=turns), patch.object(worker, 'emit'):
                worker.run(args)
            result = json.loads(output.read_text())
            self.assertEqual(result['language'], 'mul')
            self.assertEqual(result['languages'], ['en', 'es'])
            self.assertEqual([s['text'] for s in result['segments']], ['Hello.', 'Hola.'])
            self.assertEqual([s['speakerId'] for s in result['segments']], ['actor-001', 'actor-002'])
            self.assertEqual([s['start'] for s in result['segments']], [0, 1])
            self.assertEqual([s['id'] for s in result['segments']], ['segment-000001', 'segment-000002'])
            self.assertEqual([c['language'] for c in calls], ['en', 'es'])
            self.assertTrue(all(not c['multilingual'] and not c['condition_on_previous_text'] and c['word_timestamps'] for c in calls))

    def test_transcription_progress_counts_speech_not_silence_and_runs_zero_to_one_hundred(self):
        class Model:
            def __init__(self, *a, **kw):
                pass
            def detect_language(self, **kw):
                return 'es', 1, [('es', 1), ('en', 0)]
            def transcribe(self, *a, **kw):
                return iter([]), types.SimpleNamespace(language='es')
        with tempfile.TemporaryDirectory() as root:
            args = worker.parser().parse_args(['--input', 'video.mp4', '--output', str(Path(root) / 'result.json'), '--cache', root, '--no-speakers'])
            with patch.dict('sys.modules', {'faster_whisper': types.SimpleNamespace(WhisperModel=Model), 'faster_whisper.audio': types.SimpleNamespace(decode_audio=lambda *a, **kw: [0] * 32000)}), patch.object(speakers, 'speech_chunks', return_value=[(0, 4000), (16000, 28000)]), patch.object(worker, 'emit') as emitted:
                worker.run(args)
            events = [call.kwargs for call in emitted.call_args_list]
            progress = [e['percent'] for e in events if e.get('stage') == 'transcription' and 'percent' in e]
            self.assertEqual(progress, [0, 25, 100, 100])
            self.assertEqual([e['stage'] for e in events if 'stage' in e][:3], ['preparing', 'audio', 'speech'])
            self.assertFalse(any(e.get('stage') == 'speakers' for e in events))

    def test_unrelated_scripts_are_marked_instead_of_saved_as_valid_dialogue(self):
        class Model:
            def __init__(self, *a, **kw):
                pass
            def detect_language(self, **kw):
                return 'ru', .8, [('ru', .8), ('es', .15), ('en', .05)]
            def transcribe(self, *a, **kw):
                if kw['language'] not in ('es', 'en') or kw['multilingual']:
                    raise AssertionError('Decoder must stay restricted to Spanish/English')
                return iter([types.SimpleNamespace(start=0, end=1, text='Пробуем.', words=None)]), types.SimpleNamespace(language='es')
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / 'result.json'
            args = worker.parser().parse_args(['--input', 'video.mp4', '--output', str(output), '--cache', root, '--no-speakers'])
            with patch.dict('sys.modules', {'faster_whisper': types.SimpleNamespace(WhisperModel=Model), 'faster_whisper.audio': types.SimpleNamespace(decode_audio=lambda *a, **kw: [0] * 32000)}), patch.object(speakers, 'speech_chunks', return_value=[(0, 32000)]), patch.object(worker, 'emit'):
                worker.run(args)
            result = json.loads(output.read_text())
            self.assertEqual(result['segments'][0]['text'], '[Fragmento no reconocido]')
            self.assertEqual(result['languages'], ['es'])


if __name__ == "__main__":
    unittest.main()
