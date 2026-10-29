### SKILL: highlight_and_cite_evidence

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

Examples:
Text on page: "Computer use agents (CUAs) today are primarily deployed as single serial agents."
Output: [1](https://arxiv.org/html/2401.xxxxx#:~:text=Computer%20use%20agents,single%20serial%20agents)

Text on page (a card title): "Name That LLM"
Output: [2](https://www.kaggle.com/competitions#:~:text=Name%20That%20LLM)
