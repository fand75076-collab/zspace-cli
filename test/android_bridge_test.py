import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).parents[1] / 'src/android_bridge.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

def xml(*rows):
    root = ET.Element('hierarchy')
    for attrs in rows:
        ET.SubElement(root, 'node', {
            'package': b.PACKAGE, 'bounds': '[0,100][100,200]', 'class': 'android.widget.TextView',
            'enabled': 'true', 'text': 'fixture', **attrs,
        })
    return ET.tostring(root, encoding='unicode')

def snapshot(raw, activity=b.HOME):
    elements, bindings = b.screen_data(raw, activity, (1080, 2400))
    return {'activity': activity, 'elements': elements}, bindings

class BridgeTests(unittest.TestCase):
    def assert_code(self, code, fn):
        with self.assertRaises(b.BridgeError) as error:
            fn()
        self.assertEqual(error.exception.code, code)

    def test_strict_request_blocks_shell_routes_and_other_packages(self):
        for req in [None, [], {'action': []}, {'action': 'shell'}, {'action': 'open', 'app': 'browser'},
                    {'action': 'status', 'serial': 'x;echo y'}, {'action': 'status', 'serial': 123},
                    {'action': 'tap', 'target': 'x'}, {'action': 'tap', 'target': 111111111111111111111111},
                    {'action': 'status', 'package': 'other.app'}, {'action': 'set-text', 'target': 'a'*24, 'text': 'a'*4001}]:
            self.assert_code('USAGE', lambda: b.validate_request(req))
        self.assertEqual(b.validate_request({'action': 'set-text', 'target': 'a'*24, 'text': '中文'})['text'], '中文')

    def test_only_app_visible_nodes_and_clipped_bounds(self):
        raw = xml({'package': 'another.app', 'text': 'foreign-secret'}, {'text': 'offscreen', 'bounds': '[1080,0][2160,100]'},
                  {'text': 'hidden', 'visible-to-user': 'false'}, {'text': 'clipped', 'bounds': '[1000,2300][1500,2600]'},
                  {'text': 'zero', 'bounds': '[0,0][0,0]'})
        screen, _ = snapshot(raw)
        self.assertEqual(len(screen['elements']), 1)
        self.assertEqual(screen['elements'][0]['bounds'], (1000, 2300, 1080, 2400))
        self.assertEqual(screen['elements'][0]['text'], 'clipped')

    def test_password_is_hidden_and_target_cannot_be_used(self):
        screen, binding = snapshot(xml({'text': 'synthetic-password', 'password': 'true', 'class': 'android.widget.EditText'}))
        item = screen['elements'][0]
        self.assertNotIn('synthetic-password', str(screen))
        self.assertEqual(item['text'], '[PROTECTED]')
        self.assert_code('ANDROID_PROTECTED_INPUT', lambda: b.get_target(screen, binding, item['target']))

    def test_tokens_change_with_activity_label_bounds_and_state(self):
        raw = xml({})
        token = snapshot(raw)[0]['elements'][0]['target']
        for raw2, activity in [(raw, 'OtherActivity'), (xml({'text': 'changed'}), b.HOME),
                               (xml({'bounds': '[1,100][100,200]'}), b.HOME), (xml({'enabled': 'false'}), b.HOME)]:
            screen, binding = snapshot(raw2, activity)
            self.assertNotEqual(screen['elements'][0]['target'], token)
            self.assert_code('ANDROID_STALE_TARGET', lambda: b.get_target(screen, binding, token))

    def test_disabled_and_wrong_target_type_are_rejected(self):
        for attrs, code, kind in [({'enabled': 'false'}, 'ANDROID_DISABLED_TARGET', None), ({}, 'ANDROID_TARGET_TYPE', 'editable')]:
            screen, binding = snapshot(xml(attrs))
            self.assert_code(code, lambda: b.get_target(screen, binding, screen['elements'][0]['target'], kind))

    def test_navigation_preserves_existing_edits_and_dialogs(self):
        for attrs, code in [({'class': 'android.widget.EditText'}, 'ANDROID_EDIT_IN_PROGRESS'),
                            ({'resource-id': 'android:id/button1'}, 'ANDROID_DIALOG')]:
            self.assert_code(code, lambda: b.navigation_safe(snapshot(xml(attrs))[0]))

    def test_device_selection_requires_authorization_and_is_unambiguous(self):
        cases = [('List of devices attached\n', {}, 'ANDROID_DEVICE_SELECTION'),
                 ('List of devices attached\na device\nb device\n', {}, 'ANDROID_DEVICE_SELECTION'),
                 ('List of devices attached\na unauthorized\n', {}, 'ANDROID_NOT_AUTHORIZED'),
                 ('List of devices attached\na device\n', {'serial': 'b'}, 'ANDROID_NOT_CONNECTED')]
        with patch.dict(os.environ, {}, clear=True):
            for output, req, code in cases:
                with patch.object(b.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, output)):
                    self.assert_code(code, lambda: b.choose_device(req))
            with patch.object(b.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'List of devices attached\na device\nb device\n')) as run:
                self.assertEqual(b.choose_device({'serial': 'b'}), 'b')
                self.assertEqual(run.call_args.args[0], ['adb', 'devices'])

    def test_device_lock_is_exclusive_and_released(self):
        with b.device_lock('synthetic-test-device'):
            self.assert_code('ANDROID_BUSY', lambda: _take_lock())
        with b.device_lock('synthetic-test-device'):
            pass

    def test_foreground_only_and_home_back_refusal(self):
        class Device:
            def app_current(self): return {'package': 'other.app'}
            def click(self, *args): raise AssertionError('must not tap')
        with patch.object(b.time, 'sleep'):
            self.assert_code('ANDROID_FOREGROUND_REQUIRED', lambda: b.tap_item(Device(), {'bounds': [0,0,100,100]}))
        with patch.object(b, 'snapshot', return_value=snapshot(xml({}))):
            self.assert_code('ANDROID_AT_HOME', lambda: b.perform(Device(), {'action': 'back'}, 'fixture'))

    def test_snapshot_retries_transition_reads_without_repeating_input(self):
        class Device:
            states = iter([b.HOME, 'NewActivity', 'NewActivity', 'NewActivity'])
            def app_current(self): return {'package': b.PACKAGE, 'activity': next(self.states)}
            def dump_hierarchy(self): return xml({})
            def window_size(self): return (1080, 2400)
            def click(self, *args): raise AssertionError('must not repeat input')
        with patch.object(b.time, 'sleep'):
            screen, _ = b.snapshot(Device())
        self.assertEqual(screen['activity'], 'NewActivity')

def _take_lock():
    with b.device_lock('synthetic-test-device'):
        pass

if __name__ == '__main__':
    unittest.main()
