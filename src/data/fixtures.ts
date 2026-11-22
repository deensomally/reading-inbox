import type { Block, Fixture, Article } from "./model";
const p = (text: string): Block => ({ kind: "paragraph", text });
const h = (text: string): Block => ({ kind: "heading", text });
const demo = (id: string) => "#/publisher/" + id;
function story(
  id: string,
  title: string,
  publication: string,
  author: string,
  day: number,
  blocks: Block[],
  extra: Partial<Fixture> = {},
): Fixture {
  const date = `2026-11-${String(day).padStart(2, "0")}T09:00:00Z`;
  return {
    id,
    title,
    publication,
    author,
    published: date,
    received: date,
    coverage: "complete",
    publisher: demo(id),
    delivery: { kind: "rss", guid: "urn:reading-inbox:rss:" + id, blocks },
    ...extra,
  };
}
export const fixtures: Fixture[] = [
  story(
    "night-train",
    "The night train that carries a library",
    "Field Notes",
    "Mara Bell",
    19,
    [
      p(
        "At eleven minutes past nine, the last passenger leaves the carriage and Ada Finch unfolds a narrow wooden counter. On the platform at North Quay, a girl in a green coat is waiting to return a book about moths. There is no ticket to buy. The library has come to her.",
      ),
      p(
        "For six Thursdays this autumn, the last train through the Alder Valley has carried a shelf of lending books in its old parcels compartment. It stops at three villages after their branch libraries close. The railway already makes the journey. What the library has had to find is time at each platform, a dry cupboard and someone willing to carry the returns back.",
      ),
      h("A shelf built around a timetable"),
      p(
        "Finch, a librarian in the valley, began with a smaller question than how to build a travelling library. She wanted to know whether a person finishing a late shift could collect a reserved book on the way home. The station at North Quay stands between the packing sheds and the footbridge. At half past nine, that is a more useful address than the library on the hill.",
      ),
      {
        kind: "quote",
        text: "A book can be on the right shelf and still be in the wrong place.",
      },
      p(
        "The first set of shelves looked handsome in the workshop and proved impossible on the train. Tall books tipped on bends. The volunteers replaced the upright rows with three shallow crates that could slide under the counter. One holds reservations, one holds returns and one holds books a reader might choose without having thought to ask.",
      ),
      h("What the ledger can tell us"),
      p(
        "There were 84 loans recorded during the six trial evenings. Thirty-one went to people who told Finch they could rarely visit a branch during its opening hours. That question was optional, and the tally counts loans rather than individual readers. A family returning each Thursday can leave a long trail in a small ledger.",
      ),
      p(
        "The quieter entries are sometimes more revealing. On the second Thursday nobody collected a reservation at Mill Steps. Rain was blowing under the shelter and the stop lasted barely two minutes. The next week Finch put the reserved books in platform order. A reader could see a name before a volunteer had even stepped down.",
      ),
      {
        kind: "paragraph",
        text: "The library kept its stopping notes with the trial record.",
        link: {
          text: "Read the publisher’s field note.",
          href: demo("night-train"),
        },
      },
      h("The journey home"),
      p(
        "An evening service lives on borrowed minutes. A change to the winter timetable could remove the stop at Mill Steps altogether. The autumn trial used a spare compartment and volunteer shifts, neither of which the railway has promised for a full season. Finch is asking for one paid evening shift before she considers adding another village.",
      ),
      p(
        "At the end of the line the carriage lights stay on while the volunteers sort the returns. The book about moths is already reserved for next Thursday. Someone has pencilled a tiny crescent beside its title, the ledger’s sign that the next reader will meet the train after dark.",
      ),
    ],
    { discussion: demo("night-train") + "/discussion" },
  ),
  story(
    "bench",
    "A bench for the long way home",
    "Common Ground",
    "Eli Mercer",
    18,
    [
      p(
        "There is a stretch of Hollow Road where the grocery bags become heavy. It is halfway between the shops and the flats, a fact that did not appear on the council’s original seating map. It emerged when residents drew the walk they actually took.",
      ),
      h("A map made on foot"),
      p(
        "Six residents walked the route with a carpenter, stopping wherever they usually rested a bag. Four picked the same low wall. The carpenter placed a temporary bench there and another beside the ornamental entrance to the square.",
      ),
      p(
        "On two afternoons the bench by the wall was occupied more often. One neighbour pointed out that the entrance faced the wind. The short watch cannot separate weather from habit, but it gave the workshop a sensible place to start.",
      ),
      p(
        "The permanent bench is just wide enough for two people and a bag of apples. Its most important measurement may be its distance from the next place to sit.",
      ),
    ],
  ),
  story(
    "blue-hour",
    "A field guide to the blue hour",
    "Light Register",
    "Nia Moss",
    17,
    [
      p(
        "For a fortnight I took the same photograph from the east window at the end of each day. The brick wall turned blue before the sky looked blue to me. It took several evenings to realise that the wall was in shade while the clouds still held the sun.",
      ),
      {
        kind: "figure",
        src: "/demo/evening-colours.png",
        alt: "A slate-blue brick wall beside warm apricot evening clouds.",
        caption:
          "Window notebook. A colour study of the shaded brick and the last light on the clouds.",
      },
      h("A repeatable observation"),
      {
        kind: "list",
        items: [
          "Stand in the same place each evening.",
          "Keep the exposure and white balance fixed.",
          "Note the cloud cover beside each frame.",
        ],
      },
      p(
        "The images compare one window with itself. The camera makes a useful notebook, but its sensor and the eye respond differently. I kept a sentence about what I saw alongside each picture, especially on the evenings when the two accounts disagreed.",
      ),
      p(
        "By the last evening I was less interested in naming a particular blue than in the few minutes when two surfaces beside each other seemed to belong to different hours.",
      ),
    ],
    { commentsDisabled: true },
  ),
  {
    id: "paper",
    title: "The paper that remembers a garden",
    publication: "The Folded Letter",
    author: "Iona Reed",
    received: "2026-11-16T12:00:00Z",
    coverage: "complete",
    delivery: {
      kind: "newsletter",
      messageId: "<garden-04@folded-letter.example>",
      text: "Dear reader,\n\nA folded sheet fell out of my planting notebook this morning. It held no seeds, only the names of three varieties written in the order they had come up. I had forgotten that the narrow bed by the gate was planted a week later than the rest.\n\nThis is the fourth season I have used a separate sheet for each bed. I draw a rough rectangle, mark the date and leave space for anything that surprises me. Last year a torn corner stood for the place where rain washed out a row of beans.\n\nA page like this can explain a gap in a harvest. It cannot tell me what would have happened in a drier spring. I keep the sheets because the details I need in February are rarely the ones I think I will forget in June.\n\nUntil next time,\nIona",
    },
  },
  story(
    "tide",
    "Drawing a map that moves with the tide",
    "Field Notes",
    "Rowan Pell",
    15,
    [
      p(
        "Every morning the channel behind Saltwick changes its mind by a few feet. Surveyor Lea Moor has begun drawing the shifting edge on sheets of tracing paper. Laid one over another, the banks make a soft grey band where a single blue line used to be.",
      ),
    ],
    {
      coverage: "excerpt",
      reason: "The demo publisher supplied only the opening paragraph.",
    },
  ),
  story(
    "repair",
    "Inside the Saturday repair room",
    "Common Ground",
    "Sol Hart",
    14,
    [
      p(
        "The first thing a visitor is handed in the Saturday repair room is a pencil. Before anyone takes the back off a clock or opens a sewing machine, its owner writes down the sound or movement that made them bring it in.",
      ),
      p(
        "One visitor described a click that came once per turn of the wheel. The volunteer found a bent tooth where the owner had predicted it would be. Another visitor wrote only that the lamp felt wrong. A second conversation turned that feeling into a loose switch.",
      ),
      h("A record for the next visit"),
      p(
        "The slips travel home with their objects. On a return visit a volunteer can see what has already been tried. The room keeps no central list of repairs, so its organisers cannot yet say whether writing things down makes the fixes last longer.",
      ),
      p(
        "When the doors close, a tin of sharpened pencils stays beside the tools. It is the one piece of equipment everyone has learned to use.",
      ),
    ],
    { discussion: demo("repair") + "/discussion" },
  ),
  story(
    "sound",
    "Listening for the shape of a room",
    "Light Register",
    "Tess Lark",
    13,
    [],
    {
      coverage: "missing",
      reason:
        "This delivery contains a headline and byline. The publisher did not include the article text.",
    },
  ),
  story(
    "index",
    "An index for the words we inherit",
    "The Small Press",
    "Robin Ash",
    12,
    [
      p(
        "A box of recipe cards arrived at Small Press with a request for an index. The cards used three different names for the same small cake, each in a different hand. Alphabetising the recipes under one name would have made two family traditions difficult to find.",
      ),
      p(
        "The editor kept all three names and added a cross-reference in each direction. When the family tried the first proof, a cousin found the cake using the name she had heard as a child. Her brother used a different entry and arrived at the same page.",
      ),
      p(
        "One family’s index cannot settle how a dish should be named. Its quieter achievement is that nobody at this table has to learn a new word before they can find an old recipe.",
      ),
    ],
    { author: undefined, commentsDisabled: true },
  ),
];
// Content identity for cache invalidation; this digest has no security role.
export async function adapt(f: Fixture): Promise<Article> {
  const { delivery, ...meta } = f;
  const blocks =
    delivery.kind === "rss"
      ? delivery.blocks
      : delivery.text.split(/\n\s*\n/).map(p);
  const body = JSON.stringify(blocks);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return {
    ...meta,
    source: delivery.kind,
    sourceKey: delivery.kind === "rss" ? delivery.guid : delivery.messageId,
    blocks,
    bodyHash: Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
    permissions: {
      display: !!blocks.length,
      copy: !!blocks.length,
      retain: true,
      summarise: !!blocks.length,
    },
  };
}
