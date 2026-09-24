import { Mark } from "./Mark";

export function TopBar({
  showNewCut,
  onHome,
  onNewCut,
  onFaq,
}: {
  showNewCut: boolean;
  onHome: () => void;
  onNewCut: () => void;
  onFaq: () => void;
}) {
  return (
    <header className="topbar">
      <button className="brand" type="button" onClick={onHome}>
        <Mark />
        <span>CityCut</span>
      </button>
      <nav className="top-actions">
        {showNewCut && (
          <button className="text-btn" type="button" onClick={onNewCut}>
            New cut
          </button>
        )}
        <button className="text-btn" type="button" onClick={onFaq}>
          FAQ
        </button>
      </nav>
    </header>
  );
}
