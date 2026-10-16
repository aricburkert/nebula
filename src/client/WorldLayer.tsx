import { Component, lazy, Suspense, type ReactNode } from "react";
import type { WorldProps } from "./three/World";
import { setSettings, useSettings } from "./settings";

const World = lazy(() => import("./three/World"));

/** The 3D scene behind the page, loaded after the page itself so the menus show up instantly. */
export function WorldLayer(props: Omit<WorldProps, "quality" | "autoCam" | "recenter">) {
  const s = useSettings();
  if (!s.gl) return <div className="world-fallback" />;
  return (
    <div className="world">
      <Guard>
        <Suspense fallback={<div className="world-loading" />}>
          <World {...props} quality={s.quality} autoCam={s.autoCam} recenter={s.recenter} />
        </Suspense>
      </Guard>
    </div>
  );
}

/** If WebGL dies (old GPU, lost context), drop to the flat board instead of a blank page. */
class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("3D board failed, using the flat board", e);
    setSettings({ gl: false });
  }
  render() {
    return this.state.failed ? <div className="world-fallback" /> : this.props.children;
  }
}
