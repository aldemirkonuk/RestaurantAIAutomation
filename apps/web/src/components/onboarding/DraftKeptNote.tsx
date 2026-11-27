/**
 * One line above the first field when a typed draft was restored (r108 g16):
 * a restore used to be silent, so a person who did not type it could not tell
 * why the fields were full or how to empty them. Rendered only after a real
 * restore; present at the first paint, so it has no motion in either mode.
 */
export function DraftKeptNote({ onStartOver }: { onStartOver: () => void }) {
  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600"
      data-testid="draft-kept-note"
    >
      <p>We kept what you typed.</p>
      <button
        type="button"
        onClick={onStartOver}
        className="min-h-11 px-3 underline underline-offset-4"
      >
        Start over
      </button>
    </div>
  )
}
