# Card review: what works online

All 108 cards sorted into four groups. **81 cards work as is**: the computer can run them (dice, movement, Bonus cards, traps, spinner). The other 27 are below with how each would work online. Mark any you want moved to a different group.

Full card text is in `data/cards.json`.

## Chat version (12): always in the deck

The game asks a question with buttons, runs a quick mini-game, or watches the text chat.

| # | Card | How it works online |
|---|---|---|
| 6 | Bacon or Sausage? | Two buttons; the game applies the outcome. |
| 23 | Snake slither (+3, +5 or next Bonus spot) | Three buttons; picking the snake posts "Hissss…" in chat for you. |
| 37 | Addicted to coffee? | Yes / No buttons. |
| 38 | Gluten free | Yes / No buttons. |
| 48 | Phone Wars! | Everyone picks their phone brand (or flip phone); the game counts. |
| 58 | Too much time researching purchases? | The other players vote Yes / No / Don't know. |
| 67 | Quicksand! | Other players get a "Help?" button to roll; a 2 or 4 saves you. |
| 68 | Dice Adding Challenge! | Six dice appear; first correct sum typed wins, a wrong answer goes to the Nebula. |
| 73 | Sarcastic encouragement | You type something to each player in chat during the next turn; +7 if you do, +1 if you pass. |
| 76 | Generations! | Pick your birth-year range. |
| 99 | My Turn! Your Turn! (Bonus) | The holder gets a "Gotcha" button whenever someone types "my turn" or "your turn" in chat. The game highlights the message. |
| 105 | Your Rules! (Bonus) | You type a rule; others vote to accept it or send you to START. Players enforce it themselves. |

## Video-call only (14): in the deck only when the room says "We're on a video call"

The game runs the timer and the vote; players watch each other on their own call and tap the result.

| # | Card | How it works online |
|---|---|---|
| 19 | Dance Off! | 30-second timer, then everyone else votes the winner. "Skip turn" button for cowards. |
| 33 | Do Something Funny! | 30-second timer, then "Did anyone laugh?" vote. |
| 43 | Stare Contest | 30-second timer; players report winner or tie. |
| 46 | Everyone Judges Your Beard! | Others vote a beard tier. |
| 52 | Fart Challenge | Others confirm. |
| 55 | Juggle or balance dice | Pick a stunt, others confirm success. Uses real dice or any small object. |
| 65 | Card Toss Challenge! | Toss any real card or object; others judge. |
| 72 | Whistle a tune | Others judge happy (+3) or crappy (+1). |
| 74 | Dice Stacking Challenge! | 30-second timer with real dice; others vote success / fail / cheated. |
| 75 | Um! (+7 now) | The +7 is automatic. Others get a "Caught them" button for "um" or "like". |
| 77 | Burp Challenge! | Everyone burps; vote loudest and lamest. |
| 78 | Nobody Laugh! | Reader reads the tongue twisters aloud; "Did anyone laugh?" button. |
| 81 | House of Cards! | 30-second timer with real cards; others confirm. |
| 90 | Don't Laugh! (Bonus) | Target gets watched for 2 turns; a "They laughed" button sends them to the Nebula. |

**Question for you:** with the video setting off, should a few of these get a chat fallback instead of being removed? Easy candidates are 46 Beard (self-report), 72 Whistle (just a +3 / +1 choice) and 75 Um (catch typed "um" or "like" in chat).

## Remove (1)

| # | Card | Why |
|---|---|---|
| 63 | Photo Text Challenge! | The winner sends a photo from the loser's phone, which is impossible remotely. Option: keep only the dice duel (+2 or +5) and drop the photo. |

## Rule questions these cards raise

- **Reaction cards** (83 Steal, 85 Shield, 92 Canceled, 95 Backstab, 107 Reverse Reverse) can be played "at any time". Online, the game will pause a few seconds before each effect so holders can respond.
- **Curse cards you keep** (24, 56, 108 and others: "the next time you roll a 3/5…") are tracked by the game and shown next to your pawn.
