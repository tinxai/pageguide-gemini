### SKILL: pg

Cite evidence from the page the user is viewing as a markdown link:
`[N](<CURRENT_PAGE_URL>#:~:text=<START_WORDS>,<END_WORDS>)`

Always use this format. Every factual statement taken from the page must end with a numbered citation link like this. The link text is only the number, for example [1]. Never use titles, names, or quoted words as the link text, and never write a plain link without #:~:text=.

Rules:
1. Use the exact full URL of the page the user has open, starting with "https://". Do not shorten it, change it, or link to a different version of the page.
2. Quote only visible text from the main content of the page, copied exactly as written: same spelling, no paraphrasing. Do not quote menus, sidebars, headers, footers, buttons, hidden text, or text inside images.
3. Quote one sentence, one table cell, or one short label, all inside a single paragraph, card, or list item. Never span several paragraphs, cards, or sections.
4. START_WORDS are the first 3 words of the quote. END_WORDS are the last 3 words. If the quote is 6 words or fewer, use the whole quote as START_WORDS and leave out the comma and END_WORDS.
5. Use only letters and numbers in the fragment. Remove punctuation. Encode each space as %20. Separate START_WORDS and END_WORDS with a single comma.
6. Pick plain words: avoid formulas, ligature words (fi, fl), and words split across lines, so PDFs match too.
7. Pick words that appear only once on the page when you can. If the first 3 words repeat elsewhere (for example in a menu), use a different part of the sentence.
8. N is the citation number. Use a new number for each distinct quote.

Navigation and browsing tasks (for example "go to Amazon and find me a banana"):
- The final answer must cite every fact you report: product name, price, rating, stock, and so on.
- For each fact, use the exact URL of the page where you saw it, for example the product page, not the search results page, and not the site's home page. Add #:~:text= and the words exactly as they appear on that page.
- Write each fact as its own short statement ending in its own [N] link, for example:
  Organic Bananas Bunch [1], priced at $17.86 [2], rated 3.9 out of 5 stars [3].
- Do not turn product names or titles into links. The only links are the numbered citations.
- If you could not see a fact on the page, do not cite it.

Visual evidence (objects in an image, photo, chart, diagram, map, canvas, or video frame):
Text quotes cannot point at things that are not text. For these, use a box link instead:
`[N](<CURRENT_PAGE_URL>#pg-box=<YMIN>,<XMIN>,<YMAX>,<XMAX>&img=<HINT>&label=<SHORT_EXPLANATION>)`
- The four numbers are integers from 0 to 1000, in the order ymin, xmin, ymax, xmax (y first), measured inside the image, map, or chart itself and not inside the whole page. 0,0 is its top-left corner and 1000,1000 its bottom-right.
- Draw the box tight around the object you mean.
- HINT helps find the right picture when the page has several: use a word from its alt text or file name, or "map" or "chart". Leave out `&img=...` if you are unsure.
- SHORT_EXPLANATION is at most 6 words saying what the box shows. Use only letters and numbers, with %20 for spaces.
- Use the box link, not a text link, whenever the evidence is something you see rather than something written.
- Text AND picture: if the thing you cite is both written on the page and drawn on an image or map (for example a parking lot named in a sidebar and also shown on a map), you must give both in ONE link, with the text first: `[N](<CURRENT_PAGE_URL>#:~:text=<WORDS>&pg-box=<YMIN>,<XMIN>,<YMAX>,<XMAX>&img=map&label=<SHORT_EXPLANATION>)`. Never give only the text part when the thing is also visible on a map or image.

Examples:
Text on page: "Computer use agents (CUAs) today are primarily deployed as single serial agents."
Output: [1](https://arxiv.org/html/2401.xxxxx#:~:text=Computer%20use%20agents,single%20serial%20agents)

Text on page (a card title): "Name That LLM"
Output: [2](https://www.kaggle.com/competitions#:~:text=Name%20That%20LLM)

Visual evidence on a map: the Eiffel Tower marked on a map image
Output: [3](https://example.com/paris-guide#pg-box=410,520,470,575&img=map&label=Eiffel%20Tower%20location)

Named on the page and shown on a map: the Broun Lot
Output: [4](https://example.com/campus-map#:~:text=Broun%20Lot&pg-box=480,300,540,380&img=map&label=Broun%20Lot%20parking)
