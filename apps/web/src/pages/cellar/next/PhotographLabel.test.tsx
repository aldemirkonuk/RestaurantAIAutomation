/**
 * PhotographLabel — the label reader's confirm step (ADR 0160 sec110 item 5).
 *
 * Pins the sketch 110 direction A contract this component owes:
 *  - each field carries a WORD and a percentage (sure / fairly sure / unsure),
 *    or "not scored" when the reader carries no confidence for it at all —
 *    never drawn as if certain just because it has no score;
 *  - a field is editable, and once taken (accepted or typed) reads in full
 *    ink rather than the one uniform unconfirmed tone every other reading
 *    shares regardless of its own confidence;
 *  - a label with no readable producer can still be confirmed once the
 *    person types one in ("Fix a field"), never only by retaking the photo;
 *  - "Not this bottle" resets to the camera step without submitting anything;
 *  - the confirm/read-error/submit-error paths.
 *
 * The camera step (fixed 2026-09-19, cellar confirmer MAJOR) is two buttons
 * over native file inputs, not `components/scanner/CameraCapture.tsx` — see
 * that fix's note on `PhotographLabel.tsx`. These tests drive it the way a
 * browser does: `fireEvent.change` on the hidden input with a real `File`
 * (jsdom's own `FileReader` reads it for real; only the network calls below
 * are mocked).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PhotographLabel from './PhotographLabel';
import { scanWineLabel } from '../../../services/wineDetection';
import { submitWine } from '../../../services/api/wines';
import type { DetectedWine } from '../../../services/wineDetection';

vi.mock('../../../services/wineDetection', async () => {
  const actual = await vi.importActual<typeof import('../../../services/wineDetection')>(
    '../../../services/wineDetection',
  );
  return { ...actual, scanWineLabel: vi.fn() };
});

vi.mock('../../../services/api/wines', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/wines')>(
    '../../../services/api/wines',
  );
  return { ...actual, submitWine: vi.fn() };
});

const mockScan = vi.mocked(scanWineLabel);
const mockSubmit = vi.mocked(submitWine);

beforeEach(() => {
  mockScan.mockReset();
  mockSubmit.mockReset();
});

function wine(over: Partial<DetectedWine> = {}): DetectedWine {
  return {
    id: 'w1',
    name: 'Öküzgözü',
    producer: 'Kavaklıdere',
    vintage: 2022,
    country: 'Türkiye',
    region: 'Elazığ',
    grapeVariety: 'Öküzgözü',
    wineType: 'red',
    confidence: 0.9,
    fieldConfidences: {
      wine_name: 0.96,
      producer: 0.97,
      vintage: 0.61,
      grape_variety: 0.82,
      // region / country deliberately absent — "not scored".
    },
    inMasterLibrary: false,
    source: 'label_scan',
    ...over,
  };
}

function mount() {
  const qc = new QueryClient();
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <PhotographLabel open onClose={onClose} restaurantId="r1" />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

/** A real (tiny) File — jsdom's own FileReader reads it, no mock involved. */
function labelPhoto(): File {
  return new File(['fake-image-bytes'], 'label.jpg', { type: 'image/jpeg' });
}

/** Fires the camera-step capture the way a browser does: click "Take the
 * photo", then the hidden input reports a chosen file. Test code sets
 * `.files` directly (as RTL's own file-input pattern does) rather than
 * actually driving the OS picker `.click()` opens — jsdom has no picker. */
async function fireCapture() {
  fireEvent.click(await screen.findByTestId('label-take-photo'));
  const input = screen.getByTestId('label-camera-input') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [labelPhoto()] } });
}

async function capture() {
  await fireCapture();
  await screen.findByTestId('label-confirm');
}

