"""Internal Carbon-target delivery check; does not send keyboard/HID input.

Run with the project venv Python and project directory as the first argument.
This creates no window and targets only this test process's Carbon application
event target. It does not establish that a physical global shortcut works.
"""

import ctypes
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]).resolve()))

from PySide6.QtCore import QCoreApplication, QEvent
from PySide6.QtWidgets import QApplication
from my_brush.platform import DesktopIntegration, _EventHotKeyID, _fourcc


app = QApplication([sys.argv[0]])
integration = DesktopIntegration()
native_emissions = []
queued_emissions = []
integration._nativeActivated.connect(lambda: native_emissions.append("native"))
integration.hotkeyActivated.connect(lambda: queued_emissions.append("queued"))

try:
    binding = {"key": "F8", "ctrl": True, "alt": True}
    ok, error = integration.register_hotkey(binding)
    assert ok, error
    backend = integration._backend
    carbon = backend.carbon
    pointer, uint32, status_type = ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int32
    carbon.GetCurrentEventTime.argtypes = []
    carbon.GetCurrentEventTime.restype = ctypes.c_double
    carbon.CreateEvent.argtypes = [pointer, uint32, uint32, ctypes.c_double, uint32, ctypes.POINTER(pointer)]
    carbon.CreateEvent.restype = status_type
    carbon.SetEventParameter.argtypes = [pointer, uint32, uint32, uint32, pointer]
    carbon.SetEventParameter.restype = status_type
    carbon.SendEventToEventTarget.argtypes = [pointer, pointer]
    carbon.SendEventToEventTarget.restype = status_type
    carbon.ReleaseEvent.argtypes = [pointer]
    carbon.ReleaseEvent.restype = None

    statuses = []

    def send_to_own_carbon_target(kind):
        event = pointer()
        status = carbon.CreateEvent(None, _fourcc("keyb"), kind, carbon.GetCurrentEventTime(), 0, ctypes.byref(event))
        assert status == 0 and event.value, ("CreateEvent", status)
        try:
            identifier = _EventHotKeyID(backend._signature, backend._current_id)
            status = carbon.SetEventParameter(event, _fourcc("----"), _fourcc("hkid"), ctypes.sizeof(identifier), ctypes.byref(identifier))
            assert status == 0, ("SetEventParameter", status)
            # No dispatcher queue, CGEvent, HID event, or another process is used.
            status = carbon.SendEventToEventTarget(event, backend._target)
            statuses.append({"kind": kind, "status": status})
            assert status == 0, ("SendEventToEventTarget", status)
        finally:
            carbon.ReleaseEvent(event)

    def deliver_queued_signals():
        QCoreApplication.sendPostedEvents(None, QEvent.Type.MetaCall)

    send_to_own_carbon_target(5)
    assert len(native_emissions) == 1
    assert len(queued_emissions) == 0, "The Qt public signal must remain queued."
    send_to_own_carbon_target(5)
    assert len(native_emissions) == 1, "Repeated press must be suppressed before release."
    deliver_queued_signals()
    assert len(queued_emissions) == 1

    send_to_own_carbon_target(6)
    assert not backend._pressed
    assert len(native_emissions) == 1 and len(queued_emissions) == 1
    send_to_own_carbon_target(5)
    assert len(native_emissions) == 2 and len(queued_emissions) == 1
    deliver_queued_signals()
    assert len(queued_emissions) == 2, "Release must rearm exactly one queued activation."
    send_to_own_carbon_target(6)
    assert not backend._pressed

    integration.close()
    assert not backend._refs and not backend._handler.value
    print(json.dumps({
        "result": "PASS",
        "scope": "Own-process Carbon application target, callback ABI, ID parsing, repeat suppression, and Qt queued signals only",
        "physical_global_shortcut_verified": False,
        "windows_created": 0,
        "keyboard_or_hid_input_sent": False,
        "registered_binding": binding,
        "native_emissions": len(native_emissions),
        "queued_emissions": len(queued_emissions),
        "delivery_statuses": statuses,
        "cleanup_verified": True,
    }, ensure_ascii=False))
finally:
    integration.close()
