import cardsData from "../../data/cards.json";
import spinner from "../../data/spinner-standard.json";

export interface CardText {
  id: number;
  deck: "A" | "B";
  title: string | null;
  sections: string[];
}

const CARDS = (cardsData as { cards: CardText[] }).cards;
export const CARD_TEXT = new Map(CARDS.map((c) => [c.id, c]));

export { cardName as cardTitle } from "../engine/game";

export function cardAlt(id: number): string {
  const c = CARD_TEXT.get(id);
  if (!c) return "";
  return [c.title, ...c.sections].filter(Boolean).join(" ");
}

export const cardSrc = (id: number) => `/assets/cards/${id}.svg`;
/** A 640 px WebP of the card (scripts/card-images.mjs): much cheaper to show than the SVG, sharp enough below full size. */
export const cardImage = (id: number) => `/assets/cards/webp/${id}.webp`;

export const SPINNER = spinner.segments as { action: string; text: string; color: string | string[] }[];

/** Bonus cards that do their thing automatically or from a button elsewhere, with a hint shown in the hand. */
export const PASSIVE_HINT: Record<number, string> = {
  85: "Offered when something hits you.",
  92: "Offered when a card hits you.",
  95: "Offered when someone collects a Bonus card.",
  99: 'Press "Gotcha" on a chat message saying "my turn" or "your turn".',
  100: "Offered if you lose at the Canoe.",
  101: "Offered at the start of your turn in the Nebula.",
  102: "Offered when you fight the Dragon.",
  107: "Offered when another player's card hits you.",
};
