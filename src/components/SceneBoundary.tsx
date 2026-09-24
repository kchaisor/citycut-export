import { Component, type ReactNode } from "react";

export class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="scene-fallback">
          The 3D view could not start in this browser. The drawing, the SVG download, and the Rhino
          download still work.
        </div>
      );
    }
    return this.props.children;
  }
}
