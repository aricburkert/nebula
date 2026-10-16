import { Component, lazy, Suspense, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import type { WorldProps } from "./three/World";
import { setSettings, useSettings } from "./settings";

const World = lazy(() => import("./three/World"));

type ScreenWorld = Omit<WorldProps, "quality" | "autoCam" | "recenter">;

// One canvas for the whole app: screens say what it should show, and the scene, its shaders and its
// textures survive going from the home page to the lobby to the game.
let current: ScreenWorld = { mode: "attract", pawns: [] };
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));

/** Placed in a screen to set what the shared 3D scene behind it shows. Renders nothing itself. */
export function WorldLayer(props: ScreenWorld) {
  useLayoutEffect(() => {
    current = props;
    for (const fn of listeners) fn();
  });
  return null;
}

/** The 3D scene behind every page, loaded after the page itself so the menus show up instantly. */
export function WorldHost() {
  const s = useSettings();
  const props = useSyncExternalStore(subscribe, () => current);
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
