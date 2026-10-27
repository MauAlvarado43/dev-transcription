import sys
from pathlib import Path
import types
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'python'))
from languages import choose_language, supported_script


class LanguagesTest(unittest.TestCase):
    def test_auto_selects_only_english_or_spanish_even_when_another_language_scores_highest(self):
        model = types.SimpleNamespace(detect_language=lambda **kw: ('ja', .8, [('ja', .8), ('es', .15), ('en', .05)]))
        self.assertEqual(choose_language(model, [0] * 32000), 'es')
        model.detect_language = lambda **kw: ('ru', .8, [('ru', .8), ('es', .05), ('en', .15)])
        self.assertEqual(choose_language(model, [0] * 32000), 'en')

    def test_short_ambiguous_responses_keep_previous_supported_language(self):
        model = types.SimpleNamespace(detect_language=lambda **kw: self.fail('Short response should keep context'))
        self.assertEqual(choose_language(model, [0] * 4000, 'en'), 'en')
        self.assertEqual(choose_language(model, [0] * 4000, 'ru'), 'es')

    def test_latin_accents_technical_terms_and_symbols_are_allowed_but_unrelated_scripts_are_not(self):
        self.assertTrue(supported_script('¿Sí, Mau? El worker está ejecutándose. API, C++, nº 2, 20 µm.'))
        self.assertTrue(supported_script('Hello — let’s refactor the execution service.'))
        self.assertFalse(supported_script('さようなら'))
        self.assertFalse(supported_script('Пробуем.'))


if __name__ == '__main__':
    unittest.main()
