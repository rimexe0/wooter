import sys
import time

import analogio
import board
import supervisor

try:
    import usb_hid
    from adafruit_hid.keyboard import Keyboard
    from adafruit_hid.keycode import Keycode

    keyboard = Keyboard(usb_hid.devices)
    HID_OK = True
except Exception:
    keyboard = None
    Keycode = None
    HID_OK = False


SEND_INTERVAL = 0.025
raw_samples = 6
filter_alpha = 0.30
trigger_deadband = 0.015
trigger_confirm = 3


KEYCODES = {}
if HID_OK:
    KEYCODES = {
        "A": Keycode.A,
        "B": Keycode.B,
        "C": Keycode.C,
        "D": Keycode.D,
        "E": Keycode.E,
        "F": Keycode.F,
        "G": Keycode.G,
        "H": Keycode.H,
        "I": Keycode.I,
        "J": Keycode.J,
        "K": Keycode.K,
        "L": Keycode.L,
        "M": Keycode.M,
        "N": Keycode.N,
        "O": Keycode.O,
        "P": Keycode.P,
        "Q": Keycode.Q,
        "R": Keycode.R,
        "S": Keycode.S,
        "T": Keycode.T,
        "U": Keycode.U,
        "V": Keycode.V,
        "W": Keycode.W,
        "X": Keycode.X,
        "Y": Keycode.Y,
        "Z": Keycode.Z,
        "1": Keycode.ONE,
        "2": Keycode.TWO,
        "3": Keycode.THREE,
        "4": Keycode.FOUR,
        "5": Keycode.FIVE,
        "6": Keycode.SIX,
        "7": Keycode.SEVEN,
        "8": Keycode.EIGHT,
        "9": Keycode.NINE,
        "0": Keycode.ZERO,
        "SPACE": Keycode.SPACE,
        "ENTER": Keycode.ENTER,
        "ESCAPE": Keycode.ESCAPE,
        "TAB": Keycode.TAB,
        "LEFT": Keycode.LEFT_ARROW,
        "RIGHT": Keycode.RIGHT_ARROW,
        "UP": Keycode.UP_ARROW,
        "DOWN": Keycode.DOWN_ARROW,
    }


class HallKey:
    def __init__(self, pin, default_key):
        self.adc = analogio.AnalogIn(pin)
        self.min_value = None
        self.max_value = None
        self.actuation = 0.45
        self.rapid_trigger = 0.08
        self.key_name = default_key
        self.keycode = None
        self.position = 0.0
        self.filtered_raw = None
        self.last_position = 0.0
        self.peak_position = 0.0
        self.trough_position = 0.0
        self.press_count = 0
        self.release_count = 0
        self.pressed = False
        self.apply_key(default_key)

    def ready(self):
        return (
            self.min_value is not None
            and self.max_value is not None
            and self.max_value > self.min_value
            and self.key_name != "NONE"
            and self.keycode is not None
        )

    def read_raw(self):
        total = 0
        self.adc.value
        for _ in range(raw_samples):
            total += self.adc.value
        return total / raw_samples

    def update_filter(self, raw):
        if self.filtered_raw is None:
            self.filtered_raw = raw
        else:
            self.filtered_raw += (raw - self.filtered_raw) * filter_alpha
        return self.filtered_raw

    def set_min(self, value):
        self.min_value = int(value)

    def set_max(self, value):
        self.max_value = int(value)

    def set_actuation(self, value):
        self.actuation = clamp(float(value), 0.05, 0.95)

    def set_rapid_trigger(self, value):
        self.rapid_trigger = clamp(float(value), 0.01, 0.50)

    def apply_key(self, key_name):
        key_name = str(key_name).upper()
        self.key_name = key_name
        self.keycode = KEYCODES.get(key_name)

    def update_position(self, raw):
        if self.min_value is None or self.max_value is None or self.max_value <= self.min_value:
            self.position = 0.0
        else:
            span = self.max_value - self.min_value
            self.position = clamp((self.max_value - raw) / span, 0.0, 1.0)

    def update_pressed(self):
        if not self.ready():
            self.pressed = False
            self.peak_position = self.position
            self.trough_position = self.position
            self.press_count = 0
            self.release_count = 0
            return

        if self.pressed:
            if self.position > self.peak_position + trigger_deadband:
                self.peak_position = self.position
            if self.position <= self.peak_position - max(self.rapid_trigger, trigger_deadband):
                self.release_count += 1
            else:
                self.release_count = 0
            if self.release_count >= trigger_confirm:
                self.pressed = False
                self.trough_position = self.position
                self.press_count = 0
                self.release_count = 0
        else:
            if self.position < self.trough_position - trigger_deadband:
                self.trough_position = self.position
            press_line = max(self.actuation, self.trough_position + self.rapid_trigger)
            if self.position >= press_line:
                self.press_count += 1
            else:
                self.press_count = 0
            if self.press_count >= trigger_confirm:
                self.pressed = True
                self.peak_position = self.position
                self.press_count = 0
                self.release_count = 0

    def release_if_needed(self):
        if self.pressed and self.keycode is not None and keyboard is not None:
            keyboard.release(self.keycode)
        self.pressed = False


