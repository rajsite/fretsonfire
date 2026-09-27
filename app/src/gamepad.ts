// Gamepad normalization: known guitars are presented to the game in one layout, and DirectInput POV hats
// that Chrome exposes as a single axis are decoded back into hats.

// Layout the game binds by default (see Player.Controls): frets on buttons 0-4, select 8, start 9, hat 0 = strum.
export const GUITAR_FRETS = 5;
export const GUITAR_SELECT = 8;
export const GUITAR_START = 9;
const GUITAR_BUTTONS = 10;

export interface PadInput {
  id: string;
  mapping: string;
  buttons: readonly { pressed: boolean }[];
  axes: readonly number[];
}

export interface NormalizedPad {
  profile: string | null;
  buttons: boolean[];
  axes: number[];
  hats: [number, number][];
}

// POV hat encoded as one axis: -1 + 2k/7 for the 8 directions clockwise from up, and 9/7 when centered.
// Returns (x, y) with y = 1 for up, like SDL/pygame hats.
export function decodePov(value: number): [number, number] {
  if (!(value >= -1.01 && value <= 1.01)) return [0, 0];
  const k = Math.round((value + 1) * 3.5);
  const dirs: [number, number][] = [
    [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1],
  ];
  return dirs[k] ?? [0, 0];
}

// Axes outside -1..1 can only be POV hats (their centered value is 9/7).
export function isPovValue(value: number): boolean {
  return value > 1.01;
}

function guitar(frets: boolean[], select: boolean, start: boolean): boolean[] {
  const buttons = new Array<boolean>(GUITAR_BUTTONS).fill(false);
  frets.forEach((f, i) => (buttons[i] = f));
  buttons[GUITAR_SELECT] = select;
  buttons[GUITAR_START] = start;
  return buttons;
}

interface Profile {
  name: string;
  matches(pad: PadInput): boolean;
  normalize(pad: PadInput): NormalizedPad;
}

const pressed = (pad: PadInput, i: number) => !!pad.buttons[i]?.pressed;

const isRockBandPs3 = (pad: PadInput) => /12ba\D{0,12}0200/i.test(pad.id);

const PROFILES: Profile[] = [
  {
    // Rock Band guitar for PS3 in Chrome on Android: frets G Y B O on buttons 1 2 0 3, solo frets add button 4,
    // select 6, start 7, strum on the d-pad. Android reports red as BUTTON_C, which Chrome drops, so only the
    // lower red fret registers, as the solo modifier with no other fret held.
    name: 'Harmonix Guitar (PS3, Android)',
    matches: (pad) => isRockBandPs3(pad) && pad.axes.length < 10 && pad.buttons.length > 15,
    normalize(pad) {
      const [green, yellow, blue, orange] = [1, 2, 0, 3].map((b) => pressed(pad, b));
      const red = pressed(pad, 4) && !(green || yellow || blue || orange);
      const x = (pressed(pad, 15) ? 1 : 0) - (pressed(pad, 14) ? 1 : 0);
      const y = (pressed(pad, 12) ? 1 : 0) - (pressed(pad, 13) ? 1 : 0);
      return {
        profile: this.name,
        buttons: guitar([green, red, yellow, blue, orange], pressed(pad, 6), pressed(pad, 7)),
        axes: [],
        hats: [[x, y]],
      };
    },
  },
  {
    // Rock Band guitar for PS3: frets G R Y B O on buttons 1 2 3 0 4, solo frets add button 6, strum on the POV (axis 9).
    name: 'Harmonix Guitar (PS3)',
    matches: isRockBandPs3,
    normalize(pad) {
      return {
        profile: this.name,
        buttons: guitar([1, 2, 3, 0, 4].map((b) => pressed(pad, b)), pressed(pad, 8), pressed(pad, 9)),
        axes: [],
        hats: [pad.axes.length > 9 ? decodePov(pad.axes[9]) : [0, 0]],
      };
    },
  },
  {
    // Standard mapping, e.g. Xbox 360 guitars: frets on A B Y X LB, strum on the d-pad, Back/Start.
    name: 'Standard gamepad',
    matches: (pad) => pad.mapping === 'standard',
    normalize(pad) {
      const x = (pressed(pad, 15) ? 1 : 0) - (pressed(pad, 14) ? 1 : 0);
      const y = (pressed(pad, 12) ? 1 : 0) - (pressed(pad, 13) ? 1 : 0);
      return {
        profile: this.name,
        buttons: guitar([0, 1, 3, 2, 4].map((b) => pressed(pad, b)), pressed(pad, 8), pressed(pad, 9)),
        axes: [],
        hats: [[x, y]],
      };
    },
  },
];

export function profileFor(pad: PadInput): string | null {
  return PROFILES.find((p) => p.matches(pad))?.name ?? null;
}

// povAxes accumulates axes seen holding POV values, since a pressed POV looks like a normal axis value.
export function normalizePad(pad: PadInput, povAxes: Set<number>): NormalizedPad {
  const profile = PROFILES.find((p) => p.matches(pad));
  if (profile) return profile.normalize(pad);
  pad.axes.forEach((v, i) => {
    if (isPovValue(v)) povAxes.add(i);
  });
  return {
    profile: null,
    buttons: pad.buttons.map((b) => b.pressed),
    axes: pad.axes.map((v, i) => (povAxes.has(i) ? 0 : v)),
    hats: [...povAxes].sort((a, b) => a - b).map((i) => decodePov(pad.axes[i])),
  };
}

export function describePad(pad: PadInput): string {
  const profile = profileFor(pad);
  if (profile && profile !== 'Standard gamepad') return profile;
  return pad.id.replace(/\s*\(.*\)\s*$/, '') || 'Gamepad';
}