describe('PhotographLabel — the camera step (fixed 2026-09-19, cellar confirmer MAJOR)', () => {
  it('draws sketch 110A\'s own copy, never the legacy CameraCapture chrome it used to embed', async () => {
    mount();
    expect(await screen.findByText(/Hold the bottle so the label fills the frame/)).toBeInTheDocument();
    expect(screen.getByTestId('label-take-photo')).toHaveTextContent('Take the photo');
    expect(screen.getByTestId('label-choose-photo')).toHaveTextContent('Choose a photo instead');
    // The legacy component's own strings must never appear on this panel.
    expect(screen.queryByText('Scan Wine Menu')).not.toBeInTheDocument();
    expect(screen.queryByText('Open Camera')).not.toBeInTheDocument();
    expect(screen.queryByText('AI Detection Pipeline')).not.toBeInTheDocument();
  });

  it('"Choose a photo instead" reaches the same confirm step as "Take the photo"', async () => {
    mockScan.mockResolvedValue(wine());
    mount();
    fireEvent.click(await screen.findByTestId('label-choose-photo'));
    const input = screen.getByTestId('label-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [labelPhoto()] } });
    await screen.findByTestId('label-confirm');
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it('closes from the camera step without reading or writing anything ("Close" — "Not now" is the confirm step\'s own label)', async () => {
    const { onClose } = mount();
    await screen.findByTestId('label-take-photo');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });
});

describe('PhotographLabel — per-field confidence', () => {
  it('shows a word and a percentage for a scored field, from the READER\'s own snake_case keys', async () => {
    mockScan.mockResolvedValue(wine());
    mount();
    await capture();
    expect(screen.getByTestId('label-field-wine_name')).toBeInTheDocument();
    expect(screen.getByText('sure · 96%')).toBeInTheDocument();
    expect(screen.getByText('sure · 97%')).toBeInTheDocument();
    expect(screen.getByText('unsure · 61%')).toBeInTheDocument();
    expect(screen.getByText('fairly sure · 82%')).toBeInTheDocument();
  });

  it('says "not scored" for a field the reader carries no confidence for — never drawn as certain', async () => {
    mockScan.mockResolvedValue(wine());
    mount();
    await capture();
    // Region and country both carry no confidence in this fixture.
    const notScored = screen.getAllByText('not scored');
    expect(notScored.length).toBeGreaterThanOrEqual(2);
  });
});

describe('PhotographLabel — editable fields', () => {
  it('a field reads in the unconfirmed tone until it is taken, then turns to full ink', async () => {
    mockScan.mockResolvedValue(wine());
    mount();
    await capture();
    const nameBtn = screen.getByTestId('label-field-wine_name');
    expect(nameBtn).toHaveStyle({ color: 'var(--ink-2)' });
    fireEvent.click(nameBtn);
    const input = screen.getByTestId('label-field-edit-wine_name');
    fireEvent.change(input, { target: { value: 'Öküzgözü' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const takenBtn = screen.getByTestId('label-field-wine_name');
    expect(takenBtn).toHaveStyle({ color: 'var(--ink-1)' });
  });

  it('lets a missing producer be typed in, and enables the confirm button once it is', async () => {
    mockScan.mockResolvedValue(wine({ producer: undefined }));
    mount();
    await capture();
    expect(screen.getByTestId('label-no-producer')).toBeInTheDocument();
    expect(screen.getByTestId('label-confirm-yes')).toBeDisabled();

    fireEvent.click(screen.getByTestId('label-field-producer'));
    const input = screen.getByTestId('label-field-edit-producer');
    fireEvent.change(input, { target: { value: 'Kavaklıdere' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.queryByTestId('label-no-producer')).not.toBeInTheDocument();
    expect(screen.getByTestId('label-confirm-yes')).not.toBeDisabled();

    mockSubmit.mockResolvedValue({ id: 's1', status: 'flagged' });
    fireEvent.click(screen.getByTestId('label-confirm-yes'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ producer: 'Kavaklıdere' })));
  });

  it('Escape while editing closes the whole panel, per the house Esc-always-closes rule — never a competing local cancel', async () => {
    // Sheet.tsx: "Esc closes, from anywhere ... an overlay whose Esc only
    // works while focus is inside is an overlay you can get stuck behind."
    // A field-local Escape handler would be exactly that trap, so this
    // fixer deliberately does NOT swallow it — the field's own input has no
    // keydown handling for Escape at all, and the window-level close listener
    // is left free to fire.
    mockScan.mockResolvedValue(wine());
    const { onClose } = mount();
    await capture();
    fireEvent.click(screen.getByTestId('label-field-wine_name'));
    const input = screen.getByTestId('label-field-edit-wine_name');
    fireEvent.change(input, { target: { value: 'Something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

describe('PhotographLabel — Not this bottle, and the error paths', () => {
  it('"Not this bottle" resets to the camera step and submits nothing', async () => {
    mockScan.mockResolvedValue(wine());
    mount();
    await capture();
    fireEvent.click(screen.getByTestId('label-confirm-not-this'));
    await screen.findByTestId('label-take-photo');
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('a failed read shows the reader\'s own message, not a generic one', async () => {
    mockScan.mockRejectedValue(new Error('No wines detected in image'));
    mount();
    await fireCapture();
    const err = await screen.findByTestId('label-read-error');
    expect(err).toHaveTextContent('No wines detected in image');
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('a failed submit says so and lets the person try again without losing the reading', async () => {
    mockScan.mockResolvedValue(wine());
    mockSubmit.mockRejectedValue(new Error('the gateway refused it'));
    mount();
    await capture();
    fireEvent.click(screen.getByTestId('label-confirm-yes'));
    const err = await screen.findByTestId('label-submit-error');
    expect(err).toHaveTextContent('the gateway refused it');
  });
});
