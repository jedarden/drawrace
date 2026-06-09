#!/usr/bin/env python3
"""
Generate placeholder audio files for DrawRace.

This creates minimal audio files that establish the file pattern and format.
The actual game sounds should be authored by a sound designer to match
the hand-drawn paper aesthetic described in plan §Graphics 14.

Audio files needed:
- engine_rumble.webm/.mp4 (looping, playback rate modulated)
- bounce.webm/.mp4 (collision thud)
- whoosh.webm/.mp4 (ink whoosh on wheel commit)
- finish_fanfare.webm/.mp4 (kazoo/ukulele register sting)
- countdown.webm/.mp4 (beeps + GO tone)
- ui_tap.webm/.mp4 (paper tick)
"""

import wave
import struct
import math
import os

SAMPLE_RATE = 44100

def generate_sine_wave(freq, duration, volume=0.3):
    """Generate a simple sine wave buffer."""
    num_samples = int(SAMPLE_RATE * duration)
    data = bytearray()
    for i in range(num_samples):
        t = i / SAMPLE_RATE
        # Apply a simple envelope to avoid clicks
        envelope = min(1.0, i / 100, (num_samples - i) / 100) if num_samples > 200 else 1.0
        sample = int(32767 * volume * envelope * math.sin(2 * math.pi * freq * t))
        data.extend(struct.pack('<h', sample))
    return data

def create_wav(filename, freq, duration, volume=0.3):
    """Create a minimal WAV file as a placeholder."""
    os.makedirs(os.path.dirname(filename) or '.', exist_ok=True)

    data = generate_sine_wave(freq, duration, volume)

    with wave.open(filename, 'w') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(data)

def main():
    base_dir = '/home/coding/drawrace/apps/web/public/assets/audio'

    # Engine rumble - low frequency hum (80 Hz baseline, 1.2 seconds)
    print(f'Creating {base_dir}/engine_rumble.wav...')
    create_wav(f'{base_dir}/engine_rumble.wav', freq=80, duration=1.2, volume=0.2)

    # Bounce/thud - low pitch thud (200 Hz, 0.1 seconds)
    print(f'Creating {base_dir}/bounce.wav...')
    create_wav(f'{base_dir}/bounce.wav', freq=200, duration=0.1, volume=0.25)

    # Whoosh - higher frequency sweep (800 Hz, 0.3 seconds)
    print(f'Creating {base_dir}/whoosh.wav...')
    create_wav(f'{base_dir}/whoosh.wav', freq=800, duration=0.3, volume=0.15)

    # Finish fanfare - simple chord (523 Hz, 0.8 seconds)
    print(f'Creating {base_dir}/finish_fanfare.wav...')
    create_wav(f'{base_dir}/finish_fanfare.wav', freq=523, duration=0.8, volume=0.2)

    # Countdown tick - mid beep (600 Hz, 0.15 seconds)
    print(f'Creating {base_dir}/countdown.wav...')
    create_wav(f'{base_dir}/countdown.wav', freq=600, duration=0.15, volume=0.3)

    # UI tap - high paper tick (1000 Hz, 0.04 seconds)
    print(f'Creating {base_dir}/ui_tap.wav...')
    create_wav(f'{base_dir}/ui_tap.wav', freq=1000, duration=0.04, volume=0.1)

    # Go tone (higher pitch for the GO signal)
    print(f'Creating {base_dir}/go.wav...')
    create_wav(f'{base_dir}/go.wav', freq=800, duration=0.2, volume=0.3)

    # Clear sound (similar to whoosh but shorter)
    print(f'Creating {base_dir}/clear.wav...')
    create_wav(f'{base_dir}/clear.wav', freq=1200, duration=0.08, volume=0.15)

    # DNF sound (descending tone)
    print(f'Creating {base_dir}/dnf.wav...')
    create_wav(f'{base_dir}/dnf.wav', freq=400, duration=0.3, volume=0.2)

    # Stroke closure sound
    print(f'Creating {base_dir}/stroke_closure.wav...')
    create_wav(f'{base_dir}/stroke_closure.wav', freq=1200, duration=0.08, volume=0.15)

    print('Placeholder WAV files created.')
    print('Note: These are minimal sine-wave placeholders.')
    print('Production sounds should be:')
    print('  - Opus-in-.webm primary, AAC-in-.mp4 fallback')
    print('  - Total ≤ 120KB across all sounds')
    print('  - Engine rumble ≤ 40KB, others ≤ 10KB each')
    print('  - Authored to match hand-drawn paper aesthetic')

if __name__ == '__main__':
    main()
