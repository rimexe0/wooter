# Wooter Hall Keypad

A small Web Serial configurator for a two-key Hall effect keypad built around an
RP2040 running CircuitPython and SS49E analog Hall sensors.

The project has two parts:

- `code.py` runs on CircuitPython and reads the two analog Hall sensors.
- The React app runs in the browser and configures the board over USB serial.

The keypad boots disarmed. It will not send keyboard input until you calibrate the
keys and explicitly arm it from the web UI.

## Features

- Live raw and position readout for both keys
- Per-key min/max calibration
- Per-key actuation point
- Rapid trigger
- Adjustable firmware-side filtering
- Import/export config as JSON
- Per-key keyboard output mapping
- HID output gated behind calibration and an explicit arm switch

## Hardware

Designed for:

- RP2040 board with CircuitPython
- Two ADC-capable pins
- Two SS49E linear analog Hall sensors

Wiring used during development:

| Sensor | Board pin |
| --- | --- |
| Key 1 OUT | `A0` / `GP26` |
| Key 2 OUT | `A1` / `GP27` |
| VDD | `3V3` |
| GND | `GND` |

Some RP2040 boards expose `VREF` separately. If ADC readings are stuck or noisy,
check that the board's ADC reference is connected as expected.

## Running the configurator

Install dependencies:

```sh
npm install
```

Start the dev server:

```sh
npm run dev
```

Open the local URL in Chrome, Edge, or another Chromium browser:

```txt
http://localhost:5173/
```

Do not use a `file://` URL. Web Serial needs a secure browser context. `localhost`
works for local development, and HTTPS works when hosted.

## Flashing the board

1. Install the CircuitPython build for your RP2040 board.
2. Copy `code.py` to the `CIRCUITPY` drive.
3. Make sure the `adafruit_hid` library is present in `CIRCUITPY/lib`.
4. Open the configurator, connect to the serial port, calibrate, then arm.

## Standalone use

After calibration, click `Save to Keypad` in the configurator. The keypad stores
the current config in CircuitPython NVM and loads it on boot.

The board's `USR` / `BUTTON` input toggles armed and disarmed, so normal use does
not require opening the web UI. Reset/BOOT hardware buttons are left alone.

## Useful tuning notes

If the raw values jump too much, start with:

| Setting | Value |
| --- | --- |
| Filter response | `0.20` |
| ADC samples | `10` |
| Trigger deadband | `0.025` |
| Confirm frames | `4` |
| Rapid trigger distance | `0.10` |

Lower filter response is smoother. Higher filter response feels faster.

## Build

```sh
npm run typecheck
npm run build
```

The production build is written to `dist`.

## Browser support

The configurator uses Web Serial, so it works in Chromium-based browsers. Safari
and Firefox do not support Web Serial.

If deployed to Vercel or another static host, the app should still work because
HTTPS is a secure context. The Pico must still be plugged into the same computer
running the browser.
