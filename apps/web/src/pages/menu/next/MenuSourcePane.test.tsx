import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuSourcePane, SOURCE_PANE_HEIGHT } from './MenuSourcePane';
import { getMenuSourceUrl } from '../../../services/api/menus';

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, getMenuSourceUrl: vi.fn() };
});
const mockUrl = vi.mocked(getMenuSourceUrl);

function Harness({ mime, canManage = true }: { mime: string | null; canManage?: boolean }) {
  const [open, setOpen] = useState(false);
  return <MenuSourcePane menuId="m-1" mime={mime} open={open} onToggle={() => setOpen((o) => !o)} canManage={canManage} />;
}
function mount(mime: string | null, canManage = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness mime={mime} canManage={canManage} />
    </QueryClientProvider>,
  );
}

beforeEach(() => mockUrl.mockReset());

describe('MenuSourcePane -- the kept menu beside the lines (r107 menu-8)', () => {
  it('asks for no link until it is opened, then shows a photo as a photo', async () => {
    mockUrl.mockResolvedValue({ url: 'https://files.example/m-1.jpg', expiresInSeconds: 60, mime: 'image/jpeg' });
    mount('image/jpeg');
    expect(mockUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show the kept menu with the lines' }));
    const img = await screen.findByAltText('The kept menu, as it was read');
    expect(img).toHaveAttribute('src', 'https://files.example/m-1.jpg');
    expect(mockUrl).toHaveBeenCalledWith('m-1');
  });

  it('holds the room before the link comes back, and shows a PDF in a frame', async () => {
    let resolve: (v: { url: string; expiresInSeconds: number; mime: string | null }) => void = () => {};
    mockUrl.mockReturnValue(new Promise((r) => (resolve = r)));
    mount('application/pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Show the kept menu with the lines' }));
    const region = screen.getByRole('region', { name: 'The kept menu' });
    expect(region.style.minHeight).toBe(`${SOURCE_PANE_HEIGHT}px`);
    expect(region).toHaveTextContent('Getting the kept menu…');
    resolve({ url: 'https://files.example/m-1.pdf', expiresInSeconds: 60, mime: 'application/pdf' });
    expect(await screen.findByTitle('The kept menu, as it was read')).toHaveAttribute('src', 'https://files.example/m-1.pdf');
  });

  it('says a sheet cannot be shown, in words, instead of an empty frame', async () => {
    mockUrl.mockResolvedValue({ url: 'https://files.example/m-1.csv', expiresInSeconds: 60, mime: 'text/csv' });
    mount('text/csv');
    fireEvent.click(screen.getByRole('button', { name: 'Show the kept menu with the lines' }));
    expect(await screen.findByTestId('menu-source-unshown')).toHaveTextContent('a sheet cannot be shown here');
  });

  it('says why when the link could not be had, and asks again on a click', async () => {
    mockUrl.mockRejectedValueOnce({ response: { data: { message: 'The file is not there.' } } });
    mockUrl.mockResolvedValue({ url: 'https://files.example/m-1.jpg', expiresInSeconds: 60, mime: 'image/jpeg' });
    mount('image/jpeg');
    fireEvent.click(screen.getByRole('button', { name: 'Show the kept menu with the lines' }));
    expect(await screen.findByTestId('menu-source-error')).toHaveTextContent('The file is not there.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByAltText('The kept menu, as it was read')).toBeInTheDocument();
  });

  it('leaves at once, with no exit animation, when hidden', async () => {
    mockUrl.mockResolvedValue({ url: 'https://files.example/m-1.jpg', expiresInSeconds: 60, mime: 'image/jpeg' });
    mount('image/jpeg');
    fireEvent.click(screen.getByRole('button', { name: 'Show the kept menu with the lines' }));
    await screen.findByAltText('The kept menu, as it was read');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the kept menu' }));
    expect(screen.queryByRole('region', { name: 'The kept menu' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show the kept menu with the lines' })).toHaveAttribute('aria-expanded', 'false'));
  });

  it('offers staff nothing, and asks for no link: it is an owner\'s or a manager\'s', () => {
    mount('image/jpeg', false);
    expect(screen.queryByTestId('menu-source-pane')).not.toBeInTheDocument();
    expect(mockUrl).not.toHaveBeenCalled();
  });
});

// r110 review R6: a page jump reloads the frame on the cached signed link, which lasts 300 s.
describe('MenuSourcePane -- a page jump on an old link (r110 review R6)', () => {
  function Paged() {
    const [page, setPage] = useState<number | null>(1);
    return (
      <>
        <button type="button" onClick={() => setPage(3)}>go to 3</button>
        <MenuSourcePane menuId="m-1" mime="application/pdf" open onToggle={() => {}} canManage page={page} />
      </>
    );
  }
  const mountPaged = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Paged />
      </QueryClientProvider>,
    );

  it('asks for a fresh link before a jump once the old one is past 240 s, and the frame uses the fresh one', async () => {
    mockUrl.mockResolvedValueOnce({ url: 'https://files.example/m-1.pdf?sig=old', expiresInSeconds: 300, mime: 'application/pdf' });
    mockUrl.mockResolvedValue({ url: 'https://files.example/m-1.pdf?sig=new', expiresInSeconds: 300, mime: 'application/pdf' });
    const realNow = Date.now.bind(Date);
    mountPaged();
    expect(await screen.findByTitle('The kept menu, as it was read')).toHaveAttribute('src', 'https://files.example/m-1.pdf?sig=old#page=1');
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 301_000);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'go to 3' }));
      await waitFor(() =>
        expect(screen.getByTitle('The kept menu, as it was read')).toHaveAttribute('src', 'https://files.example/m-1.pdf?sig=new#page=3'),
      );
      expect(mockUrl).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('jumps at once, with no second link, while the link is young', async () => {
    mockUrl.mockResolvedValue({ url: 'https://files.example/m-1.pdf?sig=old', expiresInSeconds: 300, mime: 'application/pdf' });
    mountPaged();
    await screen.findByTitle('The kept menu, as it was read');
    fireEvent.click(screen.getByRole('button', { name: 'go to 3' }));
    await waitFor(() => expect(screen.getByTitle('The kept menu, as it was read')).toHaveAttribute('src', 'https://files.example/m-1.pdf?sig=old#page=3'));
    expect(mockUrl).toHaveBeenCalledTimes(1);
  });
});