def clamp(value, low, high):
    return max(low, min(high, value))


keys = [HallKey(board.A0, "Z"), HallKey(board.A1, "X")]
armed = False
last_send = 0.0
command_buffer = ""


def set_armed(value):
    global armed
    armed = bool(value)
    if not armed:
        for key in keys:
            key.release_if_needed()


def handle_command(line):
    parts = line.strip().split()
    if not parts:
        return

    command = parts[0].upper()
    try:
        if command == "ARM" and len(parts) >= 2:
            set_armed(parts[1] == "1")
            print("OK ARM", 1 if armed else 0)
        elif command == "SET" and len(parts) >= 3:
            apply_setting(parts[1], parts[2])
            print("OK SET", parts[1], parts[2])
        elif command == "PING":
            print("OK PONG")
        else:
            print("ERR unknown_command")
    except Exception as error:
        print("ERR", type(error).__name__)


def apply_setting(name, value):
    global filter_alpha, raw_samples, trigger_deadband, trigger_confirm
    name = name.lower()
    if name == "filter_alpha":
        filter_alpha = clamp(float(value), 0.05, 0.95)
        return
    if name == "filter_samples":
        raw_samples = int(clamp(int(float(value)), 1, 32))
        return
    if name == "trigger_deadband":
        trigger_deadband = clamp(float(value), 0.0, 0.20)
        return
    if name == "trigger_confirm":
        trigger_confirm = int(clamp(int(float(value)), 1, 10))
        return

    if not name.startswith("k") or "_" not in name:
        raise ValueError("bad_name")

    key_number = int(name[1]) - 1
    if key_number < 0 or key_number >= len(keys):
        raise ValueError("bad_key")

    field = name.split("_", 1)[1]
    key = keys[key_number]

    if field == "min":
        key.set_min(value)
    elif field == "max":
        key.set_max(value)
    elif field == "act":
        key.set_actuation(value)
    elif field == "rt":
        key.set_rapid_trigger(value)
    elif field == "key":
        key.apply_key(value)
    else:
        raise ValueError("bad_field")


def read_commands():
    global command_buffer
    while supervisor.runtime.serial_bytes_available:
        char = sys.stdin.read(1)
        if char == "\n":
            handle_command(command_buffer)
            command_buffer = ""
        elif char != "\r":
            command_buffer += char
            if len(command_buffer) > 96:
                command_buffer = ""


def update_keys():
    raw_values = []
    for key in keys:
        raw = key.read_raw()
        filtered_raw = key.update_filter(raw)
        raw_values.append(int(filtered_raw))
        key.update_position(filtered_raw)
        was_pressed = key.pressed
        key.update_pressed()

        if not armed or not key.ready() or not HID_OK:
            if was_pressed:
                key.release_if_needed()
            continue

        if key.pressed and not was_pressed:
            keyboard.press(key.keycode)
        elif was_pressed and not key.pressed:
            keyboard.release(key.keycode)

    return raw_values


def send_data(raw_values):
    print(
        "DATA",
        raw_values[0],
        raw_values[1],
        "{:.4f}".format(keys[0].position),
        "{:.4f}".format(keys[1].position),
        1 if keys[0].pressed else 0,
        1 if keys[1].pressed else 0,
        1 if armed else 0,
        1 if keys[0].ready() else 0,
        1 if keys[1].ready() else 0,
    )


print("WOOTER READY HID", 1 if HID_OK else 0)

while True:
    read_commands()
    raw_values = update_keys()

    now = time.monotonic()
    if now - last_send >= SEND_INTERVAL:
        send_data(raw_values)
        last_send = now

    time.sleep(0.002)
