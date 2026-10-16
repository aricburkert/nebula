# The Nebula from Hell: rules spec for the online version

This is the rulebook the online game will implement. It is built from the Kickstarter "How to play" page, the Standard Edition board, the spinner and all 108 cards. Anything marked **Open question** needs aric's answer before it is coded; the default in brackets is what gets built until then.

## At a glance

- 4 to 6 players (online: 2 to 6, so people can test with fewer). 30 to 60 minutes.
- First player to reach **FINISH** wins.
- Components: board (33 spaces, see `data/board-standard.json`), spinner (8 segments, `data/spinner-standard.json`), Action deck A (82 cards), Bonus deck B (26 cards), dice (up to 6 are used by some cards), 12 pawn characters, sand timer (30-second timers on some cards).

## Setup

1. Everyone picks a pawn character (12 to choose from, each pawn once).
2. All pawns start on START, which is off the path before space `s1`.
3. Shuffle the Action deck and the Bonus deck separately.
4. Pick a first player. **Open question:** how is the first player chosen? [Highest roll of one die goes first; play goes clockwise, i.e. in seat order.]
5. Room setting **"We're on a video call"**: when on, video-call cards stay in the deck; when off, they are removed before shuffling (see `docs/card-review.md`).

## Your turn

1. If you are in the NEBULA, you lose this turn instead (see The Nebula). Turn ends.
2. If you are on the GRAPPLING HOOK, you do not draw an Action card. Roll one die: a 1 wins the game. Otherwise turn ends.
3. Otherwise, **draw an Action card** and do what it says. Most cards move you, make you roll, or interact with other players.
4. Wherever you end up, resolve that **space's effect** (below).
5. Discard the Action card unless it says to keep it (some cards stay with you as a reminder of a curse, like "the next time you roll a 3, go to the NEBULA").

Moving backwards follows the path in reverse. You cannot move past the GRAPPLING HOOK: any forward movement that would pass it stops on it.

**Open question:** do you resolve every space you *pass*, or only the one you *land on*? [Only the space you land on.]

## Space colors

Most spaces have a red, blue or green dot. **Your color is the color of the space you are on.** Cards and the CANNON that target a color hit everyone standing on that color. **Safe Zones have no color**, so color attacks and effects aimed at players on certain spaces skip anyone standing in one. (Card 104 "Safe Isn't Safe!" is the exception that targets Safe Zones on purpose.)

## Spaces

| Space | Effect |
|---|---|
| Collect a Bonus Card | Draw a Bonus card into your hand. |
| Spin the Spinner | Spin and do the segment's action. |
| Safe Zone | No effect. You have no color here. |
| Hippo Bee (`s2`) | Roll a 2, 4 or 6 to fly forward to the other Hippo Bee (`c7`). |
| Hippo Bee (`c7`) | Roll a 2, 4 or 6 to fly back to the first Hippo Bee (`s2`). |
| Troll Fight! (`s4`) | Move to the Troll Battle space on the bridge and fight. |
| Fork (`s6`) | Choose: the bridge path (Troll Battle) or the lower path (Boat, Nebula). Both rejoin at the Dragon Battle Recovery Zone. |
| Troll Battle! (`a3`) | Roll a 2, 4 or 6 to defeat the Troll. Lose: go down to the BOAT (`b3`). |
| Star | Roll a 3 or 5 to warp. `b1` warps to the next star `c1`; `c1` warps to `c10`; `c10` warps back to the first star `b1`. |
| Boat (`b3`) | No effect by itself; it is where losers of the Troll Battle and the Canoe end up. |
| Nebula! (`b7`) | Get sucked into the NEBULA for 1 turn. |
| Dragon Battle Recovery Zone | No effect by itself; where Dragon Fight losers go. Has a red dot. |
| Canoe (`c2`) | Roll higher than 3 to escape the rapids. Fail: ride down to the BOAT. |
| Dragon Fight! (`c5`) | Roll a 2, 4 or 6 to defeat the Dragon. Lose: back to the Dragon Battle Recovery Zone. |
| Cannon! (`c9`) | Spin the spinner. Everyone on the color it lands on goes back 3. |
| Grappling Hook (`c15`) | You cannot go farther. From now on you skip the Action card and roll a 1 to win. |

**Open questions:**
- When you land on a "roll to…" space (Hippo Bee, Star, Troll, Canoe, Dragon), do you roll once right away, and if you fail do you simply stay? [Roll once immediately; failing with no listed penalty means you stay.]
- If you win the Dragon Fight or Troll Battle, do you get anything besides staying put? [No.]
- The Nebula exit: the board says "EXIT NEBULA HERE" next to the Nebula space. [When you leave the NEBULA you are placed on the Nebula space `b7` and continue from there toward the Dragon Battle Recovery Zone.]

## The Nebula

The NEBULA is the vortex off the board. Players there skip their turns for the stated number of turns (usually 1, some cards say 2). Several cards rescue players from it (card 22 Spaceship Rescue, card 101 Freedom). A player in the NEBULA has no color and is not on any space.

## The spinner

Eight segments. A card or space tells you which part of the spinner to use, **never both at once**:

- **Action**: do what the segment says (Bonus card x2, Nebula for 1 turn, Action card, Roll 2 dice and go forward, Go to the Dragon and fight, Duel a player, Move to the closest red/blue/green spot).
- **Color**: only the colored dot matters (used by the CANNON and some cards).

**Open question:** the "Move to the closest red, blue or green spot" segment shows all three dots. When a color spin lands there, what happens? [Every color is hit.]

**Open question:** "Duel a player". [The spinner's owner picks an opponent; both roll one die; higher roll wins +5, loser -1; ties re-roll.]

## Bonus cards

Bonus cards go into your hand (hidden from other players) and are played when they say: some on your turn, some **at any time**, including during another player's turn (Steal, Shield, Canceled, Backstab, Reverse Reverse).

Online, every effect that could be answered by a reaction card pauses for a few seconds and shows a "Respond?" prompt to players who hold a matching card. If nobody responds, the effect happens.

**Traps** (84 Spider Monkey, 93 Spring, 98 Nebula) are placed on a space and stay until triggered or removed by card 88. **Open question:** does a trap trigger once and then get discarded? [Yes, once.] Traps cannot be placed on FINISH (two of them say so).

**Open question:** is there a hand limit for Bonus cards? [No limit.]

## Decks

When a deck runs out, shuffle its discard pile to make a new one. Cards returned "to the bottom of the deck" go to the bottom.

## Winning

The first player to reach FINISH wins. On the Standard board that means rolling a 1 while on the Grappling Hook. Card 79 "You Win! Well Maybe?" offers another way out.

**Open question:** can any movement card carry you onto FINISH directly, skipping the Grappling Hook? [No, the Grappling Hook always stops you.]

## Video-call and chat cards

See `docs/card-review.md` for every card that needs players to talk, perform or judge, and how each one works online.
