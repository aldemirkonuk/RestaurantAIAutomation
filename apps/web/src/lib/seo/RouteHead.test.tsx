import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RouteHead, useDocumentTitle } from './RouteHead';

function Header({ name }: { name: string }) {
  useDocumentTitle(name);
  return null;
}

describe('RouteHead', () => {
  it('uses the registry title on a public page', () => {
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <RouteHead />
      </MemoryRouter>,
    );
    expect(document.title).toBe('Privacy & data · Mudavym');
  });

  it('falls back to the site name, and a page name below it wins', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/inventory']}>
        <RouteHead />
      </MemoryRouter>,
    );
    expect(document.title).toBe('Mudavym');
    unmount();
    render(
      <MemoryRouter initialEntries={['/inventory']}>
        <RouteHead />
        <Header name="Inventory" />
      </MemoryRouter>,
    );
    expect(document.title).toBe('Inventory · Mudavym');
  });
});
