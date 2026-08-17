import { ADDON_PACKS, FREE_PLAN_CREDITS, PHOTOS_PER_CREDIT } from '@/config/pricing';
import type { GuideContent } from './types';

/**
 * Pack prices are DERIVED, never typed. config/pricing.ts says it in capitals,
 * and lib/seo/llms.ts records what happens otherwise: the hand-written
 * llms.txt went stale the first time the photos-per-credit rule moved, because
 * the constant changed and the prose did not. Indexed articles quoting a dead
 * price are the same bug with a worse blast radius — they also feed Article
 * schema and AI crawlers.
 */
const packList = () =>
  ADDON_PACKS.map((p) => `${p.books} credits for ${p.priceUsd} US dollars`).join(', ');


export const en: Record<string, GuideContent> = {
  'turn-old-family-photos-into-a-book': {
    title: 'How to turn old family photos into a book',
    excerpt:
      'A practical walk through digitising a box of prints, choosing which ones belong in a book, and getting it into a form you can hold.',
    metaTitle: 'How to Turn Old Family Photos Into a Book — Yujee',
    metaDesc:
      'Digitise the prints, pick the few that matter, put them in order, and write the captions. A step by step guide to turning old family photos into a book.',
    lede: 'Most family photos die in a box. Not because nobody cares about them, but because a box has no order, no captions, and no reason to be opened. Turning them into a book fixes all three at once. Here is how to do it without losing three weekends.',
    sections: [
      {
        h: 'First, find out how many photos you actually have',
        paras: [
          'Before deciding anything, empty the box and count roughly. The number changes the whole approach. Under 200 prints and you can look at every single one. Over a thousand and you need to sample rather than sort, or you will still be sorting next year.',
          'Sort into decades while you count. You do not need exact dates yet, and you will not have them for most photos. A rough pile per decade is enough structure to make every later decision easier.',
          'This is also when you find out what you are missing. Almost every family has a gap where a whole era went undocumented, and it is better to know that now than to discover it halfway through laying out a book.',
        ],
      },
      {
        h: 'Digitise: a phone camera is fine, a scanner is better',
        paras: [
          'A flatbed scanner at 600 DPI is the right tool for prints you care about. It is slow, roughly a minute per photo including placement, but the result holds up when printed at full page size.',
          'For everything else, photograph the prints with your phone. Lay them flat near a window, avoid direct sun, and shoot straight down rather than at an angle. Modern phone cameras out-resolve most consumer scanners already; the thing that ruins phone shots is glare and skew, not resolution.',
          'Do not retouch anything at this stage. Scratches, colour casts, and faded corners are far easier to judge once you see the photos laid out together, and most of them turn out not to matter at book size.',
          'Name the files by decade as you go. Ten minutes of naming now saves an hour of squinting later.',
        ],
      },
      {
        h: 'Choose far fewer photos than feels right',
        paras: [
          'This is the step people get wrong. A book of 300 photos is an archive, and nobody reads an archive. A book of 40 photos is a story, and people read it more than once.',
          'The test for keeping a photo is not whether it is a good photograph. It is whether it shows something the other photos do not: a room nobody has been in for thirty years, a car, a haircut, two people standing closer than you expected. Four near-identical shots of the same birthday earn one slot between them.',
          'Blurry is not automatically out. A blurry photo of someone who was rarely photographed beats a sharp one of a landscape. Technical quality is the last criterion, not the first.',
        ],
      },
      {
        h: 'Put them in an order that carries something',
        paras: [
          'Chronological is the obvious order and it is usually right, because it is the one order a reader can follow without being told what it is.',
          'The exception is when the family splits across places. If half the photos are from one country and half from another, grouping by place and running each group chronologically reads far better than interleaving them by date and making the reader jump continents every spread.',
          'Whatever order you pick, keep it. A book that is chronological for forty pages and then thematic for ten feels like it lost its nerve.',
        ],
      },
      {
        h: 'Write the captions, because the photos will not explain themselves',
        paras: [
          'In twenty years nobody will know who is on the left. Write it down now, while someone still remembers, and ask the oldest person available before you finish this step rather than after.',
          'Good captions state facts and stop: who, where, roughly when, and one thing that is not visible in the frame. The last part is what makes a caption worth reading. "Dad outside the shop, 1974, the year before it closed" does more work than three sentences about how much the shop meant to everyone.',
          'Where you genuinely do not know, say so. An honest "somewhere in the early sixties, nobody is sure who took it" is better than a confident guess that gets repeated as fact by the next generation.',
        ],
      },
      {
        h: 'Turn it into an actual book',
        paras: [
          'Laying out a photo book by hand in design software works and takes a long time. The tedious part is not the design taste, it is the mechanical work: sizing every image to its frame, keeping margins consistent across eighty pages, and reflowing everything when you add one more photo in the middle.',
          'That mechanical layer is what Yujee automates. You upload the scans, describe what was going on, and it groups the photos, lays out the pages, and writes a first pass of the captions for you to correct. What comes out is a 300 DPI print-ready PDF: you can keep it as it is, or send it to any print shop or online printer for binding. Yujee does not print or ship the book itself.',
          'Whichever route you take, print at least one physical copy. A PDF gets backed up and forgotten. A book on a shelf gets picked up by people who were never going to go looking for a file.',
        ],
      },
    ],
  },
  'make-a-photo-book-from-iphone-photos': {
    title: 'How to make a photo book from iPhone photos',
    excerpt:
      'The parts nobody warns you about: photos that live in iCloud rather than on the phone, HEIC files some tools refuse to open, Live Photos, and a camera roll clogged with screenshots.',
    metaTitle: 'How to Make a Photo Book From iPhone Photos — Yujee',
    metaDesc:
      'Getting originals out of iCloud, handling HEIC and Live Photos, clearing screenshots, and why 12MP prints fine. How to make a photo book from iPhone photos.',
    lede: 'The hard part of making a photo book from an iPhone is not design. It is extraction. Your photos are spread across iCloud, half of them are in a format some tools still refuse to open, your camera roll is padded with screenshots and receipts, and Apple has quietly moved the full-resolution originals off your device to save space. Here is the order to do things in so none of that bites you at print size.',
    sections: [
      {
        h: 'Your originals may not be on your phone',
        paras: [
          'Open Settings, then Photos. If iCloud Photos is on and the option below it says Optimise iPhone Storage, then most of what you see in your camera roll is a preview. The full-size file lives on Apple’s servers and the phone fetches it on demand.',
          'That is fine for looking at photos and bad for exporting them. Select 300 optimised photos, hit share, and you sit through a long silent download first. Anything that fails to fetch can transfer as the smaller version instead, with no warning. You find out when a page prints soft.',
          'The fix is to switch that setting to Download and Keep Originals, then leave the phone on Wi-Fi and charging overnight. The catch is storage: you need free space equal to the size of your library, and a 60GB library will not fit on a phone with 20GB free.',
          'If it will not fit, skip the phone. The same library is available on iCloud.com, or on a Mac signed into the same Apple account, with no storage ceiling in the way.',
        ],
      },
      {
        h: 'Getting 300 photos off the phone',
        paras: [
          'AirDrop to a Mac is the fastest route and it preserves the original file, format included. Select in the Photos app, share, AirDrop. It copes with a few hundred photos but slows down badly; batches of 50 to 100 fail far less often than one batch of 300.',
          'A cable is the more reliable route, and the only sane one to a PC. Plug in, tap Trust on the phone, then use Image Capture on a Mac or File Explorer on Windows to copy the DCIM folders straight off the device. What you get is exactly what the camera wrote.',
          'From iCloud.com, select the photos and use the download button. Press and hold it and you are offered a choice between the unmodified original and the most compatible version. The second one converts HEIC to JPEG on the way out, which is sometimes exactly what you want.',
          'Do not send photos to yourself over Messages or as an ordinary mail attachment. Both recompress. Mail at least offers an Actual Size option at the bottom of the compose window, and it is worth picking every time.',
        ],
      },
      {
        h: 'HEIC, JPEG, and the Live Photos problem',
        paras: [
          'Since 2017 iPhones have saved photos as HEIC by default. It is a good format, roughly half the file size of JPEG at the same quality, and a decade of other software still trips over it. When a tool rejects your photos with no useful error, HEIC is the first suspect.',
          'Two settings control this. Settings, Camera, Formats, Most Compatible makes the camera shoot JPEG from now on, which does nothing for the photos you already took. Settings, Photos, Transfer to Mac or PC, Automatic converts on the way out, which does. Use the second one and leave the camera shooting HEIC.',
          'A Live Photo is a still image plus about three seconds of video, stored as two files. Export it as a JPEG and you get the key frame, which is usually the right result for print. If the key frame is the one where somebody blinked, open the photo, tap Edit, and set a different frame as the key photo before exporting.',
          'Portrait mode photos carry depth data a book cannot use, but the blur is baked into the exported image, so they print exactly as they look on screen. Nothing to do there.',
        ],
      },
      {
        h: 'Clear the junk out before you start choosing',
        paras: [
          'A camera roll is not a photo collection. It is a photo collection mixed with receipts, parking spot reminders, screenshots of addresses, and eleven attempts at the same photo of a dog.',
          'Albums, Media Types, Screenshots puts every screenshot in one place. Recent iOS versions also have Albums, Utilities, Duplicates, which finds exact and near-exact copies and merges them while keeping the best version. Run it first; on a large library it takes a while to populate.',
          'Bursts are the other quiet bloat. A burst is stored as one stack with a chosen favourite, but exporting can flatten it into every frame it contains. Open each burst, keep one, delete the rest, and do it before you export rather than after.',
          'Everything you delete sits in Recently Deleted for 30 days, so this stage is reversible. Worth knowing, because being ruthless here is the single biggest time saver in the whole job.',
        ],
      },
      {
        h: 'Resolution: 12MP is more than a book needs',
        paras: [
          'An iPhone photo at the standard setting is 4032 by 3024 pixels. Printed at 300 DPI, which is what print shops ask for, that is 13.4 inches by 10 inches. Bigger than the page it is going on. You have headroom, not a shortage.',
          'Even an old 8MP iPhone, anything from the 4S to the 6 Plus, gives you 3264 by 2448, which prints at just under 11 inches wide. Still fine for a full page in most book sizes.',
          'The newer 48MP sensors output 12 or 24 megapixels by default depending on the model, and only produce the full 48MP file in ProRAW or the HEIF Max setting. A book does not need it, and those files are several times larger to move around and store.',
          'What actually ruins a page: heavy crops, digital zoom past the optical range, and screenshots. A screenshot is roughly 1170 by 2530 pixels, under four inches wide at print resolution, and it goes soft the moment it fills a page. Photos taken of a screen are worse.',
        ],
      },
      {
        h: 'You exported 300, the book needs 40',
        paras: [
          'A phone roll rewards a different instinct than a shoebox of prints. Nobody shot 40 frames of one birthday cake on film. You did, and the book needs one of them.',
          'Work event by event instead of photo by photo. Find the cluster from one afternoon, pick the single best frame, move on. It goes faster than it sounds, roughly a minute per event once you stop second-guessing yourself.',
          'Keep faces and rooms. Skip pure scenery, which looks identical to everyone else’s scenery, and skip the shots where the whole story happened outside the frame and the picture is just a wall.',
          'A useful ratio is about one photo per page for a book people will reread, so 40 photos is a real 40-page book. Three hundred photos is a database with a cover on it.',
        ],
      },
      {
        h: 'Turning the exported folder into a book',
        paras: [
          'Once the photos are off the phone and sitting in one folder, the work splits in two: deciding what goes where, and the mechanical labour of fitting images to frames, holding margins steady across sixty pages, and reflowing everything when you insert one more photo in the middle.',
          'The second half is what Yujee does. You drop the exported photos into the browser, tell it what was going on, and it groups them, lays out the pages, and drafts the captions and chapter text for you to correct by chatting with it. What you download is a 300 DPI print-ready PDF. Sending it to a print shop, if you want a physical copy, is your side of the deal.',
          `The pricing is credit-based rather than a subscription: new accounts get ${FREE_PLAN_CREDITS} free credits, one credit covers ${PHOTOS_PER_CREDIT} photo, and packs run ${packList()}. Your original files never leave the browser; only compressed previews go to the AI. The interface is available in English, Chinese, Spanish, Japanese and French, and it drafts the book text in English or Chinese.`,
          'Whichever route you take, do the export properly first. Everything downstream inherits whatever came off the phone, and no layout rescues a photo that arrived as a thumbnail.',
        ],
      },
    ],
  },

  'what-to-write-in-a-photo-book': {
    title: 'What to write in a photo book',
    excerpt:
      'Caption formulas that carry real information, how long each one should run, when to leave a page silent, and what to do about the photos where nobody remembers anything.',
    metaTitle: 'What to Write in a Photo Book: Captions That Work — Yujee',
    metaDesc:
      'Caption formulas, how long to write, when to say nothing, and what to do when nobody remembers. A practical guide to what to write in a photo book.',
    lede: 'Most photo books fail at the text, not the pictures. Either there is nothing at all, and the book becomes a slideshow with no memory attached, or there is too much of the wrong kind: sentences like "an unforgettable day with the people we love most" that could sit under any photo ever taken. What to write in a photo book has a few reliable answers, and you can learn them in an afternoon.',
    sections: [
      {
        h: 'A caption carries what the photo cannot show',
        paras: [
          'The photo already shows the room, the clothes, the weather and the faces. Repeating any of that wastes the only text a reader will actually read. "Everyone smiling at the beach" is a description of a JPEG.',
          'What a photo cannot show is everything outside the frame: names, the year, why they were there, who was holding the camera, what happened the following week, what the place is now.',
          'That is the whole test. Read your caption, then cover the photo. If the sentence still tells you something, it has earned its place. If it evaporates without the picture, cut it or rewrite it.',
          'The best captions tend to hold one fact the reader could not have guessed, and then stop.',
        ],
      },
      {
        h: 'Four formulas that cover most photos',
        paras: [
          'The workhorse: who, where, when, plus one thing you cannot see. "Mum outside the shop, 1974, the year before it closed." Ten words, and the last five do all the work.',
          'The what-happened-next: state the moment, then jump forward. "The first night in the new flat. They stayed nineteen years." This is the formula that makes people cry at photo books, and it costs you one extra sentence.',
          'The point-at-one-thing: name a detail in the frame a reader would otherwise skim past. "Note the wallpaper. Dad hung it himself and never once let us forget it."',
          'The correction: use the caption to fix the impression the photo gives. "It looks like a holiday. It was the week we moved and nobody could find the kettle." Use this one sparingly, two or three times in a book.',
        ],
      },
      {
        h: 'How long, and where the longer pieces go',
        paras: [
          'Most captions should run eight to twenty words. That is one or two lines under a photo, which is about what a reader’s eye will take before it moves to the next image.',
          'A book also needs a handful of longer pieces or it has no shape. Two or three hundred words at the start of each chapter, setting up the era: where everyone lived, who was born, what changed. People do read these, because they arrive before the photos rather than in between them.',
          'The length that almost never works is the middle one. A hundred-word block wedged under a single photo stops the book dead, and nine times out of ten it is a chapter introduction that ended up in the wrong place. Move it to the front of the section.',
          'Vary the rhythm on purpose. Four captions in a row of identical length reads like a catalogue, and readers start skipping.',
        ],
      },
      {
        h: 'When to write nothing',
        paras: [
          'Silence is a legitimate choice and an underused one. A full-page photo with no text says the picture is enough, and on the right photo that lands harder than any sentence you could write.',
          'Skip the caption when the photo explains itself and is unremarkable, when the caption would only repeat the chapter heading, and when a spread already carries two captions and a third would turn it into a wall of small print.',
          'A working ratio is that half to two thirds of photos get text. Annotating every single one flattens the emphasis: if everything is captioned, nothing is highlighted.',
          'One thing overrides all of this. Always name the people, even in a book that is otherwise silent. Faces are the one piece of information that becomes unrecoverable, and it happens faster than anybody expects.',
        ],
      },
      {
        h: 'The photos where nobody remembers',
        paras: [
          'Every collection has them. A wedding where three of the four people are unidentified. A beach that could be two different countries. A baby who is either you or your uncle.',
          'Before guessing, check what is actually available. The back of a print often carries a lab date stamp or a pencilled note. Digital files carry a capture date and often GPS coordinates in their metadata. Photo lab envelopes, if any survived, are usually dated.',
          'Then ask, and ask the right people: the oldest one, and ideally two of them separately. Two people remembering the same afternoon differently is itself worth writing down, and it is more honest than picking a winner.',
          'When the answer stays unknown, write the uncertainty into the caption instead of hiding it. "Early sixties, we think. Nobody is sure who the woman on the left is." That is a true sentence, and it invites the one reader who does know to say so. A confident guess becomes family fact within a generation and is almost impossible to undo.',
        ],
      },
      {
        h: 'Write for a reader who is not you',
        paras: [
          'The person who most needs this book has not been born yet, or is currently eleven. They do not know that "the cottage" means your grandmother’s house, or that Uncle Ray is your father’s brother rather than a neighbour who came to everything.',
          'The rules that follow from that are dull and effective. Give people their full name the first time they appear, plus their relationship to somebody the reader already knows. Write the year, not "that summer". Name the town, not "back home".',
          'Cut the in-jokes unless you explain them, and the explanation is usually the better caption anyway. Why the fridge was called Gerald is worth more than the phrase itself.',
          'Read your captions aloud to somebody from a different branch of the family. Every place they stop and ask a question is a caption missing one fact.',
        ],
      },
      {
        h: 'Getting the first draft written',
        paras: [
          'The reason books ship with no text is almost never that nobody had anything to say. It is that facing sixty blank caption fields at once is a wall, and people put it off until the project quietly dies.',
          'Lower the stakes on the first pass. Type anything true under every photo, however plain, in one sitting, without editing. A page of mediocre captions is easy to improve. An empty page is not.',
          'Yujee runs that first pass for you: it groups the photos, drafts a caption for each one and the chapter text around them, and lays out the pages, so what you open is a draft to correct rather than a blank. You edit it by chatting with it, and what you download is a 300 DPI print-ready PDF that you take to a print shop yourself if you want it bound.',
          'Either way, the corrections are the point. No tool knows that the woman on the left is your great-aunt, or that the shop closed the following spring. That only exists in your head, and a book is the place to put it.',
        ],
      },
    ],
  },

  'write-a-memoir-about-a-parent': {
    title: 'How to write a memoir about your mother or father',
    excerpt:
      'How to interview a parent without it feeling like an interview: the questions that get real answers, what to do when they resist, and how to handle the parts nobody wants written down.',
    metaTitle: 'How to Write a Memoir About Your Mother or Father — Yujee',
    metaDesc:
      'The questions that open a parent up, recording versus notes, photos as prompts, and handling difficult material. How to write a memoir about a parent.',
    lede: 'A memoir about a parent is mostly an interviewing problem. The writing is real work, but it comes second: you cannot write what you were never told, and the person who could tell you has a finite amount of time and patience for being asked. Most of the difficulty is in the asking. Almost all of the regret is about starting late.',
    sections: [
      {
        h: 'The window is shorter than it feels',
        paras: [
          'The arithmetic is uncomfortable. If your mother is 75 and you talk properly a few times a year, there are fewer real conversations left than you assume, and the good ones need her to be well, unhurried and in the mood.',
          'Memory does not fail all at once either. Names go first, then the stories get shorter, and it is gradual enough that nobody notices until a question that used to produce a story produces a shrug.',
          'So start badly rather than starting well. One recorded hour this month beats a carefully designed project you begin next year. The first session will be awkward and you will ask weak questions; do it anyway, because the material is what matters and technique improves on its own.',
          'It also pays to be redundant. Ask for the same story twice, a year apart. The second telling always contains something the first one did not.',
        ],
      },
      {
        h: 'The questions that actually open people up',
        paras: [
          'Tell me about your childhood produces nothing. It is too large to answer, so people fall back on the summary they have given a hundred times: it was hard, we had nothing, we were happy.',
          'Small and sensory works instead. What did the kitchen smell like on a Sunday. What did you sit on. How did you get to school and how long did it take. What did a loaf of bread cost, and what did your father earn. What was the first thing you bought with your own money.',
          'Objects, routes, money, food, and other people. Those five categories produce more than any question about feelings, because they have concrete answers, and a concrete answer nearly always drags a story out behind it.',
          'Then the move that matters most: say nothing. When they stop, wait five seconds before asking the next thing. Most of the best material in any interview arrives in the silence after somebody thinks they have finished answering.',
        ],
      },
      {
        h: 'Record it, and take notes anyway',
        paras: [
          'Use the voice memo app on your phone, on the table where you can both see it, and say out loud that you are recording. Hiding it never ends well, and a visible phone stops being noticeable within about two minutes.',
          'Keep sessions to roughly 45 minutes. Longer and you both get tired, the answers shorten, and you end up with hours of audio you never listen to again. Short and frequent beats one heroic afternoon.',
          'The recording is not only a transcription aid, it is the artifact. In fifteen years the sound of your father’s laugh will matter more than the anecdote he was telling. Back the files up in two places the same day and put dates in the filenames.',
          'Take rough notes at the same time regardless, mostly timestamps and things to come back to. Writing while listening also gives you somewhere to look, which makes the silences easier for both of you.',
        ],
      },
      {
        h: 'Photographs are the best prompt you have',
        paras: [
          'A parent with nothing to say in the abstract will talk for an hour with ten prints on the table. Photos remove the burden of choosing what to talk about, which is the part people find hard.',
          'Go one at a time and ask the same four things. Who is that. Who took the picture. What is just outside the frame. What happened right before or right after.',
          'The last two are the productive ones. A photo is a crop of a real afternoon, and the parts that got cropped out are exactly the parts nobody ever wrote down.',
          'Follow the tangents. If a picture of a caravan turns into twenty minutes about a neighbour who appears in no photograph at all, that is not a derailment, that is the session working. You can come back to the photo, or not.',
        ],
      },
      {
        h: 'When they resist',
        paras: [
          'There are three common refusals and they are separate problems. Some parents think their life was ordinary and not worth recording. Some dislike the formality of being interviewed. Some will talk about anything except one specific thing.',
          'For the first, drop the words memoir and interview entirely. Ask for help with a concrete task instead: I am trying to label these photos and I do not know who half these people are. That is a request for expertise rather than a request to be a subject, and it gets a different answer.',
          'For the second, remove the sit-down. Ask in the car, or while cooking, or on a walk. Side by side rather than face to face lowers the temperature a great deal, and a phone records perfectly well from a pocket once you have said that it is on.',
          'For the third, take the no. Say you will leave it out, and mean it. A parent who trusts that one subject is genuinely closed will usually open several others, and the closed one sometimes opens by itself two years later.',
        ],
      },
      {
        h: 'Difficult material, handled honestly',
        paras: [
          'Every family has material a nice book would smooth over: drinking, a departure, money, an illness nobody named out loud, a person who is no longer spoken to. Sanding it flat produces a book the family does not believe, and the disbelief spreads to the true parts as well.',
          'A rule that holds up: report, do not diagnose. Write what happened, what was said, and what you saw. Do not write that your father was depressed unless somebody diagnosed him. Write that he did not leave the house for most of that winter, which is both truer and harder to read past.',
          'Living people get a say, and asking before you write is far easier than arguing after. If somebody objects to appearing in a chapter, you can usually keep the events and drop the name.',
          'Consider making two versions: a full one for you and your siblings, and a shorter one that goes to everybody else. That is not cowardice, it is an audience decision, and it lets you write the honest one without negotiating every paragraph.',
        ],
      },
      {
        h: 'Turning the recordings into a book',
        paras: [
          'Structure comes out of the material, and only two structures reliably work. By era, which any reader can follow. Or by theme, which reads better but requires you to know the whole story before you start. Choose era for a first book.',
          'Keep their actual words. Transcribe the good passages verbatim, dialect and digressions included, and set them as quotes rather than rewriting them in your own voice; the specific way a person says a thing is most of what you are preserving. Your job around those quotes is context: dates, places, who everyone is. Resist over-polishing, because a memoir that reads like literature usually means the parent has been edited out of it.',
          `For the assembly itself, Yujee takes the photos and the story you type in, groups them into chapters, drafts the chapter text and captions, and lays out the pages, which you then correct by chatting with it. What you download is a 300 DPI print-ready PDF, and you take that to a print shop yourself if you want it bound, since it does not print or ship anything. there is no subscription, new accounts get ${FREE_PLAN_CREDITS} free credits at one credit per photo, your original photos never leave the browser, the interface is available in five languages, and the book text it drafts is English or Chinese.`,
          'However you assemble it, print more than one copy. The version that survives a family is the one that exists in several houses.',
        ],
      },
    ],
  },
  'photo-book-vs-photo-album-vs-scrapbook': {
    title: 'Photo Book vs Photo Album vs Scrapbook: What Is the Difference?',
    excerpt:
      "A photo book is printed from a designed file, a photo album holds loose prints in sleeves, and a scrapbook is built by hand. Here is how the three differ in construction, cost, time, and what each one preserves best.",
    metaTitle: 'Photo Book vs Photo Album vs Scrapbook: Differences — Yujee',
    metaDesc:
      "A photo book is printed from a designed digital file. A photo album holds loose prints in sleeves. A scrapbook is assembled by hand. Cost and effort compared.",
    lede:
      "The three words get used interchangeably, and they describe three genuinely different objects. A photo book is a printed, bound book whose pages carry the images directly. A photo album is a book of empty sleeves that you fill with prints you already have. A scrapbook is a blank book you decorate by hand, combining photos with paper, handwriting, and physical keepsakes. Those differences change what each one costs, how long it takes, and how well it survives thirty years in a cupboard.",
    sections: [
      {
        h: 'What is a photo book?',
        paras: [
          "A photo book is a bound book whose pages are printed with photographs and text already on them. The layout is designed as a digital file first, then sent to a press. Nothing is inserted afterwards, because the images are part of the paper.",
          "Photo books are printed on digital presses or photographic printers, in page counts starting around 20 and running past 100. Common trim sizes range from 6 by 6 inches up to 12 by 12 inches, with 8 by 8 and 8 by 11 inches the most widely offered.",
          "Because a photo book starts as a file, it can be reprinted at any time and in any quantity. Families often order one copy per sibling from the same design, which is impossible with an album or a scrapbook without redoing all of the work.",
          "Binding options are softcover, where a paper cover is glued to the spine; hardcover, where a rigid board cover is wrapped in printed paper or cloth; and lay-flat, where pages are mounted so a spread opens completely flat and an image can cross the center without distortion.",
        ],
      },
      {
        h: 'What is a photo album?',
        paras: [
          "A photo album is a book of empty sleeves, pockets, or mounting pages that you fill with photographic prints you already own. The album carries no images when you buy it, and every image in it is a separate physical print.",
          "Albums are sized around standard print formats. Prints of 4 by 6 inches and 5 by 7 inches are the two most common, and album capacity is usually advertised in prints rather than pages, commonly 100 to 500 prints per album.",
          "Three album mechanisms dominate the market. Slip-in albums have clear pockets cut to a fixed print size. Self-adhesive albums have tacky pages under a clear film. Post-bound and three-ring albums take refill pages, so the album can grow.",
          "Self-adhesive and magnetic albums made before the 1990s frequently used acidic adhesives and PVC film, which yellow prints and can bond permanently to the photograph. Modern archival albums are labeled acid-free, lignin-free, and PVC-free, and that labeling is the most useful thing to check when buying one.",
        ],
      },
      {
        h: 'What is a scrapbook?',
        paras: [
          "A scrapbook is a blank-paged book assembled by hand, combining photographs with decorative paper, handwritten notes, and physical keepsakes such as tickets, pressed flowers, or letters. Nothing is printed for you, and every page is built individually.",
          "The dominant scrapbook page size in the United States is 12 by 12 inches, with 8.5 by 11 inches as the second standard. Pages are usually held in a post-bound or three-ring album so they can be reordered and added to over time.",
          "A scrapbook is the only one of the three formats that holds objects with thickness. A boarding pass, a hospital wristband, or a child's drawing can be mounted directly, where a photo book can only reproduce the same item as a flat scan.",
          "Scrapbooking is a craft hobby as much as a preservation method. The finished object is unique and cannot be reproduced, and the time cost is the highest of the three formats by a wide margin.",
        ],
      },
      {
        h: 'How do photo books, albums, and scrapbooks differ in construction?',
        paras: [
          "The construction difference is where the image lives. In a photo book the image is ink or toner on the page itself. In a photo album the image is a separate print held mechanically by a sleeve. In a scrapbook the image is a print physically attached to a decorated page with adhesive or photo corners.",
          "That single difference drives everything else. A page in a photo book cannot be changed after printing. A page in a photo album can be rearranged in seconds. A page in a scrapbook can be changed, but usually only by damaging what is already mounted on it.",
          "Text works differently in each format. Photo books carry typeset captions and chapter text printed alongside the images. Albums usually offer a narrow white margin or an index slot for one handwritten line. Scrapbooks take handwriting anywhere on the page, which is often the reason people choose them.",
          "Durability follows the materials rather than the format. A photo book lasts as long as its paper and binding, with press inks generally stable indoors and vulnerable to direct sunlight. Album prints last as long as the prints and the sleeve material. Scrapbooks are the most variable, because one non-archival glue or sticker can damage the photograph beside it.",
        ],
      },
      {
        h: 'What does each one cost?',
        paras: [
          "Typical market ranges are roughly 20 to 70 US dollars to print a 20 to 30 page photo book at a common size, 15 to 50 US dollars for an empty photo album, and 20 to 40 US dollars for a scrapbook album before any supplies. These are general ranges across the market rather than a quote from any specific supplier.",
          "A photo album carries a second cost that people forget: the prints themselves. Ordering 4 by 6 inch prints commonly runs somewhere between 0.10 and 0.40 US dollars each, so filling a 300-print album adds roughly 30 to 120 US dollars on top of the album.",
          "A scrapbook has the highest and least predictable consumable cost. Patterned paper, adhesives, die cuts, stamps, and embellishments are bought per project, and a single well-supplied scrapbook commonly absorbs 50 to 200 US dollars in materials over its life.",
          "A photo book is the only one of the three where the design work can also cost money, because the file has to be laid out before anything is printed. Doing it yourself is free but commonly takes 3 to 15 hours for 100 photos, and hiring a designer is typically billed at 30 to 100 US dollars an hour.",
        ],
      },
      {
        h: 'Digital or physical: how does each format exist?',
        paras: [
          "A photo book exists in both forms: a digital file that you keep and can reprint, and the printed copy on the shelf. A photo album and a scrapbook exist only as physical objects, so losing the object loses the work entirely.",
          "The digital equivalent of a photo album is a shared cloud gallery. It holds an unlimited number of images in a browsable order with no layout work at all, and it disappears if the account lapses or the service shuts down.",
          "Digital scrapbooking exists as software where decorative layouts are assembled on screen. The output is a set of designed pages, so once printed and bound it is functionally a photo book rather than a scrapbook.",
          "If long-term survival is the goal, the safest arrangement is a designed file stored in at least two places plus one printed copy. Paper survives format obsolescence, and files survive fire and flood.",
        ],
      },
      {
        h: 'Which one should you choose?',
        paras: [
          "Choose a photo book when the photos are already digital, when captions and a narrative order matter, or when more than one copy is needed. It is the only one of the three formats that reproduces.",
          "Choose a photo album when boxes of prints already exist and the goal is to get them organized quickly and reversibly. Filling an album takes an evening, where designing a book takes considerably longer.",
          "Choose a scrapbook when the physical objects matter as much as the photographs, and when the making is part of the point. It is the wrong container for 2,000 phone photos and the right container for one trip's worth of collected paper.",
          "Mixing formats is normal and usually sensible. Many families keep loose prints in archival albums for sheer volume, then make one photo book a year for the images that deserve a designed page.",
          "Yujee sits in the photo book category: it groups photos with AI, drafts captions and chapter text, lays out the pages, and outputs a 300 DPI print-ready PDF that you download and own. It does not print or ship, so the file goes to whichever print shop or online printer you prefer.",
        ],
      },
    ],
    faq: [
      {
        q: 'Is a photo book the same as a photo album?',
        a: "No. A photo book is printed with the images directly on its pages, designed as a file before printing, and cannot be changed afterwards. A photo album is a book of empty sleeves or pockets that you fill with prints you already have, and its contents can be rearranged at any time. In everyday speech the two words are often swapped, but the objects are made in completely different ways.",
      },
      {
        q: 'Which lasts longer, a photo book or a photo album?',
        a: "Both can last for decades, and materials decide the outcome more than format does. A photo book lasts as long as its paper and binding, and printed pages kept out of direct sunlight and away from humidity stay stable for many years. A photo album lasts as long as its prints and its sleeves, and older self-adhesive or PVC albums are a known risk because their adhesives and films yellow prints and can bond to the photograph. Checking for acid-free, lignin-free, and PVC-free labeling matters more than choosing one format over the other.",
      },
      {
        q: 'Are scrapbooks worth making if you already have a photo book?',
        a: "They serve different purposes, so many people keep both. A scrapbook holds physical objects with thickness, such as tickets, letters, and handwriting, which a photo book can only reproduce as a flat scan. A photo book handles large volumes of images and can be reprinted for other family members, which a handmade scrapbook cannot. If the material worth keeping is mostly paper keepsakes, a scrapbook is the better container.",
      },
      {
        q: 'What is the cheapest way to preserve a lot of printed photos?',
        a: "An archival photo album is generally the cheapest option per photo. An empty album typically costs 15 to 50 US dollars and holds 100 to 500 prints, so the cost per image stays low when the prints already exist. A photo book costs more per photo because every page is individually printed, and a scrapbook costs the most because of consumable supplies bought per project.",
      },
      {
        q: 'Can you make a photo book from phone photos?',
        a: "Yes, in almost all cases. A photo from a 12 megapixel phone camera is around 4000 by 3000 pixels, which prints cleanly up to roughly 13 by 10 inches at 300 DPI, comfortably larger than a typical photo book page. The images to watch are heavily cropped shots, screenshots, and photos saved from messaging apps, because those are often compressed to a size that prints soft.",
      },
      {
        q: 'How many photos fit in a photo book?',
        a: "A 20-page photo book typically holds 40 to 120 photographs, depending on how densely the pages are laid out. Two or three images per page reads calmly and gives each photo room, while five or six per page fits more but shrinks each one. For a full year of family photos, most people end up with 60 to 150 selected images across 30 to 60 pages.",
      },
    ],
  },

  'how-much-does-a-photo-book-cost': {
    title: 'How Much Does a Photo Book Cost? A Breakdown of Printing Prices',
    excerpt:
      "Printing a photo book typically costs 20 to 70 US dollars for a standard hardcover, and the price is driven by page count, page size, paper stock, binding, and quantity. Here is what each factor actually adds.",
    metaTitle: 'How Much Does a Photo Book Cost? Price Ranges — Yujee',
    metaDesc:
      "Printing a photo book typically costs 20 to 70 US dollars for a standard hardcover. What page count, size, paper, binding and quantity each add to the price.",
    lede:
      "Photo book pricing looks confusing because two separate things are being paid for: designing the file, and printing it. The design can cost nothing, if the hours are yours, or several hundred dollars, if the hours belong to a designer. The printing is priced by physical variables, and those are predictable once you know which ones move the number. Every range below is a typical market range in US dollars rather than a quote from any particular printer.",
    sections: [
      {
        h: 'How much does it cost to print a photo book?',
        paras: [
          "Printing a photo book typically costs between 30 and 70 US dollars for a standard 20 to 30 page hardcover at a common size such as 8 by 8 or 8 by 11 inches. Small softcover books commonly land between 15 and 35 US dollars, and large premium books with lay-flat pages commonly run 100 to 300 US dollars.",
          "Those are general market ranges for a single copy from an online photo printer, before shipping and before any promotional discount. Shipping usually adds 5 to 20 US dollars, and rush production can add roughly as much again.",
          "A local print shop prices differently, usually per printed page plus a binding charge. Expect roughly 0.50 to 3 US dollars per printed page depending on paper and size, plus 10 to 40 US dollars for binding. For short books that is often more expensive than an online printer, and for one or two copies at an unusual size it is often the only option.",
        ],
      },
      {
        h: 'What actually drives the price of a photo book?',
        paras: [
          "Six variables set the price: page count, page size, paper stock, cover type, binding method, and quantity. Everything else on a printer's order form is a smaller adjustment on top of those six.",
          "Page count and page size multiply together, because what is being bought is printed surface area. Doubling the page count of a 12 by 12 inch book raises the price far more than doubling the page count of a 6 by 6 inch one.",
          "Paper stock and binding behave as step changes rather than gradual ones. Moving from standard to thick matte paper, or from perfect binding to lay-flat, moves the total into a different bracket instead of nudging it upward.",
          "Quantity works in the opposite direction from every other variable. Each additional identical copy is cheaper than the first, because the file only has to be set up and proofed once.",
        ],
      },
      {
        h: 'How much does each extra page add?',
        paras: [
          "Each additional page typically adds 0.50 to 2 US dollars, depending on page size and paper weight. Most printers include a base page count, commonly 20 pages, in the headline price and charge per page beyond it.",
          "Pages are added in multiples of two or four, because of how printed sheets are folded and bound. A book cannot have 21 pages, and an order form will round the number up.",
          "A worked example makes the effect visible. A 20-page hardcover priced at 40 US dollars, extended to 60 pages at 1 US dollar per extra page, comes to roughly 80 US dollars. The per-page rate is what makes long books expensive, not the cover.",
        ],
      },
      {
        h: 'How much more does hardcover cost than softcover?',
        paras: [
          "Hardcover typically adds 10 to 25 US dollars over the same book in softcover. The premium pays for the rigid board, the cover wrap, and an extra binding step, and it behaves more like a flat fee than a percentage.",
          "Because it is roughly a flat fee, hardcover is proportionally cheap on a long book and proportionally expensive on a short one. Adding 15 US dollars to a 100 US dollar book is a 15 percent increase, while adding the same 15 dollars to a 20 US dollar book nearly doubles it.",
          "Cover upgrades sit on top of the hardcover premium. Dust jackets, linen or leather wraps, foil stamping, debossing, and printed slipcases each commonly add 5 to 30 US dollars.",
        ],
      },
      {
        h: 'Is lay-flat binding worth what it costs?',
        paras: [
          "Lay-flat binding typically adds 30 to 100 percent to the price of a photo book, and it earns that specifically when images cross the center of a spread. Lay-flat pages are thicker and hinged so a spread opens completely flat, which keeps a panorama or a full-bleed portrait out of the gutter.",
          "Standard perfect-bound and sewn photo books do not open flat, and roughly 6 to 12 mm of each page disappears into the spine when the book is open. Designing around that, by keeping faces and horizons away from the center of a spread, costs nothing at all.",
          "For a book where every photo sits inside its own margin on a single page, lay-flat adds cost without adding much. For wedding, travel, and landscape books built on full-spread images, it is usually the one upgrade worth paying for.",
        ],
      },
      {
        h: 'Does printing more copies make each one cheaper?',
        paras: [
          "Yes, though less dramatically than most people expect on short runs. On digital presses, which is how nearly all photo books are printed, the unit price commonly drops 20 to 40 percent between one copy and ten copies, and then flattens out.",
          "Large per-unit savings require offset printing, and offset only becomes cheaper somewhere in the hundreds of copies because of plate setup costs. For a family memoir, a reunion book, or a small memorial run, digital printing is the right choice at any quantity a household is likely to order.",
          "The practical implication is to order every copy at the same time. A reprint six months later pays full price again, and the printer may have changed paper stock or color profile in the meantime, so the two batches will not match exactly.",
        ],
      },
      {
        h: 'What does it cost to create the print-ready file?',
        paras: [
          "Creating the print-ready file is a separate cost from printing it, and it ranges from zero to several hundred US dollars. Laying out a book yourself in free vendor software costs nothing but commonly takes 3 to 15 hours for 100 photos. Hiring a designer is typically billed at 30 to 100 US dollars an hour, or several hundred dollars for a complete book.",
          "AI photo book tools sit between those two, charging tens of dollars or less to produce the file while leaving the printing to the customer. That distinction matters when comparing prices, because a tool that produces a file and a printer that produces a physical book are not substitutes for one another.",
          `Yujee is one example of the file-only model: it groups photos with AI, drafts captions and chapter text, lays out the pages, and outputs a 300 DPI print-ready PDF that you download and own, with no subscription. New accounts get ${FREE_PLAN_CREDITS} free credits, one credit covers ${PHOTOS_PER_CREDIT} photo, and credit packs are ${packList()}. It does not print or ship, so the printing cost stays separate and is paid to whichever printer the file is taken to.`,
          "When comparing a bundled service against a file-plus-printer arrangement, compare the totals rather than the headline numbers. A bundled price hides how much is design and how much is paper, and a file price looks small until printing is added to it.",
        ],
      },
    ],
    faq: [
      {
        q: 'How much does a 20-page photo book cost?',
        a: "A 20-page photo book typically costs 15 to 35 US dollars in softcover and 30 to 70 US dollars in hardcover at a common size such as 8 by 8 inches. Larger formats and premium papers push the same page count higher, and lay-flat binding can roughly double it. Shipping usually adds another 5 to 20 US dollars on top.",
      },
      {
        q: 'Why are some photo books so much more expensive than others?',
        a: "Price differences come almost entirely from physical specifications rather than from the photographs. A 12 by 12 inch lay-flat book on thick paper with a linen cover uses several times the material and several more production steps than an 8 by 8 inch softcover, so it costs several times as much. Page count multiplies that gap, because each extra page typically adds 0.50 to 2 US dollars.",
      },
      {
        q: 'Is it cheaper to print a photo book at home?',
        a: "Rarely, once everything is counted. Home inkjet consumables, photo paper, and wasted sheets from failed prints usually land in the same range as a printer's per-page price, and a home printer cannot produce a bound spine or a hardcover. Home printing makes sense for proofing a few pages before ordering, not for producing the finished book.",
      },
      {
        q: 'Do I pay separately for designing and printing a photo book?',
        a: "It depends on the service. Printers that supply their own design software fold the design cost into the print price, so there is a single payment. Tools that only produce a print-ready file charge for the file, and a printer is then paid separately for the physical book. Neither model is inherently cheaper, but a bundled service usually means the book can only be printed by that one company.",
      },
      {
        q: 'How much should I budget for a family photo book?',
        a: "For a single hardcover family book of 40 to 60 pages, budgeting 60 to 120 US dollars including shipping is realistic in most markets. If a copy is wanted for each of three siblings, add roughly 60 to 80 percent of the first copy's price for each additional copy when they are ordered together. Choosing lay-flat binding or a 12 by 12 inch format moves the whole budget into the 150 to 300 US dollar range.",
      },
      {
        q: 'Does the number of photos affect the printing price?',
        a: "Not directly. Printers charge for pages, not for images, so 200 photos across 40 pages costs the same to print as 80 photos across 40 pages. The photo count affects price only through the number of pages needed to hold the images comfortably, and through any per-photo fee charged by the software used to build the file.",
      },
    ],
  },

  'how-to-choose-an-ai-photo-book-maker': {
    title: 'How to Choose an AI Photo Book Maker: A Practical Framework',
    excerpt:
      "Judge an AI photo book maker on six things: whether it writes text or only arranges photos, whether you own the output file, its export resolution and format, what happens to your originals, how much manual placement is left, whether you can edit after generation, and how it charges.",
    metaTitle: 'How to Choose an AI Photo Book Maker: A Framework — Yujee',
    metaDesc:
      "Six questions to ask before picking an AI photo book maker: text generation, file ownership, export resolution, photo privacy, editing, and pricing model.",
    lede:
      "Most comparisons of AI photo book tools are rankings, and rankings age badly because feature sets change every few months. A checklist does not age the same way. The six dimensions below decide whether a tool fits the book you are actually trying to make, and each one can be answered from a product's own documentation in about ten minutes.",
    sections: [
      {
        h: 'What is an AI photo book maker?',
        paras: [
          "An AI photo book maker is software that takes a set of photographs and produces a designed, multi-page book layout automatically, instead of asking you to place each image on a template by hand. The AI typically handles grouping, ordering, sizing, and page composition.",
          "The category overlaps with two older ones. Template photo book editors provide empty page designs to fill manually. Auto-fill photo book services drop images into a fixed template in upload order. An AI maker differs by deciding what belongs together and how a page should be composed, rather than filling slots in sequence.",
          "Some AI makers also generate written content, including captions, chapter titles, and connecting narrative text. Others only arrange images. That split is the first thing to check, because the two kinds of tool produce very different books.",
        ],
      },
      {
        h: 'Does the tool write the text, or only arrange the photos?',
        paras: [
          "This is the largest functional split in the category, and it decides how much work is left over. A tool that only arranges photos leaves every caption, title, and paragraph to be written by hand. A tool that drafts text produces a book that can be read as well as looked at.",
          "For a holiday or event book, arrangement alone is often enough, because the photographs carry the story on their own. For a memoir, a life story, or a memorial book, generated text is the difference between an afternoon of work and several weeks of it.",
          "Where a tool does write text, check whether it writes from the images alone or whether names, dates, places, and context can be supplied to it. Text generated purely from image content tends to describe what is visible rather than what actually happened.",
          "Language coverage belongs in the same question when the book is not for English readers. Layout is language-neutral, but generated captions are not, and a tool that writes only English forces a full rewrite of every line.",
        ],
      },
      {
        h: 'Do you get a print-ready file you own, or are you locked into one printer?',
        paras: [
          "This is the dimension most people discover too late. Some tools export a file that you download and can take to any printer. Others keep the layout inside their own system and will only let you order printing from them, at their prices.",
          "A downloadable file means print quotes can be compared, a local shop can be used, the book can be reprinted years later, and a copy survives the company shutting down. A locked project file means none of that, and the print price is bundled with no way to see what is being paid for design versus paper.",
          "Locked printing is not automatically the worse deal. Bundled services manage color for their own presses and take responsibility for the finished object, which is genuinely simpler. The point is to know which model is being bought before hours go into a layout.",
          "The question to answer from the documentation is blunt: can a finished PDF be downloaded without buying a print from the same company? If the answer is not clearly yes, assume it is no.",
        ],
      },
      {
        h: 'What resolution and file format does it export?',
        paras: [
          "Print requires 300 DPI at final size, and any tool exporting below roughly 150 DPI produces a file that will look soft on paper. A tool that exports only for screen, commonly at 72 DPI, cannot produce a printable book no matter how good the layout looks on a monitor.",
          "The arithmetic is worth knowing. At 300 DPI, an image printed 8 inches wide needs 2400 pixels of width. A standard 12 megapixel phone photo at 4000 by 3000 pixels covers roughly 13 by 10 inches at that density, so ordinary phone photos are fine and heavily cropped or messaged-down photos are not.",
          "File format matters as much as resolution. A PDF opens at any print shop in the world. A proprietary project file opens only in the software that created it, which means the book exists only as long as that account does.",
          "Two production details separate a real print file from an exported picture: bleed, usually 3 mm or 0.125 inches beyond the trim edge, and correct page geometry for the intended trim size. Ask the printer what they require and confirm the tool can produce it before committing to a layout.",
        ],
      },
      {
        h: 'What happens to your original photos?',
        paras: [
          "Family photographs are among the most sensitive files most people own, and tools handle them very differently. Three things need establishing: whether full-resolution originals are uploaded to a server, how long anything uploaded is retained, and whether uploaded images are used to train models.",
          "Some tools process images in the browser and send only small compressed previews to the AI, so full-resolution files never leave the device. Others upload everything, which is necessary for server-side rendering but means the originals sit on someone else's infrastructure.",
          "Read the retention and deletion terms rather than the marketing page. The useful questions are whether uploads can be deleted, whether deletion happens immediately, and whether anything is kept after an account is closed.",
          "If the book contains photographs of children, medical situations, or family members who have died, treat the privacy model as a hard requirement rather than a preference.",
        ],
      },
      {
        h: 'How much manual work is left, and can you edit after generation?',
        paras: [
          "No AI tool produces a finished book with no involvement at all, so the real question is what kind of work remains and how it gets done. Selecting and culling photographs is almost always the customer's job. Fixing the parts the AI got wrong is where tools differ most.",
          "Editing models fall into three types. Direct editors let elements be dragged and resized on the page. Form-based editors expose text fields and options. Conversational editors accept a description of the change in words. Direct manipulation is more precise, and conversational editing is faster for structural changes such as reordering chapters.",
          "Check whether editing is possible at all once a book has been generated. Some tools regenerate the entire book when anything changes, which throws away adjustments already made.",
          "Check how photo order and grouping can be overridden. A tool that groups strictly by date will scatter a set of photographs that belong together but were taken years apart, and there needs to be a way to force them onto the same chapter.",
        ],
      },
      {
        h: 'How is it priced, and how do you apply the checklist?',
        paras: [
          "Four pricing models are common: a monthly or annual subscription, a one-off fee per book, prepaid credits, and free software whose cost is recovered in the print price. A subscription only pays off for someone making books continuously, and most people make one or two a year, which makes per-book or credit pricing cheaper.",
          "When comparing prices, separate the file from the printing. A tool charging for the file plus a printer charging for the book is not more expensive than a bundled service by default. It is simply itemized, and the total is the number to compare.",
          `Yujee is one option in this category, and it lands on the checklist as follows. It drafts captions and chapter text as well as grouping photos and laying out pages, but only in English or Chinese: a Spanish, Japanese or French reader gets an English book from a five-language interface, and has to rewrite the text or accept it as is. It exports a 300 DPI print-ready PDF that you download and own, and it does not print or ship, so the file goes to any print shop or online printer. Original photos never leave the browser and only compressed previews are sent to the AI. Editing after generation is done by chatting with it. There is no subscription: new accounts get ${FREE_PLAN_CREDITS} free credits, one credit covers ${PHOTOS_PER_CREDIT} photo, and packs are ${packList()}.`,
          "Whether that particular combination fits depends entirely on the book being made. Run the same six questions against any other tool under consideration, write the answers side by side, and the comparison resolves itself without anyone having to declare a winner.",
        ],
      },
    ],
    faq: [
      {
        q: 'Can AI really make a photo book automatically?',
        a: "Partly. Current AI photo book tools can group related photographs, choose an order, size and compose pages, and in some cases draft captions and chapter text, which removes most of the layout labor. What they cannot do is decide which photographs matter to you, so selecting and culling stays manual. Expect a strong draft rather than a finished book.",
      },
      {
        q: 'What is the difference between an AI photo book maker and a normal photo book editor?',
        a: "A normal photo book editor supplies templates and asks you to place each photo into a slot yourself. An AI photo book maker decides which photographs belong together, how many go on a page, and how each page is composed, producing a complete draft before you touch anything. The practical difference is several hours of manual placement, and some AI tools additionally write the captions and chapter text.",
      },
      {
        q: 'Do AI photo book makers work with phone photos?',
        a: "Yes, for almost all modern phone photos. A 12 megapixel photo is around 4000 by 3000 pixels, which prints cleanly up to roughly 13 by 10 inches at 300 DPI, larger than a typical photo book page. The exceptions are heavily cropped images, screenshots, and photos received through messaging apps, which are often compressed enough to print soft.",
      },
      {
        q: 'Can I print an AI-generated photo book anywhere?',
        a: "Only if the tool provides a downloadable print file. A tool that exports a 300 DPI PDF lets you use any print shop or online printer, compare quotes, and reprint years later. A tool that keeps the layout inside its own system usually requires printing to be ordered from it, so confirm that a PDF can be downloaded before investing time in a layout.",
      },
      {
        q: 'Are AI photo book makers safe to use with private family photos?',
        a: "It depends entirely on the tool, so it has to be checked rather than assumed. Three things determine the answer: whether full-resolution originals are uploaded to a server, how long uploads are retained and whether they can be deleted, and whether uploaded images are used to train models. Some tools process images in the browser and send only compressed previews to the AI, which keeps the originals on the device.",
      },
      {
        q: 'How many photos do you need for an AI photo book?',
        a: "Around 40 to 150 photographs suits most books. A 20-page book typically holds 40 to 120 images at two to six per page, and a 40 to 60 page book comfortably takes 100 to 200. Fewer than about 30 photos usually produces a thin book, and more than a few hundred is better split into separate volumes than compressed onto crowded pages.",
      },
    ],
  },
};
