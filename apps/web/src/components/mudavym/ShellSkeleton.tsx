/**
 * The shell's first paint (r58 N-02): the sidebar and the title bar as quiet
 * paper blocks, so a cold load shows the house's frame instead of a bare
 * cream screen. Purely visual and aria-hidden; the one spoken line is the
 * loader's own live region. The same markup is mirrored, as static HTML, in
 * index.html so the frame is on screen before any script runs.
 */
import './shell-motion.css';
import './house-page-loader.css';

export function ShellSkeleton() {
  return (
    <div className="mdv-shellskel" aria-hidden="true" data-testid="shell-skeleton">
      <div className="mdv-shellskel__side">
        <div className="mdv-skel__line mdv-skel__line--mid" />
        <div className="mdv-skel__line mdv-skel__line--wide" />
        <div className="mdv-skel__line mdv-skel__line--wide" />
        <div className="mdv-skel__line mdv-skel__line--wide" />
        <div className="mdv-skel__line mdv-skel__line--narrow" />
      </div>
      <div className="mdv-shellskel__main">
        <div className="mdv-skel__line mdv-shellskel__title" />
        <div className="mdv-skel__block" />
        <div className="mdv-skel__line mdv-skel__line--mid" />
        <div className="mdv-skel__line mdv-skel__line--narrow" />
      </div>
    </div>
  );
}
