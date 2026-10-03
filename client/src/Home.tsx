/** The landing page: pick a game. Each game has its own host screen, join page and rules. */

interface GameCard {
  title: string;
  glyph: string;
  tagline: string;
  facts: string[];
  host: string;
  join: string;
  rules: string;
  roles: string;
  accent: string;
}

const GAMES: GameCard[] = [
  {
    title: "Two Rooms and a Boom",
    glyph: "💣",
    tagline: "Two teams, two rooms, one bomb. Trade hostages until the timer runs out — is the President in the room with the Bomber?",
    facts: ["6–30 players", "3 rounds · ~15 min", "Needs two rooms"],
    host: "/two-rooms",
    join: "/play",
    rules: "/how-to-play",
    roles: "/roles",
    accent: "border-blueteam",
  },
  {
    title: "One Night Ultimate Werewolf",
    glyph: "🐺",
    tagline: "One night, one day, one vote. Look at cards, swap them, then argue about who's a Werewolf. Your phone does the night.",
    facts: ["3–10 players", "One round · ~10 min", "Phones do the night"],
    host: "/werewolf",
    join: "/werewolf/play",
    rules: "/werewolf/how-to-play",
    roles: "/werewolf/roles",
    accent: "border-rose-800",
  },
];

export function Home() {
  return (
    <main className="mx-auto max-w-4xl p-5 sm:p-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-4xl font-black">Game night</h1>
        <p className="text-zinc-400">
          Hidden-role party games, played in the same room. One screen on the table hosts the game, and everyone joins on
          their own phone. Nothing to install.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {GAMES.map((g) => (
          <section key={g.title} className={`flex flex-col rounded-2xl border-t-4 ${g.accent} border-x border-b border-x-zinc-800 border-b-zinc-800 bg-zinc-900 p-5`}>
            <div className="flex items-center gap-3">
              <span className="text-4xl" aria-hidden>
                {g.glyph}
              </span>
              <h2 className="text-2xl font-black leading-tight">{g.title}</h2>
            </div>
            <p className="mt-3 text-zinc-300">{g.tagline}</p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {g.facts.map((f) => (
                <li key={f} className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">
                  {f}
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2 mt-auto pt-5">
              <a href={g.host} className="rounded-xl bg-zinc-100 px-4 py-3 text-center font-semibold text-zinc-900 active:bg-zinc-300">
                Host a game
              </a>
              <a href={g.join} className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-center font-semibold active:bg-zinc-700">
                Join a game
              </a>
              <a href={g.rules} className="rounded-xl px-4 py-2 text-center text-sm text-zinc-400 underline">
                How to play
              </a>
              <a href={g.roles} className="rounded-xl px-4 py-2 text-center text-sm text-zinc-400 underline">
                Roles
              </a>
            </div>
          </section>
        ))}
      </div>
      <p className="text-sm text-zinc-500">
        Hosting: open the game on a laptop, tablet or TV everyone can see, then press <b>Create a game</b>. It shows a QR code
        to scan. Joining: scan the code, or open “Join a game” and type the 4-letter code.
      </p>
    </main>
  );
}
