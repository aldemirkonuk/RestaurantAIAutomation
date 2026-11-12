/**
 * `/register` reads the landing page to a stranger and the sign-up form to
 * anyone sent on to it: the landing's button, its invite-code line, and every
 * invite link.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { JOIN, START } from './Landing';
import { RegisterDoor, wantsForm } from './RegisterDoor';

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/register" element={<RegisterDoor landing={<p>landing</p>} form={<p>form</p>} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RegisterDoor', () => {
  it('shows the landing page at a bare /register', () => {
    at('/register');
    expect(screen.getByText('landing')).toBeTruthy();
  });

  it.each([START, JOIN, '/register?invite=ABCDEFGH', '/register?invite=ABCDEFGH#k=secret'])('opens the form at %s', (url) => {
    at(url);
    expect(screen.getByText('form')).toBeTruthy();
  });

  it('does not open the old chooser for a query it does not know', () => {
    at('/register?type=other');
    expect(screen.getByText('landing')).toBeTruthy();
    expect(wantsForm(new URLSearchParams('type=other&utm_source=mail'))).toBe(false);
  });

  it.each(['/register?invite=', '/register?invite', '/register?invite=&utm_source=mail'])(
    'shows the landing page for an invite with no code at %s',
    (url) => {
      at(url);
      expect(screen.getByText('landing')).toBeTruthy();
    },
  );

  it('names the form in the tab, and the landing again when the query drops', () => {
    render(
      <MemoryRouter initialEntries={[START]}>
        <Routes>
          <Route
            path="/register"
            element={<RegisterDoor landing={<p>landing</p>} form={<Link to="/register">back</Link>} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.title).toBe('Create an account · Mudavym');
    fireEvent.click(screen.getByText('back'));
    expect(screen.getByText('landing')).toBeTruthy();
    expect(document.title).toBe('Mudavym');
  });
});
