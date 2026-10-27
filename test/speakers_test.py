import importlib.util
from pathlib import Path
import types
import unittest

spec = importlib.util.spec_from_file_location("speakers", Path(__file__).parents[1] / "python" / "speakers.py")
speakers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(speakers)


class SpeakersTest(unittest.TestCase):
    def test_word_alignment_splits_a_single_asr_segment_at_speaker_changes(self):
        turns = [{"start": 0, "end": 2, "speakerId": "actor-001"}, {"start": 2, "end": 5, "speakerId": "actor-002"}]
        segment = types.SimpleNamespace(start=0, end=5, text="Hello. Hola, bien.", words=[
            types.SimpleNamespace(start=0, end=1, word="Hello."),
            types.SimpleNamespace(start=2, end=3, word=" Hola,"),
            types.SimpleNamespace(start=3, end=5, word=" bien."),
        ])
        result = speakers.split_by_speaker(segment, turns)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["speakerId"], "actor-001")
        self.assertEqual(result[1]["speakerId"], "actor-002")
        self.assertEqual(result[1]["text"], "Hola, bien.")
        self.assertEqual(result[1]["start"], 2)

    def test_assignment_uses_largest_overlap_and_marks_uncovered_speech_unknown(self):
        turns = [{"start": 0, "end": 1, "speakerId": "actor-001"}, {"start": 1, "end": 5, "speakerId": "actor-002"}]
        self.assertEqual(speakers.assign_speaker(0.9, 2, turns), "actor-002")
        self.assertEqual(speakers.assign_speaker(8, 9, turns), "actor-unknown")

    def test_offline_missing_models_do_not_attempt_network(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as root, patch.object(speakers.urllib.request, "urlopen") as network:
            with self.assertRaisesRegex(RuntimeError, "Speaker models are missing"):
                speakers.prepare_models(root, offline=True)
            network.assert_not_called()

    def test_speech_chunks_split_languages_at_voice_changes_without_overlapping_audio(self):
        from unittest.mock import patch
        fake_vad = types.SimpleNamespace(VadOptions=lambda **kw: kw, get_speech_timestamps=lambda *a: [{'start': 0, 'end': 160000}])
        turns = [{'start': 0, 'end': 4, 'speakerId': 'actor-001'}, {'start': 4, 'end': 10, 'speakerId': 'actor-002'}]
        with patch.dict('sys.modules', {'faster_whisper.vad': fake_vad}):
            self.assertEqual(speakers.speech_chunks([0] * 160000, turns), [(0, 64000), (64000, 160000)])


if __name__ == "__main__":
    unittest.main()
