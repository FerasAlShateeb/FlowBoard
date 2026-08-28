import { describe, expect, it } from 'vitest';

import { chordKeys, isApplePlatform } from '@/components/palette/chords';

/**
 * Key caps are the one place the cheat sheet can lie without anyone noticing:
 * every string here is what a user compares against their own keyboard.
 */

describe('isApplePlatform', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', true],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', true],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', true],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false],
    ['Mozilla/5.0 (X11; Linux x86_64)', false],
  ])('reads %s', (userAgent, expected) => {
    expect(isApplePlatform(userAgent)).toBe(expected);
  });
});

describe('chordKeys', () => {
  it('renders `mod` as the platform modifier', () => {
    expect(chordKeys('mod+k', false)).toEqual(['Ctrl', 'K']);
    expect(chordKeys('mod+k', true)).toEqual(['⌘', 'K']);
  });

  it('keeps Shift when the key is alphanumeric', () => {
    expect(chordKeys('mod+shift+j', false)).toEqual(['Ctrl', 'Shift', 'J']);
    expect(chordKeys('mod+shift+j', true)).toEqual(['⌘', '⇧', 'J']);
  });

  it('DROPS Shift when the key is already the shifted glyph', () => {
    // `shift+?` on a US layout is Shift+/ — the cap says `?` and nothing else.
    expect(chordKeys('shift+?', false)).toEqual(['?']);
    expect(chordKeys('shift+?', true)).toEqual(['?']);
  });

  it('renders a bare printable key as its uppercase cap', () => {
    expect(chordKeys('c', false)).toEqual(['C']);
  });

  it('gives named keys their printed or glyph form', () => {
    expect(chordKeys('escape', false)).toEqual(['Esc']);
    expect(chordKeys('enter', false)).toEqual(['↵']);
    expect(chordKeys('arrowleft', false)).toEqual(['←']);
    expect(chordKeys('alt+arrowright', false)).toEqual(['Alt', '→']);
  });

  it('normalises modifier ORDER, since the chord grammar does not care', () => {
    expect(chordKeys('shift+mod+j', false)).toEqual(chordKeys('mod+shift+j', false));
  });

  it('passes an unknown part through rather than dropping it', () => {
    expect(chordKeys('f2', false)).toEqual(['F2']);
  });
});
