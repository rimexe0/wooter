import sys
import time

import analogio
import board
import json
import supervisor

try:
    import microcontroller

    config_nvm = microcontroller.nvm
    CONFIG_NVM_OK = config_nvm is not None and len(config_nvm) > 128
except Exception:
    config_nvm = None
    CONFIG_NVM_OK = False

try:
    import digitalio
    import neopixel_write

    status_pixel = digitalio.DigitalInOut(board.NEOPIXEL)
    status_pixel.direction = digitalio.Direction.OUTPUT
    STATUS_PIXEL_OK = True
except Exception:
    status_pixel = None
    STATUS_PIXEL_OK = False

try:
    arm_button = digitalio.DigitalInOut(board.BUTTON)
    arm_button.switch_to_input(pull=digitalio.Pull.UP)
    ARM_BUTTON_OK = True
except Exception:
    arm_button = None
    ARM_BUTTON_OK = False

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
LED_INTERVAL = 0.025
BUTTON_DEBOUNCE = 0.035
raw_samples = 6
filter_alpha = 0.30
trigger_deadband = 0.015
trigger_confirm = 3
led_enabled = True
led_brightness = 0.28
led_disarmed_brightness = 1.0
CONFIG_MAGIC = b"WOOTER2\n"


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
    def __init__(self, pin, default_key, led_red, led_green, led_blue):
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
        self.led_red = led_red
        self.led_green = led_green
        self.led_blue = led_blue
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


keys = [HallKey(board.A0, "Z", 0.0, 1.0, 0.0), HallKey(board.A1, "X", 0.0, 0.0, 1.0)]
armed = False
last_send = 0.0
last_led = 0.0
command_buffer = ""
button_raw_pressed = not arm_button.value if ARM_BUTTON_OK else False
button_pressed = button_raw_pressed
button_changed_at = 0.0


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
        elif command == "SAVE":
            save_config()
            print("OK SAVE")
        elif command == "CONFIG":
            print("CONFIG", json.dumps(config_dict()))
        elif command == "PING":
            print("OK PONG")
        else:
            print("ERR unknown_command")
    except Exception as error:
        print("ERR", type(error).__name__)


def apply_setting(name, value):
    global filter_alpha, raw_samples, trigger_deadband, trigger_confirm
    global led_enabled, led_brightness, led_disarmed_brightness
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
    if name == "led_enabled":
        led_enabled = str(value).strip() not in ("0", "false", "False", "off", "OFF")
        return
    if name == "led_brightness":
        led_brightness = clamp(float(value), 0.0, 1.0)
        return
    if name == "led_disarmed":
        led_disarmed_brightness = clamp(float(value), 0.0, 1.0)
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
    elif field == "led_r":
        key.led_red = clamp(float(value), 0.0, 1.0)
    elif field == "led_g":
        key.led_green = clamp(float(value), 0.0, 1.0)
    elif field == "led_b":
        key.led_blue = clamp(float(value), 0.0, 1.0)
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


def update_arm_button(now):
    global button_raw_pressed, button_pressed, button_changed_at
    if not ARM_BUTTON_OK:
        return

    raw_pressed = not arm_button.value
    if raw_pressed != button_raw_pressed:
        button_raw_pressed = raw_pressed
        button_changed_at = now
        return

    if now - button_changed_at < BUTTON_DEBOUNCE:
        return

    if raw_pressed == button_pressed:
        return

    button_pressed = raw_pressed
    if button_pressed:
        set_armed(not armed)
        print("OK BUTTON_ARM", 1 if armed else 0)


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


def write_status_pixel(red, green, blue):
    if not STATUS_PIXEL_OK:
        return
    red = int(clamp(red, 0, 255))
    green = int(clamp(green, 0, 255))
    blue = int(clamp(blue, 0, 255))
    neopixel_write.neopixel_write(status_pixel, bytes([green, red, blue]))


def update_status_pixel():
    if not led_enabled:
        write_status_pixel(0, 0, 0)
        return

    if not armed:
        write_status_pixel(255 * led_brightness * led_disarmed_brightness, 0, 0)
        return

    key1 = keys[0].position if keys[0].ready() else 0.0
    key2 = keys[1].position if keys[1].ready() else 0.0
    red = (key1 * keys[0].led_red) + (key2 * keys[1].led_red)
    green = (key1 * keys[0].led_green) + (key2 * keys[1].led_green)
    blue = (key1 * keys[0].led_blue) + (key2 * keys[1].led_blue)
    scale = 255 * led_brightness
    write_status_pixel(red * scale, green * scale, blue * scale)


def config_dict():
    return {
        "filter_alpha": filter_alpha,
        "filter_samples": raw_samples,
        "trigger_deadband": trigger_deadband,
        "trigger_confirm": trigger_confirm,
        "led_enabled": 1 if led_enabled else 0,
        "led_brightness": led_brightness,
        "led_disarmed": led_disarmed_brightness,
        "k1_min": keys[0].min_value,
        "k1_max": keys[0].max_value,
        "k1_act": keys[0].actuation,
        "k1_rt": keys[0].rapid_trigger,
        "k1_key": keys[0].key_name,
        "k1_led_r": keys[0].led_red,
        "k1_led_g": keys[0].led_green,
        "k1_led_b": keys[0].led_blue,
        "k2_min": keys[1].min_value,
        "k2_max": keys[1].max_value,
        "k2_act": keys[1].actuation,
        "k2_rt": keys[1].rapid_trigger,
        "k2_key": keys[1].key_name,
        "k2_led_r": keys[1].led_red,
        "k2_led_g": keys[1].led_green,
        "k2_led_b": keys[1].led_blue,
    }


def save_config():
    if not CONFIG_NVM_OK:
        raise RuntimeError("nvm_unavailable")

    payload = CONFIG_MAGIC + json.dumps(config_dict()).encode("utf-8")
    if len(payload) > len(config_nvm):
        raise RuntimeError("config_too_large")

    config_nvm[0 : len(config_nvm)] = b"\x00" * len(config_nvm)
    config_nvm[0 : len(payload)] = payload


def load_config():
    if not CONFIG_NVM_OK:
        return False

    raw = bytes(config_nvm[0 : len(config_nvm)]).split(b"\x00", 1)[0]
    if not raw.startswith(CONFIG_MAGIC):
        return False

    loaded = json.loads(raw[len(CONFIG_MAGIC) :].decode("utf-8"))
    for name, value in loaded.items():
        if value is not None:
            apply_setting(name, value)
    return True


config_loaded = False
try:
    config_loaded = load_config()
except Exception as error:
    print("ERR CONFIG_LOAD", type(error).__name__)


print(
    "WOOTER READY HID",
    1 if HID_OK else 0,
    "PIXEL",
    1 if STATUS_PIXEL_OK else 0,
    "BUTTON",
    1 if ARM_BUTTON_OK else 0,
    "NVM",
    1 if CONFIG_NVM_OK else 0,
    "CONFIG",
    1 if config_loaded else 0,
)

while True:
    read_commands()
    raw_values = update_keys()

    now = time.monotonic()
    update_arm_button(now)

    if now - last_led >= LED_INTERVAL:
        update_status_pixel()
        last_led = now

    if now - last_send >= SEND_INTERVAL:
        send_data(raw_values)
        last_send = now

    time.sleep(0.002)
