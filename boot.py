import storage


# Product mode: hide CIRCUITPY so macOS does not warn when the keypad is unplugged.
# Serial, Web Serial, and HID remain available.
storage.disable_usb_drive()
