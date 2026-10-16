import type { GameView } from "../engine/game";
import { STANDARD_LAYOUT } from "./boardLayout";
import { cardTitle } from "./cards";

interface Props {
  game: GameView;
  /** When set, these spaces glow and can be clicked. */
  pickable?: string[];
  onPick?: (space: string) => void;
}

const L = STANDARD_LAYOUT;
const pct = (x: number, y: number) => ({ left: `${(x / L.width) * 100}%`, top: `${(y / L.height) * 100}%` });

export function Board({ game, pickable, onPick }: Props) {
  // Group pawns by spot so several on one space fan out.
  const groups = new Map<string, GameView["players"]>();
  for (const p of game.players) {
    const key = p.pos.kind === "space" ? p.pos.id : p.pos.kind;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return (
    <div className="board" style={{ aspectRatio: `${L.width} / ${L.height}` }}>
      <img className="board-img" src="/assets/board/standard.svg" alt="The Nebula from Hell game board" />
      {game.traps.map((t) => {
        const [x, y] = L.spots[t.space];
        return (
          <div key={`${t.space}-${t.card}`} className="trap" style={pct(x, y - 120)} title={`${cardTitle(t.card)} (trap)`}>
            ⚠️
          </div>
        );
      })}
      {pickable?.map((s) => {
        const [x, y] = L.spots[s];
        return (
          <button key={s} className="spot-pick" style={pct(x, y)} onClick={() => onPick?.(s)} aria-label={`Pick space ${s}`} />
        );
      })}
      {[...groups].map(([key, ps]) =>
        ps.map((p, i) => {
          const [x, y] = L.spots[key] ?? L.spots.start;
          const spread = 120;
          const dx = (i - (ps.length - 1) / 2) * spread;
          const isCurrent = game.current === p.id && game.phase === "playing";
          return (
            <div
              key={p.id}
              className={`pawn ${isCurrent ? "current" : ""} ${p.pos.kind === "nebula" ? "spinning" : ""}`}
              style={pct(x + dx, y - 60)}
              title={p.name}
            >
              <img src={`/assets/pawns/${p.pawn}.png`} alt={p.name} />
            </div>
          );
        }),
      )}
    </div>
  );
}
